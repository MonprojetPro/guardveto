// ============================================================
// GUARDVETO — Mapping regles_cabinet → ContrainteEngine (P1A-004)
// ============================================================
// Pont « règle-en-base → contrainte-en-code » (archi §4.3), dans la
// stratégie de transition douce (approche A : on conserve la FORME que
// le moteur consomme déjà — les contraintes attachées PAR VÉTO — et on
// change UNIQUEMENT la source : regles_cabinet au lieu de contraintes_veto).
//
// Ce module est PUR (aucune I/O Supabase) → entièrement testable.
// Il reconstruit, à partir d'une ligne `regles_cabinet`, le même objet
// `ContrainteEngine { id, type, config:{axes,force,brique,params}, actif }`
// que le loader fournissait jusqu'ici depuis `contraintes_veto.config`.
//
// 📌 DETTE DOCUMENTÉE (approche A = shim stable). La forme cible archi §4.3
//    (`RegleResolue[]` plat dans un `ContexteSimulation`) est REPORTÉE au
//    Palier 3 (IA « et si… ») — c'est là qu'elle a une vraie valeur. Le cœur
//    du moteur (prouvé fiable) n'est PAS réécrit avant. Cette couche reste le
//    pont V1↔V2 testé en attendant.
//
// VALIDATION DÉTERMINISTE (défensive). Le `schema_json` du catalogue
// (briques_regles) est à ce stade un MIROIR DESCRIPTIF provisoire (texte
// « integer », « string[] »… — cf. migration P1A-001, re-synchro en
// P1A-005), PAS un JSON Schema strict. La validation se limite donc à
// l'ENVELOPPE : brique connue du catalogue, force résoluble, qui/refs
// présents, type V1 reconstructible, params objet. Une règle qui échoue
// est ÉCARTÉE + tracée (jamais de crash du solver — critère P1A-004).
// ============================================================

import type { ContrainteEngine } from '@/engine/types'
import {
  EQUITY_DIMENSIONS,
  IMPORTANCE_LEVELS,
  type EquityRule,
  type EquityDimension,
  type ImportanceLevel,
} from '@/engine/equity-weights'
import {
  DEFAULT_STRUCTURE_CONFIG,
  type StructureConfig,
  type PenaliteSoupleId,
  type PenalitesSouplesConfig,
  type CompositionEquipeRegle,
  type ModeComposition,
  type RoleInterditTagRegle,
} from '@/engine/structure-config'
import { BRIQUES_INTERNES } from '@/engine/briques/catalogue'

/** Set des briques internes (rejetées comme règles utilisateur). */
const BRIQUES_INTERNES_SET = new Set<string>(BRIQUES_INTERNES)

/** Ligne brute de `regles_cabinet` telle que lue par le loader. */
export interface RegleCabinetRow {
  id: string
  cabinet_id: string
  periode_id: string | null
  brique_id: string
  params_json: unknown
  /** Enum texte côté base ; converti en étage entier pour le moteur. */
  force: string
  validite_json?: unknown
  version?: number
  actif: boolean
}

/** Forme attendue de `params_json` (produite par la migration P1A-003). */
interface ParamsJson {
  qui?: { type?: string; refs?: unknown }
  quand?: unknown
  params?: unknown
  _source?: { contrainte_id?: string; type_v1?: string }
}

/** force (texte base) → étage entier (score lexicographique 0..5). */
const FORCE_TEXTE_VERS_ETAGE: Record<string, number> = {
  invariant: 0,
  reglementaire: 1,
  jamais: 2,
  sauf_crise: 3,
  evitee: 4,
  si_possible: 5,
}

