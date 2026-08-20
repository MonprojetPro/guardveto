// ============================================================
// GUARDVETO — Chargeur de données Supabase pour le solver
// ============================================================
// Transforme les données Supabase (vétérinaires, contraintes,
// congés, bonus/malus) en SolverInput consommable par genererPlanningPur().
// ============================================================

import { createClient } from '@/lib/supabase/server'
import type { VetEngine, ContrainteEngine, CongeEngine, CalendrierResolu, AttributionGarde } from './types'
import type { BonusMalusMap } from './score-lexicographique'
import type { SolverInput } from './solver'
import {
  gardesVersPlanningPartiel, moinsJours, type GardeRow,
} from './validation/gardesVersPlanning'
import { buildEquityWeights, mapperRoleAvantageFinancierDb, type EquityWeights } from './equity-weights'
import { type StructureConfig } from './structure-config'
import {
  mapperReglesCabinet,
  extraireEquityRules,
  extraireStructureConfig,
  type RegleCabinetRow,
} from '@/data/mapReglesCabinet'
import {
  chargerCreneauModele, chargerRelationsCreneau, resoudreProfilId,
} from '@/data/chargerCreneauModele'
import { resoudreRelationsStructure } from './relations-structure'
import { chargerHistoriqueFetes } from '@/data/historiqueFetes'
import { anneesFetesCouvertes } from './historique-fete'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * #17 (Vague 5) — fenêtre de LOOKBACK inter-périodes, en jours. On charge les
 * gardes des `LOOKBACK_JOURS` jours qui précèdent le début de la période, pour
 * que les règles de rythme voient la jonction. 10 j couvrent : le week-end
 * précédent (R10 « pas 2 WE de suite »), l'espacement min (typiquement 2-3 j) et
 * la fenêtre « 1 WE sur N » usuelle. (docs/v2/06-architecture-v2.md l.124/384.)
 */
const LOOKBACK_JOURS = 10

// ── Mapping DB → engine ──────────────────────────────────

interface CongeDb {
  veterinaire_id: string
  date_debut: string
  date_fin: string
  type: 'vacances' | 'formation' | 'sante' | 'autre' | 'indisponibilite'
}

interface BonusMalusDb {
  veterinaire_id: string
  ecart_we: number
}

/** Ligne brute de la table de référentiel `vacances_scolaires` (schéma V2). */
interface VacanceScolaireDb {
  debut: string
  fin: string
  label: string
}

/** Ligne brute de la table de référentiel `jours_feries` (schéma V2). */
interface JourFerieDb {
  date: string
  libelle: string
}

// ── Chargement du calendrier scopé par zone/région ───────

/**
 * chargerCalendrierZone — Construit le CalendrierResolu (fériés + vacances
 * scolaires) à partir des DONNÉES de référentiel, scopées sur la RÉGION et
 * la ZONE du cabinet courant (`cabinets.region_feries` + `zone_scolaire`).
 *
 * C'est le cœur du correctif « zone-aware » : avant, le moteur utilisait la
 * constante `VACANCES_SCOLAIRES` (zone C, codée en dur) pour TOUS les
 * cabinets — ce qui faussait la règle « repos sauf vacances » (ex. Fanny,
 * mercredi) pour tout cabinet non-zone-C (le pilote = zone A).
 *
 * ⚠️ Cohérence fériés : on charge AUSSI les fériés (par région) pour que le
 * Set `feries` soit fidèle. Un calendrier avec un Set `feries` vide ferait
 * croire à `estJourFerie()` qu'aucune date n'est fériée → régression. On ne
 * renvoie donc le calendrier QUE lorsqu'on a pu charger les deux référentiels.
 *
 * @param cabinetId  UUID du cabinet courant (sa zone/région déterminent les dates)
 * @param dateDebut  Premier jour de la période (filtre de chevauchement)
 * @param dateFin    Dernier jour de la période (filtre de chevauchement)
 * @returns          CalendrierResolu complet, ou `undefined` si le cabinet est
 *                   introuvable / requête en erreur → le moteur se rabat alors
 *                   sur les listes en dur de utils.ts (fallback hors-DB).
 */
