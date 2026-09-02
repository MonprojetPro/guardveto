// ============================================================
// GUARDVETO — Tracer une génération, surtout quand elle MEURT (B-104)
// ============================================================
// MiKL, le 2026-09-02 : « ça commence quelques secondes puis la fenêtre se
// ferme… on avait déjà abordé cette histoire, tu avais soi-disant réglé le
// problème, apparemment non. »
//
// Le correctif précédent ne pouvait pas tenir : personne ne savait ce qui se
// passait. Mesuré avant d'écrire une ligne — `audit_log` ne porte AUCUNE trace
// des générations. Il n'y avait rien à lire après coup, donc chaque diagnostic
// repartait d'hypothèses.
//
// ── CE QUI REND CE MODULE DIFFÉRENT DE `tracerRelecture` ───────────────────
//
// La relecture trace à la SORTIE : elle a toujours quelque chose à raconter.
// Une génération, non — quand la fonction serverless est tuée, aucun code de
// sortie ne s'exécute. Ni le `finally`, ni la libération du verrou, ni un
// rapport d'erreur. Le processus ne peut pas raconter sa propre mort.
//
// D'où DEUX temps au lieu d'un :
//
//     ouvrirTrace()  → au début, avant le premier calcul
//     fermerTrace()  → dans le `finally`, avec le verdict
//
// **Une ligne ouverte et jamais refermée EST le résultat de mesure.** On lit
// une absence, pas une présence. C'est le seul dispositif qui observe quelque
// chose d'incapable de se signaler.
//
// ── LA RÈGLE ABSOLUE : LE TRACEUR NE PEUT RIEN CASSER ──────────────────────
//
// Un instrument qui ferait échouer une génération réussie serait pire que pas
// d'instrument. Toute erreur est avalée et journalisée, jamais propagée —
// `ouvrirTrace` rend `null` et la génération continue sans être tracée.
//
// C'est l'exception assumée à « une erreur avalée devient zéro ligne » : ici,
// zéro ligne est le bon repli. La contrepartie, c'est que l'échec doit rester
// VISIBLE dans les logs — une table vide et une table jamais écrite se
// ressemblent trop, et ce projet a déjà payé trois mois pour cette confusion.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

/** Une étape traversée, horodatée depuis l'ouverture. */
export interface EtapeTracee {
  /** Le nom de l'étape, tel que le serveur l'annonce déjà au client. */
  etape: string
  /** Millisecondes écoulées depuis l'ouverture de la trace. */
  aMs: number
}

/** Le verdict, écrit à la fermeture. */
export interface VerdictGeneration {
  issue: 'complet' | 'partiel' | 'echec' | 'erreur'
  nbGardes?: number | null
  /** Le calcul a été coupé par SES PROPRES plafonds (seed, rattrapage). */
  interrompu?: boolean
  erreur?: string | null
  etapes?: EtapeTracee[]
}

/**
 * Ouvre la trace et rend son identifiant — ou `null` si l'écriture a échoué.
 *
 * Appelée AVANT le premier calcul, à dessein : c'est ce qui permet de constater
 * qu'une génération a commencé sans jamais finir. L'appeler à la fin ne
 * garderait que les générations qui aboutissent, c'est-à-dire jamais celles
 * qu'on cherche.
 */
export async function ouvrirTrace(
  supabase: SupabaseClient,
  periodeId: string,
  cabinetId: string,
  lancePar: string | null,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('generations_trace')
      .insert({ cabinet_id: cabinetId, periode_id: periodeId, lance_par: lancePar })
      .select('id')
      .single()

    if (error) {
      console.error('[generation] trace non ouverte :', error.message)
      return null
    }
    return data?.id ?? null
  } catch (err) {
    console.error('[generation] trace non ouverte :', err)
    return null
  }
}

/**
 * Ferme la trace avec son verdict. Sans effet si l'ouverture avait échoué.
 *
 * `duree_ms` est calculée EN BASE, à partir de `ouverte_le` : une durée
 * calculée ici mesurerait le temps du processus, pas celui que l'admin a
 * attendu, et les deux divergent précisément quand quelque chose va mal.
 */
export async function fermerTrace(
  supabase: SupabaseClient,
  traceId: string | null,
  verdict: VerdictGeneration,
): Promise<void> {
  if (!traceId) return
  try {
    const { error } = await supabase.rpc('fermer_trace_generation', {
      p_trace_id: traceId,
      p_issue: verdict.issue,
      p_nb_gardes: verdict.nbGardes ?? null,
      p_interrompu: verdict.interrompu ?? false,
      p_erreur: verdict.erreur ?? null,
      p_etapes: verdict.etapes ?? [],
    })
    if (error) console.error('[generation] trace non fermée :', error.message)
  } catch (err) {
    console.error('[generation] trace non fermée :', err)
  }
}
