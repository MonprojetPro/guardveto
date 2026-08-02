// ============================================================
// Les corrections proposées par Filou — contrat avec le pré-vol
// ============================================================
// Ce test garde une frontière : `engine/pre-vol.ts` produit des CODES,
// `lib/regles/corrections.ts` les traduit en gestes. Le jour où le pré-vol
// apprend à détecter une douzième famille d'incohérence, la modale l'affichera
// sans une seule correction en dessous — silencieusement. Ce n'est pas une
// panne, c'est pire : un gardien qui montre un problème sans jamais dire quoi
// faire finit par n'être qu'un péage qu'on clique sans lire.
//
// D'où l'inventaire ci-dessous : il ÉNUMÈRE les codes du pré-vol et exige
// qu'aucun ne soit muet sans qu'on l'ait décidé.
// ============================================================

import { describe, expect, it } from 'vitest'
import { correctionsPour, phraseGardien } from '@/lib/regles/corrections'
import type { AvertissementPreVol, CodeAvertissementPreVol } from '@/engine/pre-vol'

const avert = (code: CodeAvertissementPreVol, regles: string[] = []): AvertissementPreVol => ({
  code, regles, message: `message de test pour ${code}`,
})

/** Les onze familles que le pré-vol sait détecter, au 2026-08-02. */
const TOUS_LES_CODES: CodeAvertissementPreVol[] = [
  'regle_veto_sorti',
  'duo_veto_sorti',
  'veto_jamais_disponible',
  'creneau_impossible',
  'charge_globale_insuffisante',
  'weekends_insuffisants',
  'composition_sans_porteur',
  'role_interdit_intenable',
  'sequence_inerte',
  'cohorte_equite_sans_porteur',
  'seulement_avec_partenaire_sorti',
]

describe('correctionsPour — aucun avertissement muet', () => {
  it.each(TOUS_LES_CODES)('« %s » propose au moins un geste', (code) => {
    expect(correctionsPour([avert(code)]).length).toBeGreaterThan(0)
  })

  it('une étiquette sans porteur envoie sur la page Équipe', () => {
    const [c] = correctionsPour([avert('composition_sans_porteur')])
    expect(c.genre).toBe('ailleurs')
    expect(c.cible).toBe('/equipe')
  })

  it('un véto écarté de tout propose d’abord d’assouplir', () => {
    const [c] = correctionsPour([avert('veto_jamais_disponible')])
    expect(c.genre).toBe('assouplir')
    expect(c.cible).toBe('sauf_crise')
  })

  it('une règle inerte ne propose PAS d’assouplir', () => {
    // L'assouplir ne changerait rien : elle est déjà sans effet. Proposer un
    // geste qui ne corrige pas le problème est le seul vrai contre-sens ici.
    const genres = correctionsPour([avert('sequence_inerte')]).map((c) => c.genre)
    expect(genres).not.toContain('assouplir')
  })
})

describe('correctionsPour — dédoublonnage', () => {
  it('deux avertissements qui appellent le même geste ne le proposent qu’une fois', () => {
    const c = correctionsPour([
      avert('composition_sans_porteur'),
      avert('cohorte_equite_sans_porteur'),
    ])
    expect(c.filter((x) => x.cible === '/equipe')).toHaveLength(1)
  })

  it('aucun avertissement, aucune correction', () => {
    expect(correctionsPour([])).toEqual([])
  })
})

describe('phraseGardien', () => {
  it('accorde le singulier et nomme la période testée', () => {
    expect(phraseGardien(1, 'ete 2026')).toContain('un point qui coince sur ete 2026')
  })

  it('accorde le pluriel', () => {
    expect(phraseGardien(3)).toContain('3 points qui coincent')
  })

  it('sans période, ne laisse pas traîner un « sur » orphelin', () => {
    expect(phraseGardien(2)).not.toContain(' sur ')
  })
})
