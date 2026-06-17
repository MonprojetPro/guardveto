// ============================================================
// GUARDVETO — Tests unitaires : validerConfigBrique
// Story : F4-001 — Normaliser le schéma config des contraintes
// ============================================================

import { describe, it, expect } from 'vitest'
import { validerConfigBrique } from '../index'
import type { ConfigBriqueV2 } from '../types'

// ── Test 1 : accepte un config V2 valide ────────────────────

describe('validerConfigBrique — config V2 valide', () => {
  it('accepte un objet V2 minimal bien formé', () => {
    const config: ConfigBriqueV2 = {
      brique: 'R1_equite_gardes',
      axes: { qui: 'tous', quand: 'weekend' },
      force: 2,
      params: { seuil: 1 },
    }
    expect(validerConfigBrique(config)).toBe(true)
  })

  it('accepte un config V2 avec axes vides (objet vide)', () => {
    const config: ConfigBriqueV2 = {
      brique: 'interdire_creneau',
      axes: {},
      force: 0,
      params: {},
    }
    expect(validerConfigBrique(config)).toBe(true)
  })

  it('accepte force = 6 (borne haute)', () => {
    const config: ConfigBriqueV2 = {
      brique: 'equite_confort',
      axes: {},
      force: 6,
      params: {},
    }
    expect(validerConfigBrique(config)).toBe(true)
  })

  it('accepte force = 0 (borne basse)', () => {
    const config: ConfigBriqueV2 = {
      brique: 'contrainte_absolue',
      axes: {},
      force: 0,
      params: {},
    }
    expect(validerConfigBrique(config)).toBe(true)
  })
})

// ── Test 2 : rejette les valeurs dégénérées ──────────────────

describe('validerConfigBrique — valeurs dégénérées', () => {
  it('rejette null', () => {
    expect(validerConfigBrique(null)).toBe(false)
  })

  it('rejette undefined', () => {
    expect(validerConfigBrique(undefined)).toBe(false)
  })

  it('rejette un string', () => {
    expect(validerConfigBrique('R1_equite_gardes')).toBe(false)
  })

  it('rejette un nombre', () => {
    expect(validerConfigBrique(42)).toBe(false)
  })

  it('rejette un objet vide', () => {
    expect(validerConfigBrique({})).toBe(false)
  })

  it('rejette si brique est une chaîne vide', () => {
    expect(validerConfigBrique({ brique: '', axes: {}, force: 1, params: {} })).toBe(false)
  })

  it('rejette si brique est absente', () => {
    expect(validerConfigBrique({ axes: {}, force: 1, params: {} })).toBe(false)
  })

  it('rejette si axes est null', () => {
    expect(validerConfigBrique({ brique: 'R1', axes: null, force: 1, params: {} })).toBe(false)
  })

  it('rejette si params est null', () => {
    expect(validerConfigBrique({ brique: 'R1', axes: {}, force: 1, params: null })).toBe(false)
  })
})

// ── Test 3 : rejette force hors [0,6] ou non entier ─────────

describe('validerConfigBrique — force invalide', () => {
  it('rejette force = -1 (en dessous de 0)', () => {
    expect(validerConfigBrique({ brique: 'R1', axes: {}, force: -1, params: {} })).toBe(false)
  })

  it('rejette force = 7 (au dessus de 6)', () => {
    expect(validerConfigBrique({ brique: 'R1', axes: {}, force: 7, params: {} })).toBe(false)
  })

  it('rejette force = 1.5 (non entier)', () => {
    expect(validerConfigBrique({ brique: 'R1', axes: {}, force: 1.5, params: {} })).toBe(false)
  })

  it('rejette force = NaN', () => {
    expect(validerConfigBrique({ brique: 'R1', axes: {}, force: NaN, params: {} })).toBe(false)
  })

  it('rejette force = Infinity', () => {
    expect(validerConfigBrique({ brique: 'R1', axes: {}, force: Infinity, params: {} })).toBe(false)
  })

  it('rejette force = "2" (string, pas un number)', () => {
    expect(validerConfigBrique({ brique: 'R1', axes: {}, force: '2', params: {} })).toBe(false)
  })
})
