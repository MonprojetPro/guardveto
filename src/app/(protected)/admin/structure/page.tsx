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
import {
  StructureCreneauxClient, type CreneauUI,
} from '@/components/admin/StructureCreneauxClient'

/** Ordre d'affichage des types de créneau. */
const ORDRE: TypeGardeEngine[] = ['semaine_soir', 'vendredi_soir', 'weekend', 'ferie']

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
          Réglez les horaires de chaque type de garde de votre cabinet. Tant qu&apos;un
          type porte le badge <span className="font-medium">« valeur par défaut »</span>,
          il utilise les horaires standard de l&apos;application. Vos réglages s&apos;appliquent
          à la prochaine génération de planning et à la synchronisation de l&apos;agenda.
          {!isAdmin && ' (Lecture seule — seul l’administrateur peut modifier.)'}
        </p>
      </div>

      <StructureCreneauxClient creneaux={creneaux} isAdmin={isAdmin} />

      <a href="/planning" className="inline-block text-sm text-muted-foreground hover:text-foreground transition-colors">
        ← Retour au planning
      </a>
    </div>
  )
}