async function chargerCalendrierZone(
  cabinetId: string,
  dateDebut: string,
  dateFin: string
): Promise<CalendrierResolu | undefined> {
  const supabase = await createClient()

  // 1. Zone scolaire + région du cabinet courant
  const { data: cabinet, error: cabinetErr } = await supabase
    .from('cabinets')
    .select('zone_scolaire, region_feries')
    .eq('id', cabinetId)
    .single()

  if (cabinetErr || !cabinet?.zone_scolaire) {
    // Cabinet/zone introuvable → fallback sur les listes en dur (utils.ts)
    return undefined
  }

  const region = cabinet.region_feries ?? 'metropole'

  // 2. Vacances scolaires de CETTE zone qui chevauchent la période
  const { data: vacances, error: vacErr } = await supabase
    .from('vacances_scolaires')
    .select('debut, fin, label')
    .eq('zone', cabinet.zone_scolaire)
    .lte('debut', dateFin)
    .gte('fin', dateDebut)
    .order('debut')

  if (vacErr || !vacances) {
    return undefined
  }

  // 3. Jours fériés de la région qui tombent dans la période
  const { data: feries, error: ferErr } = await supabase
    .from('jours_feries')
    .select('date, libelle')
    .eq('region', region)
    .gte('date', dateDebut)
    .lte('date', dateFin)
    .order('date')

  if (ferErr || !feries) {
    return undefined
  }

  return {
    feries: new Set((feries as JourFerieDb[]).map((f) => f.date)),
    vacancesScolaires: (vacances as VacanceScolaireDb[]).map((v) => ({
      debut: v.debut,
      fin: v.fin,
    })),
  }
}

// ── Chargement des règles du cabinet (P1A-004) ───────────

/**
 * chargerReglesCabinet — lit `regles_cabinet` (la nouvelle source des règles,
 * remplace le join `contraintes_veto`) scopée sur le cabinet + la validité
 * de la période, valide chaque règle contre le catalogue `briques_regles`,
 * et retourne les contraintes moteur regroupées PAR VÉTÉRINAIRE.
 *
 * Une règle au `params_json` corrompu (brique inconnue, propriétaire absent,
 * params non-objet…) est ÉCARTÉE et tracée (console.warn) — jamais de crash
 * du solver (critère d'acceptation P1A-004).
 *
 * Retourne AUSSI les poids d'équité du cabinet, extraits des règles de famille
 * `equilibrer` (équité = règle « de compteur », gérée comme les autres mais de
 * forme différente). Une dimension sans règle retombe sur son défaut historique.
 *
 * @param supabase   client serveur (RLS-aware : la restrictive borne au cabinet)
 * @param cabinetId  cabinet courant (isolation tenant garantie par la RLS)
 * @param periodeId  période générée — inclut les règles permanentes + celles de la période
 */