/** Types de contrainte que le moteur sait évaluer (par véto). */
type TypeContrainte = ContrainteEngine['type']
const TYPES_V1: ReadonlySet<TypeContrainte> = new Set<TypeContrainte>([
  'jour_repos_fixe',
  'jour_repos_conditionnel',
  'indisponibilite_cyclique',
  'duo_interdit',
  'au_plus_n',      // limite de charge réglable (brique catalogue `au_plus_n`)
  'espacement_min', // espacement minimal réglable (brique catalogue `espacement_min`)
  'espacement_weekend', // fréquence WE réglable (brique catalogue `espacement_weekend`)
  // Desiderata (n°7) — préférences positives, toujours souples (rules/desiderata.ts).
  'preferer_creneau',
  'preferer_avec',
  'volume_gardes',
  // Successions / séries / repos avancés (Vague 5 tranche B — #13).
  'succession_interdite',
  'serie_max',
  'repos_apres_serie',
  // Cadencement « 1 WE sur N ancré » (Vague 5 tranche C — #20).
  'cadencement_weekend',
  // Exclusion de dates / XOR « pas les deux » (Vague 6 tranche B — #15a).
  'exclusion_dates',
  // Garde conditionnelle ORIENTÉE « seulement avec B » (Vague 6 tranche C — #15b).
  'seulement_avec',
])

/**
 * Repli déterministe brique → type V1, utilisé uniquement quand une règle
 * n'a pas de `_source.type_v1` (ex. règle créée nativement en base, pas
 * issue de la migration). Couvre les briques du golden test pilote.
 */
const BRIQUE_VERS_TYPE: Record<string, TypeContrainte> = {
  interdire_creneau: 'jour_repos_fixe',
  repos_conditionnel: 'jour_repos_conditionnel',
  alternance_ancre: 'indisponibilite_cyclique',
  duo_interdit: 'duo_interdit',
  au_plus_n: 'au_plus_n',
  espacement_min: 'espacement_min',
  espacement_weekend: 'espacement_weekend',
  preferer_creneau: 'preferer_creneau',
  preferer_avec: 'preferer_avec',
  volume_gardes: 'volume_gardes',
  succession_interdite: 'succession_interdite',
  serie_max: 'serie_max',
  repos_apres_serie: 'repos_apres_serie',
  cadencement_weekend: 'cadencement_weekend',
  exclusion_dates: 'exclusion_dates',
  seulement_avec: 'seulement_avec',
}

export interface RegleRejetee {
  regleId: string
  raison: string
}

export interface ResultatMapping {
  /** vetId → contraintes (triées par étage, brique, id — tri stable E3). */
  contraintesParVet: Map<string, ContrainteEngine[]>
  /** Règles écartées (params corrompus / brique inconnue) — à logger. */
  rejets: RegleRejetee[]
}

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ── Extraction des règles d'équité (famille `equilibrer`) ────
// L'équité est une famille de règle À PART : elle ne cible pas un véto mais un
// COMPTEUR. Elle ne passe donc PAS par mapperReglesCabinet (qui produit des
// contraintes par véto) — on l'extrait séparément. brique_id = 'equilibrer',
// params = { dimension, importance }.

/** L'id de brique des règles d'équité (catalogue `equilibrer`). */
export const BRIQUE_EQUILIBRER = 'equilibrer'

const DIMENSIONS_VALIDES = new Set<string>(EQUITY_DIMENSIONS)
const IMPORTANCES_VALIDES = new Set<string>(IMPORTANCE_LEVELS)

/**
 * extraireEquityRules — convertit les lignes `regles_cabinet` de famille
 * `equilibrer` (actives) en EquityRule[] consommables par buildEquityWeights.
 *
 * Robustesse : une ligne au dimension/importance inconnu est IGNORÉE (jamais de
 * crash). Les règles inactives sont écartées. Le reste (dimension → défaut) est
 * géré par buildEquityWeights en aval.
 *
 * @param regles  lignes brutes regles_cabinet (toutes briques confondues)
 */
