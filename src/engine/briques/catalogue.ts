// ============================================================
// GUARDVETO — Catalogue de briques (source unique) — P1A-005
// ============================================================
// Archi §4.2 : le catalogue est la SOURCE UNIQUE lue par le moteur,
// l'IA (P3) et l'interface (P1A-006/007). Chaque brique expose :
//   • `schemaParams` — miroir des paramètres attendus (le code devient la
//      source de vérité ; le `schema_json` du seed P1A-001 était un MIROIR
//      PROVISOIRE — cf. note de la migration : re-synchro côté base ensuite).
//   • `rendreLangageNaturel(params)` — APERÇU + TRACE en français lisible
//      (« ne fait pas de garde le mercredi, sauf vacances scolaires »).
//   • `widget` — référence du composant React de saisie (consommé en P1A-006/007).
//
// ⚠️ AUCUN évaluateur ici (P1A-005 = consolidation/exposition). Le calcul
//    reste dans hard-constraints.ts / soft-constraints.ts — ce module ne
//    touche PAS au moteur (zéro impact planning). Les briques de composition
//    d'équipe restent volontairement sans évaluateur (dé-goldplating G1).
// ============================================================

import type { AxesBrique } from './types'

/** Familles d'opérateurs (miroir du CHECK `famille` de briques_regles). */
export type Famille =
  | 'interdire'
  | 'forcer'
  | 'limiter'
  | 'equilibrer'
  | 'couverture'
  | 'sequence'

/** Les 4 axes de ciblage (clés de AxesBrique). */
export type AxeNom = keyof AxesBrique // 'qui' | 'quand' | 'quoi' | 'combien'

/** Contexte optionnel pour enrichir le rendu (résolution des ids vétos…). */
export interface ContexteRendu {
  /** Résout un id de véto vers son nom affichable (duo interdit, etc.). */
  nomVeto?: (id: string) => string
}

/** Une entrée du catalogue : la définition complète d'une brique. */
export interface DefinitionBrique {
  id: string
  famille: Famille
  operateur: string
  /** Axes de ciblage attendus — DOIT rester aligné avec le seed (test de cohérence). */
  axes: AxeNom[]
  /** Paramètres attendus : clé → description courte (source de vérité côté code). */
  schemaParams: Record<string, string>
  /** Référence du composant React de saisie (placeholder tant que P1A-006/007 n'existe pas). */
  widget: string
  /** Rend le PRÉDICAT de la règle en français (le sujet est préfixé par l'appelant). */
  rendreLangageNaturel: (params: Record<string, unknown>, ctx?: ContexteRendu) => string
  /**
   * Brique INTERNE/STRUCTURELLE : concept calculé par le moteur, PAS une règle
   * que l'admin crée à la main. Aucun évaluateur « utilisateur » dédié, JAMAIS
   * proposée par le formulaire (anti-coquille-vide : sinon doublon trompeur).
   * Le mapper la rejette donc proprement si elle apparaît en base.
   */
  interne?: boolean
}

// ── Helpers de formulation (français lisible) ────────────────

const JOURS_PERIODE: Record<string, string> = {
  matin: 'le matin',
  apres_midi: "l'après-midi",
  journee: 'toute la journée',
}
function periodeLisible(p: unknown): string {
  return typeof p === 'string' ? (JOURS_PERIODE[p] ?? p) : ''
}

const CRENEAUX: Record<string, string> = {
  weekend: 'le week-end',
  semaine: 'la semaine',
  vendredi_soir: 'le vendredi soir',
  soir_semaine: 'les soirs de semaine',
  semaine_soir: 'les soirs de semaine',
  ferie: 'les jours fériés',
}
function creneauLisible(c: unknown): string {
  return typeof c === 'string' ? (CRENEAUX[c] ?? c) : String(c)
}

function fenetreLisible(f: unknown): string {
  if (f === 'semaine_civile') return 'semaine civile'
  if (typeof f === 'string') return f.replace(/_/g, ' ')
  return 'fenêtre non précisée'
}

/** Libellés FR des 6 dimensions d'équité (famille `equilibrer`). Exporté pour l'écran. */
export const DIMENSION_EQUITE_LABELS: Record<string, string> = {
  weekend: 'les week-ends',
  weekend_premier: 'le rôle de 1er le week-end',
  ferie: 'les jours fériés',
  semaine_premier: 'les soirs de semaine (1er)',
  semaine_second: 'les soirs de semaine (2nd)',
  grands_weekend: 'les grands week-ends (salariés)',
}

/** Adjectif d'importance (les crans nommés). Exporté pour l'écran. */
export const IMPORTANCE_LABELS: Record<string, string> = {
  ignoree: 'ignorée',
  peu_important: 'faible',
  normal: 'normale',
  important: 'importante',
  essentiel: 'essentielle',
}

