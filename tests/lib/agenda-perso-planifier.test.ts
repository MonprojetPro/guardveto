// ============================================================
// B-173 / B-181 — Ce que l'agenda PERSONNEL de chacun contient
// ============================================================
// B-181 (MiKL, 03/11, maquette `docs/maquettes/B-181-mon-agenda.html`) :
//   · UN agenda par personne, UN choix : « Mon planning » ou « Tout le
//     cabinet » — jamais les deux, donc jamais de doublon ;
//   · « Mon planning » : ses gardes AVEC le binôme (« Garde 1er — avec
//     Fanny »), une place vide se dit, et ses journées ;
//   · « Tout le cabinet » : les gardes de tous, places à pourvoir comprises, et
//     les journées en UN bandeau par jour, ou aux heures ;
//   · le secrétariat n'a que « Tout le cabinet ».
// Le défaut d'avant (journées seules, gardes « par l'agenda du cabinet » que
// personne n'avait) laissait l'agenda de Manon vide : c'est ce qu'on verrouille.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  contenuEffectif,
  enumerer,
  heureCourte,
  jourDeCle,
  operationsAgenda,
  placementParDefaut,
  planifierAgendaPerso,
  prenomsDepartages,
  reglagesDuChoix,
  reglagesParDefaut,
  vueDe,
  type GardeAPlacer,
  type PresenceAPlacer,
  type ReglagesAgendaPerso,
} from '@/lib/agenda-perso/planifier'
import { planifierEvenementsGarde } from '@/lib/google-calendar'

const FANNY = 'vet-fanny'
const JEAN = 'vet-jean'
const ANNESO = 'vet-anneso'
const MANON = 'vet-manon'
const MATIN = { blocId: 'bloc-matin', blocNom: 'Matin', debut: '08:00:00', fin: '12:00:00', ordre: 1 }
const APREM = { blocId: 'bloc-aprem', blocNom: 'Après-midi', debut: '14:00:00', fin: '18:00:00', ordre: 2 }
const JOURNEE = { blocId: 'bloc-journee', blocNom: 'Journée complète', debut: '08:00:00', fin: '18:00:00', ordre: 3 }

// Lundi 9 et jeudi 12 novembre.
const PRESENCES: PresenceAPlacer[] = [
  { date: '2026-11-09', vetId: FANNY, ...MATIN },
  { date: '2026-11-09', vetId: ANNESO, ...MATIN },
  { date: '2026-11-09', vetId: ANNESO, ...APREM },
  { date: '2026-11-09', vetId: JEAN, ...JOURNEE },
  { date: '2026-11-12', vetId: FANNY, ...JOURNEE },
]
const NOMS = new Map([[FANNY, 'Fanny'], [JEAN, 'Jean'], [ANNESO, 'Anne-So'], [MANON, 'Manon']])

const ev = (gardeId: string, jour: string, placeIndex: number, vetId: string | undefined, extra: Partial<GardeAPlacer['ev']> = {}): GardeAPlacer => ({
  gardeId,
  ev: {
    jour, placeIndex, vetId, titre: `garde-${vetId}-${placeIndex}`,
    base: 'Garde', role: placeIndex === 0 ? '1er' : '2nd',
    start: { date: jour }, end: { date: '2026-11-10' },
    ...(vetId ? { colorId: '6' } : {}),
    ...extra,
  },
})
// g1 : Jean 1er, Fanny 2nde. g2 : Fanny seule, la 2e place prévue est vide.
// g3 : Fanny seule sur un créneau à une place.
const GARDES: GardeAPlacer[] = [
  ev('g1', '2026-11-09', 0, JEAN),
  ev('g1', '2026-11-09', 1, FANNY),
  ev('g2', '2026-11-10', 0, FANNY),
  ev('g2', '2026-11-10', 1, undefined, { vide: true }),
  ev('g3', '2026-11-11', 0, FANNY),
]

