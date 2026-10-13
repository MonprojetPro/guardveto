// ============================================================
// Deux absences sur les mêmes dates ne peuvent plus passer en silence (B-160a ③)
// ============================================================
// LE CONSTAT — MiKL, le 13/10 : « j'ai déclaré une absence et un congé
// d'Anne-Catherine sur un jour où elle travaille et tout va bien pour le
// système ».
//
// Vérifié en base le même jour : congé validé du 02 au 03/11 ET absence active
// du 02/11, pour la même personne. Aucun message, nulle part. `conges` et
// `absences` contrôlent chacune leur chevauchement avec les GARDES, aucune ne
// regarde l'autre.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  chevauchements,
  type IndisponibilitePourChevauchement,
} from '../../src/lib/absences/chevauchement'

const CONGE: IndisponibilitePourChevauchement = {
  id: 'c1',
  veterinaire_id: 'ac',
  date_debut: '2026-11-02',
  date_fin: '2026-11-03',
  origine: 'conge',
  perimetre: 'journee-et-nuit',
}

const ABSENCE: IndisponibilitePourChevauchement = {
  id: 'a1',
  veterinaire_id: 'ac',
  date_debut: '2026-11-02',
  date_fin: '2026-11-02',
  origine: 'absence',
  perimetre: 'journee-et-nuit',
}

describe('Le cas réel du 13/10', () => {
  it('voit le recouvrement entre le congé et l’absence d’Anne-Catherine', () => {
    const r = chevauchements([CONGE, ABSENCE])
    expect(r).toHaveLength(1)
    expect(r[0].date_debut).toBe('2026-11-02')
    expect(r[0].date_fin).toBe('2026-11-02')
  })

  it('nomme les deux origines et la date, en français', () => {
    const [c] = chevauchements([CONGE, ABSENCE])
    expect(c.phrase).toContain('congé')
    expect(c.phrase).toContain('absence')
    expect(c.phrase).toContain('2026-11-02')
  })
})

describe('Ce qu’il ne faut surtout pas signaler', () => {
  it('une ligne ne se signale JAMAIS comme son propre doublon', () => {
    // Sans ce garde-fou, le bandeau s'afficherait sur chaque absence du
    // cabinet. Un message permanent cesse d'être lu — c'est ainsi qu'une alerte
    // utile meurt, et le produit a déjà payé ce mécanisme.
    expect(chevauchements([CONGE])).toEqual([])
  })

  it('deux personnes différentes ne se recouvrent pas', () => {
    const autre = { ...ABSENCE, id: 'a2', veterinaire_id: 'victor' }
    expect(chevauchements([CONGE, autre])).toEqual([])
  })

  it('deux plages qui se touchent sans se croiser ne sont pas un recouvrement', () => {
    // Le 03 finit, le 04 commence : c'est une continuité, pas un doublon.
    const suite = { ...ABSENCE, id: 'a3', date_debut: '2026-11-04', date_fin: '2026-11-05' }
    expect(chevauchements([CONGE, suite])).toEqual([])
  })
})

describe('Le cas le plus trompeur : deux périmètres qui se contredisent', () => {
  it('dit que les périmètres diffèrent, et lesquels', () => {
    // 🔑 C'EST LE CAS QUI COMPTE. Deux lignes qui disent toutes les deux
    //    « journée et nuit » sont un doublon bénin. Une qui dit « le matin » et
    //    l'autre « journée et nuit » laissent l'équipe devant deux vérités — et
    //    c'est la plus optimiste qui sera lue.
    const matin = { ...ABSENCE, id: 'a4', perimetre: 'matin' }
    const [c] = chevauchements([CONGE, matin])
    expect(c.perimetresDifferents).toBe(true)
    expect(c.phrase).toContain('Le matin')
    expect(c.phrase).toMatch(/périmètres différents/i)
  })

  it('ne crie pas quand les deux périmètres sont identiques', () => {
    const [c] = chevauchements([CONGE, ABSENCE])
    expect(c.perimetresDifferents).toBe(false)
    expect(c.phrase).not.toMatch(/périmètres différents/i)
  })

  it('un périmètre absent vaut « journée et nuit », comme partout', () => {
    const sans = { ...ABSENCE, id: 'a5', perimetre: undefined }
    const [c] = chevauchements([CONGE, sans])
    expect(c.perimetresDifferents).toBe(false)
  })
})

describe('Les bornes et le volume', () => {
  it('prend l’intersection réelle, pas l’union', () => {
    // Signaler « du 02 au 10 » quand seuls deux jours se recouvrent ferait
    // chercher un problème là où il n'y en a pas — un bandeau est un signal,
    // pas un rapport approximatif.
    const long = {
      ...ABSENCE,
      id: 'a6',
      date_debut: '2026-11-03',
      date_fin: '2026-11-10',
    }
    const [c] = chevauchements([CONGE, long])
    expect([c.date_debut, c.date_fin]).toEqual(['2026-11-03', '2026-11-03'])
  })

  it('trouve toutes les paires quand trois lignes se recouvrent', () => {
    const b = { ...ABSENCE, id: 'a7' }
    const c = { ...ABSENCE, id: 'a8' }
    // 3 lignes sur la même date → 3 paires, et pas 9 ni 6 (pas de doublon
    // symétrique, pas de comparaison avec soi-même).
    expect(chevauchements([CONGE, b, c])).toHaveLength(3)
  })
})
