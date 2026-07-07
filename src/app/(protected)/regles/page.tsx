// ============================================================
// GUARDVETO — Page « Règles du cabinet » (P1A-006)
// ============================================================
// Liste les regles_cabinet en LANGAGE NATUREL (catalogue P1A-005),
// groupées par force. L'admin gère (activer/désactiver/supprimer +
// créer/éditer en P1A-007) ; le véto consulte en lecture seule.
//
// Les règles d'ÉQUITÉ (famille `equilibrer`) sont sorties de la liste
// principale et affichées dans leur propre section « Équilibrage des
// charges » : même page, même vocabulaire d'importance, forme adaptée
// (elles ciblent un compteur, pas un véto).
//
// La RLS restrictive (F5-003) scope automatiquement la lecture au
// cabinet de l'utilisateur — aucun cabinet_id à passer ici.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { chargerCreneauModele } from '@/data/chargerCreneauModele'
import { ReglesClient, type RegleRow, type VetoMini, type TypeCreneauOption } from '@/components/regles/ReglesClient'
import { ReglesFocus } from '@/components/regles/ReglesFocus'
import {
  ReglagesPlanningClient,
  type StructureRegleUI,
} from '@/components/regles/ReglagesPlanningClient'
import {
  EQUITY_DIMENSIONS,
  DEFAULT_IMPORTANCE,
  IMPORTANCE_LEVELS,
  type EquityDimension,
  type ImportanceLevel,
} from '@/engine/equity-weights'
import { periodeLabelCourt, type PeriodeMini } from '@/lib/periodes'

const BRIQUE_EQUILIBRER = 'equilibrer'
const BRIQUE_LIAISON = 'liaison_creneaux' // R9
const BRIQUE_INVERSION = 'inversion_role' // R8
const IMPORTANCES = new Set<string>(IMPORTANCE_LEVELS)
const FORCES_STRUCTURE = new Set(['jamais', 'sauf_crise', 'evitee', 'si_possible'])
const FORCES_SOUPLES = new Set(['sauf_crise', 'evitee', 'si_possible'])

// Pénalités souples réglables (backlog n°16) : brique → force par DÉFAUT
// (= l'étage historique de chaque règle — cf. PENALITE_SOUPLE_DEFAUT).
const PENALITES_SOUPLES_DEFAUT_FORCE: Record<string, string> = {
  eviter_we_consecutifs: 'sauf_crise',    // R10  (étage 3)
  eviter_we_avant_vacances: 'evitee',     // R10c (étage 4)
  eviter_fete_fin_annee: 'evitee',        // R10b (étage 4)
  inversion_role_ferie: 'si_possible',    // R8b  (étage 5)
}

/** Résout {actif, force} d'une règle structurelle depuis les lignes (défaut Ferme/active). */
function resoudreStructure(rows: RegleRow[], briqueId: string): StructureRegleUI {
  const row = rows.find((r) => r.brique_id === briqueId)
  if (!row) return { actif: true, force: 'jamais' } // défaut historique = ferme + active
  const force = FORCES_STRUCTURE.has(row.force) ? row.force : 'jamais'
  return { actif: row.actif, force }
}

/** Résout {actif, force} d'une pénalité souple (défaut = actif + force historique). */
function resoudrePenaliteSoupleUI(rows: RegleRow[], briqueId: string): StructureRegleUI {
  const defaut = PENALITES_SOUPLES_DEFAUT_FORCE[briqueId] ?? 'sauf_crise'
  const row = rows.find((r) => r.brique_id === briqueId)
  if (!row) return { actif: true, force: defaut }
  // Toujours souple : une force dure (posée hors formulaire) s'affiche au défaut.
  const force = FORCES_SOUPLES.has(row.force) ? row.force : defaut
  return { actif: row.actif, force }
}

