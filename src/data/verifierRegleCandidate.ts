// ============================================================
// GUARDVETO — Le gardien : ce que cette règle-là casserait
// ============================================================
// PRINCIPE DU PROJET (rappel, parce que tout ce fichier en découle) :
// le MOTEUR et ses garde-fous décident, Filou n'est que le porte-parole. Ce
// module est donc du calcul pur côté serveur — aucun appel d'IA, aucune
// invention possible, aucun coût par validation. Filou met en français ce que
// ce calcul a trouvé, et propose de corriger ou d'annuler.
//
// CE QUE ÇA FAIT
//
// `pre-vol.ts` sait déjà détecter onze familles d'incohérences (un véto que ses
// règles écartent de tout, un créneau que plus personne ne peut pourvoir, une
// étiquette sans porteur, une règle qui vise quelqu'un sorti de l'effectif…).
// Mais il ne tournait qu'AU MOMENT DE GÉNÉRER — c'est-à-dire des jours après
// la saisie, quand plus personne ne se souvient de la règle en cause.
//
// Ici, on le lance DEUX FOIS : une fois sur les règles telles qu'elles sont,
// une fois avec la règle candidate ajoutée. La différence entre les deux, c'est
// exactement ce que CETTE règle apporte comme problème.
//
// LE DELTA EST LE CŒUR DU TRUC. Sans lui, un cabinet qui traîne déjà trois
// avertissements les reverrait à chaque enregistrement de règle, y compris
// quand la règle qu'on vient d'écrire n'y est pour rien. Un avertissement qui
// se déclenche toujours n'avertit plus de rien : on apprend à cliquer
// « Enregistrer quand même » sans lire, et le gardien devient un péage.
//
// SUR QUELLE PÉRIODE ?
//
// Une règle est presque toujours PERMANENTE (aucune des règles du cabinet
// n'est scopée à une période, cf. l'audit du 2026-08-01). Mais le pré-vol a
// besoin d'un calendrier concret pour compter des places et des week-ends. On
// prend donc une période de référence : celle en cours, sinon la prochaine,
// sinon la plus récente. Aucune période en base → on ne peut rien simuler, et
// on le DIT (`indisponible`) au lieu de laisser croire que tout va bien.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { mesurerImpact } from '@/data/controleImpact'
import type { RegleCabinetRow } from '@/data/mapReglesCabinet'
import type { AvertissementPreVol } from '@/engine/pre-vol'

// ⚠️ CE FICHIER EST DEVENU UN ADAPTATEUR (audit du 2026-08-03).
//
// Toute la mécanique — charger le monde, appliquer la modification en mémoire,
// rejouer le pré-vol deux fois, ne garder que le delta — vit désormais dans
// `data/controleImpact.ts`, au niveau du SERVEUR et pour TOUTES les portes
// d'entrée (règles, structure, congés, départs, Filou).
//
// Pourquoi le déménagement : le gardien était appelé par le composant React de
// l'écran Règles. Filou écrivait donc des règles sans aucun contrôle croisé, et
// les dix-sept actions de l'écran Organisation n'en avaient jamais eu. Un
// principe appliqué par discipline dans chaque écran finit par être oublié
// dans le suivant.
//
// Ce fichier reste pour ne pas casser les appelants existants et conserver la
// forme `VerdictGardien` que l'écran connaît. Rien de neuf ne doit passer par
// ici : appeler `mesurerImpact` directement.

/** Le verdict rendu à l'écran Règles. */
export interface VerdictGardien {
  /**
   * `false` quand le contrôle n'a PAS pu tourner. L'écran doit alors
   * enregistrer sans prétendre que la règle a été vérifiée — un gardien muet
   * qui passe pour un gardien satisfait est pire que pas de gardien du tout.
   */
  verifie: boolean
  /** Ce que LA RÈGLE CANDIDATE apporte comme problème (delta). */
  avertissements: AvertissementPreVol[]
  /** Libellé de la période sur laquelle le contrôle a tourné. */
  periodeTestee?: string
  /** Pourquoi le contrôle n'a pas tourné, quand c'est une panne. */
  diagnostic?: string
}

/**
 * Lance le contrôle d'impact pour une règle candidate.
 *
 * @param rowCandidate  la règle en cours de saisie, sous la forme EXACTE
 *                      qu'elle aura en base. En édition, son `id` est celui de
 *                      la règle éditée : elle REMPLACE alors l'ancienne version
 *                      au lieu de s'y ajouter.
 */
export async function verifierRegleCandidate(
  supabase: SupabaseClient<any, any, any>,
  cabinetId: string,
  rowCandidate: RegleCabinetRow,
): Promise<VerdictGardien> {
  const impact = await mesurerImpact(supabase, cabinetId, {
    genre: 'regle_ajout',
    row: rowCandidate,
  })
  return {
    verifie: impact.verifie,
    avertissements: impact.nouveaux,
    periodeTestee: impact.periodeTestee,
    diagnostic: impact.diagnostic,
  }
}
