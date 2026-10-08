// ============================================================
// GUARDVETO — Détection de conflit congé ↔ planning publié
// ============================================================
// LOT A3 du chantier « unification indisponibilités ».
//
// Cœur du fix « Antoine » : poser un congé (ou une indisponibilité) sur un
// véto DÉJÀ affecté à une garde d'un planning DIFFUSÉ doit être DÉTECTÉ — pas
// passer silencieusement.
//
// Ce service NE FAIT PAS de requête SQL : il DÉLÈGUE intégralement à
// `recenserCreneauxImpactes` (cf. src/lib/crise/contexte.ts), qui sait déjà
// retrouver, pour un véto et une plage de dates, les gardes des périodes
// PUBLIÉES/VERROUILLÉES où il est 1er ou 2nd. On réutilise cette source unique
// pour ne pas dupliquer (et faire diverger) la logique de lecture des gardes.
//
// ⚠️ Ce module ne MODIFIE pas encore les server actions conges : le câblage
//    dans createConge/validerConge/updateConge est le LOT A4.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  recenserCreneauxImpactes,
  type CreneauImpacte,
} from '@/lib/crise/contexte'
import {
  indexerExceptions,
  occupantReel,
  type ExceptionJour,
} from '@/lib/gardes/exceptions-jour'
import { addDays, datesCouvertesParGardeV1 } from '@/engine/utils'


/** Résultat de la détection : y a-t-il conflit, et sur quels créneaux ? */
export interface ResultatDetectionConflit {
  /** true dès qu'au moins une garde publiée chevauche la plage de l'indispo. */
  aConflit: boolean
  /** Gardes publiées/verrouillées impactées (vide si aucun conflit). */
  creneauxImpactes: CreneauImpacte[]
}

/**
 * detecterConflitPlanningPublie — un congé/indisponibilité posé sur ce véto,
 * pour cette plage, percute-t-il un planning DÉJÀ DIFFUSÉ ?
 *
 * Délègue à `recenserCreneauxImpactes` (réutilisation pure — aucune requête
 * dupliquée). Cette fonction filtre déjà :
 *   - le scope cabinet,
 *   - les gardes où le véto est réellement 1er OU 2nd,
 *   - les seules périodes au statut 'publie' ou 'verrouille' (un brouillon se
 *     régénère → pas de conflit),
 *   - le futur (date >= aujourd'hui ET >= date_debut) : on ne « réveille » pas
 *     un conflit sur des gardes déjà passées.
 *
 * GESTION D'ERREUR — choix : NE PAS PROPAGER.
 *   Si le recensement échoue (lecture des gardes en erreur), on logge et on
 *   retourne `aConflit:false`. Raison : ce service est appelé (lot A4) sur le
 *   chemin de création/validation d'un congé. Faire planter la création d'un
 *   congé parce que la DÉTECTION d'un conflit a échoué serait pire que le
 *   problème qu'on résout — l'admin ne pourrait plus poser de congé du tout.
 *   La détection est un GARDE-FOU d'alerte, pas une condition de validité : en
 *   cas de panne de la sonde, on laisse passer (fail-open) en le traçant, plutôt
 *   que de bloquer le métier (fail-closed). Le congé reste créable ; au pire
 *   l'alerte « Antoine » n'apparaît pas sur ce cas dégradé (= comportement V1
 *   actuel), mais on ne casse rien.
 *
 * @param params.supabase       client serveur Supabase (RLS-aware, scopé cabinet)
 * @param params.cabinetId      cabinet courant
 * @param params.veterinaireId  véto sur lequel l'indispo est posée
 * @param params.dateDebut      début de l'indispo (ISO yyyy-MM-dd)
 * @param params.dateFin        fin de l'indispo (ISO yyyy-MM-dd)
 */
export async function detecterConflitPlanningPublie(params: {
  supabase: SupabaseClient
  cabinetId: string
  veterinaireId: string
  dateDebut: string
  dateFin: string
}): Promise<ResultatDetectionConflit> {
  const { supabase, cabinetId, veterinaireId, dateDebut, dateFin } = params

  try {
    const creneauxImpactes = await recenserCreneauxImpactes(
      supabase,
      cabinetId,
      veterinaireId,
      dateDebut,
      dateFin,
    )

    return {
      aConflit: creneauxImpactes.length > 0,
      creneauxImpactes,
    }
  } catch (err) {
    // Fail-open tracé : la détection est un garde-fou, pas un bloquant métier.
    console.error(
      '[detecterConflitPlanningPublie] échec du recensement des créneaux impactés ' +
        `(cabinet=${cabinetId}, veto=${veterinaireId}, ${dateDebut}→${dateFin}) :`,
      err instanceof Error ? err.message : err,
    )
    return { aConflit: false, creneauxImpactes: [] }
  }
}

