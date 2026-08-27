// ============================================================
// B-062 — le moteur contrôle ce que Filou propose
// ============================================================
// MiKL, le 27/08 : « si c'est le cas l'IA a le dernier mot et on suit ses
// recommandations. Dans le cas où elle recommande quelque chose et que le
// moteur n'est pas d'accord car cela enfreint une règle, cela sera proposé à
// l'admin ».
//
// Tout repose donc sur UNE question : est-ce que le contrôle attrape vraiment
// une proposition illégale ? Si ce filet est troué, une garde illégale entre
// dans le planning avec l'autorité de « Filou l'a proposé, le moteur a validé ».
//
// Ce que ces tests protègent :
//   • une proposition qui enfreint une règle dure est REFUSÉE, pas appliquée ;
//   • une proposition légale est appliquée — Filou a bien le dernier mot ;
//   • un changement légal mais qui DÉGRADE le score est appliqué quand même,
//     et l'effet est dit (seule la légalité fait veto) ;
//   • le contrôle est CUMULATIF : deux changements légaux séparément mais
//     contradictoires ensemble ne passent pas tous les deux ;
//   • une place inventée par Filou est classée « sans objet », jamais appliquée
//     à moitié ;
//   • le planning d'origine n'est JAMAIS muté.
// ============================================================

import { describe, it, expect } from 'vitest'
import { arbitrerChangements, type ChangementPropose } from '../relecture/arbitrer'
import type { PlanningPartiel, VetEngine } from '../types'

const DATE_DEBUT = '2025-11-03' // lundi
const DATE_FIN = '2025-11-28'   // vendredi (4 semaines)

function vet(
  id: string,
  prenom: string,
  conges: VetEngine['conges'] = [],
): VetEngine {
  return {
    id, nom: prenom, prenom, statut: 'associe',
    dernier_recours: false, contraintes: [], conges,
  }
}

/** Deux nuits de semaine, deux personnes chacune. */
function planningDeux(): PlanningPartiel {
  return {
    attributions: [
      {
        date: '2025-11-03', type: 'semaine_soir',
        placements: [
          { role: 'premier', vetId: 'v1' },
          { role: 'second', vetId: 'v2' },
        ],
      },
      {
        date: '2025-11-05', type: 'semaine_soir',
        placements: [
          { role: 'premier', vetId: 'v3' },
          { role: 'second', vetId: 'v4' },
        ],
      },
    ],
  }
}

function options(vets: VetEngine[]) {
  return {
    vets,
    dateDebut: DATE_DEBUT,
    dateFin: DATE_FIN,
    saison: 'hiver' as const,
    nbVetosSemaineSoir: 2,
  }
}

function changement(
  id: string,
  affectations: ChangementPropose['affectations'],
): ChangementPropose {
  return { id, motif: `motif ${id}`, critere: 'epuisement', affectations }
}

const EQUIPE = [
  vet('v1', 'Alice'), vet('v2', 'Bob'),
  vet('v3', 'Carol'), vet('v4', 'David'),
]

describe('arbitrerChangements — ce que le moteur accepte', () => {
  it('applique un échange légal : Filou a le dernier mot', () => {
    const echange = changement('F1', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'premier', vetId: 'v2' },
      { date: '2025-11-03', type: 'semaine_soir', role: 'second', vetId: 'v1' },
    ])

    const r = arbitrerChangements(planningDeux(), [echange], options(EQUIPE))

    expect(r.arbitrages[0].verdict).toBe('applique')
    expect(r.modifie).toBe(true)
    const lundi = r.planning.attributions.find((a) => a.date === '2025-11-03')!
    expect(lundi.placements.find((p) => p.role === 'premier')!.vetId).toBe('v2')
    expect(lundi.placements.find((p) => p.role === 'second')!.vetId).toBe('v1')
  })

  it('dit l’effet du changement sur le score, sans s’en servir pour refuser', () => {
    const echange = changement('F1', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'premier', vetId: 'v2' },
      { date: '2025-11-03', type: 'semaine_soir', role: 'second', vetId: 'v1' },
    ])

    const r = arbitrerChangements(planningDeux(), [echange], options(EQUIPE))

    // Le verdict ne dépend PAS de l'effet : quel qu'il soit, c'est appliqué.
    expect(r.arbitrages[0].verdict).toBe('applique')
    expect(['ameliore', 'egal', 'degrade']).toContain(r.arbitrages[0].effetScore)
  })

  it('rend l’état d’AVANT, pour que le rapport sache dire qui remplaçait qui', () => {
    const remplacement = changement('F1', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'premier', vetId: 'v3' },
    ])

    const r = arbitrerChangements(planningDeux(), [remplacement], options(EQUIPE))

    expect(r.arbitrages[0].avant).toEqual([
      { date: '2025-11-03', type: 'semaine_soir', role: 'premier', vetId: 'v1' },
    ])
  })
})

