// ============================================================
// Ce qui fait une tranche horaire valide — B-120 chantier 2
// ============================================================
// Ces cas portent sur `src/lib/journee/blocs.ts`, la validation pure. Ils ne
// touchent ni la base ni le réseau : c'est précisément pour ça que la
// validation a été sortie de l'action serveur. Une règle qui n'est testable
// qu'en cliquant n'est jamais testée.
//
// ⚠️ Deux groupes de cas comptent plus que les autres, et ce ne sont pas les
//    refus évidents :
//    · ce qu'on ACCEPTE délibérément (chevauchement, bloc à cheval) — sans
//      ces cas, quelqu'un « corrigerait » un jour un faux défaut en ajoutant
//      une contrainte qui casserait le cas d'usage principal ;
//    · la NORMALISATION des heures — `08:00:00` de Postgres contre `08:00`
//      d'un champ de formulaire. C'est le genre d'écart qui fait dire « ça
//      n'a pas enregistré » alors que tout est en place.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  CRENEAUX_BLOC,
  LIBELLE_CRENEAU,
  normaliserHeure,
  nomDejaPris,
  plageLisible,
  validerBloc,
} from '@/lib/journee/blocs'

const bon = { nom: 'Matin', debut: '08:00', fin: '12:00', creneau: 'matin' }

describe('Le vocabulaire des créneaux', () => {
  it('ne connaît que les trois moments de la JOURNÉE', () => {
    expect([...CRENEAUX_BLOC].sort()).toEqual(['apres-midi', 'journee', 'matin'])
  })

  it('n’inclut PAS la soirée — elle appartient au module des gardes', () => {
    // Décision ⑦ du cadrage V3 : les deux mondes ne se parlent pas. Un bloc de
    // journée posé le soir ferait tenir le même fait par deux modules.
    expect(CRENEAUX_BLOC).not.toContain('soiree')
  })

  it('donne un libellé lisible à chacun', () => {
    for (const c of CRENEAUX_BLOC) {
      expect(LIBELLE_CRENEAU[c], `${c} n’a pas de libellé`).toBeTruthy()
    }
  })
})

describe('normaliserHeure', () => {
  it('ramène la forme Postgres à la forme du formulaire', () => {
    // Sans ça, l'écran réaffiche `08:00:00` dans un champ `time` qui l'ignore,
    // et le champ paraît vide.
    expect(normaliserHeure('08:00:00')).toBe('08:00')
    expect(normaliserHeure('14:30')).toBe('14:30')
  })

  it('tolère les espaces de bord', () => {
    expect(normaliserHeure(' 09:15 ')).toBe('09:15')
  })

  it('refuse ce qui n’est pas une heure', () => {
    expect(normaliserHeure('25:00')).toBeNull()
    expect(normaliserHeure('08:60')).toBeNull()
    expect(normaliserHeure('8h')).toBeNull()
    expect(normaliserHeure('')).toBeNull()
  })
})

describe('validerBloc — les refus', () => {
  it('refuse un nom vide, ou qui n’est que des espaces', () => {
    expect(validerBloc({ ...bon, nom: '' }).ok).toBe(false)
    expect(validerBloc({ ...bon, nom: '   ' }).ok).toBe(false)
  })

  it('refuse un nom trop long pour la grille', () => {
    const r = validerBloc({ ...bon, nom: 'x'.repeat(41) })
    expect(r.ok).toBe(false)
  })

  it('refuse une fin avant le début', () => {
    const r = validerBloc({ ...bon, debut: '12:00', fin: '08:00' })
    expect(r.ok).toBe(false)
    // Le message cite les deux heures : « la fin doit être après le début »
    // tout seul oblige à rouvrir les champs pour comprendre lequel corriger.
    if (!r.ok) expect(r.probleme).toContain('08:00')
  })

  it('refuse une tranche de durée nulle', () => {
    expect(validerBloc({ ...bon, debut: '08:00', fin: '08:00' }).ok).toBe(false)
  })

  it('refuse la soirée EN EXPLIQUANT pourquoi', () => {
    // Un refus muet renverrait l'admin essayer autrement, indéfiniment.
    const r = validerBloc({ ...bon, creneau: 'soiree' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.probleme).toMatch(/gardes/)
  })

  it('refuse un créneau inventé', () => {
    expect(validerBloc({ ...bon, creneau: 'nuit' }).ok).toBe(false)
    expect(validerBloc({ ...bon, creneau: '' }).ok).toBe(false)
  })
})

describe('validerBloc — ce qu’on accepte DÉLIBÉRÉMENT', () => {
  it('accepte une tranche qui en recouvre d’autres', () => {
    // « Journée complète » 8h→18h contient « Matin » et « Après-midi ». C'est
    // le cas d'usage décrit par MiKL, pas une erreur de saisie : les blocs
    // sont un vocabulaire, jamais un découpage exclusif.
    const r = validerBloc({
      nom: 'Journée complète',
      debut: '08:00',
      fin: '18:00',
      creneau: 'journee',
    })
    expect(r.ok).toBe(true)
  })

  it('accepte une tranche à cheval, et laisse l’admin choisir son rattachement', () => {
    // Une garde de midi 12h→14h n'est ni franchement matin ni franchement
    // après-midi. Deviner à sa place aurait inventé une règle que personne
    // n'a demandée.
    const r = validerBloc({
      nom: 'Midi',
      debut: '12:00',
      fin: '14:00',
      creneau: 'apres-midi',
    })
    expect(r.ok).toBe(true)
  })

  it('accepte une tranche qui finit à minuit moins le quart', () => {
    expect(validerBloc({ ...bon, debut: '08:00', fin: '23:45' }).ok).toBe(true)
  })

  it('normalise au passage : nom élagué, heures en HH:MM', () => {
    const r = validerBloc({
      nom: '  Visites  ',
      debut: '09:00:00',
      fin: '11:30:00',
      creneau: 'matin',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.valeur).toEqual({
        nom: 'Visites',
        debut: '09:00',
        fin: '11:30',
        creneau: 'matin',
      })
    }
  })
})

describe('nomDejaPris', () => {
  const existants = [
    { id: 'a', nom: 'Matin' },
    { id: 'b', nom: ' Après-midi ' },
  ]

  it('voit un doublon malgré la casse et les espaces', () => {
    expect(nomDejaPris('matin', existants)).toBe(true)
    expect(nomDejaPris('  MATIN', existants)).toBe(true)
    expect(nomDejaPris('après-midi', existants)).toBe(true)
  })

  it('laisse passer un nom neuf', () => {
    expect(nomDejaPris('Visites', existants)).toBe(false)
  })

  it('ne se prend PAS lui-même pour un doublon quand on le modifie', () => {
    // Sans `sauf`, changer l'horaire de « Matin » sans toucher son nom aurait
    // été refusé comme doublon de lui-même.
    expect(nomDejaPris('Matin', existants, 'a')).toBe(false)
    // Mais renommer « Après-midi » en « Matin » reste un vrai doublon.
    expect(nomDejaPris('Matin', existants, 'b')).toBe(true)
  })
})

describe('plageLisible', () => {
  it('écrit les heures rondes sans minutes', () => {
    expect(plageLisible('08:00:00', '12:00:00')).toBe('8h → 12h')
  })

  it('garde les minutes quand il y en a', () => {
    expect(plageLisible('08:30', '12:15')).toBe('8h30 → 12h15')
  })
})
