// ============================================================
// La grille en semaines — B-145 lots 2b+2c
// ============================================================
// Ces cas portent sur `src/lib/planning/grilleSemaines.ts`. Ni base ni réseau.
//
// ⚠️ LE GROUPE QUI COMPTE LE PLUS EST « L'ALIGNEMENT ».
//
// La marge des prénoms et les 7 cases du jour sont des colonnes sœurs d'une même
// grille CSS. Si une case rend moins de lignes qu'une autre — parce qu'on a
// « allégé » en omettant les lignes vides —, les prénoms ne tombent plus en face
// de leurs lignes. Un planning décalé d'un cran est pire qu'un planning absent :
// il se lit sans qu'on le soupçonne, et on y lit la garde du voisin.
//
// ⚠️ LE SECOND GROUPE EST « LE SÉLECTEUR NE PROPOSE QUE CE QUI EXISTE ».
//
// Un cabinet « gardes seules » à qui on propose « journée » se voit offrir une
// porte vers un module qu'il n'a pas achetée. Et proposer un choix UNIQUE est un
// bouton qui ne fait rien — défaut déjà payé sur ce produit.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  RAIL_DEFAUT,
  bornesRail,
  choixContenu,
  contenuParDefaut,
  decouperEnSemaines,
  enMinutes,
  lignesCaseRepliee,
  lignesDeLaSemaine,
  positionSurRail,
  semaineASignaler,
  visibilite,
  type GardeGrille,
  type PersonneGrille,
} from '@/lib/planning/grilleSemaines'
import type { JourneeAffichee, PresenceAffichee } from '@/lib/planning/presencesDuJour'

const ANNE: PersonneGrille = { id: 'v-anne', prenom: 'Anne-Sophie', couleur: '#0B7D6C' }
const FANNY: PersonneGrille = { id: 'v-fanny', prenom: 'Fanny', couleur: '#3B6FD1' }
const JEAN: PersonneGrille = { id: 'v-jean', prenom: 'Jean', couleur: '#8153C7' }
const EQUIPE = [ANNE, FANNY, JEAN]

const RAIL = { debut: 8 * 60, fin: 18 * 60 }

function presence(p: Partial<PresenceAffichee> & { id: string }): PresenceAffichee {
  return {
    vetId: ANNE.id,
    prenom: 'Anne-Sophie',
    couleur: '#0B7D6C',
    tranche: 'Matin',
    heures: '8h–13h',
    debut: '08:00:00',
    fin: '13:00:00',
    ordre: 1,
    deLaTrame: false,
    anomalie: null,
    ...p,
  }
}

function journee(presences: PresenceAffichee[]): JourneeAffichee {
  return { presences, personnes: new Set(presences.map((p) => p.vetId)).size }
}

function garde(p: Partial<GardeGrille> & { id: string }): GardeGrille {
  return { type: 'semaine_soir', places: [], manque: 0, ...p }
}

describe('le rail suit les tranches REELLES, jamais 8h-18h en dur', () => {
  it('prend l’amplitude des tranches du cabinet', () => {
    expect(bornesRail([{ debut: '07:00:00', fin: '20:00:00' }])).toEqual({
      debut: 7 * 60,
      fin: 20 * 60,
    })
  })

  it('couvre de la plus tôt à la plus tard, toutes tranches confondues', () => {
    expect(
      bornesRail([
        { debut: '08:00:00', fin: '13:00:00' },
        { debut: '14:00:00', fin: '19:30:00' },
      ]),
    ).toEqual({ debut: 8 * 60, fin: 19 * 60 + 30 })
  })

  it('retombe sur la journée de bureau si rien n’est lisible', () => {
    expect(bornesRail([])).toEqual(RAIL_DEFAUT)
    expect(bornesRail([{ debut: 'midi', fin: 'soir' }])).toEqual(RAIL_DEFAUT)
  })

  it('ignore une tranche renversée plutôt que d’étirer le rail à l’envers', () => {
    expect(bornesRail([{ debut: '18:00:00', fin: '08:00:00' }])).toEqual(RAIL_DEFAUT)
  })

  it('lit les minutes, et refuse ce qui n’en est pas', () => {
    expect(enMinutes('08:30:00')).toBe(510)
    expect(enMinutes('')).toBeNull()
  })
})

