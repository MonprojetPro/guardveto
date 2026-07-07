// ============================================================
// GUARDVETO — Souhaits de congé en attente sur une période
// ============================================================
// SOURCE UNIQUE (backlog n°24). Cette détection existait dans le gate de
// publication (/api/publish, audit 2026-07-03) : compter les demandes de
// congé encore en attente (`statut = 'souhait'`) qui CHEVAUCHENT la période.
// Elle est désormais partagée entre :
//   • le gate de publication (/api/publish) — signal TARDIF (avant publication),
//   • le pré-vol de génération (/api/generate/pre-vol) — signal PRÉCOCE
//     (dès l'écran de génération, avant le clic « Générer »).
// Même requête, même sémantique de chevauchement — jamais dupliquée.
// ============================================================

import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Compte les demandes de congé EN ATTENTE (statut 'souhait') qui chevauchent
 * l'intervalle [dateDebut, dateFin] de la période.
 *
 * Chevauchement : le congé commence avant la fin de la période ET finit après
 * son début (bornes incluses) — sémantique identique au gate de publication.
 * Le scope cabinet est garanti par la RLS (client serveur RLS-aware).
 *
 * Best-effort : en cas d'erreur de requête, renvoie 0 (jamais de crash —
 * ce signal est informatif, il ne doit jamais bloquer publication/génération).
 */
export async function compterSouhaitsCongesEnAttente(
  supabase: SupabaseServerClient,
  dateDebut: string,
  dateFin: string,
): Promise<number> {
  const { count } = await supabase
    .from('conges')
    .select('id', { count: 'exact', head: true })
    .eq('statut', 'souhait')
    .lte('date_debut', dateFin)
    .gte('date_fin', dateDebut)
  return count ?? 0
}
