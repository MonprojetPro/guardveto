// ============================================================
// GUARDVETO — Page /admin/structure (A3)
// ============================================================
// Écran admin où un cabinet règle SES horaires de garde par type.
// Pour chacun des 4 types de créneau, on préremplit avec la surcharge du
// cabinet (creneaux_cabinet) si elle existe, sinon avec les horaires PAR
// DÉFAUT (structure-creneaux), en signalant visuellement « valeur par défaut ».
//
// La RLS restrictive (migration A1) scope la lecture au cabinet ; le cabinet_id
// n'est utilisé ici que pour filtrer explicitement les surcharges. L'admin
// édite ; le véto consulte en lecture seule (comme /regles).
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { CRENEAUX, structureParDefaut } from '@/engine/structure-creneaux'
import type { TypeGardeEngine } from '@/engine/types'
import type { CreneauModele } from '@/engine/creneau-modele'
import { chargerCreneauModele } from '@/data/chargerCreneauModele'
import {
  StructureCreneauxClient, type CreneauUI,
} from '@/components/admin/StructureCreneauxClient'
import {
  CatalogueCreneauxView, type CatalogueTypeUI,
} from '@/components/admin/CatalogueCreneauxView'

/** Ordre d'affichage des types de créneau. */
const ORDRE: TypeGardeEngine[] = ['semaine_soir', 'vendredi_soir', 'weekend', 'ferie']

/** Jours en clair (0 = dimanche … 6 = samedi). */
const JOURS_COURTS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

/** Libellés « en clair » du jour de fin (miroir de StructureCreneauxClient). */
const OFFSET_CLAIR: Record<number, string> = {
  0: '', 1: ', le lendemain', 2: ', le surlendemain', 3: ', trois jours après',
}

/** Rôle en clair : premier → 1er, second → 2nd, troisieme → 3e… sinon le label brut. */
function roleClair(role: string): string {
  const map: Record<string, string> = {
    premier: '1er', second: '2nd', troisieme: '3e', quatrieme: '4e', cinquieme: '5e',
  }
  return map[role] ?? role
}

/** Décrit les jours couverts d'un type (jours de semaine + fériés). */
function joursClair(c: CreneauModele): string {
  const jours = [...c.joursSemaine].sort((a, b) => a - b).map((j) => JOURS_COURTS[j])
  const parts: string[] = []
  if (jours.length > 0) parts.push(jours.join(', '))
  if (c.surFeries) parts.push('jours fériés')
  return parts.length > 0 ? parts.join(' + ') : '—'
}

/** Décrit les places/rôles d'un type. */
function placesClair(c: CreneauModele): string {
  const n = c.nbPlaces
  const noms = c.roles.map(roleClair).join(', ')
  const motPlace = n > 1 ? 'places' : 'place'
  return noms ? `${n} ${motPlace} : ${noms}` : `${n} ${motPlace}`
}

/** Décrit les horaires d'un type. */
function horairesClair(c: CreneauModele): string {
  return `Garde de ${c.heureDebut} à ${c.heureFin}${OFFSET_CLAIR[c.offsetJoursFin] ?? ''}.`
}

/** Mappe le catalogue moteur → vue d'affichage (déjà mis en clair). */
function versCatalogueUI(catalogue: CreneauModele[]): CatalogueTypeUI[] {
  return [...catalogue]
    .sort((a, b) => a.ordre - b.ordre)
    .map((c) => ({
      id: c.id,
      nom: c.nom,
      jours: joursClair(c),
      places: placesClair(c),
      horaires: horairesClair(c),
      actif: c.actif,
    }))
}

interface CreneauCabinetRow {
  code: string
  heure_debut: string // Postgres TIME → 'HH:MM:SS'
  heure_fin: string
  offset_jours_fin: number
}

/** Postgres TIME 'HH:MM:SS' → 'HH:MM' pour l'input time. */
function hhmm(t: string): string {
  return t.slice(0, 5)
}

export default async function StructurePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentVeto } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()
  if (!currentVeto) redirect('/login')

  const isAdmin = currentVeto.role_app === 'admin'

  // cabinet_id (best-effort) pour filtrer les surcharges du cabinet.
  let cabinetId: string | null = null
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch {
    cabinetId = null
  }

  const { data: rowsRaw } = cabinetId
    ? await supabase
        .from('creneaux_cabinet')
        .select('code, heure_debut, heure_fin, offset_jours_fin')
        .eq('cabinet_id', cabinetId)
    : { data: null }

  // Le VRAI catalogue du cabinet (creneau_modele) — la source que le moteur
  // consomme (jours / places / rôles). Vide si pas de cabinetId (best-effort).
  const catalogue = cabinetId ? await chargerCreneauModele(supabase, cabinetId) : []
  const catalogueUI = versCatalogueUI(catalogue)

  const rows = (rowsRaw as CreneauCabinetRow[] | null) ?? []
  const defaut = structureParDefaut()

  const creneaux: CreneauUI[] = ORDRE.map((code) => {
    const row = rows.find((r) => r.code === code)
    if (row) {
      return {
        code,
        libelle: CRENEAUX[code].libelle,
        heureDebut: hhmm(row.heure_debut),
        heureFin: hhmm(row.heure_fin),
        offsetJoursFin: row.offset_jours_fin,
        estDefaut: false,
      }
    }
    const d = defaut[code]
    return {
      code,
      libelle: CRENEAUX[code].libelle,
      heureDebut: d.heureDebut,
      heureFin: d.heureFin,
      offsetJoursFin: d.offsetJoursFin,
      estDefaut: true,
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Structure des gardes</h1>
        <p className="text-muted-foreground text-sm mt-1 leading-5 max-w-2xl">
          Voici comment votre cabinet organise ses gardes : les types de garde, les jours
          couverts, le nombre de vétérinaires par garde et leurs rôles. C&apos;est cette
          structure que le moteur utilise pour générer vos plannings.
          {!isAdmin && ' (Lecture seule — seul l’administrateur peut modifier.)'}
        </p>
      </div>

      {/* P5 slice 1 — vue LECTURE du vrai catalogue (jours / places / rôles). */}
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-foreground">
          Vos types de garde
        </h2>
        <CatalogueCreneauxView types={catalogueUI} />
      </section>

      {/* Éditeur d'horaires existant (A3) — inchangé. */}
      <section className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-foreground">Horaires</h2>
          <p className="text-muted-foreground text-sm mt-1 leading-5 max-w-2xl">
            Réglez les horaires de chaque type de garde. Tant qu&apos;un type porte le badge
            <span className="font-medium"> « valeur par défaut »</span>, il utilise les horaires
            standard de l&apos;application. Vos réglages s&apos;appliquent à la prochaine génération
            de planning et à la synchronisation de l&apos;agenda.
          </p>
        </div>
        <StructureCreneauxClient creneaux={creneaux} isAdmin={isAdmin} />
      </section>

      <a href="/planning" className="inline-block text-sm text-muted-foreground hover:text-foreground transition-colors">
        ← Retour au planning
      </a>
    </div>
  )
}
