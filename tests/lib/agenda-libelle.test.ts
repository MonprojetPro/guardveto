import { describe, it, expect } from 'vitest'
import { libelleGarde, roleCourt } from '@/lib/agenda/libelle'

describe('libelleGarde — le gabarit décidé par MiKL', () => {
  it('sans horaires : base-nom-role', () => {
    expect(
      libelleGarde({ base: 'garde', nom: 'ACB', role: '1er', afficherHoraires: false }),
    ).toBe('garde-ACB-1er')
  })

  it('avec option horaires cochée et horaires fournis', () => {
    expect(
      libelleGarde({
        base: 'garde',
        nom: 'ACB',
        role: '1er',
        horaires: { debut: '18h', fin: '08h' },
        afficherHoraires: true,
      }),
    ).toBe('garde-ACB-1er-18h/08h')
  })

  it('option horaires cochée mais horaires absents : segment omis, pas de trou', () => {
    expect(
      libelleGarde({ base: 'garde', nom: 'ACB', role: '1er', afficherHoraires: true }),
    ).toBe('garde-ACB-1er')
  })

  it('option horaires non cochée : les horaires fournis sont ignorés', () => {
    expect(
      libelleGarde({
        base: 'garde',
        nom: 'ACB',
        role: '1er',
        horaires: { debut: '18h', fin: '08h' },
        afficherHoraires: false,
      }),
    ).toBe('garde-ACB-1er')
  })

  it('nom vide : pas de double tiret', () => {
    expect(
      libelleGarde({ base: 'garde', nom: '', role: '1er', afficherHoraires: false }),
    ).toBe('garde-1er')
  })

  it('base vide : pas de tiret en tête', () => {
    expect(
      libelleGarde({ base: '', nom: 'ACB', role: '1er', afficherHoraires: false }),
    ).toBe('ACB-1er')
  })

  it('jamais de tiret orphelin en fin de chaîne', () => {
    const titre = libelleGarde({ base: 'garde', nom: 'ACB', role: '', afficherHoraires: false })
    expect(titre.endsWith('-')).toBe(false)
    expect(titre).toBe('garde-ACB')
  })

  it('3e rôle : le libellé passe tel quel', () => {
    expect(
      libelleGarde({ base: 'garde', nom: 'ASB', role: '3e', afficherHoraires: false }),
    ).toBe('garde-ASB-3e')
  })

  it('conserve les horaires reçus sans les recalculer (piège de production à ne pas reproduire)', () => {
    expect(
      libelleGarde({
        base: 'garde',
        nom: 'FA',
        role: '2nd',
        horaires: { debut: '20h', fin: '10h' }, // valeur volontairement "fausse" pour le test
        afficherHoraires: true,
      }),
    ).toBe('garde-FA-2nd-20h/10h')
  })
})

// ============================================================
// roleCourt — « 1er » / « 2nd » au lieu de « premier » / « second » (B-080)
// ============================================================
// MiKL, en recette du 27/08 : l'agenda affichait `Garde-JD-premier`. L'origine
// n'est pas un bug de code — `creneau_modele.roles` vaut bien `['premier',
// 'second']` en base, ce sont les libellés que l'écran Créneaux propose
// d'office. Les renommer en base changerait le vocabulaire de TOUTE
// l'application ; la correction vit donc dans la couche d'affichage.
//
// Le test le plus important est celui du rôle PERSONNALISÉ : un cabinet qui
// écrit « titulaire » et « renfort » les a choisis exprès, et les abréger
// effacerait sa décision.

describe('roleCourt — la forme abrégée du rôle dans un titre d’agenda', () => {
  it('les deux noms canoniques : premier → 1er, second → 2nd', () => {
    expect(roleCourt('premier', 0)).toBe('1er')
    expect(roleCourt('second', 1)).toBe('2nd')
  })

  it('au-delà de deux places : 3e, 4e, 5e — la convention déjà en place', () => {
    // Mêmes formes que `roleClair` (data/v2/reglesStructure).
    // ⚠️ Mais PAS que `roleParDefaut` (lib/gardes/places), qui rend « 2e » là
    // où MiKL veut « 2nd » : les deux vocabulaires divergent sur cette seule
    // place, et c'est l'agenda qui suit la demande. À réconcilier un jour.
    expect(roleCourt('troisieme', 2)).toBe('3e')
    expect(roleCourt('quatrieme', 3)).toBe('4e')
    expect(roleCourt('cinquieme', 4)).toBe('5e')
  })

  it('⚠️ un rôle PERSONNALISÉ passe intact — ce sont les mots du cabinet', () => {
    expect(roleCourt('titulaire', 0)).toBe('titulaire')
    expect(roleCourt('renfort', 1)).toBe('renfort')
    // Y compris s'il ressemble à un canonique sans en être un.
    expect(roleCourt('premier renfort', 0)).toBe('premier renfort')
  })

  it('casse et accents ne changent rien : « Troisième » est « troisieme »', () => {
    expect(roleCourt('Premier', 0)).toBe('1er')
    expect(roleCourt('Troisième', 2)).toBe('3e')
    expect(roleCourt('  SECOND  ', 1)).toBe('2nd')
  })

  it('rôle vide : on retombe sur la place, jamais sur du blanc', () => {
    // Sans rôle, les deux événements du même jour deviennent indiscernables
    // dans la grille — c'est la seule chose que le titre ne peut pas perdre.
    expect(roleCourt('', 0)).toBe('1er')
    expect(roleCourt('   ', 1)).toBe('2nd')
    expect(roleCourt(null, 2)).toBe('3e')
    expect(roleCourt(undefined, 3)).toBe('4e')
  })

  it('le titre complet, tel que la cliente le verra', () => {
    expect(
      libelleGarde({
        base: 'garde', nom: 'JD', role: roleCourt('premier', 0), afficherHoraires: false,
      }),
    ).toBe('garde-JD-1er')
    expect(
      libelleGarde({
        base: 'garde', nom: 'VC', role: roleCourt('second', 1), afficherHoraires: false,
      }),
    ).toBe('garde-VC-2nd')
  })
})
