// ============================================================
// GUARDVETO — Deux règles qui règlent la MÊME chose différemment (B-129)
// ============================================================
// MiKL, le 20/09 : « oui je veux que Filou me previenne […] et quand on cree
// une regle ca serait bien qu'il y ait une alerte ».
//
// ⚠️ L'INCIDENT, ET CE QU'IL A COUTE. Le cabinet portait DEUX regles
// d'espacement des week-ends actives en meme temps, visant tout le monde :
// « 1 sur 2 » en interdiction ferme, et « 1 sur 3 » en « sauf crise ». Le
// moteur applique simplement les deux — donc la plus contraignante gagne, et
// l'autre ne sert a rien.
//
// Personne ne le voyait. On a cherche un defaut du moteur pendant DEUX
// enquetes (B-124 le 17/09, puis B-128 le 20/09) avant de comprendre que le
// moteur avait raison depuis le debut, et qu'Antoine a 14 jours d'ecart etait
// parfaitement legal.
//
// ⚠️ CE N'EST PAS UN DOUBLON. Le garde-fou existant (`trouverEquivalent`)
// compare les PARAMETRES pour refuser deux regles identiques ; ici les
// parametres DIFFERENT, et c'est precisement le probleme. C'est le test
// inverse.
// ============================================================

import { describe, it, expect } from 'vitest'
import { preVolRegles } from '@/engine/pre-vol'
import type { VetEngine, ContrainteEngine } from '@/engine/types'

const PERIODE = { dateDebut: '2026-01-05', dateFin: '2026-03-01', saison: 'hiver' as const }

/** `force` : 2 = « jamais » (dur) · 3 = « sauf crise » · 4 = « a eviter ». */
function contrainte(
  id: string,
  type: ContrainteEngine['type'],
  brique: string,
  params: Record<string, unknown>,
  force = 2,
  actif = true,
): ContrainteEngine {
  return { id, type, actif, config: { brique, force, params } } as unknown as ContrainteEngine
}

function veto(prenom: string, contraintes: ContrainteEngine[], id = prenom.toLowerCase()): VetEngine {
  return {
    id, prenom, nom: 'X', statut: 'associe', dernier_recours: false,
    conges: [], contraintes,
  }
}

/** L'equipe minimale pour que le pre-vol tourne sans crier famine par ailleurs. */
const RENFORTS = [
  veto('Jean', []), veto('Manon', []), veto('Fanny', []),
  veto('Victor', []), veto('Anne-Sophie', []),
]

const contradictions = (vets: VetEngine[]) =>
  preVolRegles({ vets, ...PERIODE }).filter((a) => a.code === 'regles_contradictoires')

describe('deux reglages differents de la MEME question', () => {
  it("signale le cas reel : « 1 week-end sur 2 » ET « 1 week-end sur 3 »", () => {
    const antoine = veto('Antoine', [
      contrainte('r-n2', 'espacement_weekend', 'espacement_weekend', { n_semaines: 2 }, 2),
      contrainte('r-n3', 'espacement_weekend', 'espacement_weekend', { n_semaines: 3 }, 3),
    ])
    const out = contradictions([antoine, ...RENFORTS])

    expect(out).toHaveLength(1)
    expect(out[0].regleIds).toEqual(['r-n2', 'r-n3'])
    expect(out[0].gravite).toBe('surveiller')
  })

  it("nomme celle qui l'emporte — la plus stricte des DURES", () => {
    // Sans ca, on sait qu'il y a un probleme sans savoir lequel gagne : c'est
    // exactement l'etat dans lequel MiKL a passe deux enquetes.
    const antoine = veto('Antoine', [
      contrainte('r-n2', 'espacement_weekend', 'espacement_weekend', { n_semaines: 2 }, 2),
      contrainte('r-n4', 'espacement_weekend', 'espacement_weekend', { n_semaines: 4 }, 2),
    ])
    const out = contradictions([antoine, ...RENFORTS])

    expect(out).toHaveLength(1)
    // Les deux sont dures : la plus exigeante (4 semaines) s'applique.
    expect(out[0].message).toContain('4')
    expect(out[0].message).toContain('plus stricte')
  })

  it('le dit autrement quand AUCUNE des deux n’est une interdiction ferme', () => {
    // Deux preferences s'additionnent : aucune ne « gagne » vraiment, et
    // designer une gagnante serait faux.
    const antoine = veto('Antoine', [
      contrainte('r-a', 'espacement_weekend', 'espacement_weekend', { n_semaines: 2 }, 4),
      contrainte('r-b', 'espacement_weekend', 'espacement_weekend', { n_semaines: 3 }, 4),
    ])
    const out = contradictions([antoine, ...RENFORTS])

    expect(out).toHaveLength(1)
    expect(out[0].message).toContain('préférences')
    expect(out[0].message).not.toContain('plus stricte')
  })

  it('attrape aussi l’espacement entre deux gardes', () => {
    const antoine = veto('Antoine', [
      contrainte('e-2', 'espacement_min', 'espacement_min', { jours: 2 }),
      contrainte('e-5', 'espacement_min', 'espacement_min', { jours: 5 }),
    ])
    expect(contradictions([antoine, ...RENFORTS])).toHaveLength(1)
  })
})

