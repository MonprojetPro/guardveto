// ============================================================
// GUARDVETO — Le gardien sur les TROIS portes restantes
// ============================================================
// Le lot 1 avait équipé la modification manuelle. Trois chemins d'écriture
// d'une garde restaient sans le moindre contrôle de rythme :
//   • le dépannage volontaire   (POST /api/absences/[id]/volontaire)
//   • les échanges de gardes    (validerEchangeAdmin)
//   • l'outil de Filou          (reparer_absence)
//
// Ce test rejoue ce que font ces trois chemins, moins Supabase : on part des
// lignes `gardes`, on simule le ou les changements en mémoire, on confronte au
// MÊME juge que la publication (`validerPlanning`), et on ne garde que le DELTA.
//
// LE POINT QUE CE FICHIER EXISTE POUR PROUVER : un échange déplace DEUX gardes
// d'un seul geste. Les juger l'une après l'autre ne donne pas « presque la même
// chose » — ça donne deux verdicts faux, dans les deux sens. C'est le test
// central ci-dessous.
// ============================================================

import { describe, it, expect } from 'vitest'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { gardesVersPlanningPartiel, type GardeRow } from '@/engine/validation/gardesVersPlanning'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import {
  simulerChangementGarde,
  violationsIntroduites,
  phraseAvertissement,
} from '@/lib/gardes/controle-regles'
import { fusionnerChangementsParGarde } from '@/lib/gardes/avertissements-regles'
import type { VetEngine, ContrainteEngine } from '@/engine/types'

// Trois samedis consécutifs — les dates de l'incident fondateur.
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
  vets: [
    anneSo(),
    sansContrainte('camille', 'Camille'),
    sansContrainte('lea', 'Léa'),
    sansContrainte('fanny', 'Fanny'),
  ],
}

const juger = (gardes: GardeRow[]) =>
  validerPlanning(gardesVersPlanningPartiel(gardes), input)

/**
 * Le pipeline exact de `avertissementsReglesDures` : on empile TOUS les
 * changements sur le même jeu, puis on soustrait une seule fois.
 */
function avertissementsPour(
  gardes: GardeRow[],
  changements: { gardeId: string; premier_id: string | null; second_id: string | null }[],
): string[] {
  let apres = gardes
  for (const c of changements) {
    apres = simulerChangementGarde(apres, c.gardeId, c.premier_id, c.second_id)
  }
  return violationsIntroduites(juger(gardes), juger(apres)).map(phraseAvertissement)
}

// ============================================================
// PORTE 1 — Les échanges de gardes
// ============================================================

describe('Échanges — les deux gardes déplacées sont jugées ENSEMBLE', () => {
  // Anne-So tient SAT1 et SAT3 (14 jours d'écart : légal). Camille tient SAT2.
  const depart: GardeRow[] = [
    we('g1', SAT1, 'anneso'),
    we('g2', SAT2, 'camille'),
    we('g3', SAT3, 'anneso'),
  ]

  // L'échange : Anne-So cède SAT1 à Camille et reprend SAT2 en retour.
  // État final : Anne-So sur SAT2 et SAT3 → 7 jours d'écart → règle enfreinte.
  const cedeSAT1 = { gardeId: 'g1', premier_id: 'camille', second_id: null }
  const reprendSAT2 = { gardeId: 'g2', premier_id: 'anneso', second_id: null }

  it('signale la seule règle que l’état final enfreint vraiment', () => {
    const phrases = avertissementsPour(depart, [cedeSAT1, reprendSAT2])
    expect(phrases).toHaveLength(1)
    expect(phrases[0]).toContain('Règle enfreinte — Anne-So')
    // Le detail du validateur, mot pour mot : en français, sans code machine
    // ni date ISO à l'écran.
    expect(phrases[0]).not.toMatch(/FREQ_WE|\d{4}-\d{2}-\d{2}/)
  })

  it('juger les deux gardes SÉPARÉMENT donne deux verdicts faux', () => {
    // ① La garde cédée, seule : Anne-So n'a plus que SAT3 — rien à signaler.
    //    On croirait l'échange inoffensif.
    expect(avertissementsPour(depart, [cedeSAT1])).toHaveLength(0)

    // ② La garde reprise, seule : le juge croit qu'Anne-So garde AUSSI SAT1,
    //    puisqu'il ne sait pas qu'elle la cède. Il remonte donc DEUX violations,
    //    dont une qui n'existera jamais (SAT1 ↔ SAT2).
    const separe = avertissementsPour(depart, [reprendSAT2])
    expect(separe.length).toBe(2)

    // Ensemble : une seule, la vraie. C'est toute la raison de l'appel groupé.
    expect(avertissementsPour(depart, [cedeSAT1, reprendSAT2])).toHaveLength(1)
  })

  it('ne dit rien d’un échange qui n’enfreint rien', () => {
    // Camille et Léa s'échangent SAT2 contre SAT3 : ni l'une ni l'autre n'a de
    // contrainte de rythme.
    const base: GardeRow[] = [
      we('g1', SAT1, 'anneso'),
      we('g2', SAT2, 'camille'),
      we('g3', SAT3, 'lea'),
    ]
    expect(avertissementsPour(base, [
      { gardeId: 'g2', premier_id: 'lea', second_id: null },
      { gardeId: 'g3', premier_id: 'camille', second_id: null },
    ])).toHaveLength(0)
  })

  it('ne fait pas payer aux deux vétos les violations DÉJÀ présentes', () => {
    // Planning déjà fautif : Anne-So sur SAT1 ET SAT2.
    const dejaFautif: GardeRow[] = [
      we('g1', SAT1, 'anneso'),
      we('g2', SAT2, 'anneso'),
      we('g3', SAT3, 'lea'),
    ]
    expect(juger(dejaFautif).some((v) => v.regle === 'FREQ_WE')).toBe(true)

    // L'échange ne touche que SAT3, entre Léa et Camille : il n'ajoute rien.
    expect(avertissementsPour(dejaFautif, [
      { gardeId: 'g3', premier_id: 'camille', second_id: null },
    ])).toHaveLength(0)
  })
})

