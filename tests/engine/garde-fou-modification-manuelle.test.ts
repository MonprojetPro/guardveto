// ============================================================
// GUARDVETO — Lot 1 : le gardien du chemin MANUEL
// ============================================================
// Le bug fondateur : trois chemins d'écriture d'une garde, deux gardiens
// seulement. La modification manuelle (`PATCH /api/gardes/[id]`) n'en avait
// aucun — l'admin s'est placée sur TROIS week-ends consécutifs contre une règle
// dure `espacement_weekend` (force = 'jamais', n_semaines = 2) sans que personne
// ne dise un mot.
//
// Ce test rejoue exactement ce que fait la route, moins Supabase : on part des
// lignes `gardes`, on simule le changement en mémoire, on confronte au MÊME juge
// que la publication (`validerPlanning`), et on ne garde que le DELTA.
//
// Il vérifie aussi l'autre moitié du lot : le marquage d'ORIGINE des violations
// de rythme héritées du lookback inter-périodes.
// ============================================================

import { describe, it, expect } from 'vitest'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { gardesVersPlanningPartiel, type GardeRow } from '@/engine/validation/gardesVersPlanning'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import {
  simulerChangementGarde,
  violationsIntroduites,
  phraseAvertissement,
  planningDuJour,
  remplacerOccupantsDuJour,
} from '@/lib/gardes/controle-regles'
import type { VetEngine, ContrainteEngine } from '@/engine/types'

// Samedis. 2026-10-03, 2026-10-10, 2026-10-17 : trois week-ends consécutifs,
// les dates réelles de l'incident.
const SAT1 = '2026-10-03', SAT2 = '2026-10-10', SAT3 = '2026-10-17'

/** Anne-So, porteuse de « au plus 1 week-end toutes les 2 semaines », DURE. */
function anneSo() {
  const v: VetEngine = {
    id: 'anneso', prenom: 'Anne-So', nom: 'D', statut: 'associe', dernier_recours: false,
    conges: [],
    contraintes: [{
      id: 'fw', type: 'espacement_weekend', actif: true,
      config: { brique: 'espacement_weekend', force: 2, params: { n_semaines: 2 } },
    } as ContrainteEngine],
  }
  return normaliserContraintesVets([v])[0]
}

/** Des collègues sans aucune contrainte — les occupants légitimes des autres WE. */
function sansContrainte(id: string, prenom: string) {
  const v: VetEngine = {
    id, prenom, nom: 'R', statut: 'associe', dernier_recours: false,
    conges: [], contraintes: [],
  }
  return normaliserContraintesVets([v])[0]
}

const we = (id: string, date: string, premier: string | null): GardeRow => ({
  id, date, type: 'weekend', premier_id: premier, second_id: null,
})

const input = {
  dateDebut: SAT1,
  dateFin: '2026-11-30',
  saison: 'hiver' as const,
  nbVetosSemaineSoir: 1,
  vets: [anneSo(), sansContrainte('autre', 'Camille'), sansContrainte('tiers', 'Léa')],
}

/** Le pipeline de la route, en pur : gardes → planning → violations. */
const juger = (gardes: GardeRow[]) =>
  validerPlanning(gardesVersPlanningPartiel(gardes), input)