/** Ids des partenaires d'un duo interdit (tolère avec_veterinaire_id | membres). */
function lirePartenaires(params: Record<string, unknown>): string[] {
  if (typeof params.avec_veterinaire_id === 'string') return [params.avec_veterinaire_id]
  if (Array.isArray(params.membres)) return (params.membres as unknown[]).filter((m): m is string => typeof m === 'string')
  return []
}

// ── Le catalogue — 10 briques (miroir du seed P1A-001) ───────

export const CATALOGUE_BRIQUES: Record<string, DefinitionBrique> = {
  interdire_creneau: {
    id: 'interdire_creneau',
    famille: 'interdire',
    operateur: 'JAMAIS',
    axes: ['qui', 'quoi', 'quand'],
    schemaParams: {
      creneaux: 'string[] (refs créneaux ou type: weekend/semaine/vendredi_soir/ferie)',
      sauf: 'ConditionQuand? (ex. vacances)',
    },
    widget: 'WidgetInterdireCreneau',
    rendreLangageNaturel: (params) => {
      // Forme « tableau de règles » (ex. Anne-Sophie : jeudi AP impaires + …).
      if (Array.isArray(params.regles)) {
        const items = (params.regles as Array<Record<string, unknown>>).map((r) => {
          const per = r.periode ? ` ${periodeLisible(r.periode)}` : ''
          const sem = r.semaine ? ` (semaines ${String(r.semaine)}s)` : ''
          return `${String(r.jour ?? '?')}${per}${sem}`
        })
        return `a des repos fixes : ${items.join(', ')}`
      }
      // Forme simple « un jour ».
      if (typeof params.jour === 'string') {
        const per = params.periode ? ` ${periodeLisible(params.periode)}` : ''
        const sauf = params.exception_vacances_scolaires ? ' (sauf vacances scolaires)' : ''
        return `ne fait pas de garde le ${params.jour}${per}${sauf}`
      }
      // Forme « créneaux » (schéma seed).
      if (Array.isArray(params.creneaux)) {
        return `ne fait jamais de garde : ${(params.creneaux as unknown[]).map(creneauLisible).join(', ')}`
      }
      return 'créneau interdit (paramètres non précisés)'
    },
  },

  repos_conditionnel: {
    id: 'repos_conditionnel',
    famille: 'sequence',
    operateur: 'REPOS_SI',
    axes: ['qui', 'quand'],
    schemaParams: {
      si_garde_we: 'string (jour de repos si garde WE)',
      sinon: 'string (jour de repos par défaut)',
    },
    widget: 'WidgetReposConditionnel',
    rendreLangageNaturel: (params) => {
      const si = params.si_garde_we
      const sinon = params.sinon
      if (typeof si === 'string' && typeof sinon === 'string') {
        return `est en repos le ${si} s'il est de garde le week-end, sinon le ${sinon}`
      }
      if (typeof sinon === 'string') return `est en repos le ${sinon}`
      return 'repos conditionnel (paramètres non précisés)'
    },
  },

  duo_interdit: {
    id: 'duo_interdit',
    famille: 'interdire',
    operateur: 'PAS_ENSEMBLE',
    axes: ['qui'],
    schemaParams: {
      membres: 'string[] (≥2 ids vétos)',
    },
    widget: 'WidgetDuoInterdit',
    rendreLangageNaturel: (params, ctx) => {
      const ids = lirePartenaires(params)
      if (ids.length === 0) return "n'est jamais de garde avec un autre véto (non précisé)"
      const noms = ids.map((id) => ctx?.nomVeto?.(id) ?? id)
      return `n'est jamais de garde en même temps que ${noms.join(', ')}`
    },
  },

  liaison_creneaux: {
    id: 'liaison_creneaux',
    famille: 'forcer',
    operateur: 'LIER',
    axes: ['quoi'],
    schemaParams: {
      creneau_source: 'string',
      creneau_lie: 'string',
    },
    widget: 'WidgetLiaisonCreneaux',
    rendreLangageNaturel: (params) =>
      `le véto de garde ${creneauLisible(params.creneau_source)} assure aussi ${creneauLisible(params.creneau_lie)}`,
  },

  inversion_role: {
    id: 'inversion_role',
    famille: 'forcer',
    operateur: 'INVERSER',
    axes: ['quoi'],
    schemaParams: {
      creneau_a: 'string',
      creneau_b: 'string',
    },
    widget: 'WidgetInversionRole',
    rendreLangageNaturel: (params) =>
      `le rôle 1er/2nd s'inverse entre ${creneauLisible(params.creneau_a)} et ${creneauLisible(params.creneau_b)}`,
  },

  alternance_ancre: {
    id: 'alternance_ancre',
    famille: 'interdire',
    operateur: 'ALTERNANCE',
    axes: ['qui', 'quand'],
    schemaParams: {
      date_ancre: "string (ISO date)",
      offset_decale: "integer? (jours depuis l'ancre — fenêtre qui traverse la semaine)",
      phase: 'string (paire|impaire)',
    },
    widget: 'WidgetAlternanceAncre',
    rendreLangageNaturel: (params) => {
      const semaines = params.semaines ?? params.phase
      const periodes = Array.isArray(params.periodes) ? (params.periodes as unknown[]) : []
      const quoi = periodes.length ? periodes.map(creneauLisible).join(' et ') : 'certaines gardes'
      const quand = semaines ? `les semaines ${String(semaines).replace(/s$/, '')}s` : 'une semaine sur deux'
      return `n'est pas disponible pour ${quoi} ${quand}`
    },
  },

  equilibrer: {
    id: 'equilibrer',
    famille: 'equilibrer',
    operateur: 'EQUILIBRER',
    axes: ['qui', 'quoi'],
    schemaParams: {
      dimension: 'string (weekend|weekend_premier|ferie|semaine_premier|semaine_second|grands_weekend)',
      importance: 'string (peu_important|normal|important|essentiel)',
    },
    widget: 'WidgetEquilibrer',
    rendreLangageNaturel: (params) => {
      const dim = typeof params.dimension === 'string' ? params.dimension : ''
      const imp = typeof params.importance === 'string' ? params.importance : ''
      const cible = DIMENSION_EQUITE_LABELS[dim] ?? 'les gardes'
      const prio = IMPORTANCE_LABELS[imp]
      const suffixe = prio ? ` — priorité ${prio}` : ''
      return `répartit équitablement ${cible}${suffixe}`
    },
  },

  au_plus_n: {
    id: 'au_plus_n',
    famille: 'limiter',
    operateur: 'AU_PLUS_N',
    axes: ['qui', 'quoi', 'combien'],
    schemaParams: {
      n: 'integer',
      fenetre: 'string (semaine_civile|glissante_N_jours) — OBLIGATOIRE',
    },
    widget: 'WidgetAuPlusN',
    rendreLangageNaturel: (params) => {
      const n = params.n ?? '?'
      return `au plus ${n} garde(s) par ${fenetreLisible(params.fenetre)}`
    },
  },

  espacement_min: {
    id: 'espacement_min',
    famille: 'limiter',
    operateur: 'ESPACEMENT',
    axes: ['qui', 'combien'],
    schemaParams: {
      ecart_min_jours: 'integer',
    },
    widget: 'WidgetEspacementMin',
    rendreLangageNaturel: (params) => {
      const j = params.ecart_min_jours ?? '?'
      return `au moins ${j} jours entre deux gardes`
    },
  },

  // ⚠️ INTERNE — « motif composite pré-calculé » (archi V2 §catalogue blindé).
  // Le métier « grand week-end » (repos vendredi si pas de garde WE, jeudi sinon)
  // est DÉJÀ livré par la brique `repos_conditionnel`. Le moteur calcule ce motif
  // en interne (`aGardeWeekendCetteSemaine`) — il n'y a PAS de règle utilisateur à
  // créer ici (ce serait un doublon de repos_conditionnel = coquille vide).
  motif_grand_weekend: {
    id: 'motif_grand_weekend',
    famille: 'interdire',
    operateur: 'MOTIF',
    axes: ['qui', 'quand'],
    schemaParams: {
      motif: 'string (garde_we_cette_semaine)',
    },
    widget: 'WidgetMotifGrandWeekend',
    rendreLangageNaturel: () =>
      "motif interne « grand week-end » (déjà couvert par le repos conditionnel)",
    interne: true,
  },
}

/** Ids des briques INTERNES/structurelles (jamais proposées à l'utilisateur). */
export const BRIQUES_INTERNES: readonly string[] = Object.values(CATALOGUE_BRIQUES)
  .filter((b) => b.interne)
  .map((b) => b.id)

/**
 * rendreRegle — point d'entrée pratique : rend une règle en français à partir
 * de son `brique_id` + params. Retourne un fallback lisible si la brique est
 * inconnue (jamais d'exception — robustesse interface).
 */
export function rendreRegle(
  briqueId: string,
  params: Record<string, unknown>,
  ctx?: ContexteRendu,
): string {
  const brique = CATALOGUE_BRIQUES[briqueId]
  if (!brique) return `règle « ${briqueId} » (non reconnue)`
  return brique.rendreLangageNaturel(params, ctx)
}

/** Ids de toutes les briques du catalogue. */
export const BRIQUES_IDS: readonly string[] = Object.keys(CATALOGUE_BRIQUES)
