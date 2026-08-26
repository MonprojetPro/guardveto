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
import { VETO_RETIRE } from '@/lib/regles/veto-absent'

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

// ⚠️ LES DEMI-JOURNÉES NE S'AFFICHENT PLUS (B-043, 2026-08-26).
//
// Ce tableau traduisait `matin` / `apres_midi` / `journee`. Or `periode` n'a
// JAMAIS été évalué par le moteur : une règle « jeudi après-midi » bloquait le
// JEUDI ENTIER. La phrase annonçait donc une portée que le planning n'appliquait
// pas — à l'endroit précis où l'administratrice décide.
//
// Ce défaut avait déjà été corrigé sur la forme SIMPLE en août. La forme
// TABLEAU avait été oubliée — c'est-à-dire précisément celle de la règle héritée
// du cabinet pilote (« jeudi AP impaires + lundi AP paires + mercredi paires »).
// Un correctif qui ne couvre pas toutes les formes d'une même donnée ne corrige
// que le cas qu'on avait sous les yeux.
//
// Sur le fond, cette notion n'a pas lieu d'être ici : le produit ne planifie que
// les soirs et les week-ends. Décision de MiKL le 2026-08-26 — on retire, et on
// rouvrira le sujet avec les journées de travail (B-006) si elles arrivent.
//
// La donnée reste en base, intacte : on cesse de l'AFFICHER, on ne réécrit pas
// les règles du client à son insu.

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
        const entrees = params.regles as Array<Record<string, unknown>>
        // Le `s` collé sortait « semaines impairess » quand la valeur porte
        // déjà sa marque du pluriel. On la retire d'abord, comme le fait le
        // rendu de l'alternance ancrée juste plus bas.
        const paritePhrase = (v: unknown) => ` (semaines ${String(v).replace(/s$/, '')}s)`
        const items = entrees.map((r) => {
          // `periode` volontairement IGNORÉ (B-043) : voir la note en tête de
          // fichier. L'afficher promettait une portée que le moteur n'applique
          // pas — la règle bloque le jour entier.
          const sem = r.semaine ? paritePhrase(r.semaine) : ''
          return `${String(r.jour ?? '?')}${sem}`
        })

        // Un seul jour : la même phrase que la forme simple, au singulier.
        // « a des repos fixes : jeudi (semaines impaires) » se lisait comme une
        // liste amputée, et cette phrase-là est la plus courante.
        if (items.length === 1) {
          return `ne fait pas de garde le ${items[0]}`
        }

        // Plusieurs jours de MÊME parité (B-041) : on factorise plutôt que de
        // répéter « (semaines paires) » derrière chaque jour. « le lundi et le
        // mardi (semaines paires) » se lit d'un coup d'œil ; « lundi (semaines
        // paires), mardi (semaines paires) » oblige à comparer les parenthèses
        // pour vérifier qu'elles disent la même chose.
        const parites = new Set(entrees.map((r) => String(r.semaine ?? '')))
        const periodes = new Set(entrees.map((r) => String(r.periode ?? '')))
        if (parites.size === 1 && periodes.size === 1 && periodes.has('')) {
          const jours = entrees.map((r) => String(r.jour ?? '?'))
          const listeFr =
            jours.length === 2
              ? `${jours[0]} et le ${jours[1]}`
              : `${jours.slice(0, -1).join(', le ')} et le ${jours[jours.length - 1]}`
          const sem = entrees[0].semaine ? paritePhrase(entrees[0].semaine) : ''
          return `ne fait pas de garde le ${listeFr}${sem}`
        }

        return `a des repos fixes : ${items.join(', ')}`
      }
      // Forme simple « un jour ».
      if (typeof params.jour === 'string') {
        // ⚠️ `periode` ('apres_midi'…) vient des données V1 et n'a JAMAIS été
        //    évalué par le moteur : l'afficher promettait une portée partielle
        //    que le planning n'appliquait pas. On ne le dit plus que si un
        //    ciblage RÉEL l'accompagne — sinon la phrase mentait à l'endroit
        //    précis où l'admin décide.
        const cibles = Array.isArray(params.creneaux) ? (params.creneaux as unknown[]) : []
        const sur = cibles.length > 0
          ? ` (${cibles.map(creneauLisible).join(', ')} seulement)`
          : ''
        const sauf = params.exception_vacances_scolaires ? ' (sauf vacances scolaires)' : ''
        return `ne fait pas de garde le ${params.jour}${sur}${sauf}`
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
      const noms = ids.map((id) => ctx?.nomVeto?.(id) ?? VETO_RETIRE)
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
      tag: 'string? (cohorte #21 — absent = équilibrage GLOBAL ; présent = équilibré UNIQUEMENT sur les vétos portant cette étiquette)',
    },
    widget: 'WidgetEquilibrer',
    rendreLangageNaturel: (params) => {
      const dim = typeof params.dimension === 'string' ? params.dimension : ''
      const imp = typeof params.importance === 'string' ? params.importance : ''
      const tag = typeof params.tag === 'string' ? params.tag.trim() : ''
      const cible = DIMENSION_EQUITE_LABELS[dim] ?? 'les gardes'
      const prio = IMPORTANCE_LABELS[imp]
      const suffixe = prio ? ` — priorité ${prio}` : ''
      // Cohorte (#21) : on précise sur QUELS vétos porte l'équilibrage.
      const portee = tag !== '' ? ` entre les vétérinaires « ${tag} »` : ''
      return `répartit équitablement ${cible}${portee}${suffixe}`
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
      creneaux: 'string[]? (codes de créneaux du cabinet — absent = toutes les gardes)',
    },
    widget: 'WidgetAuPlusN',
    rendreLangageNaturel: (params) => {
      const n = params.n ?? '?'
      // Filtre de créneaux (axe `quoi`, backlog n°19) : « max 2 week-ends par mois ».
      const creneaux = Array.isArray(params.creneaux)
        ? (params.creneaux as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      const quoi = creneaux.length > 0
        ? `garde(s) sur : ${creneaux.map(creneauLisible).join(', ')}`
        : 'garde(s)'
      return `au plus ${n} ${quoi} par ${fenetreLisible(params.fenetre)}`
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

  espacement_weekend: {
    id: 'espacement_weekend',
    famille: 'limiter',
    operateur: 'ESPACEMENT_WE',
    axes: ['qui', 'combien'],
    schemaParams: {
      n_semaines: 'integer',
    },
    widget: 'WidgetEspacementWeekend',
    rendreLangageNaturel: (params) => {
      const n = params.n_semaines ?? '?'
      return `de garde au plus un week-end sur ${n}`
    },
  },

  // ── Cadencement fixe « 1 WE sur N ancré » (Vague 5 tranche C — #20) ──
  // À NE PAS confondre avec espacement_weekend (un ESPACEMENT « au moins N
  // semaines entre deux WE »). Ici c'est un CADENCEMENT ANCRÉ : les week-ends
  // « du véto » sont ceux dont le samedi tombe à un multiple de N×7 jours d'une
  // date d'ancrage (un samedi de référence) — cas type du pompier volontaire de
  // garde 1 WE sur 3 à dates FIXES. Cycle calendaire STRICT (aucun recalage
  // vacances, contrairement à l'indispo cyclique). Deux sens :
  //   • interdit : les WE du cycle sont INTERDITS de garde véto (il est déjà pris).
  //   • impose   : les gardes WE du véto DOIVENT tomber sur le cycle (filtre de
  //     position ; PAS une obligation d'être présent à chaque WE du cycle).
  cadencement_weekend: {
    id: 'cadencement_weekend',
    famille: 'sequence',
    operateur: 'CADENCEMENT_WE',
    axes: ['qui', 'quand'],
    schemaParams: {
      n_semaines: 'integer (≥ 2 — cycle : 1 week-end sur N)',
      ancre: 'string (date ISO yyyy-MM-dd — un samedi de référence qui donne la phase du cycle)',
      sens: "string (interdit|impose — WE du cycle interdits, ou gardes WE forcées sur le cycle)",
    },
    widget: 'WidgetCadencementWeekend',
    rendreLangageNaturel: (params) => {
      const n = params.n_semaines ?? '?'
      const ancre = typeof params.ancre === 'string' && params.ancre.trim() !== '' ? params.ancre : '?'
      if (params.sens === 'impose') {
        return `ses week-ends de garde suivent un cycle d'1 semaine sur ${n} (ancré au ${ancre})`
      }
      // Défaut / 'interdit' : le cas pompier.
      return `est indisponible le week-end 1 semaine sur ${n} (cycle ancré au ${ancre})`
    },
  },

  // ── Pénalités souples réglables (backlog n°16 — règles GLOBALES) ──
  // Comme liaison_creneaux/inversion_role : pas de « qui », un réglage
  // { actif, force } par cabinet. Absentes de la base → défaut historique
  // (étage + poids d'origine). Toujours SOUPLES (l'écriture refuse « jamais »,
  // la résolution clampe) : aucun gardien dur n'existe pour elles.

  eviter_we_consecutifs: {
    id: 'eviter_we_consecutifs',
    famille: 'sequence',
    operateur: 'EVITER_SUITE',
    axes: ['quoi'],
    schemaParams: {
      _reglage: 'aucun paramètre — le réglage porte { actif, force } (R10 : pas 2 week-ends de suite)',
    },
    widget: 'WidgetPenaliteSouple',
    rendreLangageNaturel: () =>
      'le moteur évite de donner deux week-ends de garde consécutifs au même vétérinaire (R10)',
  },

  eviter_we_avant_vacances: {
    id: 'eviter_we_avant_vacances',
    famille: 'interdire',
    operateur: 'EVITER_AVANT',
    axes: ['quoi'],
    schemaParams: {
      _reglage: 'aucun paramètre — le réglage porte { actif, force } (R10c : pas de garde le WE avant ses vacances)',
    },
    widget: 'WidgetPenaliteSouple',
    rendreLangageNaturel: () =>
      'le moteur évite de mettre un vétérinaire de garde le week-end qui précède ses vacances (R10c)',
  },

  eviter_fete_fin_annee: {
    id: 'eviter_fete_fin_annee',
    famille: 'interdire',
    operateur: 'EVITER_FETE',
    axes: ['quand'],
    schemaParams: {
      _reglage: 'aucun paramètre — le réglage porte { actif, force } (R10b : soirs des 24 et 31 décembre)',
    },
    widget: 'WidgetPenaliteSouple',
    rendreLangageNaturel: () =>
      'le moteur évite les gardes des soirs de réveillon (24 et 31 décembre) autant que possible (R10b)',
  },

  inversion_role_ferie: {
    id: 'inversion_role_ferie',
    famille: 'forcer',
    operateur: 'INVERSER_FERIE',
    axes: ['quand'],
    schemaParams: {
      _reglage: 'aucun paramètre — le réglage porte { actif, force } (R8b : rôle inversé la veille d’un férié)',
    },
    widget: 'WidgetPenaliteSouple',
    rendreLangageNaturel: () =>
      'le rôle 1er/2nd s’inverse si possible entre la veille d’un jour férié et le férié lui-même (R8b)',
  },

  // ── Composition d'équipe par tag (backlog n°6 — règle GLOBALE à params) ──
  // Le « qui » n'est pas un véto nominal mais une ÉTIQUETTE (veterinaires.tags).
  // Plusieurs règles possibles par cabinet (une ligne regles_cabinet chacune).

  composition_equipe: {
    id: 'composition_equipe',
    famille: 'couverture',
    operateur: 'COMPOSITION',
    axes: ['qui', 'quoi'],
    schemaParams: {
      mode: 'string (au_moins_un|pas_seuls)',
      tag: 'string (étiquette portée par les vétos, ex. senior)',
      creneaux: 'string[]? (codes de créneaux ciblés — absent = tous)',
    },
    widget: 'WidgetCompositionEquipe',
    rendreLangageNaturel: (params) => {
      const tag = typeof params.tag === 'string' && params.tag.trim() !== '' ? params.tag : '?'
      const creneaux = Array.isArray(params.creneaux)
        ? (params.creneaux as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      const cible = creneaux.length > 0
        ? `sur : ${creneaux.map(creneauLisible).join(', ')}`
        : 'sur chaque créneau'
      if (params.mode === 'au_moins_un') {
        return `au moins un vétérinaire « ${tag} » ${cible}`
      }
      if (params.mode === 'pas_seuls') {
        return `les vétérinaires « ${tag} » ne sont jamais seuls ${cible}`
      }
      return `composition d'équipe « ${tag} » (mode non précisé)`
    },
  },

  // ── Rôle interdit par tag (backlog n°22 — « un junior jamais 1er ») ──
  role_interdit_tag: {
    id: 'role_interdit_tag',
    famille: 'interdire',
    operateur: 'ROLE_INTERDIT',
    axes: ['qui', 'quoi'],
    schemaParams: {
      tag: 'string (étiquette portée par les vétos, ex. junior)',
      role: 'string (label de la place interdite, ex. premier)',
      creneaux: 'string[]? (codes de créneaux ciblés — absent = tous)',
    },
    widget: 'WidgetRoleInterditTag',
    rendreLangageNaturel: (params) => {
      const tag = typeof params.tag === 'string' && params.tag.trim() !== '' ? params.tag : '?'
      const role = typeof params.role === 'string' && params.role.trim() !== '' ? params.role : '?'
      const roleLisible = role === 'premier' ? '1er' : role === 'second' ? '2nd' : role
      const creneaux = Array.isArray(params.creneaux)
        ? (params.creneaux as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      const cible = creneaux.length > 0
        ? ` sur : ${creneaux.map(creneauLisible).join(', ')}`
        : ''
      return `les vétérinaires « ${tag} » ne sont jamais ${roleLisible} de garde${cible}`
    },
  },

  // ── Desiderata (backlog n°7) — préférences POSITIVES par véto ──
  // TOUJOURS souples (étage ≥ 3) : l'écriture refuse « jamais », l'évaluation
  // clampe (rules/desiderata.ts). Une préférence ne bloque jamais un planning.

  preferer_creneau: {
    id: 'preferer_creneau',
    famille: 'forcer',
    operateur: 'PREFERER',
    axes: ['qui', 'quoi', 'quand'],
    schemaParams: {
      jours: 'string[]? (lundi..dimanche — jours préférés)',
      creneaux: 'string[]? (codes de créneaux préférés)',
    },
    widget: 'WidgetPrefererCreneau',
    rendreLangageNaturel: (params) => {
      const jours = Array.isArray(params.jours)
        ? (params.jours as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      const creneaux = Array.isArray(params.creneaux)
        ? (params.creneaux as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      const morceaux = [
        ...jours.map((j) => `le ${j}`),
        ...creneaux.map(creneauLisible),
      ]
      if (morceaux.length === 0) return 'préfère certains créneaux (non précisés)'
      return `préfère être de garde ${morceaux.join(', ')}`
    },
  },

  preferer_avec: {
    id: 'preferer_avec',
    famille: 'forcer',
    operateur: 'PREFERER_AVEC',
    axes: ['qui'],
    schemaParams: {
      avec_veterinaire_id: 'string (id du co-équipier préféré)',
    },
    widget: 'WidgetPrefererAvec',
    rendreLangageNaturel: (params, ctx) => {
      const id = typeof params.avec_veterinaire_id === 'string' ? params.avec_veterinaire_id : null
      if (!id) return 'préfère être de garde avec un autre vétérinaire (non précisé)'
      return `préfère être de garde avec ${ctx?.nomVeto?.(id) ?? VETO_RETIRE}`
    },
  },

  // ── Garde conditionnelle ORIENTÉE « seulement avec B » (Vague 6 tranche C — #15b) ──
  // Par-véto, famille `interdire` (elle INTERDIT à A d'être posé sans B),
  // réglable dur/mou. Version CONDITIONNELLE dur/mou de preferer_avec (qui, lui,
  // est toujours SOUPLE). ORIENTÉE : A dépend de B, jamais l'inverse — UNE ligne,
  // pas de miroir (contrairement au duo). « Même créneau » = même date + même
  // type. Ciblage `creneaux` optionnel. Jugée à la POSE COMPLÉTANTE.
  seulement_avec: {
    id: 'seulement_avec',
    famille: 'interdire',
    operateur: 'SEULEMENT_AVEC',
    axes: ['qui', 'quoi'],
    schemaParams: {
      avec_veterinaire_id: 'string (id du binôme REQUIS — A n\'est de garde que si B l\'est)',
      creneaux: 'string[]? (ne cibler que ces types de créneau — absent = tous)',
    },
    widget: 'WidgetSeulementAvec',
    rendreLangageNaturel: (params, ctx) => {
      const id = typeof params.avec_veterinaire_id === 'string' ? params.avec_veterinaire_id : null
      const creneaux = Array.isArray(params.creneaux)
        ? (params.creneaux as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      const suffixe = creneaux.length > 0
        ? ` (sur : ${creneaux.map(creneauLisible).join(', ')})`
        : ''
      if (!id) return 'ne veut être de garde que si un autre vétérinaire est de garde (non précisé)'
      return `ne veut être de garde que si ${ctx?.nomVeto?.(id) ?? VETO_RETIRE} est de garde sur le même créneau${suffixe}`
    },
  },

  volume_gardes: {
    id: 'volume_gardes',
    famille: 'equilibrer',
    operateur: 'VOLUME',
    axes: ['qui', 'combien'],
    schemaParams: {
      sens: "string (plus|moins — souhaite plus ou moins de gardes que la moyenne)",
    },
    widget: 'WidgetVolumeGardes',
    rendreLangageNaturel: (params) => {
      if (params.sens === 'plus') return 'souhaite faire PLUS de gardes que la moyenne'
      if (params.sens === 'moins') return 'souhaite faire MOINS de gardes que la moyenne'
      return 'souhaite ajuster son volume de gardes (non précisé)'
    },
  },

  // ── Successions / séries / repos avancés (Vague 5 tranche B — #13) ──
  // Trois briques par-véto, famille `sequence` (patterns standard du nurse
  // rostering). Réglables dur/mou ; jamais bloquantes si mal configurées (inertes).

  succession_interdite: {
    id: 'succession_interdite',
    famille: 'sequence',
    operateur: 'SUCCESSION_INTERDITE',
    axes: ['qui', 'quoi'],
    schemaParams: {
      type_avant: 'string (code du créneau « veille » — ex. weekend)',
      type_apres: 'string (code du créneau interdit le lendemain — ex. semaine_soir)',
    },
    widget: 'WidgetSuccessionInterdite',
    rendreLangageNaturel: (params) => {
      const avant = creneauLisible(params.type_avant)
      const apres = creneauLisible(params.type_apres)
      if (typeof params.type_avant === 'string' && typeof params.type_apres === 'string') {
        return `ne fait jamais ${apres} le lendemain d'une garde ${avant}`
      }
      return 'succession de créneaux interdite (paramètres non précisés)'
    },
  },

  serie_max: {
    id: 'serie_max',
    famille: 'sequence',
    operateur: 'SERIE_MAX',
    axes: ['qui', 'combien'],
    schemaParams: {
      n_jours: 'integer (nombre max de jours de garde d\'affilée)',
      creneaux: 'string[]? (ne compter que ces types — absent = tous)',
    },
    widget: 'WidgetSerieMax',
    rendreLangageNaturel: (params) => {
      const n = params.n_jours ?? '?'
      const creneaux = Array.isArray(params.creneaux)
        ? (params.creneaux as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      const suffixe = creneaux.length > 0
        ? ` (en ne comptant que : ${creneaux.map(creneauLisible).join(', ')})`
        : ''
      return `jamais plus de ${n} jour(s) de garde d'affilée${suffixe}`
    },
  },

  repos_apres_serie: {
    id: 'repos_apres_serie',
    famille: 'sequence',
    operateur: 'REPOS_APRES_SERIE',
    axes: ['qui', 'combien'],
    schemaParams: {
      n_jours: 'integer (longueur de série déclenchant le repos)',
      repos_jours: 'integer (jours sans garde imposés après la série)',
    },
    widget: 'WidgetReposApresSerie',
    rendreLangageNaturel: (params) => {
      const n = params.n_jours ?? '?'
      const repos = params.repos_jours ?? '?'
      return `après ${n} jour(s) de garde d'affilée, au moins ${repos} jour(s) de repos`
    },
  },

  // ── Exclusion de dates / XOR « pas les deux » (Vague 6 tranche B — #15a) ──
  // Brique PAR-VÉTO (famille `interdire`), réglable dur/mou. Sémantique retenue
  // et FIGÉE : « pas les DEUX » — le véto ne peut pas être de garde À LA FOIS sur
  // les deux cibles (JAMAIS « exactement une » : on n'oblige personne à en faire
  // une). Deux formes de params, une SEULE par règle :
  //   • fetes : ['noel','nouvel_an'] — paire de codes fête (référentiel
  //     historique-fete.ts). Cas métier dominant (24 déc XOR 31 déc), se
  //     reconduit seule chaque année : pour CHAQUE année couverte, le véto ne
  //     peut couvrir à la fois une instance de la 1re fête ET de la 2e (même
  //     année, convention « année du décembre » portée par feteDeDate()).
  //   • dates : ['YYYY-MM-DD','YYYY-MM-DD'] — paire de dates ISO explicites,
  //     pour tout autre cas. Le véto ne peut être de garde aux deux dates (au
  //     sens « jours couverts par ses gardes » — un WE couvre samedi + dimanche).
  // Mal configurée (forme absente, paire identique, date non-ISO) → INERTE
  // (jamais de crash, jamais de blocage) — des DEUX côtés moteur + validateur.
  // Intra-période uniquement (pas de lookback #17 : le XOR est réservé au
  // planning de la période en cours ; les fêtes tombant dans deux périodes
  // distinctes ne se voient qu'à moitié — limite documentée).
  exclusion_dates: {
    id: 'exclusion_dates',
    famille: 'interdire',
    operateur: 'PAS_LES_DEUX',
    axes: ['qui', 'quand'],
    schemaParams: {
      fetes: "string[2]? (paire de codes fête : noel|nouvel_an — forme « fêtes de fin d'année »)",
      dates: 'string[2]? (paire de dates ISO yyyy-MM-dd — forme « dates libres »)',
    },
    widget: 'WidgetExclusionDates',
    rendreLangageNaturel: (params) => {
      const fetes = Array.isArray(params.fetes)
        ? (params.fetes as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      if (fetes.length === 2) {
        const LIB: Record<string, string> = { noel: 'Noël', nouvel_an: 'le Nouvel An' }
        const a = LIB[fetes[0]] ?? fetes[0]
        const b = LIB[fetes[1]] ?? fetes[1]
        return `ne fait jamais de garde à la fois pour ${a} et ${b} la même année`
      }
      const dates = Array.isArray(params.dates)
        ? (params.dates as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      if (dates.length === 2) {
        return `ne fait jamais de garde à la fois le ${dates[0]} et le ${dates[1]}`
      }
      return 'ne fait jamais deux dates ensemble (paramètres non précisés)'
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