describe('Lot 1 — une modification manuelle qui enfreint une règle DURE est détectée', () => {
  // État de départ : Anne-So tient SAT1 et SAT3 (4 semaines d'écart : légal).
  // Camille tient SAT2.
  const avantGardes: GardeRow[] = [
    we('g1', SAT1, 'anneso'),
    we('g2', SAT2, 'autre'),
    we('g3', SAT3, 'anneso'),
  ]

  it('signale le week-end que le geste vient de rendre illégal', () => {
    // Le geste : l'admin se met elle-même sur g2, entre ses deux autres WE.
    const apresGardes = simulerChangementGarde(avantGardes, 'g2', 'anneso', null)
    expect(apresGardes.find((g) => g.id === 'g2')?.premier_id).toBe('anneso')
    // …et le jeu d'origine n'a pas bougé (la base n'est pas touchée).
    expect(avantGardes.find((g) => g.id === 'g2')?.premier_id).toBe('autre')

    const nouvelles = violationsIntroduites(juger(avantGardes), juger(apresGardes))

    expect(nouvelles.some((v) => v.regle === 'FREQ_WE' && v.vetId === 'anneso')).toBe(true)

    // La phrase servie à la modale reprend le détail du validateur MOT POUR MOT
    // — donc en français, avec des dates en français et AUCUN code machine.
    const phrases = nouvelles.map(phraseAvertissement)
    expect(phrases.some((p) => p.startsWith('Règle enfreinte — Anne-So'))).toBe(true)
    expect(phrases.some((p) => p.includes('deux week-ends à 7 jour(s) d’écart'.replace('’', "'")))).toBe(true)
    expect(phrases.every((p) => !/FREQ_WE|\d{4}-\d{2}-\d{2}/.test(p))).toBe(true)
  })

  it('ne dit rien quand le geste n’enfreint aucune règle dure', () => {
    // Camille prend le week-end de Anne-So : personne n'est trop rapproché.
    const apresGardes = simulerChangementGarde(avantGardes, 'g3', 'autre', null)
    expect(violationsIntroduites(juger(avantGardes), juger(apresGardes))).toHaveLength(0)
  })

  it('ne fait pas payer à l’admin les violations DÉJÀ présentes', () => {
    // Planning déjà fautif : Anne-So sur SAT1 ET SAT2.
    const dejaFautif: GardeRow[] = [
      we('g1', SAT1, 'anneso'),
      we('g2', SAT2, 'anneso'),
      we('g3', SAT3, 'autre'),
    ]
    expect(juger(dejaFautif).some((v) => v.regle === 'FREQ_WE')).toBe(true)

    // Le geste ne touche QUE g3, qu'il confie à un troisième véto sans
    // contrainte : il n'ajoute rien. Aucun avertissement — alors que la liste
    // complète des violations, elle, n'est pas vide.
    const apres = simulerChangementGarde(dejaFautif, 'g3', 'tiers', null)
    expect(violationsIntroduites(juger(dejaFautif), juger(apres))).toHaveLength(0)
  })
})

describe('Lot 1 — origine des violations de rythme (lookback inter-périodes)', () => {
  // La période commence au SAT3 ; SAT1 et SAT2 viennent du lookback.
  const inputAvecLookback = {
    ...input,
    dateDebut: SAT3,
    contexteAnterieur: gardesVersPlanningPartiel([
      we('h1', SAT1, 'anneso'),
      we('h2', SAT2, 'anneso'),
    ]).attributions,
  }

  it('marque « anterieure » la paire dont les DEUX dates précèdent la période', () => {
    const planning = gardesVersPlanningPartiel([we('g3', SAT3, 'autre')])
    const v = validerPlanning(planning, inputAvecLookback)
      .find((x) => x.regle === 'FREQ_WE' && x.date === SAT2)
    expect(v).toBeDefined()
    expect(v?.origine).toBe('anterieure')
  })

  it('NE marque PAS une paire à cheval sur la jonction de périodes', () => {
    // Anne-So reprend SAT3 : la paire SAT2 → SAT3 touche la période courante.
    const planning = gardesVersPlanningPartiel([we('g3', SAT3, 'anneso')])
    const v = validerPlanning(planning, inputAvecLookback)
      .find((x) => x.regle === 'FREQ_WE' && x.date === SAT3)
    expect(v).toBeDefined()
    expect(v?.origine).toBeUndefined()
  })

  it('sans lookback, aucune violation n’est jamais marquée', () => {
    const planning = gardesVersPlanningPartiel([we('g1', SAT1, 'anneso'), we('g2', SAT2, 'anneso')])
    const violations = validerPlanning(planning, input)
    expect(violations.some((x) => x.regle === 'FREQ_WE')).toBe(true)
    expect(violations.every((x) => x.origine === undefined)).toBe(true)
  })
})

// ============================================================
// Le SECOND mécanisme d'écriture de la route : le remplacement d'UN SEUL JOUR
// ============================================================
// L'exception ne touche pas `gardes` — le validateur est aveugle si on lui
// passe la période telle quelle. On lui soumet donc le créneau de ce jour seul.
// Deux propriétés à prouver, et elles vont ensemble :
//   ① les règles qui jugent l'OCCUPANT répondent (ici : un congé validé) ;
//   ② les règles de RYTHME se taisent — un dépannage d'un jour ne doit pas
//      compter comme un week-end, sous peine de faux positif.

