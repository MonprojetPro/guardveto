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
