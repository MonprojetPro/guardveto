// ============================================================
// GUARDVETO — Règles d'optimisation (R11–R15, R20)
// ============================================================
// Ce module collecte les compteurs par vétérinaire et expose
// des fonctions de mesure d'équité pour chaque dimension.
// ============================================================

import type { PlanningPartiel, VetEngine, AttributionGarde, CalendrierResolu } from '../types'
import { estJourFerie, addDays } from '../utils'
import { estAttribue, vetPourRole } from '../attribution'
import { DEFAULT_ROLE_AVANTAGE_FINANCIER } from '../equity-weights'

// ── Types ────────────────────────────────────────────────

/** Compteurs d'activité d'un vétérinaire sur un planning donné */
export interface CompteurVet {
  vetId: string
  /** R11 — Nombre de week-ends de garde (type 'weekend') */
  weGardes: number
  /**
   * R11b — Nombre de week-ends passés dans le RÔLE À AVANTAGE FINANCIER
   * (réglable — P4 ; défaut = 'premier'). C'est ce compteur qu'on équilibre.
   * (Nom historique `weekendPremier` conservé ; le rôle compté est désormais
   * `roleAvantageFinancier` passé à compterParVet, plus 'premier' en dur.)
   */
  weekendPremier: number
  /** R12 — Nombre de gardes sur jours fériés */
  feriesGardes: number
  /** R13 — Nombre de gardes de semaine en qualité de 1er */
  semainePremier: number
  /** R14 — Nombre de gardes de semaine en qualité de 2nd */
  semaineSecond: number
  /**
   * Nombre de gardes de semaine tenues à partir de la 3ᵉ place (renfort).
   * Reste à 0 pour tout cabinet qui n'a que 2 places le soir — c'est-à-dire
   * l'immense majorité, et la raison pour laquelle l'ajout de cette dimension
   * ne change aucun planning existant : la variance d'un compteur toujours nul
   * est nulle.
   */
  semaineRenfort: number
  /**
   * R15 — Pour les salariés : nombre de WE où ils étaient de garde
   * (= WE "perdus" sans grand week-end libre).
   * Non pertinent pour les associés.
   */
  grandsWePerdus: number
}

// ── Helpers internes ─────────────────────────────────────

function estWEGarde(attr: AttributionGarde, vetId: string): boolean {
  return attr.type === 'weekend' && estAttribue(attr, vetId)
}

/**
 * Une garde compte comme « férié » pour l'équité R12 si son jour est férié —
 * OU, pour un week-end (daté au SAMEDI), si le DIMANCHE couvert est férié
 * (fix audit 2026-07-03, bug n°3 du catalogue blindé : un férié tombant un
 * dimanche n'était JAMAIS compté). Zone-aware : le calendrier du cabinet est
 * utilisé s'il est fourni, sinon repli fériés France en dur (historique).
 */
function estFerieGarde(
  attr: AttributionGarde,
  vetId: string,
  calendrier?: CalendrierResolu,
): boolean {
  if (!estAttribue(attr, vetId)) return false
  if (estJourFerie(attr.date, calendrier)) return true
  if (attr.type === 'weekend') {
    // Week-end daté au samedi → couvre aussi le dimanche (date + 1 jour).
    return estJourFerie(addDays(attr.date, 1), calendrier)
  }
  return false
}

/** Les deux créneaux « de semaine » au sens de l'équité (R13/R14). */
function estCreneauSemaine(attr: AttributionGarde): boolean {
  return attr.type === 'semaine_soir' || attr.type === 'vendredi_soir'
}

function estSemainePremier(attr: AttributionGarde, vetId: string): boolean {
  return estCreneauSemaine(attr) && vetPourRole(attr, 'premier') === vetId
}

function estSemaineSecond(attr: AttributionGarde, vetId: string): boolean {
  return estCreneauSemaine(attr) && vetPourRole(attr, 'second') === vetId
}

/**
 * Une garde de semaine tenue à partir de la TROISIÈME place.
 *
 * Pourquoi cette dimension existe : `estSemainePremier` et `estSemaineSecond`
 * testent des rôles NOMMÉS en dur. Un cabinet qui met 3 ou 4 vétérinaires le
 * soir voyait donc ses places de renfort n'incrémenter aucun compteur : ces
 * gardes-là étaient gratuites pour l'équité, et le moteur n'avait aucune
 * raison de les répartir. Les week-ends et les fériés n'avaient pas ce trou
 * (`estWEGarde` / `estFerieGarde` comptent « qui est de garde », sans regarder
 * la place) — seuls les créneaux de semaine étaient concernés.
 *
 * On compte par POSITION et non par libellé de rôle : un cabinet nomme ses
 * places comme il veut (« renfort », « astreinte »…), et une dimension d'équité
 * qui dépendrait de ces mots ne survivrait pas au premier renommage.
 */
function estSemaineRenfort(attr: AttributionGarde, vetId: string): boolean {
  if (!estCreneauSemaine(attr)) return false
  const place = attr.placements.findIndex((p) => p.vetId === vetId)
  return place >= 2
}

// ── Compteurs ────────────────────────────────────────────