describe('la barre reste dans sa piste', () => {
  it('un matin 8h-13h occupe la première moitié', () => {
    expect(positionSurRail('08:00:00', '13:00:00', RAIL)).toEqual({ gauche: 0, largeur: 50 })
  })

  it('une journée complète occupe tout', () => {
    expect(positionSurRail('08:00:00', '18:00:00', RAIL)).toEqual({ gauche: 0, largeur: 100 })
  })

  it('une tranche qui DEBORDE du rail est bornée, pas dessinée dehors', () => {
    const p = positionSurRail('06:00:00', '22:00:00', RAIL)
    expect(p).toEqual({ gauche: 0, largeur: 100 })
  })

  it('rend null quand il n’y a rien à dessiner — pas une barre invisible', () => {
    expect(positionSurRail('13:00:00', '13:00:00', RAIL)).toBeNull()
    expect(positionSurRail('20:00:00', '22:00:00', RAIL)).toBeNull()
    expect(positionSurRail('bof', '13:00:00', RAIL)).toBeNull()
  })
})

describe('l’alignement : une ligne par personne, MEME vide', () => {
  it('rend autant de lignes que de personnes, quoi qu’il arrive', () => {
    const lignes = lignesDeLaSemaine(
      EQUIPE,
      { gardes: [], journee: journee([presence({ id: 'p1' })]), absences: [] },
      RAIL,
    )
    expect(lignes).toHaveLength(3)
    expect(lignes.map((l) => l.vetId)).toEqual([ANNE.id, FANNY.id, JEAN.id])
  })

  it('une personne sans rien ce jour-là a une ligne VIDE, pas d’absence de ligne', () => {
    const lignes = lignesDeLaSemaine(EQUIPE, { gardes: [], absences: [] }, RAIL)
    expect(lignes.every((l) => l.vide)).toBe(true)
    expect(lignes).toHaveLength(3)
  })

  it('garde l’ordre de l’équipe, sans retrier sur le contenu', () => {
    const lignes = lignesDeLaSemaine(
      EQUIPE,
      { gardes: [], journee: journee([presence({ id: 'p1', vetId: JEAN.id })]), absences: [] },
      RAIL,
    )
    // Jean est 3e dans l'équipe : il reste 3e, même s'il est le seul occupé.
    expect(lignes[2].vetId).toBe(JEAN.id)
    expect(lignes[2].vide).toBe(false)
  })
})

describe('ce qu’une ligne porte', () => {
  it('pose la présence sur le rail à partir de SES heures', () => {
    const lignes = lignesDeLaSemaine(
      EQUIPE,
      { gardes: [], journee: journee([presence({ id: 'p1' })]), absences: [] },
      RAIL,
    )
    expect(lignes[0].journee[0].position).toEqual({ gauche: 0, largeur: 50 })
  })

  it('une présence dont la tranche est introuvable n’a pas de position, mais EXISTE', () => {
    const lignes = lignesDeLaSemaine(
      EQUIPE,
      {
        gardes: [],
        journee: journee([presence({ id: 'p1', debut: null, fin: null })]),
        absences: [],
      },
      RAIL,
    )
    expect(lignes[0].journee).toHaveLength(1)
    expect(lignes[0].journee[0].position).toBeNull()
    expect(lignes[0].vide).toBe(false)
  })

  it('trouve la garde par la PERSONNE, jamais par le rôle', () => {
    // La ligne du vendredi inverse les rôles (B-111, payé le 04/09) ; un
    // identifiant de vétérinaire ne s'inverse pas.
    const lignes = lignesDeLaSemaine(
      EQUIPE,
      {
        gardes: [
          garde({
            id: 'g1',
            places: [
              { vetId: FANNY.id, prenom: 'Fanny', couleur: null, role: '2e', index: 1 },
              { vetId: ANNE.id, prenom: 'Anne-Sophie', couleur: null, role: '1er', index: 0 },
            ],
          }),
        ],
        absences: [],
      },
      RAIL,
    )
    expect(lignes[0].nuit).toEqual({ role: '1er', plusieursPlaces: true })
    expect(lignes[1].nuit).toEqual({ role: '2e', plusieursPlaces: true })
    expect(lignes[2].nuit).toBeNull()
  })

  it('porte le congé et le souhait, qui ne se disent pas pareil', () => {
    const lignes = lignesDeLaSemaine(
      EQUIPE,
      {
        gardes: [],
        absences: [
          { vetId: ANNE.id, prenom: 'Anne-Sophie', statut: 'valide' },
          { vetId: FANNY.id, prenom: 'Fanny', statut: 'souhait' },
        ],
      },
      RAIL,
    )
    expect(lignes[0].absence).toBe('valide')
    expect(lignes[1].absence).toBe('souhait')
    expect(lignes[0].vide).toBe(false)
  })
})

