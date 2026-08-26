// ============================================================
// GUARDVETO — Les cases encore à pourvoir d'une période (B-053)
// ============================================================
// Depuis que la génération rend un planning PARTIEL au lieu d'un mur, un
// brouillon peut légitimement contenir des cases vides. Il faut donc savoir
// les compter — pour deux usages opposés :
//
//   • l'écran, qui doit les montrer et les rendre cliquables ;
//   • la publication, qui doit REFUSER de partir tant qu'il en reste une.
//
// Publier un planning troué, ce serait annoncer à six vétérinaires un calendrier
// où personne n'est de garde certains soirs — la coquille vide, en pire : elle
// serait signée.
//
// ⚠️ SOURCE UNIQUE. Les places attendues viennent de `genererSteps` (le moteur
// lui-même), jamais d'un second calcul écrit ici. Un « places attendues » bis
// finirait par diverger du moteur, et on publierait un planning incomplet en
// croyant l'inverse — exactement le genre d'écart que ce projet paie cher.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { genererSteps } from '@/engine/solver'
import { resoudreContexte } from '@/data/resoudreContexte'

export interface CaseAPourvoir {
  date: string
  /** Type moteur (`weekend`, `semaine_soir`, ou code sur-mesure). */
  type: string
  role: string
}

/** Type moteur → type de la table `gardes` (miroir de /api/generate). */
function typeDb(type: string, ferie: boolean): string {
  if (type === 'weekend') return 'weekend'
  if (type === 'semaine_soir') return ferie ? 'ferie' : 'semaine'
  return type
}

/**
 * Les places que le planning devrait contenir et qui sont vides en base.
 *
 * Best-effort assumé : si le contexte ne se charge pas, on renvoie `null` plutôt
 * qu'un tableau vide. `[]` voudrait dire « tout est pourvu » — un échec de
 * lecture ne doit JAMAIS se lire comme une bonne nouvelle (leçon « une erreur
 * Supabase avalée devient zéro ligne »).
 */
export async function casesAPourvoir(
  supabase: SupabaseClient,
  periodeId: string,
  cabinetId: string,
): Promise<CaseAPourvoir[] | null> {
  try {
    const contexte = await resoudreContexte(periodeId, cabinetId)

    const steps = genererSteps(
      contexte.dateDebut,
      contexte.dateFin,
      contexte.saison,
      contexte.nbVetosSemaineSoir,
      contexte.creneaux,
    )

    const { data: gardes, error } = await supabase
      .from('gardes')
      .select('id, date, type, premier_id, second_id')
      .eq('periode_id', periodeId)
      .eq('cabinet_id', cabinetId)

    if (error) return null

    type GardeRow = {
      id: string; date: string; type: string
      premier_id: string | null; second_id: string | null
    }
    const parCle = new Map<string, GardeRow>()
    for (const g of (gardes ?? []) as GardeRow[]) parCle.set(`${g.date}|${g.type}`, g)

    // Miroir des places PAR RÔLE — indispensable aux créneaux sur-mesure, dont
    // les rôles ne tiennent pas dans premier_id/second_id. Sans lui, une 3e
    // place serait comptée « à pourvoir » à tort et bloquerait la publication
    // d'un planning pourtant complet.
    const { data: placements } = await supabase
      .from('garde_placements')
      .select('garde_id, role, veterinaire_id')
      .eq('cabinet_id', cabinetId)
      .in('garde_id', [...parCle.values()].map((g) => g.id))

    const parRole = new Map<string, string | null>()
    for (const p of (placements ?? []) as { garde_id: string; role: string; veterinaire_id: string | null }[]) {
      parRole.set(`${p.garde_id}|${p.role}`, p.veterinaire_id)
    }

    const feries = contexte.calendrier?.feries

    const out: CaseAPourvoir[] = []
    for (const step of steps) {
      // Le vendredi soir n'a pas de ligne propre : il est stocké dans le
      // week-end (même convention que la persistance).
      if (step.type === 'vendredi_soir') continue

      const garde = parCle.get(`${step.date}|${typeDb(step.type, feries?.has(step.date) ?? false)}`)

      // Aucune ligne du tout = le créneau n'a jamais été écrit : vide aussi.
      if (!garde) {
        out.push({ date: step.date, type: step.type, role: step.role })
        continue
      }

      // Le miroir par rôle d'abord (seul à connaître les rôles sur-mesure), les
      // colonnes historiques ensuite — le miroir est écrit en best-effort, il
      // peut manquer sans que le planning soit troué pour autant.
      const cleRole = `${garde.id}|${step.role}`
      const occupant = parRole.has(cleRole)
        ? parRole.get(cleRole)
        : step.role === 'premier'
          ? garde.premier_id
          : step.role === 'second'
            ? garde.second_id
            : null

      if (!occupant) out.push({ date: step.date, type: step.type, role: step.role })
    }
    return out
  } catch {
    return null
  }
}