export default async function ReglesPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>
}) {
  const { focus } = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentVeto } = await supabase
    .from('veterinaires')
    .select('role_app, id')
    .eq('user_id', user.id)
    .single()

  if (!currentVeto) redirect('/login')

  const [{ data: regles }, { data: vets }, { data: periodesDb }, { data: cabinetRow }] = await Promise.all([
    supabase
      .from('regles_cabinet')
      .select('id, brique_id, params_json, force, actif, periode_id')
      .order('brique_id')
      .order('id'),
    supabase.from('veterinaires').select('id, prenom, nom, couleur').order('nom'),
    supabase
      .from('periodes')
      .select('id, saison, numero, libelle, date_debut, date_fin')
      .neq('statut', 'verrouille') // une période verrouillée ne sera plus régénérée → inutile pour scoper une règle
      .order('date_debut', { ascending: false }),
    // R11b : rôle à avantage financier (RLS cabinets = lecture de SON cabinet).
    supabase.from('cabinets').select('role_avantage_financier').maybeSingle(),
  ])

  const roleAvantage =
    (cabinetRow as { role_avantage_financier?: string } | null)?.role_avantage_financier ?? 'premier'

  // Périodes proposables au formulaire (libellé non ambigu construit côté client).
  const periodes = ((periodesDb as PeriodeMini[]) ?? []).map((p) => ({
    id: p.id,
    label: periodeLabelCourt(p),
  }))

  const isAdmin = currentVeto.role_app === 'admin'
  const toutesRegles = (regles as RegleRow[]) ?? []

  // Types de créneaux DU cabinet (n°19 — filtre au_plus_n). Dynamique (verrou 8) :
  // catalogue actif du profil défaut ; sans catalogue → 3 types historiques.
  let typesCreneaux: TypeCreneauOption[] = []
  try {
    const cabinetId = await resoudreCabinetId(supabase)
    const modeles = await chargerCreneauModele(supabase, cabinetId)
    typesCreneaux = modeles
      .filter((m) => m.actif && m.code !== null && m.code !== 'ferie')
      .map((m) => ({ code: m.code as string, nom: m.nom }))
  } catch {
    // best-effort : repli ci-dessous
  }
  if (typesCreneaux.length === 0) {
    typesCreneaux = [
      { code: 'semaine_soir', nom: 'Soirs de semaine' },
      { code: 'vendredi_soir', nom: 'Vendredi soir' },
      { code: 'weekend', nom: 'Week-end' },
    ]
  }

  // Règles GLOBALES gérées dans leurs propres sections (pas dans la liste par-véto) :
  // équité (equilibrer) + structurelles week-end (R8/R9) + pénalités souples
  // réglables (backlog n°16). On les retire du listing.
  const GLOBALES = new Set([
    BRIQUE_EQUILIBRER, BRIQUE_LIAISON, BRIQUE_INVERSION,
    ...Object.keys(PENALITES_SOUPLES_DEFAUT_FORCE),
  ])
  const reglesClassiques = toutesRegles.filter((r) => !GLOBALES.has(r.brique_id))
  const reglesEquilibrer = toutesRegles.filter((r) => r.brique_id === BRIQUE_EQUILIBRER)

  // Config courante R8/R9 (règle posée, sinon défaut Ferme + active).
  const structureConfig = {
    liaison_creneaux: resoudreStructure(toutesRegles, BRIQUE_LIAISON),
    inversion_role: resoudreStructure(toutesRegles, BRIQUE_INVERSION),
  }

  // Config courante des 4 pénalités souples (défaut = actif + niveau historique).
  const penalitesSouples = Object.fromEntries(
    Object.keys(PENALITES_SOUPLES_DEFAUT_FORCE).map((b) => [
      b, resoudrePenaliteSoupleUI(toutesRegles, b),
    ]),
  ) as Record<string, StructureRegleUI>

  // Importance courante par dimension : règle posée si elle existe, sinon défaut.
  const importances = Object.fromEntries(
    EQUITY_DIMENSIONS.map((dim) => {
      const regle = reglesEquilibrer.find(
        (r) => (r.params_json as { params?: { dimension?: string } })?.params?.dimension === dim,
      )
      const imp = (regle?.params_json as { params?: { importance?: string } })?.params?.importance
      const valide = typeof imp === 'string' && IMPORTANCES.has(imp)
      return [dim, valide ? (imp as ImportanceLevel) : DEFAULT_IMPORTANCE[dim]]
    }),
  ) as Record<EquityDimension, ImportanceLevel>

  return (
    <div className="space-y-10">
      <ReglesFocus focus={focus} />
      <ReglesClient
        regles={reglesClassiques}
        vets={(vets as VetoMini[]) ?? []}
        periodes={periodes}
        typesCreneaux={typesCreneaux}
        isAdmin={isAdmin}
      />
      <ReglagesPlanningClient
        equite={importances}
        structure={structureConfig}
        penalitesSouples={penalitesSouples}
        roleAvantage={roleAvantage}
        isAdmin={isAdmin}
      />
    </div>
  )
}
