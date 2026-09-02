// ============================================================
// B-096 — LES PRÉFÉRENCES ENFREINTES N'ARRIVAIENT JAMAIS À FILOU
// ============================================================
// Le cas réel, reproduit : le cabinet du bac à sable règle « au moins 3
// semaines entre deux week-ends » en « sauf en cas de crise » (étage 3, donc
// une préférence). Sur Hiver P2, le planning l'enfreint HUIT fois, toutes à 14
// jours — Antoine trois fois de suite.
//
// Le moteur le savait : il a payé ces pénalités en construisant. Filou, non :
// rien ne les lui transmettait, et il aurait dû soustraire des dates de tête
// sur 118 lignes pour les retrouver. Il n'a rien dit du rythme d'Antoine.
// ============================================================

import { describe, it, expect } from 'vitest'
import { preferencesEnfreintes } from '../relecture/preferences'
import type { PlanningPartiel, VetEngine, ContrainteEngine } from '../types'

/** Une règle « au moins N semaines entre deux week-ends », à la fermeté voulue. */
function espacementWeekend(nSemaines: number, force: number): ContrainteEngine {
  return {
    id: `esp-${nSemaines}-${force}`,
    type: 'espacement_weekend',
    actif: true,
    config: { params: { n_semaines: nSemaines }, force },
  } as unknown as ContrainteEngine
}

function vet(id: string, prenom: string, contraintes: ContrainteEngine[] = []): VetEngine {
  return {
    id, nom: prenom, prenom, statut: 'associe',
    dernier_recours: false, contraintes, conges: [],
  }
}

const VEN1 = '2025-11-07', SAM1 = '2025-11-08'
const VEN2 = '2025-11-21', SAM2 = '2025-11-22' // 14 jours après : la préférence saute

/** Antoine tient deux week-ends espacés de 14 jours seulement. */
function planningDeuxWeekendsRapproches(): PlanningPartiel {
  return {
    attributions: [
      {
        date: VEN1, type: 'vendredi_soir',
        placements: [{ role: 'premier', vetId: 'antoine' }, { role: 'second', vetId: 'bob' }],
      },
      {
        date: SAM1, type: 'weekend',
        placements: [{ role: 'premier', vetId: 'bob' }, { role: 'second', vetId: 'antoine' }],
      },
      {
        date: VEN2, type: 'vendredi_soir',
        placements: [{ role: 'premier', vetId: 'antoine' }, { role: 'second', vetId: 'bob' }],
      },
      {
        date: SAM2, type: 'weekend',
        placements: [{ role: 'premier', vetId: 'bob' }, { role: 'second', vetId: 'antoine' }],
      },
    ],
  }
}

function options(contraintes: ContrainteEngine[]) {
  return {
    vets: [vet('antoine', 'Antoine', contraintes), vet('bob', 'Bob', contraintes)],
    dateDebut: VEN1,
    dateFin: SAM2,
    saison: 'hiver' as const,
    nbVetosSemaineSoir: 2,
  }
}

describe('preferencesEnfreintes — le cas d’Antoine', () => {
  it('remonte le week-end trop rapproché quand la règle est une PRÉFÉRENCE', () => {
    // Étage 3 = « sauf en cas de crise ». Le validateur l'ignore, à raison —
    // ce n'est pas une violation. Mais Filou doit le savoir pour en parler.
    const p = preferencesEnfreintes(planningDeuxWeekendsRapproches(), options([
      espacementWeekend(3, 3),
    ]))
    expect(p.length).toBeGreaterThan(0)
    expect(p.some((x) => x.vetId === 'antoine')).toBe(true)
  })

  it('la phrase remontée est celle du produit, lisible telle quelle', () => {
    const [premiere] = preferencesEnfreintes(planningDeuxWeekendsRapproches(), options([
      espacementWeekend(3, 3),
    ]))
    // Elle finira dans ce que Filou dit à l'administratrice. Elle doit nommer
    // la personne, pas rendre un code machine.
    expect(premiere.detail).toContain('Antoine')
    expect(premiere.detail.length).toBeGreaterThan(10)
  })

  it('ne remonte RIEN quand la préférence est respectée', () => {
    // Deux semaines d'écart suffisent si la règle demande 2. Un détecteur qui
    // crie sur du normal se fait ignorer — c'est la leçon du faux positif
    // d'espacement d'août, qui avait noyé la vraie règle.
    const p = preferencesEnfreintes(planningDeuxWeekendsRapproches(), options([
      espacementWeekend(2, 3),
    ]))
    expect(p).toEqual([])
  })
})

describe('preferencesEnfreintes — ce qu’elle ne doit PAS confondre', () => {
  it('ne remonte pas les violations DURES — c’est un autre sujet', () => {
    // Même situation, mais la règle est ferme (étage 2). Ce n'est plus une
    // préférence enfreinte, c'est une violation, et le produit la signale
    // ailleurs. La confondre ferait dire à Filou « c'est juste une préférence »
    // sur quelque chose d'interdit.
    const p = preferencesEnfreintes(planningDeuxWeekendsRapproches(), options([
      espacementWeekend(3, 2),
    ]))
    expect(p).toEqual([])
  })

  it('ne rend rien quand le cabinet n’a réglé aucune préférence', () => {
    expect(preferencesEnfreintes(planningDeuxWeekendsRapproches(), options([]))).toEqual([])
  })

  it('ne modifie pas les contraintes qu’on lui passe', () => {
    // La requalification en « ferme » est faite sur une COPIE. Si elle mutait
    // l'entrée, le reste du produit verrait soudain en dur des règles que le
    // cabinet a voulues souples, sans que rien ne l'explique.
    const regles = [espacementWeekend(3, 3)]
    const opts = options(regles)
    preferencesEnfreintes(planningDeuxWeekendsRapproches(), opts)
    expect((opts.vets[0].contraintes[0].config as Record<string, unknown>).force).toBe(3)
  })
})
