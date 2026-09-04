// ============================================================
// LES DEUX VOCABULAIRES DE RÔLES — payé le 2026-09-04
// ============================================================
// CE QUI S'EST PASSÉ. En recette de B-111, MiKL clique sur le cadenas d'une
// place : « rien ne se passe ». La base, elle, montrait que l'écriture avait
// parfaitement réussi.
//
// Le cadenas comparait le label cadenassé (`'premier'`, ce que stocke
// `gardes.places_figees`) au rôle AFFICHÉ (`'1er'`, ce que rend
// `roleParDefaut`). La comparaison était donc toujours fausse : le cadenas
// restait dessiné « ouvert » quoi qu'il arrive, et chaque clic renvoyait
// « poser » au lieu de « libérer ».
//
// LE SYMPTÔME EST LE PIRE POSSIBLE : ça marchait, ça ne se voyait pas. Aucun
// message d'erreur, aucun test rouge — juste un produit qui a l'air cassé alors
// qu'il enregistre correctement, et qui accumule des cadenas en silence.
//
// MÊME FAMILLE que le piège déjà documenté dans `placesAttendues.ts` (« deux
// vocabulaires de créneaux qui ne se parlent pas ») : rapprocher deux mondes
// par égalité de chaîne alors qu'ils ne nomment pas les choses pareil.
//
// CE TEST NE VÉRIFIE PAS QUE LE CODE MARCHE — il verrouille le fait que les
// deux vocabulaires sont DISTINCTS, pour que quiconque tenterait de comparer
// l'un à l'autre voie ce fichier avant.
// ============================================================

import { describe, it, expect } from 'vitest'
import { labelDonneeDePlace, roleParDefaut, placesDeGarde } from '../places'

describe('les deux vocabulaires ne se confondent pas', () => {
  it('le label de DONNÉES n’est jamais le rôle AFFICHÉ', () => {
    // C'est exactement l'égalité qui a échoué en production.
    expect(labelDonneeDePlace(0)).not.toBe(roleParDefaut(0))
    expect(labelDonneeDePlace(1)).not.toBe(roleParDefaut(1))
  })

  it('le label de données est celui que la base stocke', () => {
    expect(labelDonneeDePlace(0)).toBe('premier')
    expect(labelDonneeDePlace(1)).toBe('second')
  })

  it('le rôle affiché est celui que l’écran montre', () => {
    expect(roleParDefaut(0)).toBe('1er')
    expect(roleParDefaut(1)).toBe('2e')
  })

  it('au-delà de la 2e place, le label de données est null — jamais inventé', () => {
    // Ces places vivent dans `garde_placements` avec leurs propres labels de
    // catalogue. Rendre un label faux serait pire que rendre `null` :
    // l'appelant saurait au moins qu'il ne sait pas.
    expect(labelDonneeDePlace(2)).toBeNull()
    expect(labelDonneeDePlace(3)).toBeNull()
  })
})

describe('une place cadenassée est reconnue depuis `places_figees`', () => {
  // Reproduit la comparaison exacte que fait la grille du planning. Écrit avec
  // le rôle affiché, ce test échouerait — c'était le bug.
  const garde = {
    premier_id: 'v1', premier_prenom: 'Antoine', premier_nom: 'A', premier_couleur: '#111',
    second_id: 'v2', second_prenom: 'Victor', second_nom: 'V', second_couleur: '#222',
  }

  function estFigee(placesFigees: string[], index: number): boolean {
    const label = labelDonneeDePlace(index)
    return label !== null && new Set(placesFigees).has(label)
  }

  it('reconnaît la 1re place quand `premier` est cadenassé', () => {
    const places = placesDeGarde(garde)
    expect(places[0].index).toBe(0)
    expect(estFigee(['premier'], places[0].index)).toBe(true)
    expect(estFigee(['premier'], places[1].index)).toBe(false)
  })

  it('reconnaît la 2e place quand `second` est cadenassé', () => {
    const places = placesDeGarde(garde)
    expect(estFigee(['second'], places[1].index)).toBe(true)
    expect(estFigee(['second'], places[0].index)).toBe(false)
  })

  it('reconnaît les deux quand les deux sont cadenassées', () => {
    const places = placesDeGarde(garde)
    // L'ordre stocké est indifférent — c'est bien ce que la base contenait le
    // 04/09 après les deux clics de MiKL : {second, premier}.
    expect(estFigee(['second', 'premier'], places[0].index)).toBe(true)
    expect(estFigee(['second', 'premier'], places[1].index)).toBe(true)
  })

  it('LE BUG DU 04/09 : comparer au rôle affiché ne reconnaît RIEN', () => {
    // Garde-fou du garde-fou. Si un jour `roleParDefaut` se mettait à rendre
    // « premier », ce test tomberait — et il faudrait relire tout ce fichier
    // avant de s'en réjouir.
    const places = placesDeGarde(garde)
    const parRoleAffiche = new Set(['premier', 'second']).has(places[0].role)
    expect(parRoleAffiche).toBe(false)
  })
})