const plan = (r: ReglagesAgendaPerso, vetId: string | null = FANNY, genre: 'veto' | 'secretaire' = 'veto') =>
  planifierAgendaPerso({ contenu: contenuEffectif(r, genre), vetId, presences: PRESENCES, noms: NOMS, gardes: GARDES })

const DEFAUT = reglagesParDefaut('veto')
const choix = (vue: 'mon_planning' | 'cabinet', placement: 'heures' | 'haut', genre: 'veto' | 'secretaire' = 'veto'): ReglagesAgendaPerso =>
  ({ actif: true, ...reglagesDuChoix(vue, placement, genre) })

describe('« Mon planning » — le défaut d’un véto', () => {
  it('le défaut EST « Mon planning », journées aux heures', () => {
    expect(contenuEffectif(DEFAUT, 'veto')).toEqual({ actif: true, vue: 'mon_planning', placement: 'heures' })
  })

  it('porte SES gardes — l’agenda de Manon n’est plus vide sans journée', () => {
    const evs = planifierAgendaPerso({
      contenu: contenuEffectif(DEFAUT, 'veto'), vetId: MANON, presences: [], noms: NOMS,
      gardes: [ev('g9', '2026-11-09', 0, MANON)],
    })
    expect(evs.map((e) => e.titre)).toEqual(['Garde 1er'])
  })

  it('le titre dit avec qui on est de garde, une place vide, ou rien quand on est seul', () => {
    const titres = plan(DEFAUT).filter((e) => e.cle.startsWith('g|')).map((e) => [e.cle, e.titre])
    expect(titres).toEqual([
      ['g|g1|2026-11-09|1', 'Garde 2nd — avec Jean'],
      ['g|g2|2026-11-10|0', 'Garde 1er — avec : place à pourvoir'],
      ['g|g3|2026-11-11|0', 'Garde 1er'],
    ])
  })

  it('un binôme ET une place vide se disent tous les deux', () => {
    const evs = planifierAgendaPerso({
      contenu: contenuEffectif(DEFAUT, 'veto'), vetId: FANNY, presences: [], noms: NOMS,
      gardes: [ev('g', '2026-11-09', 0, FANNY), ev('g', '2026-11-09', 1, JEAN), ev('g', '2026-11-09', 2, undefined, { vide: true, role: '3e' })],
    })
    expect(evs.map((e) => e.titre)).toEqual(['Garde 1er — avec Jean et une place à pourvoir'])
  })

  it('jamais la garde d’un collègue, jamais une place vide pour elle-même', () => {
    expect(plan(DEFAUT).some((e) => e.cle === 'g|g1|2026-11-09|0' || e.cle === 'g|g2|2026-11-10|1')).toBe(false)
  })

  it('ses journées, aux heures du créneau, et elles seules', () => {
    const j = plan(DEFAUT).filter((e) => e.cle.startsWith('j|'))
    expect(j.map((e) => [e.cle, e.titre])).toEqual([
      ['j|2026-11-09|bloc-matin', 'Au cabinet · Matin'],
      ['j|2026-11-12|bloc-journee', 'Au cabinet · Journée complète'],
    ])
    expect(j[0].start).toEqual({ dateTime: '2026-11-09T08:00:00', timeZone: 'Europe/Paris' })
  })

  it('en haut du jour : journée entière, l’horaire passe dans le titre', () => {
    const [j] = plan(choix('mon_planning', 'haut')).filter((e) => e.cle.startsWith('j|'))
    expect(j.titre).toBe('Au cabinet · Matin 8h–12h')
    expect(j.start).toEqual({ date: '2026-11-09' })
    expect(j.end).toEqual({ date: '2026-11-10' })
  })

  it('la couleur du véto est gardée', () => {
    expect(plan(DEFAUT).find((e) => e.cle === 'g|g1|2026-11-09|1')?.colorId).toBe('6')
  })
})

