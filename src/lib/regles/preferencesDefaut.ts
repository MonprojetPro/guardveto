// ============================================================
// GUARDVETO — Les préférences ACTIVES sans ligne en base (B-064)
// ============================================================
// LE PIÈGE, mesuré le 26/08 en vérifiant que Filou connaissait la nouvelle
// préférence (demande de MiKL).
//
// Une préférence du planning n'a de ligne dans `regles_cabinet` que si
// quelqu'un l'a RÉGLÉE. C'est la convention du produit — « absence de ligne =
// défaut historique », et c'est ce qui garantit qu'un cabinet qui n'a rien
// touché se comporte comme avant.
//
// Mais tout ce qui LIT les règles depuis la base hérite du même angle mort :
// une préférence au défaut est active, elle pèse sur le planning, et elle
// n'apparaît nulle part. Mesure sur le Val d'Allier : une seule des cinq
// préférences avait une ligne. Les quatre autres étaient invisibles.
//
// Filou répondait donc « aucune règle ne le prévoit » sur une préférence
// active — la réponse incomplète présentée comme complète, exactement le
// défaut que la règle FILOU SUIT LE PRODUIT existe pour empêcher.
//
// Ce module rend les préférences manquantes, avec leur niveau par défaut, sous
// la même forme qu'une règle lue en base. Les lecteurs n'ont rien à savoir de
// la convention : ils voient l'état RÉEL du moteur.
// ============================================================

import {
  PENALITES_SOUPLES_IDS,
  PENALITE_SOUPLE_DEFAUT,
  type PenaliteSoupleId,
} from '@/engine/structure-config'
import { BRIQUES_PENALITES_SOUPLES } from '@/data/mapReglesCabinet'

/** Étage lexicographique → nom de force employé par l'écran et par Filou. */
const FORCE_PAR_ETAGE: Record<number, string> = {
  3: 'sauf_crise',
  4: 'evitee',
  5: 'si_possible',
}

/** Le niveau par défaut d'une préférence, dérivé de son étage moteur. */
export function forceParDefautPreference(id: PenaliteSoupleId): string {
  return FORCE_PAR_ETAGE[PENALITE_SOUPLE_DEFAUT[id].etage] ?? 'evitee'
}

export interface PreferenceImplicite {
  brique_id: string
  force: string
  actif: true
  /** Aucune ligne en base : ces préférences ne sont pas scopées à une période. */
  periode_id: null
  params_json: Record<string, unknown>
}

/**
 * Les préférences ACTIVES qui n'ont pas de ligne parmi `briquesPresentes`.
 *
 * À concaténer aux règles lues en base pour obtenir l'état réel du moteur.
 * Une préférence explicitement DÉSACTIVÉE a, elle, une ligne (`actif: false`) :
 * elle est donc dans `briquesPresentes` et n'est pas ré-ajoutée ici — on ne
 * ressuscite jamais une préférence que le cabinet a éteinte.
 */
export function preferencesImplicites(briquesPresentes: Iterable<string>): PreferenceImplicite[] {
  const vues = new Set(briquesPresentes)
  const out: PreferenceImplicite[] = []

  for (const [briqueId, penaliteId] of Object.entries(BRIQUES_PENALITES_SOUPLES)) {
    if (vues.has(briqueId)) continue
    if (!(PENALITES_SOUPLES_IDS as readonly string[]).includes(penaliteId)) continue
    out.push({
      brique_id: briqueId,
      force: forceParDefautPreference(penaliteId),
      actif: true,
      periode_id: null,
      params_json: {},
    })
  }
  return out
}