// ============================================================
// Verdict pour DÉCIDER d'un souhait — publié ET brouillon
// ============================================================
// POURQUOI CE SECOND DÉTECTEUR EXISTE (retour MiKL, 2026-08-20)
//
// L'écran Absences affichait « ✓ Aucun conflit avec le planning publié » sur
// CHAQUE souhait — alors que le cabinet n'avait AUCUN planning publié. Le
// message était vrai au pied de la lettre et trompeur en pratique : il
// ressemble à un contrôle rassurant, mais rien n'avait été contrôlé. Pendant
// ce temps, les six souhaits tombaient tous dans un planning EN BROUILLON,
// et trois d'entre eux sur une garde déjà attribuée — invisible.
//
// Un brouillon n'est pas une crise (il se régénère, personne ne l'a reçu),
// mais l'administratrice DOIT le savoir avant de valider : « j'accepte, et je
// régénère » n'est pas la même décision que « j'accepte, sans conséquence ».
//
// ⚠️ `recenserCreneauxImpactes` n'est PAS élargie : elle sert au flux de crise,
//    qui RÉPARE un planning diffusé. Lui faire remonter des brouillons
//    proposerait de réparer ce qui n'a pas besoin de l'être. On requête donc
//    ici, en propre, avec la même grammaire (scope cabinet, véto 1er OU 2nd,
//    jamais le passé).

/** Ce qu'une garde en conflit doit dire à qui décide. */
export interface GardeEnConflit {
  date: string
  role: string
  /** Libellé de la période, pour nommer le planning concerné. */
  periodeLibelle: string
}

/**
 * Verdict complet d'un souhait de congé, séparé par gravité :
 *   - `publiees`  : le planning est parti chez les vétérinaires → décision lourde
 *   - `brouillon` : rien n'est diffusé, une régénération suffit → décision simple
 * `aucunPlanning` distingue « j'ai regardé, il n'y a rien » de « je n'ai rien
 * regardé » — c'est précisément la confusion qu'on corrige.
 */
export interface VerdictSouhait {
  publiees: GardeEnConflit[]
  brouillon: GardeEnConflit[]
  /** Aucune garde n'existe sur ces dates, tous plannings confondus. */
  aucunPlanning: boolean
}

/** Une ligne de `gardes` telle que ce détecteur la lit. */
export interface LigneGardeConflit {
  id?: string
  date: string
  type: string
  premier_id: string | null
  second_id: string | null
  periode_id: string
}

/** Un conflit situé, avant d'être rangé par gravité. */
export interface ConflitSitue {
  periodeId: string
  date: string
  role: string
}

/**
 * Les conflits réels entre une plage d'indisponibilité et des gardes.
 *
 * ── B-156 — LE FAUX NÉGATIF LE PLUS CHER DE L'AUDIT DU 08/10 ────────────────
 *
 * 🔴 CE QUE FAISAIT CE DÉTECTEUR. Il lisait `gardes.premier_id/second_id` : les
 *    TITULAIRES. Depuis B-061, un remplacement d'un jour s'écrit dans
 *    `gardes_exceptions` et la table `gardes` ne bouge pas. Donc :
 *
 *      · le congé d'un REMPLAÇANT passait pour « aucun conflit » — on pouvait
 *        lui accorder un congé un soir où il est de garde, et personne n'aurait
 *        tenu ce soir-là. C'est le seul trou de l'audit qui peut laisser un
 *        cabinet sans vétérinaire ;
 *      · à l'inverse, on annonçait un conflit à un titulaire DÉJÀ remplacé —
 *        un avertissement faux, qui apprend à ne plus lire les avertissements.
 *
 * 🔑 ON RAISONNE JOUR PAR JOUR, parce que c'est la maille du remplacement. Au
 *    passage, ça répare un second angle mort : la ligne `gardes` d'un week-end
 *    ne porte que le samedi, alors que la garde occupe aussi le vendredi et le
 *    dimanche. Un souhait posé un dimanche de garde ne percutait donc rien.
 *
 * ⚠️ UNE SEULE ENTRÉE PAR (GARDE, RÔLE), datée du premier jour touché. Trois
 *    lignes « conflit » pour un même week-end seraient exactes et illisibles —
 *    et un écran qui crie trois fois ne se lit plus (leçon du bandeau, B-130a).
 *
 * PURE et exportée : c'est la règle qui portait le défaut, elle doit être
 * vérifiable sans base.
 */