describe('« Tout le cabinet »', () => {
  it('les gardes de toute l’équipe, places à pourvoir comprises (sans couleur)', () => {
    const g = plan(choix('cabinet', 'haut')).filter((e) => e.cle.startsWith('g|'))
    expect(g.map((e) => [e.titre, e.colorId ?? '-'])).toEqual([
      ['Garde 1er — Jean', '6'],
      ['Garde 2nd — Fanny', '6'],
      ['Garde 1er — Fanny', '6'],
      ['Garde 2nd — à pourvoir', '-'],
      ['Garde 1er — Fanny', '6'],
    ])
  })

  it('journées en bandeau : UNE ligne par jour, un prénom seul = toute la journée', () => {
    const b = plan(choix('cabinet', 'haut')).filter((e) => e.cle.startsWith('jb|'))
    expect(b.map((e) => [e.cle, e.titre])).toEqual([
      ['jb|2026-11-09', 'Au cabinet : Anne-So, Fanny (matin), Jean'],
      ['jb|2026-11-12', 'Au cabinet : Fanny'],
    ])
    expect(b[0].start).toEqual({ date: '2026-11-09' })
  })

  it('journées aux heures : un événement par créneau, avec les prénoms', () => {
    const j = plan(choix('cabinet', 'heures')).filter((e) => e.cle.startsWith('je|'))
    expect(j.map((e) => e.titre)).toEqual([
      'Au cabinet · Après-midi : Anne-So',
      'Au cabinet · Journée complète : Jean',
      'Au cabinet · Matin : Anne-So, Fanny',
      'Au cabinet · Journée complète : Fanny',
    ])
    expect(j[0].start).toEqual({ dateTime: '2026-11-09T14:00:00', timeZone: 'Europe/Paris' })
  })

  it('le placement par défaut d’une vue : bandeau pour le cabinet, heures pour soi', () => {
    expect(placementParDefaut('cabinet')).toBe('haut')
    expect(placementParDefaut('mon_planning')).toBe('heures')
  })
})

describe('le secrétariat', () => {
  it('éteint par défaut, et « Tout le cabinet » seul — même si l’appel demande l’autre', () => {
    expect(reglagesParDefaut('secretaire').actif).toBe(false)
    expect(vueDe({ journees: 'miennes' }, 'secretaire')).toBe('cabinet')
    expect(reglagesDuChoix('mon_planning', 'haut', 'secretaire').journees).toBe('equipe')
    expect(reglagesDuChoix('mon_planning', 'haut', 'secretaire').mesGardes).toBe(false)
  })

  it('reçoit les gardes de toute l’équipe', () => {
    const evs = plan(choix('cabinet', 'haut', 'secretaire'), null, 'secretaire')
    expect(evs.filter((e) => e.cle.startsWith('g|'))).toHaveLength(5)
  })
})

describe('lignes d’avant B-181 et fonction coupée', () => {
  it('« aucune » ou « les miennes » se lisent « Mon planning » ; « toute l’équipe » se lit « Tout le cabinet »', () => {
    expect(vueDe({ journees: 'aucune' }, 'veto')).toBe('mon_planning')
    expect(vueDe({ journees: 'miennes' }, 'veto')).toBe('mon_planning')
    expect(vueDe({ journees: 'equipe' }, 'veto')).toBe('cabinet')
  })
  it('fonction coupée : rien', () => {
    expect(plan({ ...DEFAUT, actif: false })).toEqual([])
  })
})

describe('les places à pourvoir viennent de la planification (B-181)', () => {
  const garde = {
    date: '2026-11-10', type: 'semaine',
    places: [{ vetId: FANNY, libelle: 'FL', couleurGoogle: '6' }, null],
    base: 'garde',
  }

  it('pour l’agenda perso : base, rôle, et la place prévue vide sort marquée « vide »', () => {
    const evs = planifierEvenementsGarde(garde, { afficherHoraires: false, pourAgendaPerso: { placesAttendues: 2 } })
    expect(evs.map((e) => [e.placeIndex, e.vetId ?? '-', e.base, e.role, e.vide ?? false])).toEqual([
      [0, FANNY, 'garde', '1er', false],
      [1, '-', 'garde', '2nd', true],
    ])
  })

  it('nombre de places inconnu : aucune place vide annoncée', () => {
    const evs = planifierEvenementsGarde(garde, { afficherHoraires: false, pourAgendaPerso: { placesAttendues: null } })
    expect(evs.some((e) => e.vide)).toBe(false)
  })

  it('créneau à une place : la 2e, jamais prévue, ne se dit pas', () => {
    const evs = planifierEvenementsGarde(garde, { afficherHoraires: false, pourAgendaPerso: { placesAttendues: 1 } })
    expect(evs.some((e) => e.vide)).toBe(false)
  })

  it('pour l’agenda du CABINET : rien ne change (ni place vide, ni morceaux)', () => {
    const evs = planifierEvenementsGarde(garde, { afficherHoraires: false })
    expect(evs).toHaveLength(1)
    expect(evs[0]).not.toHaveProperty('vide')
    expect(evs[0]).not.toHaveProperty('base')
  })
})

