// ============================================================
// GUARDVETO — GET /api/gardes/[id]/disponibilites
// ============================================================
// Retourne la liste de tous les vétérinaires actifs avec leur
// disponibilité pour la garde demandée (1er et 2nd de garde).
// Utilisé par GardeDetailModal pour afficher les disponibilités.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isValid } from '@/engine/rules/hard-constraints'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { VetEngine, ContrainteEngine, SlotGarde, PlanningPartiel, AttributionGarde } from '@/engine/types'

// ── Types retournés ──────────────────────────────────────

export interface VetDispo {
  id: string
  prenom: string
  nom: string
  couleur: string
  dernier_recours: boolean
  dispo_premier: { ok: boolean; raison?: string; warning?: string }
  dispo_second: { ok: boolean; raison?: string; warning?: string }
  nb_gardes_we_mois: number
}

export interface DisponibilitesData {
  garde: {
    id: string
    date: string
    type: 'semaine' | 'weekend' | 'ferie'
    saison: 'ete' | 'hiver'
    periode_statut: 'brouillon' | 'publie' | 'verrouille'
    premier_id: string | null
    second_id: string | null
    verrouille: boolean
    modifie_manuellement: boolean
    periode_id: string
  }
  vets: VetDispo[]
}

// ── Helpers ──────────────────────────────────────────────

function mapDbTypeToEngine(type: string): 'semaine_soir' | 'weekend' {
  return type === 'weekend' ? 'weekend' : 'semaine_soir'
}

function finDeMois(annee: string, mois: string): string {
  const d = new Date(Date.UTC(parseInt(annee), parseInt(mois), 0))
  return d.toISOString().split('T')[0]
}

// ── Handler ──────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: gardeId } = await params
  const supabase = await createClient()

  // ── Auth ────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  // ── Chargement de la garde + période ────────────────────
  const { data: gardeDb } = await supabase
    .from('gardes')
    .select('*, periodes(id, saison, date_debut, date_fin, statut)')
    .eq('id', gardeId)
    .single()

  if (!gardeDb) return NextResponse.json({ error: 'Garde introuvable.' }, { status: 404 })

  type PeriodeDb = { id: string; saison: string; date_debut: string; date_fin: string; statut: string }
  const periode = gardeDb.periodes as unknown as PeriodeDb
  if (!periode) return NextResponse.json({ error: 'Période introuvable.' }, { status: 404 })

  // ── Chargement des vétérinaires + contraintes ────────────
  type VetDbRow = {
    id: string; nom: string; prenom: string; statut: 'associe' | 'salarie'
    dernier_recours: boolean; couleur: string
    contraintes_veto: ContrainteEngine[]
  }

  const { data: vetsDb } = await supabase
    .from('veterinaires')
    .select('id, nom, prenom, statut, dernier_recours, couleur, contraintes_veto(*)')
    .eq('actif', true)
    .order('nom')

  // ── Congés validés qui chevauchent la période ────────────
  type CongeDb = { veterinaire_id: string; date_debut: string; date_fin: string }
  const { data: congesDb } = await supabase
    .from('conges')
    .select('veterinaire_id, date_debut, date_fin')
    .eq('statut', 'valide')
    .lte('date_debut', periode.date_fin)
    .gte('date_fin', periode.date_debut)

  // ── Toutes les gardes de la période (contexte planning) ──
  type GardeCtx = { date: string; type: string; premier_id: string | null; second_id: string | null }
  const { data: gardesDeLaPeriode } = await supabase
    .from('gardes')
    .select('date, type, premier_id, second_id')
    .eq('periode_id', periode.id)

  // ── Contexte mensuel (nb WE) ─────────────────────────────
  const [yr, mo] = gardeDb.date.split('-')
  const debutMois = `${yr}-${mo}-01`
  const finMoisStr = finDeMois(yr, mo)

  const weekendsMois = ((gardesDeLaPeriode as GardeCtx[] | null) ?? []).filter(
    (g) => g.type === 'weekend' && g.date >= debutMois && g.date <= finMoisStr
  )

  const nbWeMois: Record<string, number> = {}
  for (const g of weekendsMois) {
    if (g.premier_id) nbWeMois[g.premier_id] = (nbWeMois[g.premier_id] ?? 0) + 1
    if (g.second_id) nbWeMois[g.second_id] = (nbWeMois[g.second_id] ?? 0) + 1
  }

  // ── Construction du PlanningPartiel (hors garde courante) ─
  const planningPartiel: PlanningPartiel = {
    attributions: ((gardesDeLaPeriode as GardeCtx[] | null) ?? [])
      .filter((g) => !(g.date === gardeDb.date && mapDbTypeToEngine(g.type) === mapDbTypeToEngine(gardeDb.type)))
      .map((g): AttributionGarde => ({
        date: g.date,
        type: mapDbTypeToEngine(g.type) as AttributionGarde['type'],
        placements: [
          { role: 'premier', vetId: g.premier_id },
          { role: 'second', vetId: g.second_id },
        ],
      })),
  }

  // ── SlotGarde pour la garde courante ─────────────────────
  const slot: SlotGarde = {
    date: gardeDb.date,
    type: mapDbTypeToEngine(gardeDb.type),
    saison: periode.saison as 'ete' | 'hiver',
  }

  // ── Construction des VetEngine + vérification dispo ──────
  const allVets: VetEngine[] = ((vetsDb as VetDbRow[] | null) ?? []).map((v) => ({
    id: v.id,
    nom: v.nom,
    prenom: v.prenom,
    statut: v.statut,
    dernier_recours: v.dernier_recours,
    contraintes: v.contraintes_veto ?? [],
    conges: ((congesDb as CongeDb[] | null) ?? [])
      .filter((c) => c.veterinaire_id === v.id)
      .map((c) => ({ date_debut: c.date_debut, date_fin: c.date_fin })),
  }))

  // Normalisation OBLIGATOIRE avant isValid (parade cécité params) : sans
  // dépliage, une dispo « libre » serait calculée en ignorant les repos rangés
  // sous `params` → faux « disponible » incohérent avec le planning généré.
  const allVetsN = normaliserContraintesVets(allVets)

  const vets: VetDispo[] = allVetsN.map((vet) => {
    const rPremier = isValid(slot, vet, 'premier', allVetsN, planningPartiel)
    const rSecond = isValid(slot, vet, 'second', allVetsN, planningPartiel)

    return {
      id: vet.id,
      prenom: vet.prenom,
      nom: vet.nom,
      couleur: ((vetsDb as VetDbRow[] | null) ?? []).find((v) => v.id === vet.id)?.couleur ?? '#888',
      dernier_recours: vet.dernier_recours,
      dispo_premier: {
        ok: rPremier.valid,
        raison: rPremier.raison,
        warning: rPremier.warning,
      },
      dispo_second: {
        ok: rSecond.valid,
        raison: rSecond.raison,
        warning: rSecond.warning,
      },
      nb_gardes_we_mois: nbWeMois[vet.id] ?? 0,
    }
  })

  const response: DisponibilitesData = {
    garde: {
      id: gardeDb.id,
      date: gardeDb.date,
      type: gardeDb.type as 'semaine' | 'weekend' | 'ferie',
      saison: periode.saison as 'ete' | 'hiver',
      periode_statut: periode.statut as 'brouillon' | 'publie' | 'verrouille',
      premier_id: gardeDb.premier_id,
      second_id: gardeDb.second_id,
      verrouille: gardeDb.verrouille,
      modifie_manuellement: gardeDb.modifie_manuellement,
      periode_id: periode.id,
    },
    vets,
  }

  return NextResponse.json(response)
}