export function conflitsDepuisGardes(params: {
  gardes: readonly LigneGardeConflit[]
  exceptions: readonly ExceptionJour[]
  veterinaireId: string
  borneBasse: string
  dateFin: string
}): ConflitSitue[] {
  const { gardes, exceptions, veterinaireId, borneBasse, dateFin } = params
  const index = indexerExceptions(exceptions)
  const out: ConflitSitue[] = []

  for (const g of gardes) {
    const jours = datesCouvertesParGardeV1(g.date, g.type).filter(
      (j) => j >= borneBasse && j <= dateFin,
    )
    if (jours.length === 0) continue

    for (const role of ['premier', 'second'] as const) {
      // Le premier jour où il est RÉELLEMENT de garde. Aucun → il a été
      // remplacé sur toute la fenêtre, et il n'y a plus de conflit du tout.
      const jour = jours.find((j) => occupantReel(g, index, j, role) === veterinaireId)
      if (jour) out.push({ periodeId: g.periode_id, date: jour, role })
    }
  }
  return out
}

export async function detecterConflitsPourDecision(params: {
  supabase: SupabaseClient
  cabinetId: string
  veterinaireId: string
  dateDebut: string
  dateFin: string
  /** Injectable pour les tests. */
  aujourdhui?: string
}): Promise<VerdictSouhait> {
  const { supabase, cabinetId, veterinaireId, dateDebut, dateFin } = params
  const aujourdhui = params.aujourdhui ?? new Date().toISOString().slice(0, 10)

  // On ne juge JAMAIS le passé : une garde d'hier ne se réattribue pas.
  const borneBasse = dateDebut > aujourdhui ? dateDebut : aujourdhui

  try {
    // DEUX SOURCES, et aucune n'est complète toute seule :
    //   • `gardes`       — présente sur TOUS les plannings, y compris importés,
    //     mais elle ne stocke PAS le vendredi soir : celui-ci est dérivé du
    //     week-end (même binôme, rôles inversés). Un souhait posé un vendredi
    //     de garde y passait donc pour « aucun conflit » — le cas Victor du
    //     9 octobre, vu en recette.
    //   • `attributions` — contient bien les vendredis, mais reste vide sur les
    //     plannings importés (période « Historique été » : 0 ligne).
    // Interroger l'une ou l'autre seule, c'est mentir par omission dans un cas
    // sur deux. On fusionne, et on dédoublonne sur (période, date, rôle).
    //
    // ⚠️ B-156 — TROIS SOURCES DÉSORMAIS. La requête sur `gardes` ci-dessous ne
    //    ramène que les gardes où le véto est TITULAIRE : celles où il n'est que
    //    remplaçant d'un jour n'y figurent pas, et c'est précisément le cas qui
    //    pouvait laisser un soir sans personne. Les remplacements de la plage
    //    sont donc lus à part, puis leurs gardes rapatriées.
    //    La borne basse s'élargit d'un jour : un week-end daté du samedi occupe
    //    le vendredi, et un souhait qui commence le samedi percute quand même
    //    cette garde-là.
    const veilleBorneBasse = addDays(borneBasse, -1)
    const [gardesRes, attribsRes, excRes] = await Promise.all([
      supabase
        .from('gardes')
        .select('id, date, type, premier_id, second_id, periode_id, periodes!inner(statut, libelle)')
        .eq('cabinet_id', cabinetId)
        .gte('date', veilleBorneBasse)
        .lte('date', dateFin)
        .or(`premier_id.eq.${veterinaireId},second_id.eq.${veterinaireId}`),
      supabase
        .from('attributions')
        .select('date_debut_reel, role, planning_id, periodes!inner(statut, libelle)')
        .eq('cabinet_id', cabinetId)
        .eq('veterinaire_id', veterinaireId)
        .gte('date_debut_reel', `${borneBasse}T00:00:00Z`)
        .lte('date_debut_reel', `${dateFin}T23:59:59Z`),
      supabase
        .from('gardes_exceptions')
        .select('garde_id, date, role, veterinaire_id')
        .eq('cabinet_id', cabinetId)
        .gte('date', borneBasse)
        .lte('date', dateFin),
    ])

    if (gardesRes.error) throw new Error(gardesRes.error.message)
    // L'absence d'attributions n'est jamais bloquante : sur un planning importé
    // la table est vide par construction, `gardes` prend le relais.
    if (attribsRes.error) {
      console.warn(
        '[detecterConflitsPourDecision] attributions illisibles, repli sur gardes :',
        attribsRes.error.message,
      )
    }

    type Periode = { statut: string; libelle: string | null }
    const unePeriode = (p: Periode | Periode[]): Periode | undefined =>
      Array.isArray(p) ? p[0] : p

    const publiees = new Map<string, GardeEnConflit>()
    const brouillon = new Map<string, GardeEnConflit>()

    /** Range une garde dans le bon seau. Une période VERROUILLÉE est ignorée :
     *  elle ne se modifie plus, alerter devant une porte fermée n'aide personne. */
    const ranger = (per: Periode | undefined, periodeId: string, date: string, role: string) => {
      if (!per) return
      const cible = per.statut === 'publie' ? publiees : per.statut === 'brouillon' ? brouillon : null
      if (!cible) return
      cible.set(`${periodeId}|${date}|${role}`, {
        date,
        role,
        periodeLibelle: per.libelle ?? 'planning sans nom',
      })
    }

    type LigneGarde = LigneGardeConflit & { periodes: Periode | Periode[] }

    const gardesTitulaire = ((gardesRes.data as LigneGarde[] | null) ?? [])

    // ── B-156 — les gardes où il n'est QUE remplaçant d'un jour ──────────────
    //
    // Elles sont absentes de la requête ci-dessus (il n'y est ni premier ni
    // second). Sans ce rapatriement, son congé passerait pour sans conflit le
    // jour même où il est de garde — le trou le plus coûteux de l'audit.
    const exceptions = ((excRes.data as ExceptionJour[] | null) ?? [])
    if (excRes.error) {
      console.warn(
        '[detecterConflitsPourDecision] remplacements illisibles, repli sur les titulaires :',
        excRes.error.message,
      )
    }

    const dejaChargees = new Set(gardesTitulaire.map((g) => g.id).filter(Boolean))
    const idsRemplacant = [
      ...new Set(
        exceptions
          .filter((e) => e.veterinaire_id === veterinaireId && !dejaChargees.has(e.garde_id))
          .map((e) => e.garde_id),
      ),
    ]

    let gardesRemplacant: LigneGarde[] = []
    if (idsRemplacant.length > 0) {
      const { data, error } = await supabase
        .from('gardes')
        .select('id, date, type, premier_id, second_id, periode_id, periodes!inner(statut, libelle)')
        .eq('cabinet_id', cabinetId)
        .in('id', idsRemplacant)
      if (error) {
        // Tracé, jamais silencieux : sans ces gardes, le verdict est incomplet
        // et se lirait comme rassurant.
        console.warn(
          '[detecterConflitsPourDecision] gardes de remplacement illisibles :',
          error.message,
        )
      }
      gardesRemplacant = (data as LigneGarde[] | null) ?? []
    }

    const toutesLesGardes = [...gardesTitulaire, ...gardesRemplacant]
    const periodeParId = new Map<string, Periode | undefined>()
    for (const g of toutesLesGardes) periodeParId.set(g.periode_id, unePeriode(g.periodes))

    for (const c of conflitsDepuisGardes({
      gardes: toutesLesGardes,
      exceptions,
      veterinaireId,
      borneBasse,
      dateFin,
    })) {
      ranger(periodeParId.get(c.periodeId), c.periodeId, c.date, c.role)
    }

    type LigneAttrib = {
      date_debut_reel: string
      role: string
      planning_id: string
      periodes: Periode | Periode[]
    }
    for (const a of ((attribsRes.data as LigneAttrib[] | null) ?? [])) {
      // `date_debut_reel` est un instant (le vendredi soir démarre à 18h30) :
      // on ne garde que le jour, pour parler la même langue que `gardes`.
      ranger(unePeriode(a.periodes), a.planning_id, a.date_debut_reel.slice(0, 10), a.role)
    }

    const tri = (m: Map<string, GardeEnConflit>) =>
      [...m.values()].sort((x, y) => x.date.localeCompare(y.date))

    const listePubliees = tri(publiees)
    const listeBrouillon = tri(brouillon)

    return {
      publiees: listePubliees,
      brouillon: listeBrouillon,
      aucunPlanning: listePubliees.length === 0 && listeBrouillon.length === 0,
    }
  } catch (err) {
    // Fail-open tracé, comme le détecteur historique : un garde-fou muet ne
    // doit jamais empêcher l'écran de vivre ni bloquer une décision.
    console.error(
      '[detecterConflitsPourDecision] échec ' +
        `(cabinet=${cabinetId}, veto=${veterinaireId}, ${dateDebut}→${dateFin}) :`,
      err instanceof Error ? err.message : err,
    )
    return { publiees: [], brouillon: [], aucunPlanning: false }
  }
}
