// ============================================================
// B-173 — Ce que l'agenda PERSONNEL de chacun doit contenir
// ============================================================
// Règles posées par MiKL le 24/10 et validées sur maquette le 26/10 :
//   · mode par défaut : ses journées aux heures, AUCUNE garde dans l'agenda
//     perso (elles arrivent par l'agenda du cabinet — sinon doublon) ;
//   · personnalisé : toutes les combinaisons, et les gardes gardent « un
//     étage par véto de garde, comme aujourd'hui » ;
//   · un brouillon ne sort jamais (filtré en amont, à la lecture).
// Cas tirés du bac à sable : Matin 8h–12h, Journée complète 8h–18h.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  contenuEffectif,
  heureCourte,
  jourDeCle,
  operationsAgenda,
  planifierAgendaPerso,
  reglagesParDefaut,
  type GardeAPlacer,
  type PresenceAPlacer,
  type ReglagesAgendaPerso,
} from '@/lib/agenda-perso/planifier'

const FANNY = 'vet-fanny'
const JEAN = 'vet-jean'
const ANNESO = 'vet-anneso'
const MATIN = { blocId: 'bloc-matin', blocNom: 'Matin', debut: '08:00:00', fin: '12:00:00', ordre: 1 }
const JOURNEE = { blocId: 'bloc-journee', blocNom: 'Journée complète', debut: '08:00:00', fin: '18:00:00', ordre: 3 }

const PRESENCES: PresenceAPlacer[] = [
  { date: '2026-11-09', vetId: FANNY, ...MATIN },
  { date: '2026-11-09', vetId: ANNESO, ...MATIN },
  { date: '2026-11-09', vetId: JEAN, ...JOURNEE },
  { date: '2026-11-12', vetId: FANNY, ...JOURNEE },
]
const LIBELLES = new Map([[FANNY, 'FL'], [JEAN, 'JD'], [ANNESO, 'ASB']])

const garde = (gardeId: string, jour: string, placeIndex: number, vetId: string, titre: string): GardeAPlacer => ({
  gardeId,
  ev: { jour, placeIndex, vetId, titre, start: { date: jour }, end: { date: '2026-11-10' }, colorId: '6' },
})
const GARDES: GardeAPlacer[] = [
  garde('g1', '2026-11-09', 0, JEAN, 'garde-JD-1er'),
  garde('g1', '2026-11-09', 1, FANNY, 'garde-FL-2nd'),
]

const plan = (r: ReglagesAgendaPerso, vetId: string | null = FANNY, genre: 'veto' | 'secretaire' = 'veto') =>
  planifierAgendaPerso({ contenu: contenuEffectif(r, genre), vetId, presences: PRESENCES, libelles: LIBELLES, gardes: GARDES })

const DEFAUT = reglagesParDefaut('veto')
const PERSO = { ...DEFAUT, personnalise: true }

describe('mode par défaut d’un véto', () => {
  it('porte SES journées, aux heures du créneau, et aucune garde', () => {
    const evs = plan(DEFAUT)
    expect(evs.map((e) => [e.cle, e.titre])).toEqual([
      ['j|2026-11-09|bloc-matin', 'Matin'],
      ['j|2026-11-12|bloc-journee', 'Journée complète'],
    ])
    expect(evs[0].start).toEqual({ dateTime: '2026-11-09T08:00:00', timeZone: 'Europe/Paris' })
    expect(evs[0].end).toEqual({ dateTime: '2026-11-09T12:00:00', timeZone: 'Europe/Paris' })
  })

  it('laisse les gardes à l’agenda du cabinet (sinon chaque garde apparaîtrait deux fois)', () => {
    expect(contenuEffectif(DEFAUT, 'veto').gardesViaCabinet).toBe(true)
    expect(plan(DEFAUT).some((e) => e.cle.startsWith('g|'))).toBe(false)
  })
})