export function extraireEquityRules(regles: RegleCabinetRow[]): EquityRule[] {
  const out: EquityRule[] = []
  for (const row of regles) {
    if (row.brique_id !== BRIQUE_EQUILIBRER || !row.actif) continue
    if (!estObjet(row.params_json)) continue
    const params = (row.params_json as ParamsJson).params
    if (!estObjet(params)) continue
    const dimension = params.dimension
    const importance = params.importance
    if (typeof dimension !== 'string' || !DIMENSIONS_VALIDES.has(dimension)) continue
    if (typeof importance !== 'string' || !IMPORTANCES_VALIDES.has(importance)) continue
    // Cohorte par tag (Vague 6 tranche A — #21) : optionnel, normalisé à la
    // frontière (trim().toLowerCase()) comme extraireCompositions. Un tag vide
    // ou absent → règle GLOBALE historique (byte-identique). Un tag présent →
    // la règle ne concerne que les porteurs (cohorte indépendante).
    const tagBrut = params.tag
    const tag =
      typeof tagBrut === 'string' && tagBrut.trim() !== ''
        ? tagBrut.trim().toLowerCase()
        : undefined
    out.push({
      dimension: dimension as EquityDimension,
      importance: importance as ImportanceLevel,
      ...(tag ? { tag } : {}),
    })
  }
  return out
}

// ── Extraction de la config structurelle R8/R9 ──────────────
// R9 = brique `liaison_creneaux` (vendredi soir = week-end, même duo).
// R8 = brique `inversion_role`   (1er/2nd inversés vendredi↔WE).
// Règles GLOBALES (pas de « qui ») : on lit { actif, force→étage } de chaque.
// Absente → défaut FERME + ACTIVE (comportement historique).

export const BRIQUE_LIAISON = 'liaison_creneaux' // R9
export const BRIQUE_INVERSION = 'inversion_role' // R8

// ── Pénalités souples réglables (backlog n°16 — R10/R10c/R10b/R8b) ──
// Règles GLOBALES comme R8/R9 (pas de « qui ») : { actif, force→étage } par
// brique. Absente → défaut historique (résolu par resoudrePenaliteSouple).
// ⚠️ Ces règles n'ont AUCUN gardien dur : une force « jamais » posée en base
//    est clampée en souple à la résolution (structure-config).

/** brique_id (base/catalogue) → identifiant interne de la pénalité souple. */
export const BRIQUES_PENALITES_SOUPLES: Record<string, PenaliteSoupleId> = {
  eviter_we_consecutifs: 'we_consecutif',     // R10
  eviter_we_avant_vacances: 'we_avant_vacances', // R10c
  eviter_fete_fin_annee: 'fete_fin_annee',    // R10b
  inversion_role_ferie: 'inversion_ferie',    // R8b
}

/**
 * extrairePenalitesSouples — résout le réglage des 4 pénalités souples depuis
 * les lignes `regles_cabinet`. Une brique absente n'apparaît pas dans le
 * résultat (→ défaut historique en aval). Force inconnue → étage défaut 3.
 */
export function extrairePenalitesSouples(regles: RegleCabinetRow[]): PenalitesSouplesConfig {
  const out: PenalitesSouplesConfig = {}
  for (const [briqueId, cle] of Object.entries(BRIQUES_PENALITES_SOUPLES)) {
    const row = regles.find((r) => r.brique_id === briqueId)
    if (!row) continue
    const etage = FORCE_TEXTE_VERS_ETAGE[row.force]
    out[cle] = {
      actif: row.actif,
      etage: typeof etage === 'number' ? etage : 3,
    }
  }
  return out
}

// ── Composition d'équipe par tag (backlog n°6) ──────────────
// Règles GLOBALES avec PARAMS (contrairement à R8/R9 qui n'ont que
// { actif, force }) : chaque ligne `composition_equipe` porte
// params = { mode, tag, creneaux? }. PLUSIEURS lignes possibles par cabinet
// (une par règle : « au moins un senior le WE » + « un junior jamais seul »).

/** L'id de brique des règles de composition d'équipe. */
export const BRIQUE_COMPOSITION = 'composition_equipe'

