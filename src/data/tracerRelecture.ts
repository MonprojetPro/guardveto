// ============================================================
// GUARDVETO — Garder la trace de ce que Filou a dit (B-096)
// ============================================================
// MiKL, le 2026-09-02 : « Filou il a fait quoi ? Rien. » Il avait raison, et
// personne n'a pu le vérifier après coup — la relecture s'affiche à l'écran et
// ne laisse aucune trace. Impossible de relire ses constats une heure plus
// tard, impossible de comparer avant et après un correctif.
//
// C'est la première pierre de B-096 : sans elle, les autres lots donnent à
// Filou de quoi voir et de quoi agir, mais on ne saurait pas si ça a servi. On
// remplacerait « je crois qu'il ne voit rien » par « je crois qu'il voit
// mieux ». Ce projet a déjà payé trois mois de cette monnaie-là.
//
// ── LA RÈGLE ABSOLUE DE CE MODULE : IL NE PEUT RIEN CASSER ─────────────────
//
// Une trace qui ferait échouer une relecture réussie serait pire que pas de
// trace du tout. Toute erreur est donc avalée et journalisée, jamais propagée.
//
// C'est l'exception assumée à la règle « une erreur avalée devient zéro
// ligne » : ici, zéro ligne est le bon comportement de repli. Ce qui compte —
// le planning et le rapport affiché — est déjà produit quand on arrive ici.
// La contrepartie, c'est que l'échec doit rester VISIBLE dans les logs : une
// table vide et une table qui n'a jamais reçu d'écriture se ressemblent trop.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

/** Ce qu'on conserve d'une relecture — exactement ce que l'écran affiche. */
export interface TraceRelecture {
  issue: 'relu' | 'indisponible'
  modele?: string | null
  synthese?: string | null
  revue?: unknown[]
  criteresNonTraites?: unknown[]
  appliques?: unknown[]
  aTrancher?: unknown[]
  ecartes?: number
  planningModifie?: boolean
  /** Le message d'erreur, quand Filou n'a pas pu répondre. */
  erreur?: string | null
  /**
   * CE QUE FILOU AVAIT SOUS LES YEUX — pas seulement ce qu'il a répondu.
   *
   * Ajouté le 02/09 après CINQ recettes de MiKL sur le même défaut. À chaque
   * fois la même question sans réponse : le mouvement qui aurait corrigé le
   * problème était-il dans sa liste ? Et à chaque fois, il fallait reconstruire
   * le dossier à la main pour le savoir — extraire le planning de la base,
   * rejouer le calcul, comparer. Une demi-heure, pour une information que le
   * serveur avait déjà.
   *
   * Sans ça, on ne peut jamais distinguer les deux seules causes possibles :
   * le levier MANQUAIT, ou le levier était là et Filou ne l'a pas pris. Ce sont
   * deux chantiers opposés — l'un dans le moteur, l'autre dans le prompt — et
   * on a passé la journée à hésiter entre les deux.
   */
  dossier?: {
    /** Combien de mouvements de chaque genre lui ont été transmis. */
    mouvementsParGenre?: Record<string, number>
    /** Combien améliorent, sont neutres, ou dégradent. */
    effets?: Record<string, number>
    /** Qui, nommément, pouvait être allégé d'un week-end. Le cœur du sujet. */
    personnesAllegeables?: string[]
    /** Combien de mouvements légaux ont été écartés faute de place. */
    ecartes?: number
    /** Combien de préférences enfreintes lui ont été signalées. */
    preferencesEnfreintes?: number
  }
}

/**
 * Écrit la trace. Ne lève jamais, ne retourne rien d'utile à l'appelant.
 *
 * On garde aussi les ÉCHECS (`issue: 'indisponible'`) : un historique où tout
 * s'est toujours bien passé ne sert à rien, et c'est précisément quand Filou ne
 * répond pas qu'on veut pouvoir le montrer.
 */
export async function tracerRelecture(
  supabase: SupabaseClient,
  periodeId: string,
  cabinetId: string,
  trace: TraceRelecture,
): Promise<void> {
  try {
    const { error } = await supabase.from('relectures_planning').insert({
      cabinet_id: cabinetId,
      periode_id: periodeId,
      issue: trace.issue,
      modele: trace.modele ?? null,
      synthese: trace.synthese ?? null,
      revue: trace.revue ?? [],
      criteres_non_traites: trace.criteresNonTraites ?? [],
      appliques: trace.appliques ?? [],
      a_trancher: trace.aTrancher ?? [],
      ecartes: trace.ecartes ?? 0,
      planning_modifie: trace.planningModifie ?? false,
      erreur: trace.erreur ?? null,
      dossier: trace.dossier ?? null,
    })
    // Journalisé, jamais propagé : le rapport est déjà produit, et le perdre
    // pour un problème d'archivage serait absurde. Mais un échec muet ferait
    // croire à une relecture qui n'a jamais eu lieu.
    if (error) console.error('[relecture] trace non enregistrée :', error.message)
  } catch (err) {
    console.error('[relecture] trace non enregistrée :', err)
  }
}
