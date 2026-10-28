// ============================================================
// GUARDVETO V2 — Organisation du cabinet (écran fusionné)
// ============================================================
// Quatrième écran de la bascule. Il RÉUNIT deux pages V1 qui répondaient à une
// seule question — « comment mon cabinet fonctionne-t-il ? » — sans jamais se
// lier l'une à l'autre : `/regles` (ce que le moteur doit respecter) et
// `/admin/structure` (comment les gardes sont bâties).
//
// Le symptôme le plus net de ce découpage : on créait une liaison entre deux
// créneaux dans Structure, mais on réglait sa fermeté dans Règles. Un seul
// sujet, deux écrans, deux tables — et l'utilisateur au milieu. L'onglet
// « Enchaînements » les remet ensemble.
//
// Ce qui NE vient PAS ici : les paramètres du cabinet (agenda Google,
// expéditeur d'e-mails, adresse → zone scolaire). Ils sont déjà refaits en V2
// dans `/reglages` ; les reprendre créerait deux portes d'écriture sur la même
// table `cabinets`.
//
// OUVERT À TOUTE L'ÉQUIPE, EN ÉCRITURE ADMIN. Un vétérinaire y lit ce qui
// fabrique son planning — les horaires, les enchaînements, les règles — sans
// pouvoir rien changer. Voir le commentaire sur `estAdmin` plus bas.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { exigerVeterinaire } from '@/lib/identite'
import '@/styles/v2-absences.css'
import '@/styles/v2-filou-edge.css'
import '@/styles/v2-regles.css'
import '@/styles/regles-forces.css'
import '@/styles/v2-journee.css'
import '@/styles/v2-organisation.css'
import { OrganisationParties, type PartieOrganisation } from '@/components/v2/OrganisationParties'
import { BlocsJournee } from '@/components/v2/BlocsJournee'
import { ModuleEteint } from '@/components/v2/ModuleEteint'
import { TramesJournee } from '@/components/v2/TramesJournee'
import { modulesDuCabinet } from '@/lib/produit/modules-serveur'
import { MODULE_JOURNEE } from '@/lib/journee/porte'
import { MODULE_SOCLE } from '@/lib/produit/modules'
import { plageLisible } from '@/lib/journee/blocs'
import type { BlocJournee, TrameJournee } from '@/types'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { ReglesStructureV2 } from '@/components/v2/ReglesStructureV2'
import { chargerDock } from '@/data/v2/dock'
import { chargerProfilsStructure } from '@/data/v2/reglesStructure'
import { chargerOptionsRegles } from '@/data/optionsRegles'
import type { RegleRow, TypeCreneauOption } from '@/components/regles/ReglesClient'
import type { RegleEquipeUI } from '@/components/regles/CompositionEquipeClient'
import type { StructureRegleUI } from '@/components/regles/ReglagesPlanningClient'
import type { CohorteEquiteUI } from '@/app/(protected)/regles/actions'
import type { VetoUI } from '@/components/v2/regles/types'
import {
  EQUITY_DIMENSIONS,
  DEFAULT_IMPORTANCE,
  IMPORTANCE_LEVELS,
  type EquityDimension,
  type ImportanceLevel,
} from '@/engine/equity-weights'
import type { Veterinaire } from '@/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'GuardVeto — Organisation du cabinet' }

const BRIQUE_EQUILIBRER = 'equilibrer'
const BRIQUE_LIAISON = 'liaison_creneaux' // R9 — même équipe
const BRIQUE_INVERSION = 'inversion_role' // R8 — rôles différents
const BRIQUE_COMPOSITION = 'composition_equipe' // n°6
const BRIQUE_ROLE_INTERDIT = 'role_interdit_tag' // n°22
const IMPORTANCES = new Set<string>(IMPORTANCE_LEVELS)
const FORCES_STRUCTURE = new Set(['jamais', 'sauf_crise', 'evitee', 'si_possible'])
const FORCES_SOUPLES = new Set(['sauf_crise', 'evitee', 'si_possible'])

