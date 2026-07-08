// ============================================================
// GUARDVETO — Historique des fêtes de fin d'année (backlog n°14)
// ============================================================
// Équité INTER-ANNUELLE des fêtes (§6/§7 doc métier) : « qui a fait Noël
// l'an dernier ne le refait pas cette année ». Porté par la table
// `historique_fete` (alimentée à la PUBLICATION d'une période couvrant une
// fête) et consommé par le scoring en PÉNALITÉ SOUPLE — jamais une violation
// dure : le validateur indépendant ne connaît PAS cette règle (par design).
//
// Module PUR (aucun Supabase, aucun React) : détection des fêtes, forme
// normalisée de l'historique, et pénalité. La donnée est NORMALISÉE À LA
// SOURCE (parade anti-cécité params) : le loader résout les lignes DB en un
// `HistoriqueFetesResolu` (Set de clés canoniques) que TOUS les consommateurs
// (greedy, LNS, scoreur global) interrogent à l'identique via
// `penaliteFeteHistorique` — aucun consommateur ne re-parse la donnée brute.
//
// BYTE-IDENTIQUE PAR CONSTRUCTION : historique absent (`undefined`) ou VIDE
// ⇒ pénalité 0 partout ⇒ planning strictement inchangé (testé explicitement
// dans __tests__/historique-fete.test.ts).
// ============================================================

import { addDays } from './utils'

// ── Fêtes reconnues ──────────────────────────────────────────
// Le doc métier (§6) ne liste que deux fêtes : Noël (24-25 déc) et
// Nouvel An (31 déc - 1er janv) — mêmes 4 dates que `estFeteFinAnnee`.

export type CodeFete = 'noel' | 'nouvel_an'

/**
 * Une INSTANCE de fête = (fête, année de saison). Convention d'année :
 * l'année du mois de DÉCEMBRE — le 01/01/2027 appartient au Nouvel An 2026
 * (même réveillon que le 31/12/2026). Ainsi « l'an dernier » = annee - 1,
 * sans ambiguïté au passage d'année.
 */
export interface InstanceFete {
  fete: CodeFete
  annee: number
}

/** Fête (et année de saison) portée par une DATE calendaire, ou null. */
export function feteDeDate(date: string): InstanceFete | null {
  const mmjj = date.substring(5) // 'MM-DD'
  const annee = Number(date.substring(0, 4))
  if (mmjj === '12-24' || mmjj === '12-25') return { fete: 'noel', annee }
  if (mmjj === '12-31') return { fete: 'nouvel_an', annee }
  if (mmjj === '01-01') return { fete: 'nouvel_an', annee: annee - 1 }
  return null
}

/** Dédoublonne une liste d'instances (un slot couvrant 24 ET 25 = UNE fois Noël). */
function dedupliquerInstances(instances: InstanceFete[]): InstanceFete[] {
  const vues = new Set<string>()
  const out: InstanceFete[] = []
  for (const i of instances) {
    const cle = `${i.fete}|${i.annee}`
    if (vues.has(cle)) continue
    vues.add(cle)
    out.push(i)
  }
  return out
}

/**
 * Instances de fête couvertes par un SLOT MOTEUR (date, type).
 * Sémantique moteur : `weekend` (daté du samedi) couvre samedi + dimanche ;
 * tout autre code (semaine_soir, vendredi_soir, sur-mesure) couvre sa date.
 * (Le vendredi soir est un slot EXPLICITE côté moteur — pas dérivé.)
 */
export function fetesCouvertesParSlot(date: string, type: string): InstanceFete[] {
  const dates = type === 'weekend' ? [date, addDays(date, 1)] : [date]
  return dedupliquerInstances(
    dates.map(feteDeDate).filter((f): f is InstanceFete => f !== null),
  )
}

/**
 * Instances de fête couvertes par une GARDE V1 (table `gardes`).
 * Sémantique V1 ≠ moteur : le week-end (daté du samedi) emporte AUSSI le
 * vendredi soir (pas de ligne V1 vendredi — l'équipe du WE le tient, cf.
 * syncAttributions/joursImpactesGarde) → couvre [vendredi, samedi, dimanche].
 */
export function fetesCouvertesParGardeV1(date: string, type: string): InstanceFete[] {
  const dates =
    type === 'weekend' ? [addDays(date, -1), date, addDays(date, 1)] : [date]
  return dedupliquerInstances(
    dates.map(feteDeDate).filter((f): f is InstanceFete => f !== null),
  )
}