describe('rapprochement', () => {
  const voulus = plan(DEFAUT)
  const connu = (cle: string, empreinte = 'x') => ({ cle, googleEventId: `ev-${cle}`, empreinte })

  it('crée ce qui manque, ne touche pas ce qui est identique', () => {
    const ops = operationsAgenda(voulus.slice(0, 2), [{ ...connu(voulus[0].cle), empreinte: voulus[0].empreinte }], '2026-11-01')
    expect(ops.map((o) => o.genre)).toEqual(['creer'])
  })

  it('met à jour ce qui a changé (horaires d’un créneau modifiés)', () => {
    const ops = operationsAgenda(voulus.slice(0, 1), [connu(voulus[0].cle, 'ancienne')], '2026-11-01')
    expect(ops).toEqual([{ genre: 'majer', voulu: voulus[0], googleEventId: `ev-${voulus[0].cle}` }])
  })

  it('retire ce que le planning ne dit plus, mais garde le passé hors fenêtre', () => {
    const ops = operationsAgenda([], [connu('j|2026-11-09|b'), connu('j|2026-10-01|b')], '2026-11-01')
    expect(ops.map((o) => (o.genre === 'retirer' ? o.connu.cle : o.genre))).toEqual(['j|2026-11-09|b'])
  })

  it('fonction coupée : vide TOUT, passé compris', () => {
    const ops = operationsAgenda(voulus, [connu('j|2026-10-01|b'), connu('j|2026-11-09|b')], '2026-11-01', true)
    expect(ops.every((o) => o.genre === 'retirer')).toBe(true)
    expect(ops).toHaveLength(2)
  })

  it('relancé sur son propre résultat : plus rien à faire', () => {
    const ecrits = voulus.map((v) => ({ cle: v.cle, googleEventId: 'id', empreinte: v.empreinte }))
    expect(operationsAgenda(voulus, ecrits, '2026-11-01')).toEqual([])
  })
})

describe('petits outils', () => {
  it('heureCourte', () => {
    expect(heureCourte('08:00:00')).toBe('8h')
    expect(heureCourte('08:30')).toBe('8h30')
  })
  it('jourDeCle lit la date par segment, jamais dans un identifiant', () => {
    expect(jourDeCle('g|1234-56-78ab|2026-11-09|0')).toBe('2026-11-09')
    expect(jourDeCle('jb|2026-11-09')).toBe('2026-11-09')
  })
  it('enumerer', () => {
    expect(enumerer(['Fanny'])).toBe('Fanny')
    expect(enumerer(['Fanny', 'Jean'])).toBe('Fanny et Jean')
    expect(enumerer(['Anne-So', 'Fanny', 'Jean'])).toBe('Anne-So, Fanny et Jean')
  })
  it('deux prénoms identiques se départagent par l’initiale du nom', () => {
    const n = prenomsDepartages([
      { id: 'a', prenom: 'Anne', nom: 'Bernard' },
      { id: 'b', prenom: 'Anne', nom: 'Colas' },
      { id: 'c', prenom: 'Jean', nom: 'Dupont' },
    ])
    expect([...n.values()]).toEqual(['Anne B.', 'Anne C.', 'Jean'])
  })
})