/**
 * compterParVet — Calcule les compteurs de chaque dimension d'équité
 * pour tous les vétérinaires sur le planning donné.
 *
 * @param planning  Planning (partiel ou complet)
 * @param vets      Liste de tous les vétérinaires
 * @param roleAvantageFinancier  Rôle dont on compte les week-ends pour R11b
 *   (réglable — P4). Défaut 'premier' → compteur historique. `null` → on ne
 *   compte rien (aucun rôle avantagé, donc rien à équilibrer).
 * @param calendrier  Calendrier résolu du cabinet (fériés zone-aware). Absent →
 *   repli fériés France en dur (comportement historique).
 */
export function compterParVet(
  planning: PlanningPartiel,
  vets: VetEngine[],
  roleAvantageFinancier: string | null = DEFAULT_ROLE_AVANTAGE_FINANCIER,
  calendrier?: CalendrierResolu,
): CompteurVet[] {
  return vets.map((vet) => {
    const compteur: CompteurVet = {
      vetId: vet.id,
      weGardes: 0,
      weekendPremier: 0,
      feriesGardes: 0,
      semainePremier: 0,
      semaineSecond: 0,
      semaineRenfort: 0,
      grandsWePerdus: 0,
    }

    for (const attr of planning.attributions) {
      if (estWEGarde(attr, vet.id)) {
        compteur.weGardes++
        // R15 : pour les salariés, un WE de garde = grand WE "perdu"
        if (vet.statut === 'salarie') compteur.grandsWePerdus++
      }
      // R11b : occuper le RÔLE À AVANTAGE FINANCIER le week-end (réglable — P4).
      // Défaut 'premier' → compteur historique. null → aucun rôle avantagé.
      if (
        attr.type === 'weekend' &&
        roleAvantageFinancier !== null &&
        vetPourRole(attr, roleAvantageFinancier) === vet.id
      ) {
        compteur.weekendPremier++
      }
      if (estFerieGarde(attr, vet.id, calendrier)) compteur.feriesGardes++
      if (estSemainePremier(attr, vet.id)) compteur.semainePremier++
      if (estSemaineSecond(attr, vet.id)) compteur.semaineSecond++
      if (estSemaineRenfort(attr, vet.id)) compteur.semaineRenfort++
    }

    return compteur
  })
}

// ── Mesures d'équité ─────────────────────────────────────

/**
 * Variance d'une liste de valeurs — mesure de déséquilibre.
 * Plus la variance est haute, plus les vétérinaires sont inégaux.
 */
export function variance(valeurs: number[]): number {
  if (valeurs.length === 0) return 0
  const moy = valeurs.reduce((s, v) => s + v, 0) / valeurs.length
  return valeurs.reduce((s, v) => s + (v - moy) ** 2, 0) / valeurs.length
}

/**
 * Écart max–min d'une liste de valeurs — mesure simple de déséquilibre.
 */
export function ecartMaxMin(valeurs: number[]): number {
  if (valeurs.length === 0) return 0
  return Math.max(...valeurs) - Math.min(...valeurs)
}

/**
 * R11 — Déséquilibre des WE de garde (tous vétos)
 * Retourne la variance du nombre de WE par vétérinaire.
 */
export function desequilibreWE(compteurs: CompteurVet[]): number {
  return variance(compteurs.map((c) => c.weGardes))
}

/**
 * R11b — Déséquilibre du rôle 1er le week-end (avantage financier).
 * On cherche à ce que chacun ait, autant que possible, le même nombre de
 * week-ends en tant que 1er (et pas seulement le même nombre total de WE).
 */
export function desequilibreWeekendPremier(compteurs: CompteurVet[]): number {
  return variance(compteurs.map((c) => c.weekendPremier))
}

/**
 * R12 — Déséquilibre des gardes sur fériés
 */
export function desequilibreFeries(compteurs: CompteurVet[]): number {
  return variance(compteurs.map((c) => c.feriesGardes))
}

/**
 * R13 — Déséquilibre des gardes de semaine en 1er
 */
export function desequilibreSemainePremier(compteurs: CompteurVet[]): number {
  return variance(compteurs.map((c) => c.semainePremier))
}

/**
 * R14 — Déséquilibre des gardes de semaine en 2nd
 */
export function desequilibreSemaineSecond(compteurs: CompteurVet[]): number {
  return variance(compteurs.map((c) => c.semaineSecond))
}

/**
 * Déséquilibre des gardes de semaine tenues EN RENFORT (3ᵉ place et au-delà).
 * Vaut 0 pour tout cabinet à deux places le soir : le compteur y est nul chez
 * tout le monde, donc sa variance aussi — c'est ce qui rend cette dimension
 * inoffensive pour les plannings existants.
 */
export function desequilibreSemaineRenfort(compteurs: CompteurVet[]): number {
  return variance(compteurs.map((c) => c.semaineRenfort))
}

/**
 * R15 — Déséquilibre des grands WE perdus (salariés uniquement)
 */
export function desequilibreGrandsWeSalaries(compteurs: CompteurVet[], vets: VetEngine[]): number {
  const salaries = compteurs.filter((c) => {
    const vet = vets.find((v) => v.id === c.vetId)
    return vet?.statut === 'salarie'
  })
  if (salaries.length === 0) return 0
  return variance(salaries.map((c) => c.grandsWePerdus))
}
