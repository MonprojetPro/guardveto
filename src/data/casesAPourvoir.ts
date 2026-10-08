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
import { aUneLigneEnBase } from '@/data/ecrirePlanningV1'
import { resoudreContexte } from '@/data/resoudreContexte'

export interface CaseAPourvoir {
  date: string
  /** Type moteur (`weekend`, `semaine_soir`, ou code sur-mesure). */
  type: string
  role: string
}

/** Une ligne de `planning_semaine` : UN jour d'une garde, remplacements appliqués. */
export interface JourAffiche {
  /** L'identifiant de la GARDE — plusieurs jours partagent le même. */
  id: string
  date: string
  premier_id: string | null
  second_id: string | null
}

/**
 * Ce que la vue dit de chaque rôle : est-il vide sur au moins un jour affiché ?
 *
 * 🔴 EXTRAIT POUR ÊTRE TESTABLE. La fonction qui l'entoure parle à Supabase et
 *    au moteur, donc aucun test ne peut la couvrir ; cette règle-ci est pure, et
 *    c'est elle qui portait le défaut du 08/10. La laisser dans la boucle, c'est
 *    la laisser invérifiable — et sur ce projet, invérifiable veut dire
 *    « vérifiée en production, devant le client ».
 *
 * ⚠️ VIDE UN SEUL JOUR SUFFIT. Un week-end occupe trois jours dans la vue : un
 *    remplaçant trouvé pour le samedi seul laisse un trou le dimanche, et ce
 *    trou doit continuer de se dire.
 */
export function lireLaVue(jours: readonly JourAffiche[]): {
  gardesVues: Set<string>
  videUnJourAuMoins: Map<string, boolean>
} {
  const gardesVues = new Set<string>()
  const videUnJourAuMoins = new Map<string, boolean>()

  for (const j of jours) {
    gardesVues.add(j.id)
    for (const [role, occupant] of [
      ['premier', j.premier_id],
      ['second', j.second_id],
    ] as const) {
      const cle = `${j.id}|${role}`
      if (!occupant) videUnJourAuMoins.set(cle, true)
      else if (!videUnJourAuMoins.has(cle)) videUnJourAuMoins.set(cle, false)
    }
  }

  return { gardesVues, videUnJourAuMoins }
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

    // ── B-155 — CE QUI EST AFFICHÉ FAIT FOI, PAS LA TABLE BRUTE ──────────────
    //
    // 🔴 LE DÉFAUT DU 08/10, VÉCU DEVANT LE CLIENT. La publication a été refusée
    //    pour « une garde sans vétérinaire » sur un week-end que l'écran montrait
    //    PLEIN. Les deux disaient vrai, chacun sur sa source :
    //
    //      · la table `gardes` du 14/11 porte `premier = Victor, second = NULL` ;
    //      · six lignes de `gardes_exceptions` couvrent les 3 jours × 2 rôles,
    //        et c'est bien Jean et Antoine qui sont de garde ce week-end-là.
    //
    //    La vue `planning_semaine` APPLIQUE ces exceptions — c'est pour ça que
    //    l'écran a raison. Cette fonction, elle, lisait la table brute et n'avait
    //    jamais entendu parler de la surcouche « remplacer quelqu'un un seul
    //    jour » (B-061). Elle inventait donc un trou, et le trou interdisait.
    //
    // 🔑 LA CORRECTION N'EST PAS D'AJOUTER UNE LECTURE DE PLUS, c'est de prendre
    //    LA MÊME SOURCE QUE L'ÉCRAN. Ajouter ici un troisième calcul des
    //    remplacements aurait recréé l'écart un cran plus loin : le jour où la
    //    vue change, c'est elle qu'on corrige, et ce fichier se remettrait à
    //    mentir sans que rien ne le signale.
    //
    // ⚠️ La vue s'étale par JOUR (un week-end y occupe vendredi, samedi,
    //    dimanche). Une place n'est donc pourvue que si elle l'est sur CHAQUE
    //    jour affiché : un remplaçant trouvé pour le samedi seul laisse bien un
    //    trou le dimanche, et ce trou doit continuer de se dire.
    const { data: jours } = await supabase
      .from('planning_semaine')
      .select('id, date, premier_id, second_id')
      .eq('periode_id', periodeId)
      .eq('cabinet_id', cabinetId)

    const { gardesVues, videUnJourAuMoins } = lireLaVue((jours ?? []) as JourAffiche[])

    const feries = contexte.calendrier?.feries

    const out: CaseAPourvoir[] = []
    for (const step of steps) {
      // Le vendredi soir n'a pas de ligne propre : il est stocké dans le
      // week-end (même convention que la persistance, désormais PARTAGÉE avec
      // elle et avec /api/generate — cf. `aUneLigneEnBase`, B-130b).
      if (!aUneLigneEnBase(step.type)) continue

      const garde = parCle.get(`${step.date}|${typeDb(step.type, feries?.has(step.date) ?? false)}`)

      // Aucune ligne du tout = le créneau n'a jamais été écrit : vide aussi.
      if (!garde) {
        out.push({ date: step.date, type: step.type, role: step.role })
        continue
      }

      const cleRole = `${garde.id}|${step.role}`

      // B-155 — pour les deux rôles que la vue porte, c'est ELLE qui tranche :
      // elle seule applique les remplacements d'un jour. Les rôles sur-mesure
      // (3e place et au-delà) ne figurent pas dans la vue et gardent le chemin
      // d'origine, le miroir par rôle.
      if (
        (step.role === 'premier' || step.role === 'second') &&
        gardesVues.has(garde.id)
      ) {
        if (videUnJourAuMoins.get(cleRole) === true) {
          out.push({ date: step.date, type: step.type, role: step.role })
        }
        continue
      }

      // Le miroir par rôle d'abord (seul à connaître les rôles sur-mesure), les
      // colonnes historiques ensuite — le miroir est écrit en best-effort, il
      // peut manquer sans que le planning soit troué pour autant.
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
