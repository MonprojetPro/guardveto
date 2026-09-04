// ============================================================
// LE CADENAS POSÉ DEPUIS LA MODALE DE GARDE (B-114)
// ============================================================
// La modale ne lit PAS la même source que la grille, et c'est tout l'enjeu.
//
//   • la grille      → la vue `planning_semaine`, qui matérialise un week-end
//                      sur trois lignes et INVERSE les rôles le vendredi ;
//   • la modale      → la table `gardes`, en rôles natifs.
//
// Les deux affichent un cadenas, les deux le traduisent en PERSONNES — mais par
// deux chemins différents. Appliquer la traduction native à une ligne de vue
// désignerait la mauvaise personne un jour sur trois : c'est exactement le
// défaut que B-111 a évité en recette, et qui a coûté deux correctifs le 04/09.
//
// Ce test verrouille la traduction native et, surtout, il ÉCHOUE si quelqu'un
// s'en sert sur une ligne affichée (dernier bloc).
// ============================================================

import { describe, it, expect } from 'vitest'
import { vetsFigesNatifs, placeFixableMaintenant, labelDonneeDePlace } from '../places'

describe('les personnes cadenassées, lues dans la TABLE', () => {
  const garde = { premier_id: 'antoine', second_id: 'victor' }

  it('« premier » désigne le titulaire de `premier_id`', () => {
    expect(vetsFigesNatifs({ ...garde, places_figees: ['premier'] })).toEqual(['antoine'])
  })

  it('« second » désigne le titulaire de `second_id`', () => {
    expect(vetsFigesNatifs({ ...garde, places_figees: ['second'] })).toEqual(['victor'])
  })

  it('l’ordre stocké est indifférent — la base a déjà rendu {second, premier}', () => {
    const figes = vetsFigesNatifs({ ...garde, places_figees: ['second', 'premier'] })
    expect(new Set(figes)).toEqual(new Set(['antoine', 'victor']))
  })

  it('aucun cadenas, aucune personne', () => {
    expect(vetsFigesNatifs({ ...garde, places_figees: [] })).toEqual([])
    expect(vetsFigesNatifs(garde)).toEqual([])
  })

  it('une place cadenassée mais VIDE ne rend personne, elle n’invente pas', () => {
    // Cas réel : `vider` retire la personne et son cadenas, mais un état
    // intermédiaire en base ne doit jamais produire un identifiant fantôme.
    expect(vetsFigesNatifs({ premier_id: null, second_id: 'victor', places_figees: ['premier'] })).toEqual([])
  })

  it('les places au-delà de la 2e ne sont pas traduites — la route les refuse', () => {
    expect(labelDonneeDePlace(2)).toBeNull()
    expect(vetsFigesNatifs({ ...garde, places_figees: ['3e', 'renfort'] })).toEqual([])
  })

  it('LE PIÈGE : appliquée aux rôles AFFICHÉS, la traduction ne reconnaît rien', () => {
    // Si un jour on branchait la modale sur la vue en gardant cette fonction,
    // les labels ressembleraient à ceux de l'affichage — et le silence serait
    // total. Ce test rend ce silence bruyant.
    expect(vetsFigesNatifs({ ...garde, places_figees: ['1er'] })).toEqual([])
  })
})

describe('on ne propose pas un geste qui échouera', () => {
  it('la place est fixable quand l’affiché est ce qui est enregistré', () => {
    expect(placeFixableMaintenant('antoine', 'antoine')).toBe(true)
  })

  it('elle ne l’est PAS tant qu’une réattribution n’est pas enregistrée', () => {
    // Le serveur répondrait 409 « cette personne ne tient pas cette garde » :
    // il cherche la place dans la garde EN BASE, pas dans l'écran.
    expect(placeFixableMaintenant('fanny', 'antoine')).toBe(false)
  })

  it('une place vide n’est pas fixable — il n’y a personne à fixer', () => {
    expect(placeFixableMaintenant(null, null)).toBe(false)
    expect(placeFixableMaintenant(null, 'antoine')).toBe(false)
  })
})
