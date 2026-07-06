// ============================================================
// GUARDVETO — Appariement des occurrences de créneaux liés (RG tranche 2)
// ============================================================
// LE point délicat des relations génériques : quand une relation dit
// « créneau A lié au créneau B », le moteur doit savoir QUELLE occurrence de A
// va avec QUELLE occurrence de B. Historiquement c'était une formule magique
// (`vendrediDeSemaine` : le vendredi de la semaine du samedi).
//
// RÈGLE D'APPARIEMENT (générique) : deux occurrences sont appariées si elles
// sont ADJACENTES — aucune autre occurrence de l'un OU l'autre créneau entre
// les deux — et distantes d'au plus FENETRE_APPARIEMENT_JOURS jours.
// Concrètement : on balaie jour par jour depuis l'occurrence connue ; la
// PREMIÈRE occurrence rencontrée (source ou cible) décide — si c'est le
// créneau cherché on apparie, sinon l'appariement revient à cette occurrence
// plus proche (pas à nous). Rien dans la fenêtre → pas de contrainte.
//
// BYTE-IDENTIQUE au couple historique (vendredi_soir → weekend hebdomadaires) :
// depuis un samedi, la première occurrence en arrière est TOUJOURS le vendredi
// J-1 (= vendrediDeSemaine) ; depuis un vendredi, la première en avant est le
// samedi J+1 (= samediDeSemaine). Un vendredi non encore planifié → rien dans
// la fenêtre utile → ok, exactement comme `getAttribution(...) === undefined`.
//
// Le balayage lit le PLANNING PARTIEL (les attributions posées), pas le
// catalogue : une occurrence « existe » si son slot a été généré — c'est la
// même source de vérité que l'ancien `getAttribution`.
//
// ⚠️ Le validateur indépendant ne DOIT PAS importer ce module : il ré-implémente
// son propre appariement depuis la même donnée (indépendance des deux gardiens).
// ============================================================

import type { PlanningPartiel, AttributionGarde } from './types'
import type { RelationStructure, GenreRelationStructure } from './structure-config'
import type { CreneauModele, RelationCreneau } from './creneau-modele'
import { addDays } from './utils'

/** Distance maximale (en jours) entre deux occurrences appariées. */
export const FENETRE_APPARIEMENT_JOURS = 7

function attributionA(
  planning: PlanningPartiel,
  date: string,
  code: string,
): AttributionGarde | undefined {
  return planning.attributions.find((a) => a.date === date && a.type === code)
}

/**
 * Occurrence du créneau SOURCE appariée à l'occurrence cible du `dateCible`.
 * Balaie le MÊME JOUR (deux gardes/jour — matin+soir, vision doc 09) puis vers
 * l'ARRIÈRE (J-1 … J-fenêtre) ; la première occurrence rencontrée décide
 * (source → appariée ; cible → une occurrence cible plus proche capture la
 * source, pas nous — jamais testé à k=0 : ce serait l'occurrence elle-même).
 * `undefined` = pas de contrainte. Byte-identique au couple historique :
 * vendredi_soir et weekend ne partagent jamais un jour → k=0 sans effet.
 */
export function apparierSourcePourCible(
  planning: PlanningPartiel,
  rel: RelationStructure,
  dateCible: string,
): AttributionGarde | undefined {
  for (let k = 0; k <= FENETRE_APPARIEMENT_JOURS; k++) {
    const d = addDays(dateCible, -k)
    const source = attributionA(planning, d, rel.sourceCode)
    if (source) return source
    if (k > 0 && attributionA(planning, d, rel.cibleCode)) return undefined
  }
  return undefined
}

/**
 * Occurrence du créneau CIBLE appariée à l'occurrence source du `dateSource`.
 * Balaie même jour puis vers l'AVANT (J+1 … J+fenêtre), symétrique de
 * apparierSourcePourCible.
 */
export function apparierCiblePourSource(
  planning: PlanningPartiel,
  rel: RelationStructure,
  dateSource: string,
): AttributionGarde | undefined {
  for (let k = 0; k <= FENETRE_APPARIEMENT_JOURS; k++) {
    const d = addDays(dateSource, k)
    const cible = attributionA(planning, d, rel.cibleCode)
    if (cible) return cible
    if (k > 0 && attributionA(planning, d, rel.sourceCode)) return undefined
  }
  return undefined
}

/**
 * Résout les relations DONNÉE (ids de creneau_modele) en relations MOTEUR
 * (codes de slot). Filtre : inactives, genres non consommés (repos_apres —
 * pas encore implémenté côté moteur), créneaux sans code (jamais planifiés)
 * ou introuvables, auto-liens. Pur, partagé loader + replay.
 */
export function resoudreRelationsStructure(
  relations: RelationCreneau[],
  creneaux: CreneauModele[],
): RelationStructure[] {
  const codeParId = new Map(creneaux.map((c) => [c.id, c.code]))
  const resolues: RelationStructure[] = []
  for (const r of relations) {
    if (!r.actif) continue
    if (r.genre !== 'meme_binome' && r.genre !== 'inversion_role') continue
    const sourceCode = codeParId.get(r.sourceId)
    const cibleCode = codeParId.get(r.cibleId)
    if (!sourceCode || !cibleCode || sourceCode === cibleCode) continue
    resolues.push({ sourceCode, cibleCode, genre: r.genre as GenreRelationStructure })
  }
  return resolues
}