const MODES_COMPOSITION = new Set<string>(['au_moins_un', 'pas_seuls'])

/**
 * extraireCompositions — convertit les lignes `composition_equipe` en règles
 * moteur résolues (tag normalisé, étage entier). Une ligne mal formée (mode
 * inconnu, tag vide) est IGNORÉE (jamais de crash). Les règles inactives sont
 * CONSERVÉES avec actif=false (l'UI liste tout ; le moteur filtre par actif).
 */
export function extraireCompositions(regles: RegleCabinetRow[]): CompositionEquipeRegle[] {
  const out: CompositionEquipeRegle[] = []
  for (const row of regles) {
    if (row.brique_id !== BRIQUE_COMPOSITION) continue
    if (!estObjet(row.params_json)) continue
    const params = (row.params_json as ParamsJson).params
    if (!estObjet(params)) continue
    const mode = params.mode
    const tagBrut = params.tag
    if (typeof mode !== 'string' || !MODES_COMPOSITION.has(mode)) continue
    if (typeof tagBrut !== 'string' || tagBrut.trim() === '') continue
    const creneaux = Array.isArray(params.creneaux)
      ? (params.creneaux as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      : undefined
    const etage = FORCE_TEXTE_VERS_ETAGE[row.force]
    out.push({
      regleId: row.id,
      mode: mode as ModeComposition,
      tag: tagBrut.trim().toLowerCase(),
      ...(creneaux && creneaux.length > 0 ? { creneaux } : {}),
      actif: row.actif,
      etage: typeof etage === 'number' ? etage : 2,
    })
  }
  return out
}

// ── Rôle interdit par tag (backlog n°22) ────────────────────
// « Un junior jamais 1er » : règle GLOBALE avec params { tag, role, creneaux? },
// même famille que composition_equipe (le « qui » est un TAG).

/** L'id de brique des règles de rôle interdit par tag. */
export const BRIQUE_ROLE_INTERDIT = 'role_interdit_tag'

/**
 * extraireRolesInterdits — convertit les lignes `role_interdit_tag` en règles
 * moteur résolues (tag normalisé, étage entier). Ligne mal formée (tag/role
 * vides) → IGNORÉE (jamais de crash). Inactives conservées (l'UI liste tout).
 */
export function extraireRolesInterdits(regles: RegleCabinetRow[]): RoleInterditTagRegle[] {
  const out: RoleInterditTagRegle[] = []
  for (const row of regles) {
    if (row.brique_id !== BRIQUE_ROLE_INTERDIT) continue
    if (!estObjet(row.params_json)) continue
    const params = (row.params_json as ParamsJson).params
    if (!estObjet(params)) continue
    const tagBrut = params.tag
    const role = params.role
    if (typeof tagBrut !== 'string' || tagBrut.trim() === '') continue
    if (typeof role !== 'string' || role.trim() === '') continue
    const creneaux = Array.isArray(params.creneaux)
      ? (params.creneaux as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      : undefined
    const etage = FORCE_TEXTE_VERS_ETAGE[row.force]
    out.push({
      regleId: row.id,
      tag: tagBrut.trim().toLowerCase(),
      role: role.trim(),
      ...(creneaux && creneaux.length > 0 ? { creneaux } : {}),
      actif: row.actif,
      etage: typeof etage === 'number' ? etage : 2,
    })
  }
  return out
}

/**
 * extraireStructureConfig — résout la config R8/R9 depuis les lignes
 * `regles_cabinet`. Chaque règle absente garde son défaut (ferme + active).
 * Une force inconnue retombe sur l'étage dur (2) — jamais d'exception.
 * Porte AUSSI le réglage des pénalités souples (backlog n°16) : il voyage
 * dans StructureConfig, donc partout où elle est déjà threadée (solver,
 * scoreur, crise, replay) sans nouveau branchement.
 */
export function extraireStructureConfig(regles: RegleCabinetRow[]): StructureConfig {
  const lire = (briqueId: string) => {
    const row = regles.find((r) => r.brique_id === briqueId)
    if (!row) return undefined
    const etage = FORCE_TEXTE_VERS_ETAGE[row.force]
    return {
      actif: row.actif,
      etage: typeof etage === 'number' ? etage : 2,
    }
  }
  // Pénalités souples : la clé n'est portée QUE si au moins une règle est
  // configurée en base. Zéro ligne → config strictement égale au défaut
  // historique (DEFAULT_STRUCTURE_CONFIG) — byte-identique, et les consommateurs
  // aval résolvent chaque pénalité absente à son défaut (resoudrePenaliteSouple).
  const penalitesSouples = extrairePenalitesSouples(regles)
  // Composition d'équipe (n°6) + rôle interdit par tag (n°22) : même principe
  // — la clé n'existe que si des règles sont posées en base (zéro ligne →
  // byte-identique).
  const compositions = extraireCompositions(regles)
  const rolesInterdits = extraireRolesInterdits(regles)
  return {
    r9_liaison: lire(BRIQUE_LIAISON) ?? { ...DEFAULT_STRUCTURE_CONFIG.r9_liaison },
    r8_inversion: lire(BRIQUE_INVERSION) ?? { ...DEFAULT_STRUCTURE_CONFIG.r8_inversion },
    ...(Object.keys(penalitesSouples).length > 0 ? { penalitesSouples } : {}),
    ...(compositions.length > 0 ? { compositions } : {}),
    ...(rolesInterdits.length > 0 ? { rolesInterdits } : {}),
  }
}

/**
 * mapperReglesCabinet — convertit des lignes `regles_cabinet` en contraintes
 * moteur, regroupées par vétérinaire propriétaire (1re réf de `qui.refs`).
 *
 * @param regles          lignes brutes (déjà scopées cabinet + validité par le loader)
 * @param briquesConnues  ids présents dans le catalogue briques_regles
 * @returns               contraintes par véto (triées) + liste des rejets
 */
export function mapperReglesCabinet(
  regles: RegleCabinetRow[],
  briquesConnues: ReadonlySet<string>,
): ResultatMapping {
  const contraintesParVet = new Map<string, ContrainteEngine[]>()
  const rejets: RegleRejetee[] = []

  for (const row of regles) {
    const rejet = (raison: string) => rejets.push({ regleId: row.id, raison })

    // 0. Règles GLOBALES (pas par véto) : équité (`equilibrer`), structurelles
    //    R8/R9 (`liaison_creneaux`, `inversion_role`), pénalités souples
    //    réglables (backlog n°16) et composition d'équipe (n°6). Traitées À PART
    //    (équité → buildEquityWeights ; structure + pénalités + compositions →
    //    extraireStructureConfig). On les saute ici SANS les compter comme
    //    rejets (ce ne sont pas des contraintes de véto).
    if (
      row.brique_id === BRIQUE_EQUILIBRER ||
      row.brique_id === BRIQUE_LIAISON ||
      row.brique_id === BRIQUE_INVERSION ||
      row.brique_id === BRIQUE_COMPOSITION ||
      row.brique_id === BRIQUE_ROLE_INTERDIT ||
      row.brique_id in BRIQUES_PENALITES_SOUPLES
    ) {
      continue
    }

    // 1. Brique connue du catalogue
    if (!briquesConnues.has(row.brique_id)) {
      rejet(`brique inconnue du catalogue : « ${row.brique_id} »`)
      continue
    }

    // 1bis. Brique INTERNE/structurelle (ex. motif_grand_weekend) : jamais une
    //       règle utilisateur — rejet déterministe, même si un _source.type_v1
    //       valide tentait de la faire passer (anti-coquille-vide, défense en
    //       profondeur ; le formulaire ne la propose déjà pas).
    if (BRIQUES_INTERNES_SET.has(row.brique_id)) {
      rejet(`brique interne non applicable comme règle : « ${row.brique_id} »`)
      continue
    }

    // 2. Force résoluble en étage
    const etage = FORCE_TEXTE_VERS_ETAGE[row.force]
    if (etage === undefined) {
      rejet(`force invalide : « ${row.force} »`)
      continue
    }

    // 3. params_json bien formé
    if (!estObjet(row.params_json)) {
      rejet('params_json absent ou non-objet')
      continue
    }
    const pj = row.params_json as ParamsJson

    // 4. qui.refs présent, propriétaire identifiable
    const refs = pj.qui?.refs
    if (!Array.isArray(refs) || refs.length === 0 || typeof refs[0] !== 'string') {
      rejet('qui.refs absent ou vide (propriétaire indéterminable)')
      continue
    }
    // MULTI-PROPRIÉTAIRES (backlog n°18) : une règle « pour Manon ET Antoine »
    // s'applique à CHAQUE réf — plus de troncature silencieuse de refs[1..n].
    // ⚠️ EXCEPTION duo_interdit : historiquement refs = [propriétaire, partenaire]
    //    (migration P1A-003 + écriture symétrique A→B/B→A d'upsertRegle). refs[1]
    //    y est le PARTENAIRE, pas un co-propriétaire → refs[0] seul, comme avant.
    //    (La symétrie du duo est déjà garantie par la ligne miroir.)
    const refsUniques = [...new Set(refs.filter((x): x is string => typeof x === 'string'))]

    // 5. type V1 reconstructible (depuis _source, sinon repli brique→type)
    const typeBrut = pj._source?.type_v1 ?? BRIQUE_VERS_TYPE[row.brique_id]
    if (typeof typeBrut !== 'string' || !TYPES_V1.has(typeBrut as TypeContrainte)) {
      rejet(`type V1 indéterminable (brique « ${row.brique_id} »)`)
      continue
    }
    const type = typeBrut as TypeContrainte

    // 6. params métier (objet) — préservés tels quels (V1 intégral)
    if (!estObjet(pj.params)) {
      rejet('params_json.params absent ou non-objet')
      continue
    }

    // Reconstruction de la FORME config attendue par le moteur :
    //   { axes, force(int), brique, params } — identique à ce que le loader
    //   produisait depuis contraintes_veto.config. L'axe `quand` n'est posé
    //   que s'il est non-null (un `{quand:null}` d'origine ↔ `{}` : inerte
    //   pour le solver, qui accède à axes.quand → undefined dans les 2 cas).
    const quand = pj.quand
    const axes = quand !== null && quand !== undefined ? { quand } : {}

    // Dépliage n°18 : une instance de contrainte PAR propriétaire (duo → refs[0]
    // seul, cf. exception ci-dessus). Objets DISTINCTS par véto (pas de partage
    // de référence : normaliserContraintes copie, mais on reste défensif).
    const proprietaires = type === 'duo_interdit' ? [refsUniques[0]] : refsUniques
    for (const proprietaireId of proprietaires) {
      const contrainte: ContrainteEngine = {
        id: row.id,
        type,
        config: {
          axes,
          force: etage,
          brique: row.brique_id,
          params: pj.params,
        },
        actif: row.actif,
      }
      const liste = contraintesParVet.get(proprietaireId)
      if (liste) liste.push(contrainte)
      else contraintesParVet.set(proprietaireId, [contrainte])
    }
  }

  // Tri stable (E3) : (étage, brique_id, id) au sein de chaque véto.
  for (const liste of contraintesParVet.values()) {
    liste.sort((a, b) => {
      const fa = a.config.force as number
      const fb = b.config.force as number
      if (fa !== fb) return fa - fb
      const ba = a.config.brique as string
      const bb = b.config.brique as string
      if (ba !== bb) return ba < bb ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  }

  return { contraintesParVet, rejets }
}