async function chargerReglesCabinet(
  supabase: SupabaseServerClient,
  cabinetId: string,
  periodeId: string,
  /** Effectif ACTIF du cabinet — déplie les règles « tous les vétérinaires ». */
  tousLesVetoIds: readonly string[],
): Promise<{
  contraintesParVet: Map<string, ContrainteEngine[]>
  equityWeights: EquityWeights
  structureConfig: StructureConfig
}> {
  // Catalogue des briques connues (ids) — socle de la validation déterministe.
  const { data: briquesDb } = await supabase.from('briques_regles').select('id')
  const briquesConnues = new Set<string>(
    ((briquesDb as { id: string }[] | null) ?? []).map((b) => b.id),
  )

  // Règles actives du cabinet : permanentes (periode_id NULL) OU propres à
  // CETTE période. La RLS restrictive (F5-003) garantit déjà le scope cabinet.
  const { data: reglesDb, error } = await supabase
    .from('regles_cabinet')
    .select('id, cabinet_id, periode_id, brique_id, params_json, force, validite_json, version, actif')
    .eq('cabinet_id', cabinetId)
    .or(`periode_id.is.null,periode_id.eq.${periodeId}`)
    .order('id')

  if (error) {
    console.warn(
      `[P1A-004] Lecture regles_cabinet échouée (${error.message}) — aucune règle appliquée.`,
    )
    return {
      contraintesParVet: new Map(),
      equityWeights: buildEquityWeights([]),
      structureConfig: extraireStructureConfig([]),
    }
  }

  const rows = (reglesDb as RegleCabinetRow[] | null) ?? []

  const { contraintesParVet, rejets } = mapperReglesCabinet(rows, briquesConnues, tousLesVetoIds)
  for (const r of rejets) {
    console.warn(`[P1A-004] Règle ${r.regleId} écartée : ${r.raison}`)
  }

  // Équité : extraite des règles `equilibrer` (défaut historique si absentes).
  const equityWeights = buildEquityWeights(extraireEquityRules(rows))
  // Structurelles R8/R9 : extraites des règles liaison_creneaux/inversion_role.
  const structureConfig = extraireStructureConfig(rows)

  return { contraintesParVet, equityWeights, structureConfig }
}

// ── Chargement principal ─────────────────────────────────

/**
 * chargerInputDepuisSupabase — Charge toutes les données nécessaires
 * depuis Supabase et retourne un SolverInput prêt à l'emploi.
 *
 * Si `cabinetId` est fourni, le SolverInput est enrichi d'un `calendrier`
 * (fériés + vacances scolaires) chargé depuis les DONNÉES de référentiel,
 * scopé sur la zone/région du cabinet. Le chemin nominal utilise donc les
 * vraies vacances de la zone du cabinet, et non plus la constante en dur
 * `VACANCES_SCOLAIRES` (zone C) de utils.ts.
 *
 * Sans `cabinetId` (contextes hors-DB / legacy), `calendrier` reste absent
 * et le moteur se rabat sur les listes en dur de utils.ts (fallback).
 *
 * @param periodeId  UUID de la période à générer
 * @param cabinetId  UUID du cabinet courant (optionnel) — active le calendrier zone-aware
 * @param options    `autoriserVerrouille` (défaut false) : autorise le chargement
 *                   d'une période VERROUILLÉE. La génération l'interdit (on ne
 *                   régénère jamais un planning verrouillé) ; la gestion de crise,
 *                   elle, doit pouvoir RÉPARER un planning verrouillé sans le
 *                   régénérer (réparation ciblée d'un seul créneau).
 * @throws           Si la période est introuvable ou inaccessible
 */