// Pénalités souples réglables (backlog n°16) : brique → force par DÉFAUT
// (= l'étage historique de chaque règle). Une règle absente n'est pas une règle
// éteinte : c'est une règle à son niveau d'origine.
const PENALITES_SOUPLES_DEFAUT_FORCE: Record<string, string> = {
  eviter_we_avant_vacances: 'evitee', // R10c (étage 4)
  eviter_fete_fin_annee: 'evitee', // R10b (étage 4)
  inversion_role_ferie: 'si_possible', // R8b  (étage 5)
  eviter_veille_repos: 'evitee', // R10d (étage 4) — B-063
}

/** Résout {actif, force} d'une règle structurelle (défaut historique : ferme + active). */
function resoudreStructure(rows: RegleRow[], briqueId: string): StructureRegleUI {
  const row = rows.find((r) => r.brique_id === briqueId)
  if (!row) return { actif: true, force: 'jamais' }
  const force = FORCES_STRUCTURE.has(row.force) ? row.force : 'jamais'
  return { actif: row.actif, force }
}

/** Résout {actif, force} d'une pénalité souple (une force dure retombe au défaut). */
function resoudrePenaliteSoupleUI(rows: RegleRow[], briqueId: string): StructureRegleUI {
  const defaut = PENALITES_SOUPLES_DEFAUT_FORCE[briqueId] ?? 'sauf_crise'
  const row = rows.find((r) => r.brique_id === briqueId)
  if (!row) return { actif: true, force: defaut }
  const force = FORCES_SOUPLES.has(row.force) ? row.force : defaut
  return { actif: row.actif, force }
}

