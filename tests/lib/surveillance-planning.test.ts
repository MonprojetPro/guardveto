// ============================================================
// GUARDVETO — B-130a : ce qu'on surveille, et ce qu'on en dit
// ============================================================
// Ces tests figent une DECISION PRODUIT, pas un detail d'implementation :
//
//   « Sur un brouillon, seulement les regles enfreintes, pas les cases vides. »
//     — MiKL, 30/09
//
// Le contexte, parce qu'il explique pourquoi les deux moities comptent : le
// controle ne tournait que sur les plannings PUBLIES. Le 25/09, MiKL durcit
// `espacement_min` APRES avoir genere Hiver P2 ; le planning deja enregistre
// devient non conforme a cette seconde, et rien ne le dit — la periode etait en
// brouillon. Il l'a vu a l'œil nu, et a conclu a un bug du moteur (B-130).
//
// Les deux moities se tiennent : surveiller le brouillon SANS taire les cases
// vides ferait crier le bandeau a chaque generation partielle, et un bandeau
// qui crie toujours ne se lit plus — on aurait remplace un silence par du
// bruit, ce qui revient au meme.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  REGIME_PAR_STATUT,
  REGLE_CASE_VIDE,
  estSurveillee,
  filtrerSelonStatut,
  remonteLesCasesVides,
} from '@/lib/produit/surveillancePlanning'
import type { StatutPeriode } from '@/types'

/** Un echantillon realiste : 2 regles enfreintes + 2 cases vides. */
const VIOLATIONS = [
  { regle: 'ESPACEMENT', date: '2026-10-27', detail: 'seulement 1 jour' },
  { regle: REGLE_CASE_VIDE, date: '2026-10-28', detail: 'place non pourvue' },
  { regle: 'R1', date: '2026-11-03', detail: 'conge' },
  { regle: REGLE_CASE_VIDE, date: '2026-11-04', detail: 'place non pourvue' },
] as const

describe('B-130a — le brouillon est surveille, mais pas sur ses cases vides', () => {
  it('un brouillon remonte les regles enfreintes', () => {
    const gardees = filtrerSelonStatut(VIOLATIONS, 'brouillon')
    expect(gardees.map((v) => v.regle)).toEqual(['ESPACEMENT', 'R1'])
  })

  it('un brouillon ne remonte AUCUNE case vide', () => {
    const gardees = filtrerSelonStatut(VIOLATIONS, 'brouillon')
    expect(gardees.some((v) => v.regle === REGLE_CASE_VIDE)).toBe(false)
  })

  it('le filtre garde les champs des violations — un bandeau sans date est inutile', () => {
    const [premiere] = filtrerSelonStatut(VIOLATIONS, 'brouillon')
    expect(premiere.date).toBe('2026-10-27')
    expect(premiere.detail).toBe('seulement 1 jour')
  })
})

describe('B-130a — le publie, lui, remonte tout', () => {
  it('une case vide sur un planning DIFFUSE est un trou de garde, pas un travail en cours', () => {
    const gardees = filtrerSelonStatut(VIOLATIONS, 'publie')
    expect(gardees).toHaveLength(4)
    expect(gardees.filter((v) => v.regle === REGLE_CASE_VIDE)).toHaveLength(2)
  })
})

describe('B-130a — le verrouille reste hors controle', () => {
  it('une periode close ne remonte rien : signaler n ouvre aucune decision', () => {
    expect(estSurveillee('verrouille')).toBe(false)
    expect(filtrerSelonStatut(VIOLATIONS, 'verrouille')).toEqual([])
  })
})

describe('B-130a — un statut inconnu ne produit jamais un verdict', () => {
  // Le repli le plus etroit est le seul honnete : pretendre juger une periode
  // dont on ignore l'etat rendrait un « aucune regle enfreinte » sans valeur,
  // c'est-a-dire une bonne nouvelle fausse — et personne ne va verifier une
  // bonne nouvelle.
  it('undefined n est pas surveille et ne remonte rien', () => {
    expect(estSurveillee(undefined)).toBe(false)
    expect(remonteLesCasesVides(undefined)).toBe(false)
    expect(filtrerSelonStatut(VIOLATIONS, undefined)).toEqual([])
  })

  it('une valeur inattendue en base ne passe pas en « tout va bien »', () => {
    const inconnu = 'archive' as StatutPeriode
    expect(estSurveillee(inconnu)).toBe(false)
    expect(filtrerSelonStatut(VIOLATIONS, inconnu)).toEqual([])
  })
})

describe('B-130a — aucun statut ne peut rester muet', () => {
  // Le pendant de `lib/produit/attentes.ts` : la table est exhaustive, et on
  // verifie qu'elle l'est VRAIMENT plutot que de faire confiance au type — un
  // `Record` satisfait TypeScript, il ne prouve pas que chaque entree a ete
  // pensee. Chaque regime doit aussi dire POURQUOI, pour qu'un futur lecteur
  // n'ait pas a deviner l'intention.
  const STATUTS: StatutPeriode[] = ['brouillon', 'publie', 'verrouille']

  it('les 3 statuts de periode ont leur decision', () => {
    expect(Object.keys(REGIME_PAR_STATUT).sort()).toEqual([...STATUTS].sort())
  })

  it('chaque decision est motivee, et pas d un mot', () => {
    for (const statut of STATUTS) {
      expect(REGIME_PAR_STATUT[statut].pourquoi.length).toBeGreaterThan(40)
    }
  })

  it('remonter les cases vides sans etre surveille n a aucun sens', () => {
    for (const statut of STATUTS) {
      const r = REGIME_PAR_STATUT[statut]
      if (r.remonterLesCasesVides) expect(r.surveillee).toBe(true)
    }
  })
})
