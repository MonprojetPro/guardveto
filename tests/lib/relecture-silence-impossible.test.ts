// ============================================================
// B-071 — la relecture de Filou ne peut pas se taire
// ============================================================
// MiKL, le 27/08, en recette sur les vraies données de Val d'Allier :
// « tout ça pour qu'il ne trouve rien à dire ? alors qu'il y a des cases
// vides, qu'Antoine fait un max de week-ends… c'est pas bon du tout ».
//
// Ce qui s'était passé : Filou avait rendu une relecture ENTIÈREMENT VIDE, et
// l'écran avait affiché « Filou n'a rien à redire à ce planning ». Pas une
// panne — une FAUSSE ASSURANCE, sur un planning où Anne-Sophie faisait 8
// gardes sans jamais être 1re du week-end et où deux cases restaient vides.
//
// La mesure a écarté la donnée : tout était dans le dossier. C'était le prompt
// qui décourageait de parler. La parade n'est donc PAS une consigne de plus —
// c'est une consigne qui a causé le problème. Elle est structurelle : une
// ligne par critère, et ce qui manque se dit.
//
// Ces tests protègent la partie vérifiable sans réseau : que le code d'aval
// ne puisse plus jamais transformer un silence en bonne nouvelle.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  normaliserRelecture,
  type DossierRelecture,
  type SortieRelecture,
} from '@/lib/ia/relecturePlanning'
import { CRITERES_HUMAINS } from '@/lib/planning/criteres-humains'

const DOSSIER: DossierRelecture = {
  // B-093 : ce test porte sur l'impossibilité du silence, pas sur les échanges.
  echanges: [],
  periode: 'du 21 septembre au 18 octobre',
  saison: 'hiver',
  places: [
    {
      date: '2026-10-03', jour: 'samedi 3 octobre', creneau: 'week-end',
      type: 'weekend', role: 'premier', prenom: 'Antoine', vetId: 'v-antoine',
      remplacants: ['Anne-Sophie'],
    },
    {
      date: '2026-10-03', jour: 'samedi 3 octobre', creneau: 'week-end',
      type: 'weekend', role: 'second', prenom: null, vetId: null,
      remplacants: ['Anne-Sophie'],
    },
  ],
  equipe: [
    {
      vetId: 'v-antoine', prenom: 'Antoine',
      gardesPeriode: { total: 7, weekends: 2, premierWeekend: 1 },
      absences: [], regles: [],
    },
    {
      vetId: 'v-anne-so', prenom: 'Anne-Sophie',
      gardesPeriode: { total: 8, weekends: 1, premierWeekend: 0 },
      absences: [], regles: [],
    },
  ],
  reglesCabinet: [],
  roleAvantageFinancier: 'premier',
}

/** Une revue complète : une ligne par critère, toutes « rien à signaler ». */
function revueComplete(): SortieRelecture['revue'] {
  return CRITERES_HUMAINS.map((c) => ({
    critere: c.cle,
    verdict: 'rien_a_signaler' as const,
    constat: `Vérifié pour ${c.titre} : rien à signaler.`,
    corrigeable: false,
  }))
}

function sortie(partiel: Partial<SortieRelecture> = {}): SortieRelecture {
  return {
    synthese: 'Ce planning tient globalement, avec deux points de vigilance.',
    revue: revueComplete(),
    changements: [],
    ...partiel,
  }
}

describe('normaliserRelecture — le silence se voit', () => {
  it('signale TOUS les critères quand Filou n’en traite aucun', () => {
    // Le cas exact du 27/08 : une réponse vide. Elle ne doit plus pouvoir
    // ressortir comme « rien à redire » — chaque critère manquant est nommé.
    const r = normaliserRelecture(sortie({ revue: [] }), DOSSIER)

    expect(r.revue).toEqual([])
    expect(r.criteresNonTraites).toHaveLength(CRITERES_HUMAINS.length)
    expect(r.criteresNonTraites).toContain(
      CRITERES_HUMAINS.find((c) => c.cle === 'role_avantage')!.titre,
    )
  })

  it('signale le critère manquant quand Filou en oublie UN seul', () => {
    const partielle = revueComplete().filter((r) => r.critere !== 'concentration')

    const r = normaliserRelecture(sortie({ revue: partielle }), DOSSIER)

    expect(r.criteresNonTraites).toEqual([
      CRITERES_HUMAINS.find((c) => c.cle === 'concentration')!.titre,
    ])
  })

  it('ne signale rien quand la revue est complète', () => {
    const r = normaliserRelecture(sortie(), DOSSIER)

    expect(r.criteresNonTraites).toEqual([])
    expect(r.revue).toHaveLength(CRITERES_HUMAINS.length)
  })
})

