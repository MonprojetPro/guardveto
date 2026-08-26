// ============================================================
// Le catalogue du prompt décrit-il TOUT ce que le moteur sait faire ?
// ============================================================
// Le prompt système est la seule chose qui apprend à Filou ce qu'il peut
// proposer. Un type de règle absent du catalogue devient INVISIBLE : Filou ne
// le proposera jamais, et personne ne s'en apercevra — il répondra simplement
// « je ne sais pas faire ça », ce qui est indiscernable d'un refus légitime.
//
// Ces tests figent le contrat entre le SCHÉMA (ce que le serveur accepte) et le
// CATALOGUE (ce que Filou connaît). Ils ont été écrits en condensant le
// catalogue de 39 % : sans eux, une phrase supprimée par mégarde aurait coûté un
// type de règle entier, en silence.
// ============================================================

import { describe, it, expect } from 'vitest'
import { construireSystemIA } from '../proposerRegle'
import { BRIQUES_IA, FORCES_IA } from '../regleSchema'

const SYSTEM = construireSystemIA(
  [
    { id: '1', prenom: 'Manon' },
    { id: '2', prenom: 'Victor' },
  ],
  [
    { code: 'semaine_soir', nom: 'Nuit de semaine' },
    { code: 'weekend', nom: 'Week-end' },
  ],
  ['junior', 'senior'],
  ['premier', 'second'],
)

describe('Catalogue du prompt — couverture', () => {
  it('nomme les 19 types de règles que le serveur sait créer', () => {
    const manquants = BRIQUES_IA.filter((b) => !SYSTEM.includes(b))
    expect(manquants).toEqual([])
  })

  it('nomme les quatre niveaux de force', () => {
    const manquants = FORCES_IA.filter((f) => !SYSTEM.includes(f))
    expect(manquants).toEqual([])
  })

  it('nomme chaque paramètre attendu par au moins un type de règle', () => {
    // Ces noms sont ceux que le serveur lit dans `params_json`. Si le catalogue
    // ne les mentionne pas, Filou ne peut pas les produire correctement.
    const PARAMS = [
      'jour',
      'exception_vacances_scolaires',
      'si_garde_we',
      'sinon',
      'semaines',
      'periodes',
      'partenaire',
      'fenetre',
      'creneaux',
      'ecart_min_jours',
      'n_semaines',
      'mode_composition',
      'tag',
      'role_interdit',
      'jours',
      'sens',
      'type_avant',
      'type_apres',
      'n_jours',
      'repos_jours',
      'ancre',
      'sens_cadence',
      'fetes',
      'dates',
      'dimension_equite',
      'importance_equite',
    ]
    const manquants = PARAMS.filter((p) => !SYSTEM.includes(p))
    expect(manquants).toEqual([])
  })

  it('énumère les valeurs autorisées des paramètres à choix fermé', () => {
    // Une valeur d'énumération absente du catalogue est une valeur que Filou
    // n'emploiera jamais — le serveur l'accepterait pourtant.
    const VALEURS = [
      // fenetre
      'semaine_civile',
      'glissante_7_jours',
      'glissante_14_jours',
      'glissante_30_jours',
      // mode_composition
      'au_moins_un',
      'pas_seuls',
      // sens_cadence
      'interdit',
      'impose',
      // dimension_equite
      'weekend_premier',
      'ferie',
      'semaine_premier',
      'semaine_second',
      'grands_weekend',
      // importance_equite
      'peu_important',
      'essentiel',
      // fetes
      'noel',
      'nouvel_an',
      // semaines
      'paires',
      'impaires',
      // periodes
      'soir_semaine',
    ]
    const manquants = VALEURS.filter((v) => !SYSTEM.includes(v))
    expect(manquants).toEqual([])
  })

  it('conserve les six pièges de désambiguïsation', () => {
    // Chacun corrige une confusion RÉELLE observée. Les perdre, c'est perdre en
    // exigence : Filou proposerait une règle plausible mais fausse.
    const PIEGES: Array<[string, RegExp]> = [
      ['plafond ≠ fréquence', /au plus 2 WE par mois[\s\S]{0,80}un WE sur 3/i],
      ['fréquence ≠ cadencement', /DATES PRÉCISES|dates PRÉCISES/],
      ['préférence ≠ condition', /seulement si[\s\S]{0,60}jamais sans/i],
      ['repos = espacement', /2 jours de repos = 3 jours d.écart/],
      ['lendemain civil', /son lendemain est donc le lundi/],
      ['équité globale hors périmètre', /réglages d.équité/],
    ]
    const perdus = PIEGES.filter(([, motif]) => !motif.test(SYSTEM)).map(([nom]) => nom)
    expect(perdus).toEqual([])
  })

  it('rappelle que les desiderata ne sont jamais fermes', () => {
    expect(SYSTEM).toMatch(/DESIDERATA/)
    expect(SYSTEM).toMatch(/JAMAIS "jamais"/)
  })

  it('injecte le contexte réel du cabinet (prénoms, créneaux, étiquettes, rôles)', () => {
    expect(SYSTEM).toContain('Manon')
    expect(SYSTEM).toContain('semaine_soir')
    expect(SYSTEM).toContain('junior')
    expect(SYSTEM).toContain('premier')
  })

  it('reste sous le seuil qui rendait le prompt coûteux', () => {
    // Repère de non-régression, mesuré et non deviné : le prompt système complet
    // (catalogue + consignes + contexte du cabinet) est passé de 13 535 à 9 086
    // caractères, soit 6 179 → ~4 200 tokens. Ce test ne juge pas la qualité —
    // il alerte si quelqu'un le regonfle sans s'en rendre compte.
    expect(SYSTEM.length).toBeLessThan(10_000)
  })
})
