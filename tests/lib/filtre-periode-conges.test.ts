// ============================================================
// B-131 — le filtre de congés ne doit JAMAIS cacher ce qu'on cherche
// ============================================================
// MiKL, le 26/09 : « mettre un filtre dans congé pour trier les congés que pour
// une période, ou une zone de date particulière ».
//
// La décision qui compte est le CHEVAUCHEMENT plutôt que l'inclusion : un congé
// à cheval sur le début d'une période est précisément celui qui pose problème,
// donc celui qu'on cherche. Un filtre qui le masque donne l'illusion d'avoir
// regardé — c'est plus dangereux que pas de filtre.
//
// Les deux autres pièges figés ici sont des pièges de SAISIE, et ils produisent
// tous les deux la même fausse nouvelle (« zéro congé ») si on les rate :
// une borne à moitié tapée, et deux bornes inversées.
// ============================================================

import { describe, expect, it } from 'vitest'
import { chevauche, filtrerParFenetre } from '@/lib/conges/filtre-periode'

/** Hiver P2 du cabinet Val d'Allier, tel qu'il existe en base. */
const P2 = { debut: '2026-10-19', fin: '2026-11-29' }

const conge = (date_debut: string, date_fin = date_debut) => ({ date_debut, date_fin })

describe('chevauche — quels congés touchent la fenêtre', () => {
  it('garde un congé entièrement dedans', () => {
    expect(chevauche(conge('2026-11-02', '2026-11-06'), P2)).toBe(true)
  })

  // ⚠️ LA preuve du module. Exiger l'inclusion aurait fait disparaître ces deux
  // congés de la liste au moment où l'admin les cherche.
  it('garde un congé à cheval sur le DÉBUT de la fenêtre', () => {
    expect(chevauche(conge('2026-10-15', '2026-10-25'), P2)).toBe(true)
  })

  it('garde un congé à cheval sur la FIN de la fenêtre', () => {
    expect(chevauche(conge('2026-11-25', '2026-12-05'), P2)).toBe(true)
  })

  it('garde un congé qui englobe toute la fenêtre', () => {
    expect(chevauche(conge('2026-09-01', '2027-01-31'), P2)).toBe(true)
  })

  it('garde un congé posé le jour même d’une borne', () => {
    expect(chevauche(conge('2026-10-19'), P2)).toBe(true)
    expect(chevauche(conge('2026-11-29'), P2)).toBe(true)
  })

  it('écarte un congé strictement avant, et un strictement après', () => {
    expect(chevauche(conge('2026-10-17', '2026-10-18'), P2)).toBe(false)
    expect(chevauche(conge('2026-11-30'), P2)).toBe(false)
  })

  it('accepte une fenêtre ouverte d’un seul côté', () => {
    expect(chevauche(conge('2027-06-01'), { debut: '2026-10-19' })).toBe(true)
    expect(chevauche(conge('2026-01-01'), { debut: '2026-10-19' })).toBe(false)
    expect(chevauche(conge('2026-01-01'), { fin: '2026-11-29' })).toBe(true)
    expect(chevauche(conge('2027-01-01'), { fin: '2026-11-29' })).toBe(false)
  })

  // Un champ de date à moitié rempli ne doit pas vider la liste sous les doigts
  // de l'admin : il croirait avoir zéro congé alors qu'il est en train de taper.
  it('ne filtre rien quand aucune borne n’est exploitable', () => {
    const c = conge('2026-11-02')
    expect(chevauche(c, {})).toBe(true)
    expect(chevauche(c, { debut: '', fin: '   ' })).toBe(true)
    expect(chevauche(c, { debut: '2026-11' })).toBe(true)
    expect(chevauche(c, { debut: null, fin: undefined })).toBe(true)
  })

  // Bornes inversées : on ne réordonne PAS en silence. Corriger la saisie
  // ferait apparaître des résultats que personne n'a demandés, et l'admin
  // croirait que sa demande a été comprise.
  it('ne rend rien sur une fenêtre inversée, sans la corriger', () => {
    expect(chevauche(conge('2026-11-02'), { debut: '2026-11-29', fin: '2026-10-19' })).toBe(false)
  })
})

describe('filtrerParFenetre', () => {
  it('conserve l’ordre d’entrée et ne garde que ce qui touche', () => {
    const liste = [
      conge('2026-10-01'),          // avant
      conge('2026-10-20'),          // dedans
      conge('2026-11-28', '2026-12-02'), // à cheval sur la fin
      conge('2027-01-05'),          // après
    ]
    expect(filtrerParFenetre(liste, P2).map((c) => c.date_debut)).toEqual([
      '2026-10-20',
      '2026-11-28',
    ])
  })

  it('ne casse pas sur une liste vide', () => {
    expect(filtrerParFenetre([], P2)).toEqual([])
  })
})
