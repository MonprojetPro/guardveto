// ============================================================
// GUARDVETO — Chargeur de données Supabase pour le solver
// ============================================================
// Transforme les données Supabase (vétérinaires, contraintes,
// congés, bonus/malus) en SolverInput consommable par genererPlanningPur().
// ============================================================

import { createClient } from '@/lib/supabase/server'
import type { VetEngine, ContrainteEngine, CongeEngine, CalendrierResolu } from './types'
import type { BonusMalusMap } from './score-lexicographique'
import type { SolverInput } from './solver'
import { buildEquityWeights, type EquityWeights } from './equity-weights'
import { type StructureConfig } from './structure-config'
import {
  mapperReglesCabinet,
  extraireEquityRules,
  extraireStructureConfig,
  type RegleCabinetRow,
} from '@/data/mapReglesCabinet'
import { chargerCreneauModele, resoudreProfilId, chargerEffectifProfil } from '@/data/chargerCreneauModele'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

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

  const { contraintesParVet, rejets } = mapperReglesCabinet(rows, briquesConnues)
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
    .select('id, nom, prenom, statut, dernier_recours')
    .eq('actif', true)
    .order('nom')

  if (vetsErr) throw new Error(`Erreur chargement vétérinaires : ${vetsErr.message}`)

  // 2b. Règles du cabinet (nouvelle source — remplace contraintes_veto).
  //     Scopé cabinet + validité de période ; sans cabinetId (contextes
  //     hors-DB / legacy) aucune règle n'est appliquée. Inclut les poids
  //     d'équité (extraits des règles `equilibrer`, défaut si absentes).
  const { contraintesParVet, equityWeights, structureConfig } = cabinetId
    ? await chargerReglesCabinet(supabase, cabinetId, periodeId)
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

  // 5. Mapper vers VetEngine (contraintes injectées depuis regles_cabinet)
  type VetDb = {
    id: string
    nom: string
    prenom: string
    statut: 'associe' | 'salarie'
    dernier_recours: boolean
  }

  const vets: VetEngine[] = ((vetsDb as VetDb[]) ?? []).map((vet) => ({
    id: vet.id,
    nom: vet.nom,
    prenom: vet.prenom,
    statut: vet.statut,
    dernier_recours: vet.dernier_recours,
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

  // Effectif configurable — PRÉCÉDENCE : période (surcharge) > profil > saison.
  // Lecture BEST-EFFORT (jamais de throw) : une colonne absente (déploiement
  // avant migration) → undefined → repli saison (hiver = 2, été = 1) en aval.
  // Byte-identique : toutes les périodes existantes portent déjà une valeur
  // explicite (backfill P1-B) → la branche période gagne toujours pour elles ;
  // le profil ne s'applique qu'aux périodes sans surcharge (ex. profil « Été »).
  let nbVetosSemaineSoir: number | undefined
  {
    const { data: eff } = await supabase
      .from('periodes')
      .select('nb_vetos_semaine_soir')
      .eq('id', periodeId)
      .single()
    const vPeriode = (eff as { nb_vetos_semaine_soir?: number | null } | null)?.nb_vetos_semaine_soir
    if (typeof vPeriode === 'number') {
      nbVetosSemaineSoir = vPeriode
    } else if (profilId) {
      // Pas de surcharge période → l'effectif porté par le profil de la période.
      nbVetosSemaineSoir = await chargerEffectifProfil(supabase, profilId)
    }
    // Sinon undefined → le solver retombe sur la saison.
  }

  // Poids d'équité : déjà calculés ci-dessus par chargerReglesCabinet (extraits
  // des règles `equilibrer`). Repli DEFAULT_EQUITY_WEIGHTS si aucune règle.

  // Catalogue de créneaux du cabinet (fondamentaux universels — P1/P2), SCOPÉ au
  // profil de la période (P5 slice 3). Best-effort : absent si pas de cabinet →
  // le moteur retombe sur le mapping en dur (comportement historique).
  const creneaux = cabinetId
    ? await chargerCreneauModele(supabase, cabinetId, profilId)
    : undefined

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
  }
}
