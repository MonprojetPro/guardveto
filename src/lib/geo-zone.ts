// ============================================================
// GUARDVETO — Dérivation zone scolaire + région fériés depuis l'adresse
// ============================================================
// #10d (dé-câblage des partages en dur) : aujourd'hui la zone scolaire (A/B/C)
// et la région des fériés (metropole / alsace-moselle / DOM) sont saisies à la
// main sur `cabinets` (colonnes zone_scolaire + region_feries, lues par le
// loader et get_calendrier). Ce module en DÉDUIT la valeur à partir du code
// postal du cabinet — pour que l'onboarding d'un cabinet n°2 n'oblige plus à
// deviner sa zone.
//
// CHOIX TECHNIQUE — table de correspondance département → zone (PAS de
// géocodage). Justification :
//   • Déterministe et hors-ligne : aucun appel réseau, aucune clé API tierce,
//     aucun quota, aucune latence — donc aucun point de panne en production.
//   • La zone scolaire est définie par l'ACADÉMIE, elle-même fonction du
//     DÉPARTEMENT : une correspondance département→zone est donc EXACTE, là où
//     un géocodage introduirait une dépendance et une marge d'erreur pour zéro
//     gain de précision.
//   • Le département se lit directement dans le code postal (2 premiers
//     chiffres, cas Corse et DOM gérés) — pas besoin d'adresse complète.
//
// Le résultat n'ÉCRASE la config existante que lorsqu'il est certain (zone
// connue) : Corse et DOM renvoient `zone: null` → on conserve alors la valeur
// déjà en base (fallback), on ne dégrade jamais un calendrier correct.
//
// Source unique de vérité : la RPC d'écriture (configurer_adresse_cabinet)
// reçoit la zone/région déjà calculées ICI — le mapping n'est pas dupliqué en
// SQL, il vit uniquement dans ce fichier testé.
// ============================================================

export type ZoneScolaire = 'A' | 'B' | 'C'

/** Régions fériés supportées (miroir du CHECK de jours_feries.region). */
export type RegionFeries =
  | 'metropole'
  | 'alsace-moselle'
  | 'guadeloupe'
  | 'martinique'
  | 'guyane'
  | 'reunion'
  | 'mayotte'
  | 'polynesie'

export interface ZoneRegionResolue {
  /** Département déduit (ex. '03', '2A', '971') ou null si code postal invalide. */
  departement: string | null
  /** Zone scolaire A/B/C, ou null si indéterminée (Corse, DOM, CP invalide). */
  zone: ZoneScolaire | null
  /** Région des fériés (défaut 'metropole'). */
  region: RegionFeries
}

// ── Table département → zone scolaire (académies, rentrée 2023+) ──────────────
// Zones officielles du ministère de l'Éducation nationale. Une académie = une
// zone ; on déplie par département pour une lecture O(1) et sans ambiguïté.

const ZONE_A = new Set([
  // Besançon
  '25', '39', '70', '90',
  // Bordeaux
  '24', '33', '40', '47', '64',
  // Clermont-Ferrand (dont Allier = 03 → cabinet pilote)
  '03', '15', '43', '63',
  // Dijon
  '21', '58', '71', '89',
  // Grenoble
  '07', '26', '38', '73', '74',
  // Limoges
  '19', '23', '87',
  // Lyon
  '01', '42', '69',
  // Poitiers
  '16', '17', '79', '86',
])

const ZONE_B = new Set([
  // Aix-Marseille
  '04', '05', '13', '84',
  // Amiens
  '02', '60', '80',
  // Lille
  '59', '62',
  // Nancy-Metz
  '54', '55', '57', '88',
  // Nantes
  '44', '49', '53', '72', '85',
  // Nice
  '06', '83',
  // Normandie (Caen + Rouen)
  '14', '27', '50', '61', '76',
  // Orléans-Tours
  '18', '28', '36', '37', '41', '45',
  // Reims
  '08', '10', '51', '52',
  // Rennes
  '22', '29', '35', '56',
  // Strasbourg
  '67', '68',
])

const ZONE_C = new Set([
  // Créteil
  '77', '93', '94',
  // Montpellier
  '11', '30', '34', '48', '66',
  // Paris
  '75',
  // Toulouse
  '09', '12', '31', '32', '46', '65', '81', '82',
  // Versailles
  '78', '91', '92', '95',
])

// ── Table département → région fériés (spécificités locales) ──────────────────

const REGION_PAR_DEPARTEMENT: Record<string, RegionFeries> = {
  // Alsace-Moselle : deux fériés supplémentaires (Vendredi saint + 26 déc.)
  '57': 'alsace-moselle',
  '67': 'alsace-moselle',
  '68': 'alsace-moselle',
  // DOM (fériés locaux : abolition de l'esclavage, etc.)
  '971': 'guadeloupe',
  '972': 'martinique',
  '973': 'guyane',
  '974': 'reunion',
  '976': 'mayotte',
  '987': 'polynesie',
}

/**
 * Déduit le code département depuis un code postal français.
 * Gère la Corse (2A/2B) et les DOM (3 chiffres, 97x/98x).
 * @returns Code département ('03', '2A', '971'…) ou null si le CP est invalide.
 */
export function departementDepuisCodePostal(codePostal: string): string | null {
  const clean = (codePostal ?? '').replace(/\s/g, '')
  if (!/^\d{5}$/.test(clean)) return null

  const prefixe2 = clean.slice(0, 2)

  // Corse : 20xxx → 2A (Corse-du-Sud, < 20200) ou 2B (Haute-Corse).
  // Découpe usuelle par tranche de code postal (approximation admise : la
  // Corse n'a de toute façon pas de zone A/B/C standard, cf. plus bas).
  if (prefixe2 === '20') {
    return Number(clean) < 20200 ? '2A' : '2B'
  }

  // DOM/COM : codes à 3 chiffres (971…, 984, 986, 987, 988).
  if (prefixe2 === '97' || prefixe2 === '98') {
    return clean.slice(0, 3)
  }

  return prefixe2
}

/**
 * Déduit zone scolaire + région fériés depuis un département.
 * Corse et DOM → `zone: null` (pas de zone A/B/C standard) : l'appelant
 * conserve alors la zone déjà configurée (aucune dégradation).
 */
export function zoneEtRegionDepuisDepartement(departement: string | null): {
  zone: ZoneScolaire | null
  region: RegionFeries
} {
  const region = (departement && REGION_PAR_DEPARTEMENT[departement]) || 'metropole'

  if (!departement) return { zone: null, region }
  if (ZONE_A.has(departement)) return { zone: 'A', region }
  if (ZONE_B.has(departement)) return { zone: 'B', region }
  if (ZONE_C.has(departement)) return { zone: 'C', region }

  // Corse (2A/2B), DOM/COM, ou département inconnu : zone indéterminée.
  return { zone: null, region }
}

/**
 * Déduit zone scolaire + région fériés directement depuis un code postal.
 * Point d'entrée unique côté serveur (server action d'onboarding cabinet).
 */
export function zoneEtRegionDepuisCodePostal(codePostal: string): ZoneRegionResolue {
  const departement = departementDepuisCodePostal(codePostal)
  const { zone, region } = zoneEtRegionDepuisDepartement(departement)
  return { departement, zone, region }
}
