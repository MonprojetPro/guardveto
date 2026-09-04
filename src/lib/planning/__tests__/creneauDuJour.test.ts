// ============================================================
// B-111 — le créneau qu'on peut fixer à la main sur un jour
// ============================================================
// Ce test protège deux choses, et la seconde est la vraie raison de son
// existence.
//
// ① Les jours SANS créneau propre disent pourquoi. Le vendredi et le dimanche
//    sont portés par la garde du samedi ; y créer une ligne produirait une
//    garde que rien ne lit, et qui collisionnerait sur `UNIQUE(date, type)`.
//
// ② `creneauPosableDuJour` reste la RÉCIPROQUE de `mapTypeGardeEnDb`. Elles ne
//    peuvent pas être fusionnées (l'une part d'un jour, l'autre d'un créneau du
//    moteur) mais décrivent le même découpage. Les laisser diverger ferait
//    créer à la main des gardes que la génération écraserait au tour suivant —
//    sans erreur, sans message, l'admin constatant juste que « ça n'a pas tenu ».
// ============================================================

import { describe, it, expect } from 'vitest'
import { creneauPosableDuJour } from '../creneauDuJour'
import { mapTypeGardeEnDb } from '@/data/ecrirePlanningV1'

// Semaine de repère : lundi 3 novembre 2025 → dimanche 9.
const LUNDI = '2025-11-03'
const MERCREDI = '2025-11-05'
const VENDREDI = '2025-11-07'
const SAMEDI = '2025-11-08'
const DIMANCHE = '2025-11-09'

describe('creneauPosableDuJour', () => {
  it('une nuit de semaine se fixe, et porte le type `semaine`', () => {
    const r = creneauPosableDuJour(MERCREDI, false)
    expect(r.creneau?.type).toBe('semaine')
  })

  it('un jour férié en semaine porte le type `ferie`, pas `semaine`', () => {
    // La table range une nuit de semaine tombant un jour férié sous 'ferie'
    // (héritage V1). Créer une 'semaine' ce jour-là entrerait en collision avec
    // la garde que la génération y écrirait.
    const r = creneauPosableDuJour(LUNDI, true)
    expect(r.creneau?.type).toBe('ferie')
  })

  it('le samedi porte le week-end entier', () => {
    const r = creneauPosableDuJour(SAMEDI, false)
    expect(r.creneau?.type).toBe('weekend')
  })

  it('le vendredi ne se fixe pas, et renvoie au samedi', () => {
    const r = creneauPosableDuJour(VENDREDI, false)
    expect(r.creneau).toBeNull()
    expect('raison' in r && r.raison).toContain('samedi')
  })

  it('le dimanche ne se fixe pas, et renvoie au samedi', () => {
    const r = creneauPosableDuJour(DIMANCHE, false)
    expect(r.creneau).toBeNull()
    expect('raison' in r && r.raison).toContain('samedi')
  })
})

describe('elle reste la réciproque de l’écriture en base', () => {
  it('ce qu’elle propose est ce que la génération écrirait le même jour', () => {
    // Pour chaque jour posable, le type proposé doit être EXACTEMENT celui que
    // `mapTypeGardeEnDb` produirait à partir du créneau du moteur. Si l'une des
    // deux évolue seule, ce test tombe — c'est tout son objet.
    const cas: Array<{ date: string; ferie: boolean; typeMoteur: string }> = [
      { date: LUNDI, ferie: false, typeMoteur: 'semaine_soir' },
      { date: MERCREDI, ferie: false, typeMoteur: 'semaine_soir' },
      { date: LUNDI, ferie: true, typeMoteur: 'semaine_soir' },
      { date: SAMEDI, ferie: false, typeMoteur: 'weekend' },
    ]

    for (const { date, ferie, typeMoteur } of cas) {
      const propose = creneauPosableDuJour(date, ferie).creneau?.type
      const calendrier = ferie ? { feries: new Set([date]), vacancesScolaires: [] } : undefined
      const ecrit = mapTypeGardeEnDb(typeMoteur, date, calendrier)
      expect(propose, `${date} (férié: ${ferie})`).toBe(ecrit)
    }
  })
})