describe('ce qui N’EST PAS une contradiction — le risque du faux positif', () => {
  // Un avertissement qui se declenche a tort est pire que pas d'avertissement :
  // on apprend a cliquer « quand meme » sans lire, et le gardien devient un
  // peage (c'est la raison d'etre du DELTA dans `controleImpact`).

  it('deux regles qui disent la MEME chose ne se contredisent pas', () => {
    const antoine = veto('Antoine', [
      contrainte('r1', 'espacement_weekend', 'espacement_weekend', { n_semaines: 3 }, 2),
      contrainte('r2', 'espacement_weekend', 'espacement_weekend', { n_semaines: 3 }, 3),
    ])
    expect(contradictions([antoine, ...RENFORTS])).toHaveLength(0)
  })

  it('deux plafonds sur des FENETRES differentes se completent', () => {
    // « au plus 2 par semaine » et « au plus 5 par mois » sont parfaitement
    // compatibles — c'est la meme brique, pas la meme question.
    const antoine = veto('Antoine', [
      contrainte('a1', 'au_plus_n', 'au_plus_n', { n: 2, fenetre: 'semaine_civile' }),
      contrainte('a2', 'au_plus_n', 'au_plus_n', { n: 5, fenetre: 'mois' }),
    ])
    expect(contradictions([antoine, ...RENFORTS])).toHaveLength(0)
  })

  it('deux plafonds sur la MEME fenetre, eux, se contredisent', () => {
    const antoine = veto('Antoine', [
      contrainte('a1', 'au_plus_n', 'au_plus_n', { n: 2, fenetre: 'semaine_civile' }),
      contrainte('a2', 'au_plus_n', 'au_plus_n', { n: 4, fenetre: 'semaine_civile' }),
    ])
    expect(contradictions([antoine, ...RENFORTS])).toHaveLength(1)
  })

  it('une regle EN PAUSE ne contredit personne', () => {
    const antoine = veto('Antoine', [
      contrainte('r1', 'espacement_weekend', 'espacement_weekend', { n_semaines: 2 }, 2),
      contrainte('r2', 'espacement_weekend', 'espacement_weekend', { n_semaines: 3 }, 2, false),
    ])
    expect(contradictions([antoine, ...RENFORTS])).toHaveLength(0)
  })

  it('deux repos fixes sur des jours differents ne se contredisent pas', () => {
    // Victor a bien un repos le lundi ET un le mardi : c'est legitime, et le
    // signaler serait le faux positif le plus facile a produire.
    const victor = veto('Victor2', [
      contrainte('j1', 'jour_repos_fixe', 'interdire_creneau', { jour: 'lundi' }),
      contrainte('j2', 'jour_repos_fixe', 'interdire_creneau', { jour: 'mardi' }),
    ])
    expect(contradictions([victor, ...RENFORTS])).toHaveLength(0)
  })

  it('un cabinet sans regle de rythme ne declenche rien', () => {
    expect(contradictions(RENFORTS)).toHaveLength(0)
  })
})

describe('l’avertissement ne se repete pas', () => {
  it('une regle « tous » depliee sur 6 vetos ne produit qu’UNE alerte', () => {
    // Un avertissement affiche sept fois est un avertissement qu'on apprend a
    // ne plus lire.
    const paire = () => [
      contrainte('g-n2', 'espacement_weekend', 'espacement_weekend', { n_semaines: 2 }, 2),
      contrainte('g-n3', 'espacement_weekend', 'espacement_weekend', { n_semaines: 3 }, 3),
    ]
    const equipe = ['Antoine', 'Jean', 'Manon', 'Fanny', 'Victor', 'Anne-Sophie']
      .map((p) => veto(p, paire()))

    expect(contradictions(equipe)).toHaveLength(1)
  })

  it('mais deux vetos avec des regles NOMINATIVES distinctes font deux alertes', () => {
    const antoine = veto('Antoine', [
      contrainte('a-n2', 'espacement_weekend', 'espacement_weekend', { n_semaines: 2 }, 2),
      contrainte('a-n3', 'espacement_weekend', 'espacement_weekend', { n_semaines: 3 }, 3),
    ])
    const jean = veto('Jean2', [
      contrainte('j-n2', 'espacement_weekend', 'espacement_weekend', { n_semaines: 2 }, 2),
      contrainte('j-n4', 'espacement_weekend', 'espacement_weekend', { n_semaines: 4 }, 3),
    ])
    expect(contradictions([antoine, jean, ...RENFORTS])).toHaveLength(2)
  })
})
