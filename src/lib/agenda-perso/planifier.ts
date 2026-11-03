// ============================================================
// GUARDVETO — B-173 / B-181 : ce que l'agenda PERSONNEL d'un membre contient
// ============================================================
// Fonction pure — ni base, ni réseau. Elle décide ; le rapprochement
// (`rapprocher.ts`) ne fait qu'exécuter sa sortie. C'est sur elle que portent
// les tests.
//
// B-181 (MiKL, 03/11, maquette `docs/maquettes/B-181-mon-agenda.html`) :
// chaque personne a UN agenda GuardVeto, et choisit ce qu'il contient.
//   · « Mon planning » (défaut d'un véto) : SES gardes, avec la personne de
//     garde avec elle (« Garde 1er — avec Fanny »), et SES journées — aux
//     heures ou en haut du jour.
//   · « Tout le cabinet » (seul choix du secrétariat) : les gardes de toute
//     l'équipe, une par place, les places à pourvoir comprises ; et les
//     journées de l'équipe, en UN bandeau par jour (« Au cabinet : Jean,
//     Manon (matin) ») ou aux heures, dans les cases.
// Toujours un seul agenda : jamais de doublon, donc plus de partage de
// l'agenda commun du cabinet (retiré dès que l'agenda perso tourne).
//
// Avant le 03/11, le mode par défaut ne portait QUE les journées : les gardes
// devaient arriver par l'agenda du cabinet, que personne n'avait — l'agenda
// de Manon (26 gardes, aucune journée) restait vide.
// ============================================================

import type { EvenementPlanifie, PeriodeEvenementGoogle } from '@/lib/google-calendar'

/** Colonnes historiques de `agendas_perso` (B-173), toujours en base. */
export type ChoixJournees = 'miennes' | 'equipe' | 'aucune'
export type Placement = 'heures' | 'haut'
export type GenreMembre = 'veto' | 'secretaire'
/** B-181 — le seul choix de l'écran. */
export type VueAgenda = 'mon_planning' | 'cabinet'

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
 * ni journée ni garde à elle ; elle l'allume si elle le souhaite, et reçoit
 * alors tout le cabinet, journées en bandeau.
 */
export function reglagesParDefaut(genre: GenreMembre): ReglagesAgendaPerso {
  return {
    actif: genre === 'veto',
    personnalise: false,
    journees: genre === 'veto' ? 'miennes' : 'equipe',
    placement: genre === 'veto' ? 'heures' : 'haut',
    mesGardes: genre === 'veto',
    gardesAutres: genre !== 'veto',
  }
}

/** Le placement proposé d'office quand on passe sur une vue. */
export function placementParDefaut(vue: VueAgenda): Placement {
  return vue === 'cabinet' ? 'haut' : 'heures'
}

/**
 * La vue que portent les colonnes. « Toute l'équipe » en journées = « Tout le
 * cabinet » ; tout le reste (les miennes, aucune, lignes d'avant B-181) =
 * « Mon planning ». Le secrétariat n'a que « Tout le cabinet ».
 */
export function vueDe(r: Pick<ReglagesAgendaPerso, 'journees'>, genre: GenreMembre): VueAgenda {
  if (genre === 'secretaire') return 'cabinet'
  return r.journees === 'equipe' ? 'cabinet' : 'mon_planning'
}

/** Les colonnes à écrire pour un choix fait à l'écran. */
export function reglagesDuChoix(vue: VueAgenda, placement: Placement, genre: GenreMembre): Omit<ReglagesAgendaPerso, 'actif'> {
  const v = genre === 'secretaire' ? 'cabinet' : vue
  return {
    personnalise: true,
    journees: v === 'cabinet' ? 'equipe' : 'miennes',
    placement,
    mesGardes: genre === 'veto',
    gardesAutres: v === 'cabinet',
  }
}

/** Ce que l'agenda perso porte RÉELLEMENT, réglages appliqués. */
export interface ContenuAgendaPerso {
  actif: boolean
  vue: VueAgenda
  placement: Placement
}

