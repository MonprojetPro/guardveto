// ============================================================
// GUARDVETO — B-130b : la génération ne peut plus annoncer un autre planning
//                      que celui qu'elle écrit
// ============================================================
// RELEVÉ D'ORIGINE (25/09, Val d'Allier, Hiver P2) : la trace de 14h50 annonce
// « 3 cases resteront à pourvoir », la base en contient 9 ; celle de 15h07
// annonce 11, la base en contient 10. Resté inexpliqué pendant cinq jours.
//
// ── LA CAUSE, MESURÉE LE 30/09 ────────────────────────────────────────────
//
// Le moteur recense ses cases vides sur SES places. Un week-end en compte
// QUATRE : deux le vendredi soir, deux le samedi. La table `gardes`, elle, n'en
// stocke que deux — le vendredi n'a pas de ligne, il se re-dérive du week-end
// par `meme_binome` (+ `inversion_role`), cf. `placementsVendrediLie`.
//
// La convention était donc écrite TROIS fois :
//   • `ecrirePlanningV1`  → l'appliquait (filtre `vendredi_soir`)   ✅
//   • `casesAPourvoir`    → l'appliquait (écran + gate publication) ✅
//   • `/api/generate`     → publiait `creneauxVides` BRUT           ❌
//
// Sonde du 30/09, 4 semaines, 2 vétérinaires dont un en congé total :
//     ANNONCÉ 23 {vendredi_soir: 4, weekend: 3, semaine_soir: 16}
//     ÉCRIT   19 {weekend: 3, semaine: 15, ferie: 1}
// L'écart vaut EXACTEMENT les 4 vendredis. Ce n'était pas un chiffre cosmétique :
// il pilote aussi `issue` et `success`, donc un planning dont les seuls trous
// restants étaient des vendredis dérivés était annoncé « partiel » alors que la
// gate de publication le tenait déjà pour complet. Deux modules donnaient deux
// réponses opposées sur le même planning.
//
// ⚠️ CE QUE CE TEST NE DIT PAS. Il ne rejoue pas `/api/generate` (Supabase) :
// il verrouille l'INVARIANT que la route applique désormais — annoncer ce qui
// sera écrit, et rien d'autre. Si quelqu'un retire le filtre de la route, c'est
// le test `casesAPourvoir`/route qui doit tomber ; ici on verrouille la règle.
// ============================================================

import { describe, it, expect } from 'vitest'
import { remplirAuMieux, type SolverInput } from '@/engine/solver'
import { aUneLigneEnBase, mapTypeGardeEnDb } from '@/data/ecrirePlanningV1'
import type { VetEngine } from '@/engine/types'

const DATE_DEBUT = '2025-11-03' // lundi
const DATE_FIN = '2025-11-28'   // vendredi (4 semaines)

function vet(id: string, prenom: string, conges: VetEngine['conges'] = []): VetEngine {
  return { id, nom: prenom, prenom, statut: 'associe', dernier_recours: false, contraintes: [], conges }
}

function input(vets: VetEngine[]): SolverInput {
  return { dateDebut: DATE_DEBUT, dateFin: DATE_FIN, saison: 'hiver', vets, bonusMalus: {}, lnsTimeoutMs: 2000 }
}

const CONGE_TOTAL = [{ date_debut: DATE_DEBUT, date_fin: DATE_FIN, type: 'vacances' as const }]

/**
 * Les places vides que l'ÉCRITURE posera réellement en base — miroir exact de
 * `ecrirePlanningV1` (filtre + premier_id = placements[0], second_id = [1]).
 */
function videsReellementEcrites(planning: { attributions: { date: string; type: string; placements: { vetId: string | null }[] }[] }) {
  const out: { date: string; dbType: string; role: number }[] = []
  for (const a of planning.attributions) {
    if (!aUneLigneEnBase(a.type)) continue
    const dbType = mapTypeGardeEnDb(a.type, a.date)
    if (!a.placements[0]?.vetId) out.push({ date: a.date, dbType, role: 0 })
    if (a.placements.length > 1 && !a.placements[1]?.vetId) out.push({ date: a.date, dbType, role: 1 })
  }
  return out
}

describe('B-130b — le nombre annoncé est le nombre écrit', () => {
  // Deux personnes dont une absente toute la période : les nuits à une place
  // passent, les week-ends à deux places non → il RESTE des cases vides.
  const resultat = remplirAuMieux(input([vet('v1', 'Alice'), vet('v2', 'Bob', CONGE_TOTAL)]))

  it('le cas de test produit bien des cases vides (sinon il ne prouverait rien)', () => {
    expect(resultat.creneauxVides.length).toBeGreaterThan(0)
  })

  it('ce que la génération ANNONCE égale ce que l’écriture POSE', () => {
    const annonce = resultat.creneauxVides.filter((c) => aUneLigneEnBase(c.type))
    const ecrites = videsReellementEcrites(resultat.planning)

    expect(annonce.length).toBe(ecrites.length)
  })

  it('le filtre n’est pas cosmétique : sans lui, les deux nombres DIVERGENT', () => {
    // Ce test est le garde-fou du garde-fou. Si un jour le vendredi obtient sa
    // propre ligne en base, il tombera — et c'est ce qu'on veut : la convention
    // aura changé, il faudra revoir `aUneLigneEnBase` plutôt que ce filtre.
    const brut = resultat.creneauxVides.length
    const filtre = resultat.creneauxVides.filter((c) => aUneLigneEnBase(c.type)).length

    expect(brut).toBeGreaterThan(filtre)
    expect(resultat.creneauxVides.some((c) => c.type === 'vendredi_soir')).toBe(true)
  })

  it('aucune case annoncée ne porte un créneau absent de la base', () => {
    const annonce = resultat.creneauxVides.filter((c) => aUneLigneEnBase(c.type))

    // « Le tableau ne peut pas se taire » à l'envers : il ne doit pas non plus
    // désigner une case sur laquelle l'admin ne pourra jamais cliquer.
    for (const c of annonce) {
      expect(c.type).not.toBe('vendredi_soir')
    }
  })
})