describe('les axes d’affichage masquent vraiment', () => {
  it('« gardes seules » n’expose aucune présence', () => {
    const lignes = lignesDeLaSemaine(
      EQUIPE,
      { gardes: [], journee: journee([presence({ id: 'p1' })]), absences: [] },
      RAIL,
      { gardesVisibles: true, journeeVisible: false },
    )
    expect(lignes[0].journee).toHaveLength(0)
    expect(lignes[0].vide).toBe(true)
  })

  it('« journée seule » n’expose aucune garde', () => {
    const lignes = lignesDeLaSemaine(
      EQUIPE,
      {
        gardes: [
          garde({
            id: 'g1',
            places: [{ vetId: ANNE.id, prenom: 'Anne-Sophie', couleur: null, role: '1er', index: 0 }],
          }),
        ],
        absences: [],
      },
      RAIL,
      { gardesVisibles: false, journeeVisible: true },
    )
    expect(lignes[0].nuit).toBeNull()
  })
})

describe('le sélecteur ne propose que ce que le cabinet possède', () => {
  it('les deux modules → trois choix', () => {
    expect(choixContenu(['gardes', 'planning-journee'])).toEqual(['gardes', 'journee', 'les-deux'])
  })

  it('journée seule → un seul choix, donc AUCUN sélecteur à afficher', () => {
    expect(choixContenu(['planning-journee'])).toEqual(['journee'])
  })

  it('gardes seules → un seul choix', () => {
    expect(choixContenu(['gardes'])).toEqual(['gardes'])
  })

  it('repli FERMANT sur une liste vide : les gardes, jamais « tout »', () => {
    expect(choixContenu([])).toEqual(['gardes'])
  })

  it('le défaut montre tout ce que le cabinet possède', () => {
    expect(contenuParDefaut(['gardes', 'planning-journee'])).toBe('les-deux')
    expect(contenuParDefaut(['planning-journee'])).toBe('journee')
    expect(contenuParDefaut(['gardes'])).toBe('gardes')
  })

  it('la visibilité suit le choix', () => {
    expect(visibilite('les-deux')).toEqual({ gardesVisibles: true, journeeVisible: true })
    expect(visibilite('gardes')).toEqual({ gardesVisibles: true, journeeVisible: false })
    expect(visibilite('journee')).toEqual({ gardesVisibles: false, journeeVisible: true })
  })
})

