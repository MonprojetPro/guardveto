// ============================================================
// B-064 — une préférence active ne peut pas être invisible
// ============================================================
// Trouvé le 26/08 en vérifiant, à la demande de MiKL, que Filou connaissait la
// nouvelle préférence « éviter la garde la veille d'un repos ».
//
// Il savait la NOMMER (le catalogue la rend en français). Il ne la VOYAIT pas :
// `lister_regles` lit `regles_cabinet`, or une préférence au défaut n'a aucune
// ligne — c'est la convention du produit. Mesure sur le Val d'Allier : une
// seule des cinq préférences avait une ligne, les quatre autres étaient
// actives et muettes.
//
// À la question « est-ce qu'on évite les gardes la veille d'un repos ? », Filou
// aurait répondu « aucune règle ne le prévoit ». Le défaut fondateur de la
// règle FILOU SUIT LE PRODUIT : la réponse incomplète présentée comme complète.
// ============================================================

import { describe, it, expect } from 'vitest'
import { preferencesImplicites, forceParDefautPreference } from '@/lib/regles/preferencesDefaut'
import { BRIQUES_PENALITES_SOUPLES } from '@/data/mapReglesCabinet'
import { rendreRegle } from '@/engine/briques/catalogue'

describe('preferencesImplicites', () => {
  it('rend TOUTES les préférences quand la base est vide', () => {
    const rendues = preferencesImplicites([]).map((p) => p.brique_id).sort()
    expect(rendues).toEqual(Object.keys(BRIQUES_PENALITES_SOUPLES).sort())
  })

  it('reproduit le cas réel du Val d’Allier : une seule ligne en base', () => {
    // Mesure du 26/08 : seul `eviter_we_consecutifs` avait une ligne.
    const rendues = preferencesImplicites(['eviter_we_consecutifs']).map((p) => p.brique_id)

    expect(rendues).not.toContain('eviter_we_consecutifs') // déjà lue en base
    expect(rendues).toContain('eviter_veille_repos')       // celle de MiKL, invisible avant
    expect(rendues.length).toBe(Object.keys(BRIQUES_PENALITES_SOUPLES).length - 1)
  })

  it('ne ressuscite JAMAIS une préférence que le cabinet a éteinte', () => {
    // Une préférence désactivée a une ligne (`actif: false`) : elle est donc
    // « présente », et ne doit pas revenir par cette porte.
    expect(preferencesImplicites(['eviter_veille_repos']).map((p) => p.brique_id))
      .not.toContain('eviter_veille_repos')
  })

  it('chaque préférence porte un niveau, et une phrase en français', () => {
    for (const p of preferencesImplicites([])) {
      expect(p.force.length).toBeGreaterThan(0)
      expect(p.actif).toBe(true)
      // C'est cette phrase que Filou lira : elle ne peut pas être vide.
      const phrase = rendreRegle(p.brique_id, {}, { nomVeto: (i) => i })
      expect(phrase.trim().length).toBeGreaterThan(0)
    }
  })

  it('le niveau par défaut vient du moteur, jamais d’une liste écrite à côté', () => {
    // `veille_repos` est à l'étage 4 → « à éviter ». Si le moteur change son
    // étage, ce test suit sans qu'on ait à y penser.
    expect(forceParDefautPreference('veille_repos')).toBe('evitee')
    expect(forceParDefautPreference('we_consecutif')).toBe('sauf_crise')
    expect(forceParDefautPreference('inversion_ferie')).toBe('si_possible')
  })
})