// ============================================================
// PORTE 2 — Le dépannage volontaire
// ============================================================

describe('Dépannage volontaire — le geste de bonne volonté est jugé, pas bloqué', () => {
  // Fanny s'absente : elle tenait SAT2. Anne-So tient déjà SAT1 et SAT3.
  const depart: GardeRow[] = [
    we('g1', SAT1, 'anneso'),
    we('g2', SAT2, 'fanny'),
    we('g3', SAT3, 'anneso'),
  ]

  it('signale ce que le dépannage enfreint, sans rien interdire', () => {
    // Anne-So se porte volontaire : elle se retrouverait sur trois week-ends
    // d'affilée. Le contrôle rend des PHRASES — il ne renvoie aucune erreur, et
    // la route s'en sert pour demander confirmation, pas pour refuser.
    const phrases = avertissementsPour(depart, [
      { gardeId: 'g2', premier_id: 'anneso', second_id: null },
    ])
    expect(phrases.length).toBeGreaterThan(0)
    expect(phrases.every((p) => p.startsWith('Règle enfreinte — '))).toBe(true)
  })

  it('se tait quand le volontaire ne casse rien', () => {
    // Camille dépanne à la place de Fanny : aucune contrainte de rythme.
    expect(avertissementsPour(depart, [
      { gardeId: 'g2', premier_id: 'camille', second_id: null },
    ])).toHaveLength(0)
  })
})

// ============================================================
// PORTE 3 — L'outil de réparation de Filou
// ============================================================

describe('Filou — plusieurs remplacements sur la MÊME garde ne s’écrasent pas', () => {
  const base = [{
    gardeId: 'g2',
    periodeId: 'p1',
    premier_id: 'fanny' as string | null,
    second_id: 'fanny' as string | null,
  }]

  it('empile les deux rôles d’un même créneau sur un seul changement', () => {
    const fusion = fusionnerChangementsParGarde(base, [
      { gardeId: 'g2', role: 'premier', remplacant_id: 'camille' },
      { gardeId: 'g2', role: 'second', remplacant_id: 'lea' },
    ])
    // Une seule garde touchée, mais les DEUX places à jour. Traitées à la file,
    // la seconde décision aurait remis `fanny` en 1er : on aurait jugé un état
    // qui n'allait jamais exister.
    expect(fusion).toHaveLength(1)
    expect(fusion[0]).toMatchObject({
      gardeId: 'g2', periodeId: 'p1', premier_id: 'camille', second_id: 'lea',
    })
  })

  it('ne rend QUE les gardes réellement touchées', () => {
    const avecVoisine = [...base, {
      gardeId: 'g3', periodeId: 'p1', premier_id: 'lea' as string | null, second_id: null,
    }]
    const fusion = fusionnerChangementsParGarde(avecVoisine, [
      { gardeId: 'g2', role: 'premier', remplacant_id: 'camille' },
    ])
    expect(fusion.map((c) => c.gardeId)).toEqual(['g2'])
  })

  it('ignore une garde inconnue plutôt que d’échouer', () => {
    // Contrôle informatif : il n'a pas à faire tomber ce que l'écriture, elle,
    // saura refuser proprement.
    expect(fusionnerChangementsParGarde(base, [
      { gardeId: 'inexistante', role: 'premier', remplacant_id: 'camille' },
    ])).toHaveLength(0)
  })

  it('ne modifie pas le jeu de départ', () => {
    fusionnerChangementsParGarde(base, [
      { gardeId: 'g2', role: 'premier', remplacant_id: 'camille' },
    ])
    expect(base[0].premier_id).toBe('fanny')
  })
})
