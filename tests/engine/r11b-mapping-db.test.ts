import { describe, it, expect } from 'vitest'
import {
  mapperRoleAvantageFinancierDb,
  DEFAULT_ROLE_AVANTAGE_FINANCIER,
} from '../../src/engine/equity-weights'

// ============================================================
// R11b de bout en bout — mapping base → moteur (2026-07-03)
// ============================================================
// `cabinets.role_avantage_financier` alimente enfin le paramètre moteur
// (fin du « réglage fantôme » de l'audit). Contrat du mapping :
//   'premier'/'second' → tel quel ; 'aucun' → null (pas d'équilibrage) ;
//   absent/inconnu → undefined (repli défaut moteur 'premier').
// ============================================================

describe('mapperRoleAvantageFinancierDb — contrat base → moteur', () => {
  it("'premier' et 'second' passent tels quels", () => {
    expect(mapperRoleAvantageFinancierDb('premier')).toBe('premier')
    expect(mapperRoleAvantageFinancierDb('second')).toBe('second')
  })

  it("'aucun' → null (aucun rôle avantagé, rien à équilibrer)", () => {
    expect(mapperRoleAvantageFinancierDb('aucun')).toBeNull()
  })

  it('absent / inconnu → undefined (repli défaut moteur, byte-identique historique)', () => {
    expect(mapperRoleAvantageFinancierDb(undefined)).toBeUndefined()
    expect(mapperRoleAvantageFinancierDb(null)).toBeUndefined()
    expect(mapperRoleAvantageFinancierDb('n_importe_quoi')).toBeUndefined()
    expect(mapperRoleAvantageFinancierDb(42)).toBeUndefined()
  })

  it("le défaut moteur reste 'premier' (le repli undefined y retombe)", () => {
    expect(DEFAULT_ROLE_AVANTAGE_FINANCIER).toBe('premier')
  })
})
