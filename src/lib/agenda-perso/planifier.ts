// ============================================================
// GUARDVETO — B-173 : ce que l'agenda PERSONNEL d'un membre doit contenir
// ============================================================
// Fonction pure — ni base, ni réseau. Elle décide ; le rapprochement
// (`rapprocher.ts`) ne fait qu'exécuter sa sortie. C'est sur elle que portent
// les tests.
//
// Les règles, telles que MiKL les a posées le 24/10 :
//   · MODE PAR DÉFAUT (rien réglé) : ses journées aux heures du créneau ; les
//     gardes de toute l'équipe restent apportées par l'agenda du CABINET, que
//     la personne affiche déjà. L'agenda perso n'en porte donc aucune — sinon
//     chaque garde apparaîtrait deux fois.
//   · PERSONNALISÉ : journées (les miennes / toute l'équipe / aucune), placées
//     aux heures ou en haut du jour, mes gardes oui/non, gardes des autres
//     oui/non. L'agenda du cabinet lui est alors retiré (voir rapprocher.ts) :
//     tout arrive par l'agenda perso.
//   · Les gardes gardent « un étage par véto de garde, comme aujourd'hui » :
//     on reprend tels quels les événements de l'agenda du cabinet.
// ============================================================

import type { EvenementPlanifie, PeriodeEvenementGoogle } from '@/lib/google-calendar'

export type ChoixJournees = 'miennes' | 'equipe' | 'aucune'
export type Placement = 'heures' | 'haut'
export type GenreMembre = 'veto' | 'secretaire'

export interface ReglagesAgendaPerso {
  actif: boolean
  personnalise: boolean
  journees: ChoixJournees
  placement: Placement
  mesGardes: boolean
  gardesAutres: boolean
}

/**
 * Un véto reçoit son planning sans rien faire. Une secrétaire, non : elle n'a
 * ni journée ni garde à elle, et l'équipe entière posée d'office dans son
 * agenda serait exactement le « bazar » que MiKL voulait éviter. Elle l'allume
 * si elle le souhaite.
 */
export function reglagesParDefaut(genre: GenreMembre): ReglagesAgendaPerso {
  return {
    actif: genre === 'veto',
    personnalise: false,
    journees: genre === 'veto' ? 'miennes' : 'equipe',
    placement: genre === 'veto' ? 'heures' : 'haut',
    mesGardes: genre === 'veto',
    gardesAutres: true,
  }
}

/** Ce que l'agenda perso porte RÉELLEMENT, réglages appliqués. */
export interface ContenuAgendaPerso {
  journees: ChoixJournees
  placement: Placement
  mesGardes: boolean
  gardesAutres: boolean
  /** Les gardes arrivent par l'agenda du cabinet (non retiré à la personne). */
  gardesViaCabinet: boolean
}

export function contenuEffectif(r: ReglagesAgendaPerso, genre: GenreMembre): ContenuAgendaPerso {
  if (!r.actif) {
    return { journees: 'aucune', placement: 'heures', mesGardes: false, gardesAutres: false, gardesViaCabinet: true }
  }
  if (!r.personnalise) {
    const d = reglagesParDefaut(genre)
    return { journees: d.journees, placement: d.placement, mesGardes: false, gardesAutres: false, gardesViaCabinet: true }
  }
  return {
    // Une secrétaire n'a pas de journées « à elle » : « les miennes » ne
    // donnerait rien, sans que rien ne dise pourquoi.
    journees: genre === 'secretaire' && r.journees === 'miennes' ? 'equipe' : r.journees,
    placement: r.placement,
    mesGardes: genre === 'veto' && r.mesGardes,
    gardesAutres: r.gardesAutres,
    gardesViaCabinet: false,
  }
}

/** Une présence de journée publiée, prête à placer. */
export interface PresenceAPlacer {
  date: string
  vetId: string
  blocId: string
  blocNom: string
  /** 'HH:MM' ou 'HH:MM:SS' */
  debut: string
  fin: string
  ordre: number
}

export interface GardeAPlacer {
  gardeId: string
  ev: EvenementPlanifie
}

export interface EvenementVoulu {
  cle: string
  titre: string
  start: PeriodeEvenementGoogle['start']
  end: PeriodeEvenementGoogle['end']
  colorId?: string
  empreinte: string
}

const FUSEAU = 'Europe/Paris'

/** « 08:00:00 » → « 8h » ; « 08:30 » → « 8h30 ». */
export function heureCourte(h: string): string {
  const [hh, mm] = h.split(':')
  const heures = String(Number(hh))
  return mm && mm !== '00' ? `${heures}h${mm}` : `${heures}h`
}

function secondes(h: string): string {
  return h.length === 5 ? `${h}:00` : h
}

function lendemain(jour: string): string {
  const [a, m, j] = jour.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, j + 1)).toISOString().slice(0, 10)
}

function empreinte(e: Omit<EvenementVoulu, 'empreinte' | 'cle'>): string {
  return JSON.stringify([e.titre, e.start, e.end, e.colorId ?? null])
}

function bornesJournee(p: PresenceAPlacer, placement: Placement): Pick<EvenementVoulu, 'start' | 'end'> {
  if (placement === 'haut') {
    return { start: { date: p.date }, end: { date: lendemain(p.date) } }
  }
  // Un créneau qui finit avant (ou quand) il commence déborde sur le lendemain.
  const finLeLendemain = secondes(p.fin) <= secondes(p.debut)
  return {
    start: { dateTime: `${p.date}T${secondes(p.debut)}`, timeZone: FUSEAU },
    end: { dateTime: `${finLeLendemain ? lendemain(p.date) : p.date}T${secondes(p.fin)}`, timeZone: FUSEAU },
  }
}

