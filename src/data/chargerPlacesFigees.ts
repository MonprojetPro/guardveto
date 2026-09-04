// ============================================================
// GUARDVETO — LIRE LES CADENAS DE L'ADMIN, POUR LE MOTEUR (B-111)
// ============================================================
// Traduit `gardes.places_figees` (les labels cadenassés, stockés par garde) en
// `PlaceFigee[]`, la forme que le solver attend : une ligne par place, avec la
// personne qui l'occupe et le CODE DE CRÉNEAU DU MOTEUR.
//
// ── LA CONVERSION DE TYPE EST LE POINT DÉLICAT ─────────────────────────────
//
// La table ne connaît que 'semaine' | 'weekend' | 'ferie' (plus les codes
// sur-mesure), là où le moteur raisonne en 'semaine_soir' | 'weekend' | … .
// C'est l'exacte réciproque de `mapTypeGardeEnDb`, et elle doit le rester : une
// figée dont le type ne retombe pas sur un créneau réel du moteur est
// silencieusement ignorée par `attributionsDesFigees` — le cadenas serait alors
// affiché à l'écran et sans effet sur la génération.
//
// C'est précisément pour ça que `figeesSansPlace` existe côté moteur : ce qui
// n'a pas trouvé sa place se DIT, au lieu de disparaître.
//
// ⚠️ 'ferie' redevient 'semaine_soir' : en base, une nuit de semaine tombant un
// jour férié est rangée sous 'ferie' (héritage V1), alors que le moteur ne
// produit jamais de créneau 'ferie' — il pose un `semaine_soir` et le
// reclassifie au scoring. Traduire 'ferie' par 'ferie' rendrait donc tous les
// cadenas des jours fériés inopérants, en silence.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlaceFigee } from '@/engine/figees'

/** Réciproque de `mapTypeGardeEnDb` (cf. en-tête pour le cas 'ferie'). */
export function mapTypeDbVersMoteur(typeDb: string): string {
  if (typeDb === 'weekend') return 'weekend'
  if (typeDb === 'semaine' || typeDb === 'ferie') return 'semaine_soir'
  return typeDb
}

interface LigneGardeFigee {
  id: string
  date: string
  type: string
  premier_id: string | null
  second_id: string | null
  places_figees: string[] | null
}

interface LignePlacement {
  garde_id: string
  role: string
  veterinaire_id: string | null
}

export interface PlacesFigeesChargees {
  places: PlaceFigee[]
  /**
   * Cadenas posés sur une place qui n'a PLUS personne (la garde a été vidée
   * depuis, ou le miroir des places au-delà de la 2ᵉ est incomplet). On ne peut
   * pas figer « personne » : le cadenas est inopérant, et ça se dit.
   */
  sansTitulaire: { date: string; type: string; role: string }[]
  erreur?: string
}

/**
 * Charge les places cadenassées d'une période.
 *
 * Best-effort assumé sur le miroir `garde_placements` (places au-delà de la
 * 2ᵉ) : les colonnes `premier_id`/`second_id` restent la source de vérité pour
 * les deux premières places, et elles couvrent la totalité des cabinets
 * actuels. Une erreur de lecture n'est jamais avalée en « aucun cadenas » —
 * elle remonte, parce qu'un cadenas perdu se traduirait par un planning
 * recomposé sans lui.
 */
export async function chargerPlacesFigees(
  supabase: SupabaseClient,
  periodeId: string,
  cabinetId: string | null | undefined,
): Promise<PlacesFigeesChargees> {
  let requete = supabase
    .from('gardes')
    .select('id, date, type, premier_id, second_id, places_figees')
    .eq('periode_id', periodeId)
    .neq('places_figees', '{}')

  if (cabinetId) requete = requete.eq('cabinet_id', cabinetId)

  const { data, error } = await requete

  if (error) {
    return { places: [], sansTitulaire: [], erreur: error.message }
  }

  const lignes = (data ?? []) as LigneGardeFigee[]
  if (lignes.length === 0) return { places: [], sansTitulaire: [] }

  // Les labels au-delà de 'premier'/'second' vivent dans le miroir des places.
  const labelsHistoriques = new Set(['premier', 'second'])
  const besoinMiroir = lignes.some((g) =>
    (g.places_figees ?? []).some((role) => !labelsHistoriques.has(role)),
  )

  const miroir = new Map<string, string | null>()
  if (besoinMiroir) {
    const { data: placements } = await supabase
      .from('garde_placements')
      .select('garde_id, role, veterinaire_id')
      .in('garde_id', lignes.map((g) => g.id))

    for (const p of (placements ?? []) as LignePlacement[]) {
      miroir.set(`${p.garde_id}|${p.role}`, p.veterinaire_id)
    }
  }

  const places: PlaceFigee[] = []
  const sansTitulaire: PlacesFigeesChargees['sansTitulaire'] = []

  for (const g of lignes) {
    const type = mapTypeDbVersMoteur(g.type)
    for (const role of g.places_figees ?? []) {
      const vetId =
        role === 'premier' ? g.premier_id
        : role === 'second' ? g.second_id
        : (miroir.get(`${g.id}|${role}`) ?? null)

      if (!vetId) {
        sansTitulaire.push({ date: g.date, type, role })
        continue
      }
      places.push({ date: g.date, type, role, vetId })
    }
  }

  return { places, sansTitulaire }
}