export default async function ReglesStructurePage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string; onglet?: string; partie?: string }>
}) {
  const { focus, onglet, partie: partieDemandee } = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Le secretariat n'a pas de fiche veterinaire : `exigerVeterinaire` le
  // renvoie vers le planning au lieu de le deconnecter (B-017, 2026-08-25).
  // C'est ce refus SERVEUR qui ferme la porte -- le dock reduit n'est qu'un
  // confort d'affichage.
  const { veto: moi } = await exigerVeterinaire(supabase)

  const vet = moi as Veterinaire

  // OUVERT AUX VÉTÉRINAIRES, EN LECTURE SEULE.
  //
  // Les deux pages V1 fusionnées ici l'étaient déjà : leur `isAdmin` grisait
  // les boutons, il ne fermait pas la porte, et chaque section affichait
  // « (Lecture seule — seul l'administrateur peut modifier.) ». La bascule V2 a
  // posé un `redirect` à la place, et un vétérinaire s'est retrouvé sans aucun
  // moyen de voir les horaires et les règles qui produisent SON planning.
  //
  // Rétabli le 2026-08-01 sur décision de MiKL. La doctrine du produit est
  // « le véto propose, l'admin ancre » : proposer suppose de voir ce qui existe.
  //
  // L'écriture, elle, reste fermée à trois niveaux : les boutons ne sont pas
  // rendus, le contenu est enveloppé d'un `<fieldset disabled>`, et surtout
  // chaque action serveur porte son propre `assertAdmin` — c'est celui-là qui
  // protège réellement, les deux autres ne font qu'éviter de promettre un
  // geste impossible.
  const estAdmin = vet.role_app === 'admin'

  // ── B-175 — DEUX PARTIES : gardes et journées ─────────────────────────────
  // MiKL, 27/10 : « l'onglet journée devrait appartenir à l'onglet
  // organisation ». La partie Journées n'existe que si le module est allumé ;
  // une adresse `?partie=journees` sur un cabinet sans le module retombe sur
  // les gardes au lieu d'afficher une partie vide.
  const modules = await modulesDuCabinet(supabase)
  const journeeAllumee = modules.includes(MODULE_JOURNEE)
  // B-175a (28/10) — un cabinet « journées seules » n'a pas de partie Gardes :
  // il ouvre directement sur les journées, quelle que soit l'adresse.
  const gardesAllumees = modules.includes(MODULE_SOCLE)
  const partie: PartieOrganisation =
    journeeAllumee && (partieDemandee === 'journees' || !gardesAllumees) ? 'journees' : 'gardes'

  if (partie === 'journees') {
    return (
      <PartieJournees vet={vet} estAdmin={estAdmin} supabase={supabase} gardesAllumees={gardesAllumees} />
    )
  }

  // On a demandé les journées (ancien lien /journee, favori) sur un cabinet où
  // le module est éteint : on le DIT, au lieu de montrer les gardes comme si
  // de rien n'était (B-120a ②, « une porte qui se referme sans un mot »).
  if (partieDemandee === 'journees') {
    const dockEteint = await chargerDock(supabase, vet)
    return (
      <>
        <Satin />
        <div className="shell">
          <BarreV2 prenom={vet.prenom} estAdmin={estAdmin} dock={dockEteint} />
          <OrganisationParties partie="gardes" estAdmin={estAdmin} journeeAllumee={false} gardesAllumees />
          <ModuleEteint module={MODULE_JOURNEE} estAdmin={estAdmin} />
        </div>
      </>
    )
  }

  const [reglesRes, vetsRes, cabinetRes, profils, options] = await Promise.all([
    supabase
      .from('regles_cabinet')
      .select('id, brique_id, params_json, force, actif, periode_id')
      .order('brique_id')
      .order('id'),
    supabase.from('veterinaires').select('id, prenom, nom, couleur, tags, actif').order('nom'),
    // R11b : rôle à avantage financier (RLS cabinets = lecture de SON cabinet).
    supabase.from('cabinets').select('role_avantage_financier').maybeSingle(),
    chargerProfilsStructure(supabase),
    // Source UNIQUE des trois listes du formulaire de règle (périodes, types de
    // créneaux, rôles), partagée avec l'écran Équipe. La V1 dupliquait cette
    // logique en ligne dans sa page : deux écrans, deux catalogues possibles.
    chargerOptionsRegles(supabase),
  ])

  const toutesRegles = ((reglesRes?.data ?? []) as RegleRow[]) ?? []
  const vets = ((vetsRes?.data ?? []) as VetoUI[]) ?? []
  const roleAvantage =
    (cabinetRes?.data as { role_avantage_financier?: string } | null)?.role_avantage_financier ??
    'premier'

  const periodes = options.periodes
  const typesCreneaux = options.typesCreneaux as TypeCreneauOption[]

  // On comptait ici les plannings encore rattachés à AUCUNE période type, pour
  // décider s'il fallait montrer « Configuration standard ». Elle ne se montre
  // désormais JAMAIS (MiKL, 2026-08-19) : le compte n'a plus d'objet.
  const rolesCabinet = options.rolesCabinet

  // Étiquettes réellement portées par l'équipe : les suggestions des formulaires
  // de composition et de cohorte ne proposent que des tags qui existent.
  const tagsEquipe = [
    ...new Set(
      vets
        .flatMap((v) => v.tags ?? [])
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t !== ''),
    ),
  ].sort()

  // Règles gérées dans leurs propres sections — retirées de la liste par-véto.
  const GLOBALES = new Set([
    BRIQUE_EQUILIBRER,
    BRIQUE_LIAISON,
    BRIQUE_INVERSION,
    BRIQUE_COMPOSITION,
    BRIQUE_ROLE_INTERDIT,
    ...Object.keys(PENALITES_SOUPLES_DEFAUT_FORCE),
  ])
  const reglesClassiques = toutesRegles.filter((r) => !GLOBALES.has(r.brique_id))
  const reglesEquilibrer = toutesRegles.filter((r) => r.brique_id === BRIQUE_EQUILIBRER)

  // Règles d'équipe par étiquette (n°6 + n°22) → forme UI unifiée.
  const reglesEquipe: RegleEquipeUI[] = toutesRegles
    .filter((r) => r.brique_id === BRIQUE_COMPOSITION || r.brique_id === BRIQUE_ROLE_INTERDIT)
    .flatMap((r): RegleEquipeUI[] => {
      const p = (
        r.params_json as {
          params?: { mode?: string; tag?: string; role?: string; creneaux?: unknown }
        }
      )?.params
      const tag = p?.tag
      if (typeof tag !== 'string') return []
      const creneaux = Array.isArray(p?.creneaux)
        ? (p.creneaux as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      const force = FORCES_STRUCTURE.has(r.force) ? r.force : 'jamais'
      if (r.brique_id === BRIQUE_COMPOSITION) {
        const mode = p?.mode
        if (mode !== 'au_moins_un' && mode !== 'pas_seuls') return []
        return [
          {
            id: r.id,
            brique: 'composition_equipe' as const,
            mode,
            tag,
            creneaux,
            force,
            actif: r.actif,
          },
        ]
      }
      const role = p?.role
      if (typeof role !== 'string' || role.trim() === '') return []
      return [
        {
          id: r.id,
          brique: 'role_interdit_tag' as const,
          tag,
          role,
          creneaux,
          force,
          actif: r.actif,
        },
      ]
    })

  // Niveau (ferme/souple) des deux genres de liaison — la moitié « Règles » du
  // sujet « Enchaînements », que l'onglet affiche avec les liaisons elles-mêmes.
  const niveauxLiaison = {
    meme_binome: resoudreStructure(toutesRegles, BRIQUE_LIAISON),
    inversion_role: resoudreStructure(toutesRegles, BRIQUE_INVERSION),
  }

  const penalitesSouples = Object.fromEntries(
    Object.keys(PENALITES_SOUPLES_DEFAUT_FORCE).map((b) => [
      b,
      resoudrePenaliteSoupleUI(toutesRegles, b),
    ]),
  ) as Record<string, StructureRegleUI>

  // Importance courante par dimension GLOBALE (sans tag) : règle posée sinon
  // défaut. Les lignes COHORTE (avec tag) ont leur propre sous-section.
  const importances = Object.fromEntries(
    EQUITY_DIMENSIONS.map((dim) => {
      const regle = reglesEquilibrer.find((r) => {
        const p = (r.params_json as { params?: { dimension?: string; tag?: unknown } })?.params
        const t = typeof p?.tag === 'string' ? p.tag.trim() : ''
        return p?.dimension === dim && t === ''
      })
      const imp = (regle?.params_json as { params?: { importance?: string } })?.params?.importance
      const valide = typeof imp === 'string' && IMPORTANCES.has(imp)
      return [dim, valide ? (imp as ImportanceLevel) : DEFAULT_IMPORTANCE[dim]]
    }),
  ) as Record<EquityDimension, ImportanceLevel>

  // Cohortes d'équité (Vague 6 #21) : lignes `equilibrer` AVEC un tag.
  const cohortesEquite: CohorteEquiteUI[] = reglesEquilibrer.flatMap((r): CohorteEquiteUI[] => {
    const p = (
      r.params_json as { params?: { dimension?: string; importance?: string; tag?: unknown } }
    )?.params
    const tag = typeof p?.tag === 'string' ? p.tag.trim().toLowerCase() : ''
    const dimension = p?.dimension
    const importance = p?.importance
    if (tag === '' || typeof dimension !== 'string' || typeof importance !== 'string') return []
    if (!(EQUITY_DIMENSIONS as readonly string[]).includes(dimension)) return []
    if (!IMPORTANCES.has(importance)) return []
    return [{ id: r.id, dimension, tag, importance }]
  })

  const dock = await chargerDock(supabase, vet)

  return (
    <>
      <Satin />
      <div className="shell">
        <BarreV2 prenom={vet.prenom} estAdmin={estAdmin} dock={dock} />
        <OrganisationParties partie="gardes" estAdmin={estAdmin} journeeAllumee={journeeAllumee} gardesAllumees />
        <ReglesStructureV2
          estAdmin={estAdmin}
          ongletInitial={onglet}
          focus={focus}
          profils={profils.profils}
          socle={profils.socle}
          relationsSocle={profils.relations}
          regles={reglesClassiques}
          reglesEquipe={reglesEquipe}
          vets={vets}
          periodes={periodes}
          typesCreneaux={typesCreneaux}
          rolesCabinet={rolesCabinet}
          tagsEquipe={tagsEquipe}
          equite={importances}
          cohortes={cohortesEquite}
          niveauxLiaison={niveauxLiaison}
          penalitesSouples={penalitesSouples}
          roleAvantage={roleAvantage}
        />
      </div>
    </>
  )
}

