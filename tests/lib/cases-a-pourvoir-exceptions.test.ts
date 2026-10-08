// ============================================================
// Une garde remplacee n'est pas une garde vide (B-155)
// ============================================================
// LE DEFAUT, VECU DEVANT LE CLIENT LE 08/10. MiKL, en sortant du rendez-vous :
//
//   « ya eu un bug qu'on n'a pas compris et je suis plutot mecontent d'avoir
//    vecu ca en direct… quand je publie il m'indique ne pas pouvoir car il
//    manque une garde, ce qui n'est pas vrai visuellement »
//
// CE QUI SE PASSAIT VRAIMENT — mesure en base, Val d'Allier, Hiver P2, garde
// `c9fca6f1` du 14/11 :
//
//   · la table `gardes` porte `premier = Victor, second = NULL` ;
//   · SIX lignes de `gardes_exceptions` couvrent les 3 jours du week-end x 2
//     roles — Jean et Antoine sont bel et bien de garde.
//
// 🔑 LES DEUX ECRANS DISAIENT VRAI, CHACUN SUR SA SOURCE. La vue
//    `planning_semaine` applique les remplacements (d'ou la case pleine, qui est
//    la verite metier) ; `casesAPourvoir` lisait la table brute et n'avait
//    jamais entendu parler de la surcouche « remplacer quelqu'un un seul jour »
//    (B-061). C'est « trois chemins d'ecriture, deux gardiens » (22/08), cote
//    LECTURE : la surcouche a ete ajoutee, le controle de publication n'a jamais
//    ete mis au courant.
//
// LA CORRECTION N'EST PAS UNE LECTURE DE PLUS, c'est LA MEME SOURCE QUE
// L'ECRAN. Un troisieme calcul des remplacements aurait recree l'ecart un cran
// plus loin.
// ============================================================

import { describe, expect, it } from 'vitest'
import { lireLaVue, type JourAffiche } from '../../src/data/casesAPourvoir'

const GARDE = 'c9fca6f1'

describe('Ce que la vue dit des roles', () => {
  it('🔴 LE CAS DU 08/10 — un week-end entierement remplace n’est PAS un trou', () => {
    // Les 3 jours de la garde, tels que la vue les rend une fois les exceptions
    // appliquees : personne n'est vide, alors que `gardes.second_id` est NULL.
    const jours: JourAffiche[] = [
      { id: GARDE, date: '2026-11-13', premier_id: 'anne-sophie', second_id: 'jean' },
      { id: GARDE, date: '2026-11-14', premier_id: 'jean', second_id: 'antoine' },
      { id: GARDE, date: '2026-11-15', premier_id: 'jean', second_id: 'antoine' },
    ]
    const { videUnJourAuMoins } = lireLaVue(jours)
    expect(videUnJourAuMoins.get(`${GARDE}|premier`)).toBe(false)
    expect(
      videUnJourAuMoins.get(`${GARDE}|second`),
      'c’est CETTE ligne qui bloquait la publication devant le client',
    ).toBe(false)
  })

  it('🔴 un remplacant trouve pour UN SEUL jour laisse le trou des autres', () => {
    // Le piege inverse, et il compte autant : si on se contentait de « une
    // exception existe donc c’est pourvu », un dimanche sans personne passerait
    // en silence — on publierait une nuit sans veterinaire.
    const jours: JourAffiche[] = [
      { id: GARDE, date: '2026-11-13', premier_id: 'jean', second_id: 'antoine' },
      { id: GARDE, date: '2026-11-14', premier_id: 'jean', second_id: 'antoine' },
      { id: GARDE, date: '2026-11-15', premier_id: 'jean', second_id: null },
    ]
    const { videUnJourAuMoins } = lireLaVue(jours)
    expect(videUnJourAuMoins.get(`${GARDE}|second`)).toBe(true)
    expect(videUnJourAuMoins.get(`${GARDE}|premier`)).toBe(false)
  })

  it('un trou en PREMIER jour compte autant qu’un trou en dernier', () => {
    // L'ordre de lecture ne doit rien changer : un `false` ecrit apres un `true`
    // ne doit jamais l'effacer.
    const jours: JourAffiche[] = [
      { id: GARDE, date: '2026-11-13', premier_id: null, second_id: 'antoine' },
      { id: GARDE, date: '2026-11-14', premier_id: 'jean', second_id: 'antoine' },
    ]
    expect(lireLaVue(jours).videUnJourAuMoins.get(`${GARDE}|premier`)).toBe(true)
  })

  it('distingue les gardes entre elles', () => {
    const jours: JourAffiche[] = [
      { id: 'g1', date: '2026-11-14', premier_id: 'jean', second_id: 'antoine' },
      { id: 'g2', date: '2026-11-21', premier_id: 'jean', second_id: null },
    ]
    const { videUnJourAuMoins, gardesVues } = lireLaVue(jours)
    expect(videUnJourAuMoins.get('g1|second')).toBe(false)
    expect(videUnJourAuMoins.get('g2|second')).toBe(true)
    expect([...gardesVues].sort()).toEqual(['g1', 'g2'])
  })

  it('🔴 une garde ABSENTE de la vue ne conclut rien — ni pourvue, ni vide', () => {
    // Elle doit retomber sur l'ancien chemin (le miroir par role), pas etre
    // declaree complete par defaut. Un « absent donc tout va bien » est
    // exactement « une erreur Supabase avalee devient zero ligne ».
    const { gardesVues, videUnJourAuMoins } = lireLaVue([])
    expect(gardesVues.has(GARDE)).toBe(false)
    expect(videUnJourAuMoins.has(`${GARDE}|second`)).toBe(false)
  })
})