export function contenuEffectif(r: ReglagesAgendaPerso, genre: GenreMembre): ContenuAgendaPerso {
  return { actif: r.actif, vue: vueDe(r, genre), placement: r.placement }
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

function journeeEntiere(date: string): Pick<EvenementVoulu, 'start' | 'end'> {
  return { start: { date }, end: { date: lendemain(date) } }
}

function bornesJournee(p: PresenceAPlacer, placement: Placement): Pick<EvenementVoulu, 'start' | 'end'> {
  if (placement === 'haut') return journeeEntiere(p.date)
  // Un créneau qui finit avant (ou quand) il commence déborde sur le lendemain.
  const finLeLendemain = secondes(p.fin) <= secondes(p.debut)
  return {
    start: { dateTime: `${p.date}T${secondes(p.debut)}`, timeZone: FUSEAU },
    end: { dateTime: `${finLeLendemain ? lendemain(p.date) : p.date}T${secondes(p.fin)}`, timeZone: FUSEAU },
  }
}

/**
 * Le nom d'un créneau dans un titre. Aux heures, l'agenda montre déjà
 * l'horaire ; en haut du jour il ne le montre pas, donc le titre le porte.
 */
function nomCreneau(p: PresenceAPlacer, placement: Placement): string {
  return placement === 'haut' ? `${p.blocNom} ${heureCourte(p.debut)}–${heureCourte(p.fin)}` : p.blocNom
}

/** « Fanny », « Fanny et Jean », « Anne-So, Fanny et Jean ». */
export function enumerer(noms: readonly string[]): string {
  if (noms.length <= 1) return noms[0] ?? ''
  return `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`
}

const triFr = (a: string, b: string) => a.localeCompare(b, 'fr')

/**
 * B-181 — « avec Fanny », « Au cabinet : Jean, Manon » : les titres nomment
 * les gens par leur prénom. Deux prénoms identiques au cabinet se départagent
 * par l'initiale du nom, sinon le titre ne désignerait plus personne.
 */
export function prenomsDepartages(vetos: readonly { id: string; prenom: string | null; nom: string | null }[]): Map<string, string> {
  const prenom = (v: { prenom: string | null; nom: string | null }) => (v.prenom ?? '').trim() || (v.nom ?? '').trim() || '?'
  const compte = new Map<string, number>()
  for (const v of vetos) compte.set(prenom(v).toLocaleLowerCase('fr'), (compte.get(prenom(v).toLocaleLowerCase('fr')) ?? 0) + 1)
  return new Map(vetos.map((v) => {
    const p = prenom(v)
    const initiale = (v.nom ?? '').trim().charAt(0).toLocaleUpperCase('fr')
    return [v.id, (compte.get(p.toLocaleLowerCase('fr')) ?? 0) > 1 && initiale ? `${p} ${initiale}.` : p]
  }))
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
  /** Par véto : son prénom, départagé s'il est porté deux fois au cabinet. */
  noms: ReadonlyMap<string, string>
  gardes: readonly GardeAPlacer[]
}

/** « Garde 1er » : les morceaux posés par la planification, sinon le titre du cabinet. */
function teteGarde(ev: EvenementPlanifie): string {
  return ev.base && ev.role ? `${ev.base} ${ev.role}` : ev.titre
}

/**
 * Le bandeau quotidien de « Tout le cabinet » : « Au cabinet : Anne-So
 * (matin), Jean, Victor (après-midi) ». Un prénom seul = toute la journée,
 * c'est-à-dire du premier au dernier créneau que ce jour de la semaine
 * connaît au cabinet (le samedi matin seul vaut journée entière le samedi).
 */
function bandeaux(presences: readonly PresenceAPlacer[], noms: ReadonlyMap<string, string>): Map<string, string> {
  const jourSemaine = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()
  const amplitude = new Map<number, { debut: string; fin: string }>()
  for (const p of presences) {
    const js = jourSemaine(p.date)
    const a = amplitude.get(js)
    const d = secondes(p.debut)
    const f = secondes(p.fin)
    amplitude.set(js, { debut: !a || d < a.debut ? d : a.debut, fin: !a || f > a.fin ? f : a.fin })
  }

  const parJour = new Map<string, Map<string, PresenceAPlacer[]>>()
  for (const p of presences) {
    const jour = parJour.get(p.date) ?? new Map<string, PresenceAPlacer[]>()
    jour.set(p.vetId, [...(jour.get(p.vetId) ?? []), p])
    parJour.set(p.date, jour)
  }

  const sortie = new Map<string, string>()
  for (const [date, parVet] of parJour) {
    const amp = amplitude.get(jourSemaine(date))!
    const morceaux = [...parVet].map(([vetId, liste]) => {
      const nom = noms.get(vetId) ?? '?'
      const debut = liste.reduce((m, x) => (secondes(x.debut) < m ? secondes(x.debut) : m), '99')
      const fin = liste.reduce((m, x) => (secondes(x.fin) > m ? secondes(x.fin) : m), '')
      if (debut <= amp.debut && fin >= amp.fin) return nom
      const creneaux = [...new Map(liste.map((x) => [x.blocId, x])).values()]
        .sort((a, b) => a.ordre - b.ordre)
        .map((x) => x.blocNom.toLocaleLowerCase('fr'))
      return `${nom} (${creneaux.join(' et ')})`
    })
    sortie.set(date, `Au cabinet : ${morceaux.sort(triFr).join(', ')}`)
  }
  return sortie
}

export function planifierAgendaPerso(e: EntreePlanification): EvenementVoulu[] {
  const { contenu } = e
  if (!contenu.actif) return []
  const sortie: EvenementVoulu[] = []
  const pousser = (cle: string, ev: Omit<EvenementVoulu, 'empreinte' | 'cle'>) =>
    sortie.push({ cle, ...ev, empreinte: empreinte(ev) })
  const nom = (id: string | undefined) => (id && e.noms.get(id)) || '?'

  // ── Journées ──
  if (contenu.vue === 'mon_planning' && e.vetId) {
    for (const p of e.presences) {
      if (p.vetId !== e.vetId) continue
      pousser(`j|${p.date}|${p.blocId}`, { titre: `Au cabinet · ${nomCreneau(p, contenu.placement)}`, ...bornesJournee(p, contenu.placement) })
    }
  }

  if (contenu.vue === 'cabinet') {
    if (contenu.placement === 'haut') {
      // UN bandeau par jour : une vingtaine de créneaux par semaine noieraient
      // l'agenda (« éviter le surchargement visuel », MiKL 03/11).
      for (const [date, titre] of bandeaux(e.presences, e.noms)) {
        pousser(`jb|${date}`, { titre, ...journeeEntiere(date) })
      }
    } else {
      // Aux heures : UN événement par créneau, avec ceux qui y sont.
      const groupes = new Map<string, PresenceAPlacer[]>()
      for (const p of e.presences) {
        const k = `${p.date}|${p.blocId}`
        groupes.set(k, [...(groupes.get(k) ?? []), p])
      }
      for (const [k, liste] of groupes) {
        const p = liste[0]
        const presents = [...new Set(liste.map((x) => nom(x.vetId)))].sort(triFr)
        pousser(`je|${k}`, { titre: `Au cabinet · ${p.blocNom} : ${presents.join(', ')}`, ...bornesJournee(p, 'heures') })
      }
    }
  }

  // ── Gardes ── une par place, aux bornes que l'agenda du cabinet leur donne.
  const parCreneau = new Map<string, EvenementPlanifie[]>()
  for (const { gardeId, ev } of e.gardes) {
    const k = `${gardeId}|${ev.jour}`
    parCreneau.set(k, [...(parCreneau.get(k) ?? []), ev])
  }

  for (const { gardeId, ev } of e.gardes) {
    let titre: string
    if (contenu.vue === 'mon_planning') {
      if (!e.vetId || ev.vide || ev.vetId !== e.vetId) continue
      const memeCreneau = parCreneau.get(`${gardeId}|${ev.jour}`) ?? []
      const autres = memeCreneau.filter((x) => x !== ev && !x.vide && x.vetId).map((x) => nom(x.vetId)).sort(triFr)
      const aPourvoir = memeCreneau.some((x) => x.vide)
      titre = autres.length && aPourvoir
        ? `${teteGarde(ev)} — avec ${enumerer(autres)} et une place à pourvoir`
        : autres.length
          ? `${teteGarde(ev)} — avec ${enumerer(autres)}`
          : aPourvoir
            ? `${teteGarde(ev)} — avec : place à pourvoir`
            : teteGarde(ev)
    } else {
      titre = `${teteGarde(ev)} — ${ev.vide ? 'à pourvoir' : nom(ev.vetId)}`
    }
    pousser(`g|${gardeId}|${ev.jour}|${ev.placeIndex}`, {
      titre,
      start: ev.start,
      end: ev.end,
      ...(ev.colorId && !ev.vide ? { colorId: ev.colorId } : {}),
    })
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
