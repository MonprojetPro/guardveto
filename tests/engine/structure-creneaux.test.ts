import { describe, it, expect } from 'vitest'
import {
  CRENEAUX,
  horairesCreneau,
  libelleCreneau,
  typeGardePourJour,
  effectifSemaineParDefaut,
} from '@/engine/structure-creneaux'
import type { TypeGardeEngine } from '@/engine/types'

// ============================================================
// SOURCE UNIQUE — garde-fou anti-dérive (A0)
// ============================================================
// Ces valeurs DOIVENT rester le miroir exact du seed
// `creneaux_catalogue` (migration 20260616160002_attributions_v2.sql,
// lignes 44-50). Si quelqu'un modifie l'un sans l'autre, ce test casse.
// ============================================================

// Miroir littéral du seed SQL — toute divergence = test rouge.
const SEED = {
  semaine_soir:  { libelle: 'Soir de semaine (lun-jeu)', heureDebut: '18:30', heureFin: '08:30', estNuit: true,  estWeekend: false, dureeHeures: 14 },
  vendredi_soir: { libelle: 'Soir du vendredi',          heureDebut: '18:30', heureFin: '08:30', estNuit: true,  estWeekend: false, dureeHeures: 14 },
  weekend:       { libelle: 'Week-end (sam+dim)',         heureDebut: '08:30', heureFin: '08:30', estNuit: false, estWeekend: true,  dureeHeures: 48 },
  ferie:         { libelle: 'Jour férié',                heureDebut: '08:30', heureFin: '08:30', estNuit: false, estWeekend: false, dureeHeures: 24 },
} as const

const TYPES: TypeGardeEngine[] = ['semaine_soir', 'vendredi_soir', 'weekend', 'ferie']

describe('structure-creneaux — miroir du seed creneaux_catalogue', () => {
  for (const type of TYPES) {
    it(`${type} : horaires + métadonnées alignés sur le seed`, () => {
      const c = CRENEAUX[type]
      const s = SEED[type]
      expect(c.heureDebut).toBe(s.heureDebut)
      expect(c.heureFin).toBe(s.heureFin)
      expect(c.estNuit).toBe(s.estNuit)
      expect(c.estWeekend).toBe(s.estWeekend)
      expect(c.dureeHeures).toBe(s.dureeHeures)
      expect(c.libelle).toBe(s.libelle)
    })
  }
})

describe('structure-creneaux — offset de fin (chevauchement de jours)', () => {
  it('semaine/vendredi/ferie finissent le lendemain (+1j)', () => {
    expect(horairesCreneau('semaine_soir').offsetJoursFin).toBe(1)
    expect(horairesCreneau('vendredi_soir').offsetJoursFin).toBe(1)
    expect(horairesCreneau('ferie').offsetJoursFin).toBe(1)
  })
  it('week-end finit 2 jours après le samedi (lundi matin)', () => {
    expect(horairesCreneau('weekend').offsetJoursFin).toBe(2)
  })
})

describe('structure-creneaux — comportement historique préservé (persisterResultat)', () => {
  // Avant A0, persisterResultat codait ces valeurs en dur. On verrouille
  // qu'elles n'ont pas changé en passant par la source unique.
  it('semaine_soir : 18:30 → +1j 08:30', () => {
    const h = horairesCreneau('semaine_soir')
    expect([h.heureDebut, h.offsetJoursFin, h.heureFin]).toEqual(['18:30', 1, '08:30'])
  })
  it('weekend : 08:30 → +2j 08:30', () => {
    const h = horairesCreneau('weekend')
    expect([h.heureDebut, h.offsetJoursFin, h.heureFin]).toEqual(['08:30', 2, '08:30'])
  })
})

describe('structure-creneaux — libelleCreneau', () => {
  it('renvoie le libellé humain', () => {
    expect(libelleCreneau('weekend')).toBe('Week-end (sam+dim)')
    expect(libelleCreneau('ferie')).toBe('Jour férié')
  })
})

describe('structure-creneaux — typeGardePourJour (mapping jour→type)', () => {
  // Convention jourIndex / getDay : 0=dim, 1=lun … 5=ven, 6=sam.
  it('vendredi (5) → vendredi_soir', () => expect(typeGardePourJour(5)).toBe('vendredi_soir'))
  it('samedi (6) → weekend', () => expect(typeGardePourJour(6)).toBe('weekend'))
  it('lundi à jeudi (1-4) → semaine_soir', () => {
    expect(typeGardePourJour(1)).toBe('semaine_soir')
    expect(typeGardePourJour(2)).toBe('semaine_soir')
    expect(typeGardePourJour(3)).toBe('semaine_soir')
    expect(typeGardePourJour(4)).toBe('semaine_soir')
  })
  it('dimanche (0) → null (couvert par le weekend du samedi)', () => {
    expect(typeGardePourJour(0)).toBeNull()
  })
})

describe('structure-creneaux — effectifSemaineParDefaut (repli)', () => {
  it('hiver = 2', () => expect(effectifSemaineParDefaut('hiver')).toBe(2))
  it('été = 1', () => expect(effectifSemaineParDefaut('ete')).toBe(1))
})