describe('la case repliée', () => {
  it('un CHIFFRE pour les présents, pas des prénoms', () => {
    const l = lignesCaseRepliee(
      {
        gardes: [],
        journee: journee([
          presence({ id: 'p1', vetId: ANNE.id }),
          presence({ id: 'p2', vetId: FANNY.id, prenom: 'Fanny' }),
        ]),
        absences: [],
      },
      { gardesVisibles: true, journeeVisible: true },
    )
    const presents = l.find((x) => x.genre === 'presents')
    expect(presents?.nombre).toBe(2)
    expect(presents?.pastilles).toHaveLength(0)
  })

  it('des NOMS pour la nuit — c’est l’information qu’on cherche en ouvrant', () => {
    const l = lignesCaseRepliee(
      {
        gardes: [
          garde({
            id: 'g1',
            places: [{ vetId: ANNE.id, prenom: 'Anne-Sophie', couleur: '#0B7D6C', role: '1er', index: 0 }],
          }),
        ],
        absences: [],
      },
      { gardesVisibles: true, journeeVisible: true },
    )
    expect(l.find((x) => x.genre === 'nuit')?.pastilles[0].texte).toBe('Anne-Sophie')
  })

  it('les places à pourvoir sortent, avec leur compte', () => {
    const l = lignesCaseRepliee(
      { gardes: [garde({ id: 'g1', manque: 2 })], absences: [] },
      { gardesVisibles: true, journeeVisible: true },
    )
    expect(l.find((x) => x.genre === 'pourvoir')?.nombre).toBe(2)
  })

  it('au-delà de 3 pastilles, résume par « +N » — la case ne grandit pas', () => {
    const l = lignesCaseRepliee(
      {
        gardes: [],
        absences: [
          { vetId: 'a', prenom: 'Anne', statut: 'valide' },
          { vetId: 'b', prenom: 'Bea', statut: 'valide' },
          { vetId: 'c', prenom: 'Cyril', statut: 'valide' },
          { vetId: 'd', prenom: 'Dan', statut: 'valide' },
          { vetId: 'e', prenom: 'Eve', statut: 'valide' },
        ],
      },
      { gardesVisibles: true, journeeVisible: true },
    )
    const abs = l.find((x) => x.genre === 'absents')
    expect(abs?.pastilles).toHaveLength(3)
    expect(abs?.pastilles[2].texte).toBe('+3')
  })

  it('un souhait se marque en creux, un congé non', () => {
    const l = lignesCaseRepliee(
      {
        gardes: [],
        absences: [
          { vetId: 'a', prenom: 'Anne', statut: 'valide' },
          { vetId: 'b', prenom: 'Bea', statut: 'souhait' },
        ],
      },
      { gardesVisibles: true, journeeVisible: true },
    )
    const p = l.find((x) => x.genre === 'absents')?.pastilles ?? []
    expect(p[0].creux).toBe(false)
    expect(p[1]).toEqual({ texte: 'Bea ?', couleur: null, creux: true })
  })

  it('un jour sans rien ne rend AUCUNE ligne — pas une ligne « 0 »', () => {
    expect(
      lignesCaseRepliee({ gardes: [], absences: [] }, { gardesVisibles: true, journeeVisible: true }),
    ).toEqual([])
  })

  it('« journée seule » n’affiche ni nuit ni places à pourvoir', () => {
    const l = lignesCaseRepliee(
      {
        gardes: [
          garde({
            id: 'g1',
            manque: 1,
            places: [{ vetId: ANNE.id, prenom: 'Anne-Sophie', couleur: null, role: '1er', index: 0 }],
          }),
        ],
        absences: [],
      },
      { gardesVisibles: false, journeeVisible: true },
    )
    expect(l.find((x) => x.genre === 'nuit')).toBeUndefined()
    expect(l.find((x) => x.genre === 'pourvoir')).toBeUndefined()
  })
})

describe('la semaine repliée garde son signal', () => {
  it('compte les places à pourvoir de la semaine', () => {
    const n = semaineASignaler(
      [{ gardes: [garde({ id: 'g1', manque: 2 })] }, { gardes: [garde({ id: 'g2', manque: 1 })] }],
      true,
    )
    expect(n).toBe(3)
  })

  it('ne signale rien quand les gardes sont masquées — un trou de garde qu’on ne montre pas n’a pas à clignoter', () => {
    expect(semaineASignaler([{ gardes: [garde({ id: 'g1', manque: 5 })] }], false)).toBe(0)
  })
})

describe('le découpage en semaines', () => {
  it('fait des paquets de 7, dans l’ordre', () => {
    const grille = Array.from({ length: 42 }, (_, i) => `j${i}`)
    const s = decouperEnSemaines(grille)
    expect(s).toHaveLength(6)
    expect(s[0][0]).toBe('j0')
    expect(s[5][6]).toBe('j41')
  })

  it('ne perd aucun jour', () => {
    const grille = Array.from({ length: 35 }, (_, i) => `j${i}`)
    expect(decouperEnSemaines(grille).flat()).toEqual(grille)
  })
})
