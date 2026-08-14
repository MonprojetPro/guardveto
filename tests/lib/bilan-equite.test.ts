// ============================================================
// GUARDVETO — Ce que « l'écart à la juste part » veut dire, exactement
// ============================================================
// `calculerBilans` n'est pas un calcul d'affichage : sa sortie part en base
// dans `bonus_malus`, et le moteur la relit à la génération suivante pour
// rattraper les écarts (`engine/loader.ts` → `bonusMalus[id] = -ecart_we`).
// C'est aussi ce que Filou récite quand on lui demande « qui est en retard
// sur ses gardes ? ». Une même fonction, trois bouches.
//
// D'où ces tests : ils FIXENT la définition de la juste part, pour qu'on ne
// la déplace jamais par accident. Deux d'entre eux décrivent des angles morts
// connus (marqués ⚠️) : ils ne valident pas un comportement souhaitable, ils
// verrouillent le comportement ACTUEL pour qu'une correction future soit un
// choix, pas un effet de bord.
// ============================================================

import { describe, it, expect } from 'vitest'
import { calculerBilans } from '@/engine/bilan'
import type { CompteursRow } from '@/hooks/useCompteurs'

function ligne(
  id: string,
  o: Partial<CompteursRow> & { statut?: 'associe' | 'salarie' } = {},
): CompteursRow {
  return {
    veterinaire_id: id,
    prenom: id,
    nom: id,
    statut: 'associe',
    couleur: '#000',
    we_premier: 0, we_second: 0, we_total: 0,
    sem_premier: 0, sem_second: 0, sem_total: 0,
    feries_premier: 0, feries_second: 0, feries_total: 0,
    total_gardes: 0,
    ...o,
  }
}

describe('l’écart à la juste part', () => {
  it('vaut zéro quand tout le monde a fait pareil', () => {
    const bilans = calculerBilans(
      [ligne('a', { we_total: 4 }), ligne('b', { we_total: 4 }), ligne('c', { we_total: 4 })],
      12,
    )
    expect(bilans.map((b) => b.ecart_we)).toEqual([0, 0, 0])
  })

  it('est positif pour qui a fait plus que la moyenne, négatif pour qui a fait moins', () => {
    const bilans = calculerBilans([ligne('a', { we_total: 6 }), ligne('b', { we_total: 2 })], 8)
    const de = (id: string) => bilans.find((b) => b.veterinaire_id === id)!

    // Moyenne = 4. La convention (documentée dans engine/bilan.ts) : écart > 0
    // = a fait PLUS, donc fera moins ensuite. Le moteur inverse le signe en le
    // relisant — ne jamais le ré-inverser ici.
    expect(de('a').ecart_we).toBe(2)
    expect(de('b').ecart_we).toBe(-2)
  })

  it('somme à zéro sur l’ensemble : ce qui est en trop chez l’un manque chez l’autre', () => {
    const bilans = calculerBilans(
      [ligne('a', { sem_total: 9 }), ligne('b', { sem_total: 6 }), ligne('c', { sem_total: 3 })],
      0,
    )
    expect(bilans.reduce((s, b) => s + b.ecart_semaine, 0)).toBe(0)
  })

  it('ne compte les week-ends libres que pour les salariés', () => {
    const bilans = calculerBilans(
      [
        ligne('asso', { statut: 'associe', we_total: 2 }),
        ligne('sal', { statut: 'salarie', we_total: 6 }),
      ],
      10,
    )
    const de = (id: string) => bilans.find((b) => b.veterinaire_id === id)!

    // L'associé n'a pas de quota de week-ends libres : 0 partout, pas un
    // écart calculé sur une moyenne qui ne le concerne pas.
    expect(de('asso').grands_we_realise).toBe(0)
    expect(de('asso').ecart_grands_we).toBe(0)
    // Seul salarié → il EST la moyenne → écart nul, jamais NaN.
    expect(de('sal').grands_we_realise).toBe(4)
    expect(de('sal').ecart_grands_we).toBe(0)
  })

  it('ne renvoie rien plutôt que des NaN quand il n’y a aucun compteur', () => {
    expect(calculerBilans([], 0)).toEqual([])
  })
})

describe('⚠️ angles morts connus de la juste part (comportement ACTUEL, à trancher)', () => {
  it('⚠️ la moyenne ignore les vétérinaires à zéro garde — ils sont absents des compteurs', () => {
    // La vue `compteurs_gardes` et `queryCompteursPlage` ne renvoient QUE les
    // vétérinaires ayant au moins une garde. Conséquence : quelqu'un d'absent
    // toute la période n'entre pas dans la moyenne, n'apparaît pas à l'écran,
    // et surtout n'obtient AUCUNE ligne `bonus_malus` — donc aucun rattrapage
    // à la période suivante.
    //
    // Le moteur, lui, calcule sa variance d'équité sur TOUS les vétérinaires
    // (`compterParVet(planning, vets)` dans score-lexicographique.ts), celui à
    // zéro compris. Les deux ne comptent donc pas sur la même population.
    const avecLAbsent = calculerBilans(
      [ligne('a', { we_total: 6 }), ligne('b', { we_total: 6 }), ligne('absent', { we_total: 0 })],
      12,
    )
    const sansLAbsent = calculerBilans(
      [ligne('a', { we_total: 6 }), ligne('b', { we_total: 6 })],
      12,
    )

    // Vu par le moteur (population complète) : moyenne 4 → a et b sont à +2.
    expect(avecLAbsent.find((b) => b.veterinaire_id === 'a')!.ecart_we).toBe(2)
    expect(avecLAbsent.find((b) => b.veterinaire_id === 'absent')!.ecart_we).toBe(-4)
    // Vu par l'écran (l'absent n'est pas dans les compteurs) : moyenne 6 → tout
    // le monde est « dans la juste part ». Même période, même équipe, verdict
    // opposé — c'est la seule différence que fait la présence de la ligne.
    expect(sansLAbsent.every((b) => b.ecart_we === 0)).toBe(true)
  })

  it('⚠️ le « dernier recours » pèse dans la moyenne alors que l’écran l’en exclut', () => {
    // `HistoriqueV2` affiche « — hors répartition » pour les vétérinaires
    // `dernier_recours`. Mais `calculerBilans` ne connaît pas ce drapeau : leurs
    // quelques gardes tirent la moyenne vers le bas, et tous les autres
    // paraissent en surplus.
    const bilans = calculerBilans(
      [
        ligne('a', { we_total: 5 }),
        ligne('b', { we_total: 5 }),
        ligne('c', { we_total: 5 }),
        ligne('dernierRecours', { we_total: 1 }),
      ],
      12,
    )
    const de = (id: string) => bilans.find((b) => b.veterinaire_id === id)!

    // Moyenne = 4 à cause de la ligne « dernier recours ». Les trois autres,
    // qui ont pourtant tenu exactement le même nombre de week-ends, affichent
    // +1 : « léger écart » en pastille orange, alors qu'ils sont parfaitement
    // à égalité entre eux.
    expect(de('a').ecart_we).toBe(1)
    expect(de('b').ecart_we).toBe(1)
    expect(de('c').ecart_we).toBe(1)
    // Entre eux quatre, la moyenne devrait être 5 si le dernier recours sortait
    // du calcul — et les trois seraient alors à 0.
  })
})
