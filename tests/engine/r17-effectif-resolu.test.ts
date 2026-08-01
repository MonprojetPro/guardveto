import { describe, it, expect } from 'vitest'
import { gardesVersPlanningPartiel } from '../../src/engine/validation/gardesVersPlanning'
import {
  validerPlanning,
  type ValidationInput,
} from '../../src/engine/validation/validerPlanning'
import { scorerPlanning, Etage } from '../../src/engine/score-lexicographique'
import { normaliserContraintesVets } from '../../src/engine/normaliserContraintes'
import type { VetEngine } from '../../src/engine/types'

// ============================================================
// R17 conditionné à l'effectif RÉSOLU — fix audit 2026-07-03
// ============================================================
// AVANT : le validateur déclenchait R17 sur `saison === 'ete'` sans consulter
// `nbVetosSemaineSoir`, contredisant le moteur (slot.besoinSecond) et sa
// propre section COUVERTURE → violations FANTÔMES pour tout cabinet réglé
// à 2 vétos/nuit en été. APRÈS : même précédence que le moteur.
// ============================================================

function vet(id: string, prenom: string): VetEngine {
  return {
    id,
    nom: prenom,
    prenom,
    statut: 'associe',
    dernier_recours: false,
    contraintes: [],
    conges: [],
  } as VetEngine
}

// Mardi isolé : un seul slot semaine_soir attendu sur la période.
const MARDI = '2026-01-06'

const vets = [vet('A', 'Alice'), vet('B', 'Bob')]

/** Planning : une garde de semaine avec 1er ET 2nd. */
const planningAvecSecond = gardesVersPlanningPartiel([
  { date: MARDI, type: 'semaine', premier_id: 'A', second_id: 'B' },
])

function inputPour(saison: 'ete' | 'hiver', nbVetosSemaineSoir?: number): ValidationInput {
  return {
    dateDebut: MARDI,
    dateFin: MARDI,
    saison,
    vets,
    nbVetosSemaineSoir,
  }
}

describe('R17 — conditionné à l\'effectif résolu, pas à la saison', () => {
  it('été + effectif réglé à 2 : un 2nd en semaine est LÉGAL (zéro violation fantôme)', () => {
    const violations = validerPlanning(planningAvecSecond, inputPour('ete', 2))
    expect(violations.filter((v) => v.regle === 'R17')).toEqual([])
    // Cohérence avec la COUVERTURE : premier+second attendus et pourvus.
    expect(violations.filter((v) => v.regle === 'COUVERTURE')).toEqual([])
  })

  it('été sans réglage (repli saison → 1) : un 2nd déclenche R17 (comportement historique conservé)', () => {
    const violations = validerPlanning(planningAvecSecond, inputPour('ete'))
    const r17 = violations.filter((v) => v.regle === 'R17')
    expect(r17).toHaveLength(1)
    expect(r17[0].vetId).toBe('B')
    expect(r17[0].date).toBe(MARDI)
  })

  it('hiver + effectif réglé à 1 : un 2nd déclenche R17 (nouvelle capacité, alignée moteur)', () => {
    const violations = validerPlanning(planningAvecSecond, inputPour('hiver', 1))
    expect(violations.filter((v) => v.regle === 'R17')).toHaveLength(1)
  })

  it('hiver sans réglage (repli saison → 2) : pas de R17', () => {
    const violations = validerPlanning(planningAvecSecond, inputPour('hiver'))
    expect(violations.filter((v) => v.regle === 'R17')).toEqual([])
  })
})

// ============================================================
// Le SCOREUR aussi — fix 2026-08-01
// ============================================================
// Le validateur avait été corrigé en juillet 2026 ; le scoreur global, non.
// `listerSlotRoles` reconstruisait ses slots SANS `besoinSecond`, si bien que
// le re-check de l'étage 0 retombait sur le repli historique
// `slot.besoinSecond ?? (saison === 'hiver')`. Résultat : pour un cabinet EN
// ÉTÉ réglé à 2 vétérinaires le soir, chaque 2nd de semaine comptait comme une
// violation d'invariant — sur un planning que le solver venait pourtant de
// construire légitimement. L'étage 0 servant au départage du LNS, le scoreur
// pénalisait ces plannings sans raison.
//
// Le scoreur n'a pas accès à l'effectif de la période : il déduit le besoin de
// ce que le planning contient RÉELLEMENT.
// ============================================================

describe('Scoreur global — pas de violation R17 fantôme en été', () => {
  const vetsN = normaliserContraintesVets(vets)

  it('été, un 2nd en semaine : étage INVARIANT à zéro', () => {
    const score = scorerPlanning(planningAvecSecond, vetsN, 'ete')
    expect(score.etages[Etage.INVARIANT_SYSTEME]).toBe(0)
  })

  it('le même planning jugé en hiver donne le même verdict', () => {
    // La saison ne doit plus rien décider ici : seul compte ce qui est posé.
    const ete = scorerPlanning(planningAvecSecond, vetsN, 'ete')
    const hiver = scorerPlanning(planningAvecSecond, vetsN, 'hiver')
    expect(ete.etages[Etage.INVARIANT_SYSTEME]).toBe(hiver.etages[Etage.INVARIANT_SYSTEME])
  })

  it('un 1er seul en semaine reste sans violation, dans les deux saisons', () => {
    const seul = gardesVersPlanningPartiel([
      { date: MARDI, type: 'semaine', premier_id: 'A', second_id: null },
    ])
    expect(scorerPlanning(seul, vetsN, 'ete').etages[Etage.INVARIANT_SYSTEME]).toBe(0)
    expect(scorerPlanning(seul, vetsN, 'hiver').etages[Etage.INVARIANT_SYSTEME]).toBe(0)
  })
})