/**
 * B-175 — la partie Journées d'Organisation (ex-écran « Journée »).
 *
 * L'ADMIN y règle tout : les tranches horaires et la semaine type de chacun.
 * UN VÉTÉRINAIRE y lit les tranches et remplit SA semaine type, et rien
 * d'autre (MiKL, 27/10 : « chaque véto sa semaine type, l'admin garde la
 * main »). Le refus réel est dans `porteTrame` et dans la RLS.
 */
async function PartieJournees({
  vet,
  estAdmin,
  supabase,
  gardesAllumees,
}: {
  vet: Veterinaire
  estAdmin: boolean
  supabase: Awaited<ReturnType<typeof createClient>>
  gardesAllumees: boolean
}) {
  // La RLS borne au cabinet (policy RESTRICTIVE). On lit TOUT, actif ou non :
  // l'écran range lui-même les lignes retirées, et les masquer ici rendrait la
  // remise en service impossible depuis l'interface.
  const [{ data: dataBlocs }, { data: dataTrames }, { data: dataEquipe }, dock] = await Promise.all([
    supabase
      .from('blocs_journee')
      .select('id, cabinet_id, nom, debut, fin, creneau, ordre, actif')
      .order('ordre', { ascending: true }),
    supabase
      .from('trames_journee')
      .select('id, cabinet_id, veterinaire_id, bloc_id, jour, semaine, actif'),
    // Seuls les actifs sont proposés : une trame bâtie sur quelqu'un qui a
    // quitté le cabinet poserait des présences fantômes.
    supabase
      .from('veterinaires')
      .select('id, prenom, nom, role_app, actif')
      .eq('actif', true)
      .order('prenom', { ascending: true }),
    chargerDock(supabase, vet),
  ])

  const blocs = (dataBlocs ?? []) as BlocJournee[]
  const trames = (dataTrames ?? []) as TrameJournee[]
  const equipe = (dataEquipe ?? []) as Veterinaire[]
  const tranchesActives = blocs.filter((b) => b.actif)

  return (
    <>
      <Satin />
      <div className="shell">
        <BarreV2 prenom={vet.prenom} estAdmin={estAdmin} dock={dock} />
        <OrganisationParties
          partie="journees"
          estAdmin={estAdmin}
          journeeAllumee
          gardesAllumees={gardesAllumees}
        />
        <div className="page-head rise">
          <div>
            <h1>Organisation des journées</h1>
            {!estAdmin && (
              <p className="ro-bandeau">
                Vous remplissez ici votre propre semaine type. Les tranches horaires et les
                journées des plannings restent réglées par l&apos;administratrice.
              </p>
            )}
          </div>
        </div>

        {estAdmin ? (
          <>
            <BlocsJournee blocs={blocs} />
            <TramesJournee trames={trames} blocs={blocs} equipe={equipe} />
          </>
        ) : (
          <>
            <div className="card">
              <div className="card-head">
                <h2>Les tranches horaires du cabinet</h2>
              </div>
              <div className="card-body">
                {tranchesActives.length === 0 ? (
                  <p className="conn-line">Aucune tranche horaire n’est encore définie.</p>
                ) : (
                  <ul className="org-tranches">
                    {tranchesActives.map((b) => (
                      <li key={b.id}>
                        <b>{b.nom}</b>
                        {plageLisible(b.debut, b.fin)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <TramesJournee
              trames={trames}
              blocs={blocs}
              equipe={equipe.filter((v) => v.id === vet.id)}
              limiterA={vet.id}
              pourMoi
            />
          </>
        )}
      </div>
    </>
  )
}