describe('normaliserRelecture — hygiène de la revue', () => {
  it('range la revue dans l’ordre du catalogue, pas dans celui de la réponse', () => {
    // L'admin lit les mêmes critères au même endroit d'une génération à
    // l'autre ; un ordre qui bouge se relit à chaque fois.
    const r = normaliserRelecture(
      sortie({ revue: [...revueComplete()].reverse() }),
      DOSSIER,
    )

    expect(r.revue.map((x) => x.critere)).toEqual(CRITERES_HUMAINS.map((c) => c.cle))
  })

  it('écarte un critère inventé sans le compter comme traité', () => {
    const avecInvente = [
      ...revueComplete().filter((r) => r.critere !== 'epuisement'),
      {
        critere: 'critere_qui_nexiste_pas',
        verdict: 'probleme' as const,
        constat: 'Inventé.',
        corrigeable: false,
      },
    ]

    const r = normaliserRelecture(sortie({ revue: avecInvente }), DOSSIER)

    expect(r.revue.some((x) => x.critere === 'critere_qui_nexiste_pas')).toBe(false)
    expect(r.criteresNonTraites).toEqual([
      CRITERES_HUMAINS.find((c) => c.cle === 'epuisement')!.titre,
    ])
  })

  it('garde la PREMIÈRE ligne quand Filou traite deux fois le même critère', () => {
    const doublon = [
      ...revueComplete(),
      {
        critere: 'concentration',
        verdict: 'probleme' as const,
        constat: 'Deuxième avis contradictoire.',
        corrigeable: false,
      },
    ]

    const r = normaliserRelecture(sortie({ revue: doublon }), DOSSIER)

    expect(r.revue).toHaveLength(CRITERES_HUMAINS.length)
    expect(r.revue.find((x) => x.critere === 'concentration')!.verdict).toBe(
      'rien_a_signaler',
    )
  })
})

describe('normaliserRelecture — les propositions restent filtrées', () => {
  it('écarte une proposition qui vise une place inexistante', () => {
    const r = normaliserRelecture(
      sortie({
        changements: [
          {
            motif: 'Un motif.',
            critere: 'cases_vides',
            affectations: [
              { date: '2030-01-01', type: 'weekend', role: 'second', vetId: 'v-anne-so' },
            ],
          },
        ],
      }),
      DOSSIER,
    )

    expect(r.changements).toEqual([])
  })

  it('écarte une proposition qui nomme quelqu’un d’inconnu', () => {
    // Un identifiant inventé mettrait un fantôme sur une garde : le validateur
    // ne connaît pas cette personne et pourrait n'avoir rien à redire.
    const r = normaliserRelecture(
      sortie({
        changements: [
          {
            motif: 'Un motif.',
            critere: 'cases_vides',
            affectations: [
              { date: '2026-10-03', type: 'weekend', role: 'second', vetId: 'v-fantome' },
            ],
          },
        ],
      }),
      DOSSIER,
    )

    expect(r.changements).toEqual([])
  })

  it('garde une proposition valide et lui donne un identifiant', () => {
    const r = normaliserRelecture(
      sortie({
        changements: [
          {
            motif: 'Anne-Sophie n’est jamais première du week-end.',
            critere: 'role_avantage',
            affectations: [
              { date: '2026-10-03', type: 'weekend', role: 'second', vetId: 'v-anne-so' },
            ],
          },
        ],
      }),
      DOSSIER,
    )

    expect(r.changements).toHaveLength(1)
    expect(r.changements[0].id).toBe('F1')
    expect(r.changements[0].critere).toBe('role_avantage')
  })
})