describe('personnalisé', () => {
  it('« mes gardes » seulement : la sienne, pas celle de Jean', () => {
    const evs = plan({ ...PERSO, journees: 'aucune', gardesAutres: false })
    expect(evs.map((e) => e.titre)).toEqual(['garde-FL-2nd'])
  })

  it('les gardes gardent un étage par véto de garde, titre et couleur de l’agenda du cabinet', () => {
    const evs = plan({ ...PERSO, journees: 'aucune' })
    expect(evs.map((e) => [e.cle, e.titre, e.colorId])).toEqual([
      ['g|g1|2026-11-09|0', 'garde-JD-1er', '6'],
      ['g|g1|2026-11-09|1', 'garde-FL-2nd', '6'],
    ])
  })

  it('journées de toute l’équipe : UN événement par créneau, avec les initiales', () => {
    const evs = plan({ ...PERSO, journees: 'equipe', mesGardes: false, gardesAutres: false })
    expect(evs.map((e) => [e.cle, e.titre])).toEqual([
      ['je|2026-11-09|bloc-journee', 'Journée complète · JD'],
      ['je|2026-11-09|bloc-matin', 'Matin · ASB, FL'],
      ['je|2026-11-12|bloc-journee', 'Journée complète · FL'],
    ])
  })

  it('en haut du jour : journée entière, l’horaire passe dans le titre', () => {
    const [ev] = plan({ ...PERSO, placement: 'haut', mesGardes: false, gardesAutres: false })
    expect(ev.titre).toBe('Matin 8h–12h')
    expect(ev.start).toEqual({ date: '2026-11-09' })
    expect(ev.end).toEqual({ date: '2026-11-10' })
  })

  it('rien de rien : agenda vide', () => {
    expect(plan({ ...PERSO, journees: 'aucune', mesGardes: false, gardesAutres: false })).toEqual([])
  })
})

describe('fonction coupée', () => {
  it('n’envoie rien et rend l’agenda du cabinet', () => {
    const c = contenuEffectif({ ...PERSO, actif: false }, 'veto')
    expect(c.gardesViaCabinet).toBe(true)
    expect(plan({ ...PERSO, actif: false })).toEqual([])
  })
})

describe('secrétaire', () => {
  it('éteint par défaut : elle n’a ni journée ni garde à elle', () => {
    expect(reglagesParDefaut('secretaire').actif).toBe(false)
  })
  it('« les miennes » n’a pas de sens pour elle : devient « toute l’équipe »', () => {
    const c = contenuEffectif({ ...reglagesParDefaut('secretaire'), actif: true, personnalise: true, journees: 'miennes' }, 'secretaire')
    expect(c.journees).toBe('equipe')
    expect(c.mesGardes).toBe(false)
  })
})

describe('créneau de nuit', () => {
  it('une fin avant le début déborde sur le lendemain', () => {
    const nuit: PresenceAPlacer = { date: '2026-11-09', vetId: FANNY, blocId: 'b-nuit', blocNom: 'Nuit', debut: '20:00', fin: '08:00', ordre: 9 }
    const [ev] = planifierAgendaPerso({ contenu: contenuEffectif(DEFAUT, 'veto'), vetId: FANNY, presences: [nuit], libelles: LIBELLES, gardes: [] })
    expect(ev.end).toEqual({ dateTime: '2026-11-10T08:00:00', timeZone: 'Europe/Paris' })
  })
})

describe('rapprochement', () => {
  const voulus = plan(DEFAUT)
  const connu = (cle: string, empreinte = 'x') => ({ cle, googleEventId: `ev-${cle}`, empreinte })

  it('crée ce qui manque, ne touche pas ce qui est identique', () => {
    const ops = operationsAgenda(voulus, [{ ...connu(voulus[0].cle), empreinte: voulus[0].empreinte }], '2026-11-01')
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
    expect(jourDeCle('je|2026-11-09|bloc')).toBe('2026-11-09')
  })
})
