// ============================================================
// GUARDVETO — Le socle affiné par une période type
// ============================================================
// « La structure donne l'ensemble des possibilités, les périodes types les
// affinent par période » (MiKL, 2026-08-04).
//
// `appliquerAffinage` est le point exact où cette phrase devient du code, et
// c'est une fonction PURE : elle se teste sans base, autant de fois qu'on veut.
// Ce qu'elle décide se répercute partout — le solver n'émet des slots que pour
// les créneaux qu'elle rend, le validateur n'attend que ceux-là, les écrans ne
// montrent que ceux-là.
// ============================================================

import { describe, it, expect } from 'vitest'
import { appliquerAffinage } from '@/data/chargerCreneauModele'
import type { CreneauModele } from '@/engine/creneau-modele'

function creneau(over: Partial<CreneauModele> & { id: string }): CreneauModele {
  return {
    code: 'weekend', nom: 'Week-end', joursSemaine: [6], surFeries: false,
    heureDebut: '08:30', heureFin: '08:30', offsetJoursFin: 2,
    nbPlaces: 2, roles: ['premier', 'second'], actif: true, ordre: 1, ...over,
  }
}

const SOCLE: CreneauModele[] = [
  creneau({ id: 'sem', code: 'semaine_soir', nom: 'Soir de semaine', joursSemaine: [1, 2, 3, 4] }),
  creneau({ id: 'ven', code: 'vendredi_soir', nom: 'Soir du vendredi', joursSemaine: [5] }),
  creneau({ id: 'we', code: 'weekend', nom: 'Week-end' }),
]

describe('Une période type affine le socle', () => {
  it('sans aucun choix, le socle passe tel quel', () => {
    // L'état d'une période type neuve : tout ce qui est possible est retenu.
    expect(appliquerAffinage(SOCLE, new Map())).toEqual(SOCLE)
  })

  it('baisser le nombre de vétérinaires ne touche pas aux autres créneaux', () => {
    const r = appliquerAffinage(SOCLE, new Map([['sem', 1]]))
    expect(r.map((c) => [c.id, c.nbPlaces])).toEqual([['sem', 1], ['ven', 2], ['we', 2]])
  })

  it('les rôles suivent le nombre retenu', () => {
    // Sinon le solver émettrait des places sans libellé à leur donner.
    const r = appliquerAffinage(SOCLE, new Map([['we', 1]]))
    expect(r.find((c) => c.id === 'we')?.roles).toEqual(['premier'])
  })
})

describe('Zéro vétérinaire = pas de garde de ce type sur cette période', () => {
  it('le créneau DISPARAÎT de la liste, il ne reste pas à zéro place', () => {
    // Décision explicite : un créneau laissé à 0 place n'émettrait aucun slot,
    // mais continuerait d'être compté comme un type de garde du cabinet par les
    // écrans, le diagnostic d'impasse et le validateur. Absent, il ne peut
    // mentir nulle part.
    const r = appliquerAffinage(SOCLE, new Map([['ven', 0]]))
    expect(r.map((c) => c.id)).toEqual(['sem', 'we'])
  })

  it('on peut retirer plusieurs types de garde à la fois', () => {
    const r = appliquerAffinage(SOCLE, new Map([['ven', 0], ['sem', 0]]))
    expect(r.map((c) => c.id)).toEqual(['we'])
  })

  it('tout retirer donne une période type qui ne génère rien', () => {
    // Cas limite assumé : c'est à l'écran de prévenir, pas au moteur de refuser
    // en silence un réglage que l'admin a demandé.
    expect(appliquerAffinage(SOCLE, new Map([['ven', 0], ['sem', 0], ['we', 0]]))).toEqual([])
  })
})

describe('Le socle borne toujours', () => {
  it('une période type ne peut pas demander plus de places que le socle n’en offre', () => {
    // Le socle dit ce qui est POSSIBLE, et c'est lui qui nomme les rôles.
    const r = appliquerAffinage(SOCLE, new Map([['we', 9]]))
    expect(r.find((c) => c.id === 'we')?.nbPlaces).toBe(2)
    expect(r.find((c) => c.id === 'we')?.roles).toEqual(['premier', 'second'])
  })

  it('un nombre négatif est traité comme zéro, jamais comme une place', () => {
    expect(appliquerAffinage(SOCLE, new Map([['we', -1]])).map((c) => c.id))
      .toEqual(['sem', 'ven'])
  })

  it('le socle d’origine n’est jamais modifié', () => {
    // Il est partagé par toutes les périodes types du cabinet : le muter ferait
    // dépendre chaque période type de l'ordre dans lequel on les a lues.
    const avant = JSON.parse(JSON.stringify(SOCLE))
    appliquerAffinage(SOCLE, new Map([['we', 1], ['ven', 0]]))
    expect(SOCLE).toEqual(avant)
  })
})