describe('arbitrerChangements — ce que le moteur refuse', () => {
  it('REFUSE de poser quelqu’un qui est en congé', () => {
    // Carol est absente toute la période : la mettre de garde est une
    // violation dure. C'est LE cas qui compte — si ce test tombe, Filou peut
    // envoyer quelqu'un en vacances sur une garde.
    const equipe = [
      vet('v1', 'Alice'), vet('v2', 'Bob'),
      vet('v3', 'Carol', [{ date_debut: DATE_DEBUT, date_fin: DATE_FIN, type: 'vacances' }]),
      vet('v4', 'David'),
    ]
    const illegal = changement('F1', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'premier', vetId: 'v3' },
    ])

    const r = arbitrerChangements(planningDeux(), [illegal], options(equipe))

    expect(r.arbitrages[0].verdict).toBe('refuse')
    expect(r.arbitrages[0].violations.length).toBeGreaterThan(0)
    expect(r.modifie).toBe(false)
    // Le planning rendu est celui d'origine : Alice est toujours première.
    const lundi = r.planning.attributions.find((a) => a.date === '2025-11-03')!
    expect(lundi.placements.find((p) => p.role === 'premier')!.vetId).toBe('v1')
  })

  it('REFUSE de mettre la même personne deux fois sur la même garde', () => {
    const doublon = changement('F1', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'second', vetId: 'v1' },
    ])

    const r = arbitrerChangements(planningDeux(), [doublon], options(EQUIPE))

    expect(r.arbitrages[0].verdict).toBe('refuse')
    expect(r.modifie).toBe(false)
  })

  it('classe « sans objet » une place que Filou a inventée', () => {
    const inventee = changement('F1', [
      { date: '2026-01-01', type: 'semaine_soir', role: 'premier', vetId: 'v2' },
    ])

    const r = arbitrerChangements(planningDeux(), [inventee], options(EQUIPE))

    expect(r.arbitrages[0].verdict).toBe('sans_objet')
    expect(r.modifie).toBe(false)
  })

  it('n’applique JAMAIS la moitié d’un échange dont une place est inventée', () => {
    // Le piège : la première affectation est valide, la seconde non. Appliquer
    // la première laisserait Bob sur deux places et Alice nulle part — un
    // planning cassé qu'aucune règle dure n'attraperait forcément.
    const moitie = changement('F1', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'premier', vetId: 'v2' },
      { date: '2025-11-03', type: 'semaine_soir', role: 'troisieme', vetId: 'v1' },
    ])

    const r = arbitrerChangements(planningDeux(), [moitie], options(EQUIPE))

    expect(r.arbitrages[0].verdict).toBe('sans_objet')
    const lundi = r.planning.attributions.find((a) => a.date === '2025-11-03')!
    expect(lundi.placements.find((p) => p.role === 'premier')!.vetId).toBe('v1')
  })
})

describe('arbitrerChangements — le contrôle est cumulatif', () => {
  it('refuse le second changement quand le premier l’a rendu illégal', () => {
    // Pris séparément, chacun est légal. Ensemble, ils mettent Bob deux fois
    // sur la garde du lundi. Un arbitrage qui jugerait chaque proposition
    // contre le planning D'ORIGINE les accepterait tous les deux.
    const premier = changement('F1', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'premier', vetId: 'v2' },
      { date: '2025-11-03', type: 'semaine_soir', role: 'second', vetId: 'v1' },
    ])
    const second = changement('F2', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'second', vetId: 'v2' },
    ])

    const r = arbitrerChangements(planningDeux(), [premier, second], options(EQUIPE))

    expect(r.arbitrages[0].verdict).toBe('applique')
    expect(r.arbitrages[1].verdict).toBe('refuse')
  })
})