/**
 * Années de saison des fêtes couvertes par la fenêtre [dateDebut, dateFin]
 * (bornes incluses). Sert au loader pour ne requêter l'historique QUE quand
 * la période couvre réellement une fête (et cibler les bonnes années).
 */
export function anneesFetesCouvertes(dateDebut: string, dateFin: string): number[] {
  const yDebut = Number(dateDebut.substring(0, 4))
  const yFin = Number(dateFin.substring(0, 4))
  const annees = new Set<number>()
  for (let y = yDebut - 1; y <= yFin; y++) {
    const datesInstance = [
      `${y}-12-24`, `${y}-12-25`, `${y}-12-31`, `${y + 1}-01-01`,
    ]
    if (datesInstance.some((d) => d >= dateDebut && d <= dateFin)) annees.add(y)
  }
  return [...annees].sort((a, b) => a - b)
}

// ── Forme normalisée (résolue à la source par le loader) ─────

/** Ligne minimale de `historique_fete` (côté lecture). */
export interface HistoriqueFeteRow {
  veterinaire_id: string
  fete: string
  annee: number
}

/**
 * Historique RÉSOLU consommable par le scoring : Set de clés canoniques
 * `vetId|fete|annee`. Une seule représentation, un seul constructeur
 * (`resoudreHistoriqueFetes`), un seul lecteur (`penaliteFeteHistorique`) —
 * aucun consommateur ne peut lire la donnée « à moitié ».
 */
export type HistoriqueFetesResolu = ReadonlySet<string>

/** Clé canonique d'une entrée d'historique (producteur ET consommateur). */
export function cleHistoriqueFete(vetId: string, fete: CodeFete, annee: number): string {
  return `${vetId}|${fete}|${annee}`
}

/**
 * Clé canonique d'une INSTANCE de fête (fête, année), SANS véto — sert au XOR
 * « pas les deux fêtes » (brique exclusion_dates, #15a) à identifier « la même
 * année » : une garde couvrant Noël(2026) et une couvrant le Nouvel An(2026)
 * sont exclusives ; Noël(2026) et Nouvel An(2027) ne le sont PAS.
 */
export function cleInstanceFete(inst: InstanceFete): string {
  return `${inst.fete}|${inst.annee}`
}

/** Normalise les lignes DB en historique résolu (lignes inconnues écartées). */
export function resoudreHistoriqueFetes(rows: HistoriqueFeteRow[]): HistoriqueFetesResolu {
  const set = new Set<string>()
  for (const r of rows) {
    if (r.fete !== 'noel' && r.fete !== 'nouvel_an') continue
    if (!r.veterinaire_id || !Number.isInteger(r.annee)) continue
    set.add(cleHistoriqueFete(r.veterinaire_id, r.fete as CodeFete, r.annee))
  }
  return set
}

// ── Pénalité souple ──────────────────────────────────────────

/**
 * Réglage de la pénalité « fête déjà tenue l'an dernier » :
 *   • etage 4 (🟡 EVITEE_AU_MAX) — même étage que R10b (fête fin d'année).
 *     Souple par NATURE (jamais dure : le validateur indépendant l'ignore).
 *   • poids 40 — intra-étage : entre R10c (45, WE avant vacances) et
 *     R10b (30, un soir de réveillon). Plus fort que R10b car le doc métier
 *     en fait une promesse explicite (« qui a fait Noël l'an dernier ne le
 *     refait pas cette année »), moins fort que la protection des départs
 *     en vacances. Poids documenté, non exposé (leçon UX équité : pas de
 *     chiffres abstraits).
 */
export const PENALITE_FETE_HISTORIQUE = { etage: 4, poids: 40 } as const

/**
 * penaliteFeteHistorique — pénalité souple si le véto candidat a déjà tenu,
 * L'AN DERNIER (annee - 1), une fête que ce slot couvre cette année.
 * Historique absent ou vide → 0 (byte-identique par construction).
 */
export function penaliteFeteHistorique(
  slot: { date: string; type: string },
  vetId: string,
  historique?: HistoriqueFetesResolu,
): number {
  if (!historique || historique.size === 0) return 0
  let n = 0
  for (const inst of fetesCouvertesParSlot(slot.date, slot.type)) {
    if (historique.has(cleHistoriqueFete(vetId, inst.fete, inst.annee - 1))) n++
  }
  return n * PENALITE_FETE_HISTORIQUE.poids
}
