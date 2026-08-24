// ============================================================
// Ce que Filou RÉPOND : d'où le tient-il ?
// ============================================================
// « Jamais de suggestion IA inventée » — mais rien ne veillait sur ses réponses.
// Le second gardien contrôle l'OMISSION (une action oubliée), pas l'INVENTION.
//
// MiKL a tranché : on affiche les sources, on ne bloque pas. Ces tests figent
// les trois choses qui font que cet affichage sert à quelque chose :
//   ① chaque outil de lecture du catalogue a un libellé LISIBLE (sinon la
//      source disparaît en silence, et on est revenu à rien) ;
//   ② les écritures et l'affichage ne comptent pas comme des sources ;
//   ③ le cas « aucune lecture » se DIT, il ne s'efface pas.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  sourcesLisibles,
  phraseSources,
  sansAucuneLecture,
  nomsDesLecturesDuCatalogue,
} from '../outils/sources'
import { AUCUNE_LECTURE, enumerer } from '../sources-texte'

describe('couverture du catalogue', () => {
  it('chaque outil de lecture porte un libellé lisible', () => {
    // Un outil de lecture ajouté sans libellé n'apparaîtrait jamais dans les
    // sources : la réponse s'afficherait sans dire d'où elle vient, et
    // personne ne s'en apercevrait. D'où ce test.
    const sansLibelle = nomsDesLecturesDuCatalogue().filter(
      (nom) => sourcesLisibles([nom]).length === 0,
    )
    expect(sansLibelle).toEqual([])
  })

  it('aucun libellé ne ressemble à un nom technique', () => {
    for (const nom of nomsDesLecturesDuCatalogue()) {
      const [libelle] = sourcesLisibles([nom])
      expect(libelle).not.toContain('_')
      expect(libelle).not.toBe(nom)
    }
  })
})

describe('sourcesLisibles', () => {
  it('traduit les noms d’outils en français', () => {
    expect(sourcesLisibles(['lire_gardes', 'lire_equipe'])).toEqual([
      'le planning',
      "les fiches de l'équipe",
    ])
  })

  it('ne compte ni l’affichage ni les écritures comme des sources', () => {
    // Poser une réponse sur le tableau ne fonde rien, et une écriture n'a même
    // pas eu lieu : la proposition attend un clic.
    expect(sourcesLisibles(['afficher_sur_le_tableau', 'modifier_veterinaire'])).toEqual([])
  })

  it('dédoublonne un outil appelé plusieurs fois', () => {
    expect(sourcesLisibles(['lire_gardes', 'lire_gardes'])).toEqual(['le planning'])
  })

  it('ignore un nom d’outil inconnu plutôt que d’inventer une source', () => {
    expect(sourcesLisibles(['outil_qui_nexiste_pas'])).toEqual([])
  })

  it('supporte le témoin « (2ᵉ regard) » du second gardien', () => {
    // Le second gardien ne fait que des écritures — donc aucune source — mais
    // le suffixe ne doit pas nous faire rater un nom si cela changeait.
    expect(sourcesLisibles(['lire_equipe (2ᵉ regard)'])).toEqual(["les fiches de l'équipe"])
  })

  it('supporte une liste absente', () => {
    expect(sourcesLisibles(undefined)).toEqual([])
  })
})

describe('la ligne affichée sous la réponse', () => {
  it('nomme les sources en français, sans jargon', () => {
    const phrase = phraseSources(['lire_gardes', 'lire_equipe'])
    expect(phrase).toBe("D’après le planning et les fiches de l'équipe.")
    expect(phrase).not.toContain('lire_')
  })

  it('DIT quand aucune lecture n’a eu lieu — c’est le cas qui compte', () => {
    // Le chemin réel : `stop_reason !== 'tool_use'` dès le premier tour. Le
    // texte libre du modèle part sur le tableau sans qu'aucune lecture ait eu
    // lieu. Le silence se lirait comme « rien à signaler ».
    expect(sansAucuneLecture([])).toBe(true)
    expect(phraseSources([])).toBe(AUCUNE_LECTURE)
    expect(AUCUNE_LECTURE).toContain('aucune donnée')
  })

  it('une réponse fondée n’est pas signalée comme non fondée', () => {
    expect(sansAucuneLecture(['lire_conges'])).toBe(false)
  })
})

describe('enumerer', () => {
  it('n’écrit jamais une liste qui a l’air inachevée', () => {
    expect(enumerer(['a'])).toBe('a')
    expect(enumerer(['a', 'b'])).toBe('a et b')
    expect(enumerer(['a', 'b', 'c'])).toBe('a, b et c')
  })
})