describe('arbitrerChangements — sur un planning PARTIEL (B-053)', () => {
  // MESURÉ le 27/08, et c'est ce qui a fait réécrire le critère de refus.
  // Un planning à cases vides porte DÉJÀ une violation R18 par case (« garde
  // de semaine sans second »). Exiger « zéro violation après » refusait donc
  // tout changement sur un planning troué — y compris celui qui bouche le
  // trou. La fonction aurait été morte exactement là où elle sert le plus.
  const partiel = (): PlanningPartiel => ({
    attributions: [
      {
        date: '2025-11-03', type: 'semaine_soir',
        placements: [
          { role: 'premier', vetId: 'v1' },
          { role: 'second', vetId: null },
        ],
      },
    ],
  })

  const optionsUnJour = (vets: VetEngine[]) => ({
    vets,
    dateDebut: '2025-11-03',
    dateFin: '2025-11-03',
    saison: 'hiver' as const,
    nbVetosSemaineSoir: 2,
  })

  it('accepte de POURVOIR une case vide, malgré la violation préexistante', () => {
    const bouche = changement('F1', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'second', vetId: 'v2' },
    ])

    const r = arbitrerChangements(
      partiel(), [bouche], optionsUnJour([vet('v1', 'Alice'), vet('v2', 'Bob')]),
    )

    expect(r.arbitrages[0].verdict).toBe('applique')
    expect(r.modifie).toBe(true)
    const lundi = r.planning.attributions[0]
    expect(lundi.placements.find((p) => p.role === 'second')!.vetId).toBe('v2')
  })

  it('refuse quand même de pourvoir une case vide avec quelqu’un d’absent', () => {
    // La contrepartie du test précédent : assouplir le critère ne doit pas
    // avoir ouvert la porte aux vraies fautes.
    const equipe = [
      vet('v1', 'Alice'),
      vet('v2', 'Bob', [{ date_debut: '2025-11-01', date_fin: '2025-11-30', type: 'vacances' }]),
    ]
    const bouche = changement('F1', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'second', vetId: 'v2' },
    ])

    const r = arbitrerChangements(partiel(), [bouche], optionsUnJour(equipe))

    expect(r.arbitrages[0].verdict).toBe('refuse')
    expect(r.modifie).toBe(false)
  })

  it('ne montre à l’admin QUE les violations causées par la proposition', () => {
    // Le planning partiel porte une violation R18 (case vide) qui n'est pas la
    // faute de Filou. La lui imputer ferait lire à l'admin un reproche qui ne
    // concerne pas le changement proposé.
    const equipe = [
      vet('v1', 'Alice'),
      vet('v2', 'Bob', [{ date_debut: '2025-11-01', date_fin: '2025-11-30', type: 'vacances' }]),
    ]
    const bouche = changement('F1', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'second', vetId: 'v2' },
    ])

    const r = arbitrerChangements(partiel(), [bouche], optionsUnJour(equipe))

    expect(r.arbitrages[0].violations.every((v) => v.regle !== 'R18')).toBe(true)
  })
})

describe('arbitrerChangements — hygiène', () => {
  it('ne mute JAMAIS le planning qu’on lui donne', () => {
    const origine = planningDeux()
    const copieAvant = JSON.stringify(origine)

    arbitrerChangements(
      origine,
      [
        changement('F1', [
          { date: '2025-11-03', type: 'semaine_soir', role: 'premier', vetId: 'v2' },
          { date: '2025-11-03', type: 'semaine_soir', role: 'second', vetId: 'v1' },
        ]),
      ],
      options(EQUIPE),
    )

    expect(JSON.stringify(origine)).toBe(copieAvant)
  })

  it('sans proposition, ne touche à rien et le dit', () => {
    const r = arbitrerChangements(planningDeux(), [], options(EQUIPE))

    expect(r.arbitrages).toEqual([])
    expect(r.modifie).toBe(false)
  })
})