export async function chargerInputDepuisSupabase(
  periodeId: string,
  cabinetId?: string,
  options?: { autoriserVerrouille?: boolean }
): Promise<SolverInput> {
  const supabase = await createClient()

  // 1. Période à générer
  const { data: periode, error: periodeErr } = await supabase
    .from('periodes')
    .select('id, saison, date_debut, date_fin, statut, profil_id')
    .eq('id', periodeId)
    .single()

  if (periodeErr || !periode) {
    throw new Error(`Période introuvable : ${periodeId}`)
  }

  if (periode.statut === 'verrouille' && !options?.autoriserVerrouille) {
    throw new Error('Cette période est verrouillée — impossible de régénérer.')
  }

  // 2. Vétérinaires actifs (les contraintes ne viennent plus du join
  //    contraintes_veto, mais de regles_cabinet — cf. étape 2b, P1A-004).
  const { data: vetsDb, error: vetsErr } = await supabase
    .from('veterinaires')
    .select('id, nom, prenom, statut, dernier_recours, tags')
    .eq('actif', true)
    .order('nom')

  if (vetsErr) throw new Error(`Erreur chargement vétérinaires : ${vetsErr.message}`)

  // 2b. Règles du cabinet (nouvelle source — remplace contraintes_veto).
  //     Scopé cabinet + validité de période ; sans cabinetId (contextes
  //     hors-DB / legacy) aucune règle n'est appliquée. Inclut les poids
  //     d'équité (extraits des règles `equilibrer`, défaut si absentes).
  //     L'effectif actif est passé au mapper : c'est lui qui déplie les règles
  //     « tous les vétérinaires » sur chaque véto (une règle collective créée
  //     avant l'arrivée d'un véto doit le couvrir lui aussi).
  const idsVetosActifs = ((vetsDb as { id: string }[] | null) ?? []).map((v) => v.id)
  const { contraintesParVet, equityWeights, structureConfig } = cabinetId
    ? await chargerReglesCabinet(supabase, cabinetId, periodeId, idsVetosActifs)
    : {
        contraintesParVet: new Map<string, ContrainteEngine[]>(),
        equityWeights: buildEquityWeights([]),
        structureConfig: extraireStructureConfig([]),
      }

  // 3. Congés validés qui chevauchent la période
  const { data: congesDb } = await supabase
    .from('conges')
    .select('veterinaire_id, date_debut, date_fin, type')
    .eq('statut', 'valide')
    .lte('date_debut', periode.date_fin)
    .gte('date_fin', periode.date_debut)

  // 4. Bonus/malus de la période précédente (pour R20)
  const { data: periodePrecedente } = await supabase
    .from('periodes')
    .select('id')
    .lt('date_fin', periode.date_debut)
    .order('date_fin', { ascending: false })
    .limit(1)
    .maybeSingle()

  let bonusMalus: BonusMalusMap = {}
  if (periodePrecedente) {
    const { data: bmDb } = await supabase
      .from('bonus_malus')
      .select('veterinaire_id, ecart_we')
      .eq('periode_id', periodePrecedente.id)

    for (const bm of (bmDb as BonusMalusDb[] | null) ?? []) {
      // ecart_we positif = a fait plus → bm positif = doit faire moins ce tour
      // On inverse le signe car dans le solver, bm positif = DOIT faire plus
      bonusMalus[bm.veterinaire_id] = -bm.ecart_we
    }
  }

  // 4b. #17 (Vague 5) — LOOKBACK INTER-PÉRIODES : les gardes des ~10 jours qui
  //     PRÉCÈDENT le début de la période. Sert aux SEULES règles de rythme
  //     (R10, R3, espacement_min, espacement_weekend, au_plus_n fenêtre) pour ne
  //     pas être aveugle à la jonction de deux périodes (ex. deux week-ends
  //     consécutifs à cheval). Filtré PAR DATE (toutes périodes confondues), scopé
  //     cabinet. BEST-EFFORT ABSOLU (comme chargerHistoriqueFetes) : erreur /
  //     absence → undefined → comportement historique byte-identique, jamais de
  //     throw. La conversion réutilise gardesVersPlanningPartiel (synthèse du
  //     vendredi_soir depuis le week-end — indispensable pour R10/R3 qui lisent
  //     ces types).
  let contexteAnterieur: AttributionGarde[] | undefined
  if (cabinetId) {
    try {
      const debutLookback = moinsJours(periode.date_debut, LOOKBACK_JOURS)
      const { data: gardesAvant, error: lookbackErr } = await supabase
        .from('gardes')
        .select('id, date, type, premier_id, second_id')
        .eq('cabinet_id', cabinetId)
        .gte('date', debutLookback)
        .lt('date', periode.date_debut)
        .order('date')
      if (!lookbackErr && gardesAvant && gardesAvant.length > 0) {
        const { attributions } = gardesVersPlanningPartiel(
          gardesAvant as GardeRow[],
          // Relations résolues plus bas (structureConfig.relations) ; à ce stade
          // on n'en a pas besoin : la synthèse du vendredi utilise le repli
          // couple historique (byte-identique pour le pilote). Les règles de
          // rythme qui consomment le lookback (R10/R3/espacements) ne dépendent
          // pas de l'inversion des rôles du vendredi, seulement de sa présence.
          undefined,
        )
        contexteAnterieur = attributions
      }
    } catch (e) {
      // Best-effort : un lookback indisponible ne doit JAMAIS casser la génération.
      console.warn('[lookback-#17] chargement du contexte antérieur ignoré (best-effort):', e)
    }
  }

  // 5. Mapper vers VetEngine (contraintes injectées depuis regles_cabinet)
  type VetDb = {
    id: string
    nom: string
    prenom: string
    statut: 'associe' | 'salarie'
    dernier_recours: boolean
    tags?: string[] | null
  }

  const vets: VetEngine[] = ((vetsDb as VetDb[]) ?? []).map((vet) => ({
    id: vet.id,
    nom: vet.nom,
    prenom: vet.prenom,
    statut: vet.statut,
    dernier_recours: vet.dernier_recours,
    // Tags d'équipe (n°6/n°22) — normalisés À LA SOURCE (parade anti-cécité :
    // tous les consommateurs comparent des tags déjà minuscules/épurés).
    tags: (vet.tags ?? []).map((t) => t.trim().toLowerCase()).filter((t) => t !== ''),
    contraintes: contraintesParVet.get(vet.id) ?? [],
    conges: ((congesDb as CongeDb[] | null) ?? [])
      .filter((c) => c.veterinaire_id === vet.id)
      .map((c): CongeEngine => ({
        date_debut: c.date_debut,
        date_fin: c.date_fin,
        type: c.type,
      })),
  }))

  // 6. Calendrier zone-aware (fériés + vacances de la zone du cabinet).
  //    Chemin nominal : on charge les vraies vacances de la zone du cabinet.
  //    Fallback : si pas de cabinetId, ou cabinet/référentiel introuvable,
  //    `calendrier` reste undefined → le moteur retombe sur utils.ts.
  const calendrier = cabinetId
    ? await chargerCalendrierZone(cabinetId, periode.date_debut, periode.date_fin)
    : undefined

  // Profil de planning de la période (P5 slice 3) : celui explicitement choisi
  // (`periode.profil_id`), sinon le profil DÉFAUT du cabinet. SOURCE UNIQUE
  // réutilisée pour le catalogue ET l'effectif → les deux photographient le même
  // profil. Sans cabinet (contextes legacy) → undefined (repli mapping en dur).
  const profilId = cabinetId
    ? await resoudreProfilId(supabase, cabinetId, (periode as { profil_id?: string | null }).profil_id ?? undefined)
    : undefined

  // ── EFFECTIF DE NUIT : DEUX MAILLONS AU LIEU DE TROIS (2026-08-04) ──
  //
  // La chaîne était : période (surcharge) > PÉRIODE TYPE > saison. Le maillon
  // du milieu a disparu, et le dernier avec lui sur ce chemin.
  //
  // Pourquoi — MiKL : « pourquoi on ne définit que le nb de véto pour les soirs
  // de la semaine et pas les week-ends ? ». Parce que ce réglage était un
  // DOUBLON partiel : la structure des gardes fixe déjà le nombre de places de
  // CHAQUE garde (`creneau_modele.nb_places`), week-ends et fériés compris. La
  // nuit de semaine était le seul créneau à avoir un second maître, qui ne
  // pouvait que le RABOTER (`Math.min` dans le solver) — un cabinet réglé à 2
  // places sur son créneau mais à 1 sur sa période type tournait à 1 sans
  // qu'aucun écran ne le dise.
  //
  // Ce qui reste : la surcharge portée par LE PLANNING lui-même, qui garde tout
  // son sens (« cet été-là, on n'était que cinq »). Sans elle, c'est le créneau
  // de la période type qui décide — un seul endroit, toutes les gardes.
  let nbVetosSemaineSoir: number | undefined
  {
    const { data: eff } = await supabase
      .from('periodes')
      .select('nb_vetos_semaine_soir')
      .eq('id', periodeId)
      .single()
    const vPeriode = (eff as { nb_vetos_semaine_soir?: number | null } | null)?.nb_vetos_semaine_soir
    if (typeof vPeriode === 'number') nbVetosSemaineSoir = vPeriode
    // Sinon undefined → le créneau de la période type décide (chemin catalogue),
    // ou la saison pour les contextes sans catalogue (chemin legacy).
  }

  // Poids d'équité : déjà calculés ci-dessus par chargerReglesCabinet (extraits
  // des règles `equilibrer`). Repli DEFAULT_EQUITY_WEIGHTS si aucune règle.

  // R11b — rôle à avantage financier (réglage cabinet, fin du « réglage
  // fantôme » P4). Best-effort : colonne absente / cabinet inconnu →
  // undefined → défaut moteur ('premier', byte-identique à l'historique).
  let roleAvantageFinancier: string | null | undefined
  if (cabinetId) {
    const { data: cab } = await supabase
      .from('cabinets')
      .select('role_avantage_financier')
      .eq('id', cabinetId)
      .maybeSingle()
    roleAvantageFinancier = mapperRoleAvantageFinancierDb(
      (cab as { role_avantage_financier?: unknown } | null)?.role_avantage_financier,
    )
  }

  // Catalogue de créneaux du cabinet (fondamentaux universels — P1/P2), SCOPÉ au
  // profil de la période (P5 slice 3). Best-effort : absent si pas de cabinet →
  // le moteur retombe sur le mapping en dur (comportement historique).
  const creneaux = cabinetId
    ? await chargerCreneauModele(supabase, cabinetId, profilId)
    : undefined

  // Relations entre créneaux (RG tranche 2) : résolues ids → codes et portées
  // par structureConfig (propagé en bloc partout). SEULEMENT si un catalogue
  // est chargé : sans catalogue (legacy), `relations` reste undefined → repli
  // couple historique. Avec catalogue, la DONNÉE fait foi — y compris vide
  // (un cabinet qui supprime ses relations découple réellement ses créneaux).
  if (cabinetId && creneaux && creneaux.length > 0) {
    const relationsRows = await chargerRelationsCreneau(supabase, cabinetId, profilId)
    structureConfig.relations = resoudreRelationsStructure(relationsRows, creneaux)
  }

  // Historique des fêtes (backlog n°14 — équité inter-annuelle). Chargé
  // UNIQUEMENT si la période couvre une fête (24-25/12, 31/12-01/01) : on
  // requête alors les années N-1 des instances couvertes, NORMALISÉES À LA
  // SOURCE (Set canonique — parade anti-cécité params). Porté par
  // structureConfig (même principe que `relations` : propagé partout —
  // resoudreContexte, generate, crise, diagnostic — sans nouveau threading).
  // Best-effort : table absente / erreur → undefined → aucune pénalité →
  // byte-identique (idem table VIDE, par construction de la pénalité).
  if (cabinetId) {
    const anneesCouvertes = anneesFetesCouvertes(periode.date_debut, periode.date_fin)
    if (anneesCouvertes.length > 0) {
      const historique = await chargerHistoriqueFetes(
        supabase,
        cabinetId,
        anneesCouvertes.map((a) => a - 1),
      )
      if (historique) structureConfig.historiqueFetes = historique
    }
  }

  return {
    dateDebut: periode.date_debut,
    dateFin: periode.date_fin,
    saison: periode.saison as 'ete' | 'hiver',
    vets,
    bonusMalus,
    calendrier,
    nbVetosSemaineSoir,
    equityWeights,
    structureConfig,
    creneaux,
    roleAvantageFinancier,
    // #17 — lookback inter-périodes (best-effort ; undefined → byte-identique).
    contexteAnterieur,
  }
}