/**
 * Le titre d'un créneau. Aux heures, l'agenda montre déjà l'horaire ; en haut
 * du jour il ne le montre pas, donc le titre le porte.
 */
function titreCreneau(p: PresenceAPlacer, placement: Placement): string {
  return placement === 'haut' ? `${p.blocNom} ${heureCourte(p.debut)}–${heureCourte(p.fin)}` : p.blocNom
}

/** La date d'un événement, lue dans sa clé (pour borner les retraits). */
export function jourDeCle(cle: string): string | null {
  // Par segment, jamais par recherche dans la chaîne : un identifiant de garde
  // ne doit pas pouvoir être lu comme une date.
  return cle.split('|').find((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)) ?? null
}

export interface EntreePlanification {
  contenu: ContenuAgendaPerso
  /** Le véto du membre, null pour une secrétaire. */
  vetId: string | null
  presences: readonly PresenceAPlacer[]
  /** Par véto : comment il est nommé dans un titre (initiales départagées). */
  libelles: ReadonlyMap<string, string>
  gardes: readonly GardeAPlacer[]
}

export function planifierAgendaPerso(e: EntreePlanification): EvenementVoulu[] {
  const { contenu } = e
  const sortie: EvenementVoulu[] = []
  const pousser = (cle: string, ev: Omit<EvenementVoulu, 'empreinte' | 'cle'>) =>
    sortie.push({ cle, ...ev, empreinte: empreinte(ev) })

  // ── Journées ──
  if (contenu.journees === 'miennes' && e.vetId) {
    for (const p of e.presences) {
      if (p.vetId !== e.vetId) continue
      pousser(`j|${p.date}|${p.blocId}`, { titre: titreCreneau(p, contenu.placement), ...bornesJournee(p, contenu.placement) })
    }
  }

  if (contenu.journees === 'equipe') {
    // UN événement par créneau, avec les initiales de ceux qui y sont : sept
    // événements empilés sur le même matin seraient illisibles.
    const groupes = new Map<string, PresenceAPlacer[]>()
    for (const p of e.presences) {
      const k = `${p.date}|${p.blocId}`
      groupes.set(k, [...(groupes.get(k) ?? []), p])
    }
    for (const [k, liste] of groupes) {
      const p = liste[0]
      const noms = [...new Set(liste.map((x) => e.libelles.get(x.vetId) ?? '?'))].sort((a, b) => a.localeCompare(b, 'fr'))
      pousser(`je|${k}`, {
        titre: `${titreCreneau(p, contenu.placement)} · ${noms.join(', ')}`,
        ...bornesJournee(p, contenu.placement),
      })
    }
  }

  // ── Gardes ── reprises telles que l'agenda du cabinet les écrit.
  if (!contenu.gardesViaCabinet && (contenu.mesGardes || contenu.gardesAutres)) {
    for (const { gardeId, ev } of e.gardes) {
      const aMoi = !!e.vetId && ev.vetId === e.vetId
      if (aMoi ? !contenu.mesGardes : !contenu.gardesAutres) continue
      pousser(`g|${gardeId}|${ev.jour}|${ev.placeIndex}`, {
        titre: ev.titre,
        start: ev.start,
        end: ev.end,
        ...(ev.colorId ? { colorId: ev.colorId } : {}),
      })
    }
  }

  // Ordre stable : la sortie ne dépend pas de l'ordre de lecture en base.
  return sortie.sort((a, b) => a.cle.localeCompare(b.cle))
}

/** Ce qu'il faut faire pour passer de ce qui est écrit à ce qui est voulu. */
export interface EvenementConnu {
  cle: string
  googleEventId: string
  empreinte: string
}

export type OperationAgenda =
  | { genre: 'creer'; voulu: EvenementVoulu }
  | { genre: 'majer'; voulu: EvenementVoulu; googleEventId: string }
  | { genre: 'retirer'; connu: EvenementConnu }

/**
 * Le rapprochement, en pur. `depuis` borne les retraits : un événement passé
 * qui n'est plus « voulu » parce qu'il est sorti de la fenêtre reste dans
 * l'agenda — c'est de l'histoire, pas une erreur. `toutRetirer` vide tout
 * (fonction coupée).
 */
export function operationsAgenda(
  voulus: readonly EvenementVoulu[],
  connus: readonly EvenementConnu[],
  depuis: string,
  toutRetirer = false,
): OperationAgenda[] {
  const ops: OperationAgenda[] = []
  const parCle = new Map(connus.map((c) => [c.cle, c]))
  const vouluesCles = new Set<string>()

  if (!toutRetirer) {
    for (const v of voulus) {
      vouluesCles.add(v.cle)
      const c = parCle.get(v.cle)
      if (!c) ops.push({ genre: 'creer', voulu: v })
      else if (c.empreinte !== v.empreinte) ops.push({ genre: 'majer', voulu: v, googleEventId: c.googleEventId })
    }
  }
  for (const c of connus) {
    if (vouluesCles.has(c.cle)) continue
    const jour = jourDeCle(c.cle)
    if (!toutRetirer && jour && jour < depuis) continue
    ops.push({ genre: 'retirer', connu: c })
  }
  return ops
}