describe('Lot 1 — remplacement d’un seul jour (exception)', () => {
  /** Anne-So, la même règle de fréquence des week-ends, DURE. */
  const enCongeLe = (id: string, prenom: string, d: string) => {
    const v: VetEngine = {
      id, prenom, nom: 'X', statut: 'associe', dernier_recours: false,
      conges: [{ id: 'c1', date_debut: d, date_fin: d, statut: 'valide', type: 'conge' }],
      contraintes: [],
    } as unknown as VetEngine
    return normaliserContraintesVets([v])[0]
  }

  // Anne-So tient déjà SAT1 et SAT2 : elle est DÉJÀ en limite de fréquence.
  const gardes: GardeRow[] = [we('g1', SAT1, 'anneso'), we('g3', SAT3, 'autre')]

  const inputJour = (jour: string, vets: typeof input.vets) => ({
    ...input, dateDebut: jour, dateFin: jour, vets, contexteAnterieur: undefined,
  })

  it('signale un remplaçant en congé validé CE jour-là', () => {
    const vets = [anneSo(), enCongeLe('autre', 'Camille', SAT3), sansContrainte('tiers', 'Léa')]
    const duJour = planningDuJour(gardesVersPlanningPartiel(gardes), SAT3)
    expect(duJour.attributions).toHaveLength(1)

    const inp = inputJour(SAT3, vets)
    const avant = validerPlanning(remplacerOccupantsDuJour(duJour, SAT3, 'tiers', null), inp)
    const apres = validerPlanning(remplacerOccupantsDuJour(duJour, SAT3, 'autre', null), inp)

    const nouvelles = violationsIntroduites(avant, apres)
    expect(nouvelles.some((v) => v.regle === 'R16' && v.vetId === 'autre')).toBe(true)
    expect(nouvelles.map(phraseAvertissement)[0]).toContain('Règle enfreinte')
  })

  it('ne fabrique AUCUN faux positif de rythme : dépanner un jour n’est pas un week-end', () => {
    // Anne-So est déjà sur SAT1 ; on la met sur le week-end du SAT3, à 14 jours.
    // Sur la période entière ce serait une violation FREQ_WE (min 2 semaines
    // = 14 jours, donc 14 < 14 est faux… on prend SAT2 pour être net).
    const vets = [anneSo(), sansContrainte('autre', 'Camille'), sansContrainte('tiers', 'Léa')]
    const gardesRapprochees: GardeRow[] = [we('g1', SAT1, 'anneso'), we('g2', SAT2, 'autre')]

    // Preuve que le cas EST une violation quand on raisonne en blocs.
    const surBloc = violationsIntroduites(
      validerPlanning(gardesVersPlanningPartiel(gardesRapprochees), { ...input, vets }),
      validerPlanning(
        gardesVersPlanningPartiel(simulerChangementGarde(gardesRapprochees, 'g2', 'anneso', null)),
        { ...input, vets },
      ),
    )
    expect(surBloc.some((v) => v.regle === 'FREQ_WE')).toBe(true)

    // Le MÊME geste à la maille du jour ne dit rien : Anne-So dépanne un jour,
    // elle ne prend pas un week-end.
    const duJour = planningDuJour(gardesVersPlanningPartiel(gardesRapprochees), SAT2)
    const inp = inputJour(SAT2, vets)
    const surJour = violationsIntroduites(
      validerPlanning(remplacerOccupantsDuJour(duJour, SAT2, 'autre', null), inp),
      validerPlanning(remplacerOccupantsDuJour(duJour, SAT2, 'anneso', null), inp),
    )
    expect(surJour.some((v) => v.regle === 'FREQ_WE')).toBe(false)
  })

  it('un jour SANS créneau propre (le dimanche d’un week-end) ne donne rien à juger', () => {
    // Le bloc est daté du samedi ; le dimanche n'a pas d'attribution à lui.
    const dimanche = '2026-10-04'
    expect(planningDuJour(gardesVersPlanningPartiel(gardes), dimanche).attributions).toHaveLength(0)
  })
})
