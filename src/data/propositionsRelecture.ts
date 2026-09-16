// ============================================================
// GUARDVETO — Les propositions de Filou EN ATTENTE (B-122 lot 2)
// ============================================================
// Le pendant persisté de `data/tracerRelecture.ts` : celui-là garde une trace
// en lecture seule, celui-ci garde un ÉTAT ACTIONNABLE — l'admin doit pouvoir
// revenir dessus demain matin et encore trancher.
//
// ── CE QUE CE MODULE N'EST PAS ─────────────────────────────────────────────
//
// Ce n'est pas la source de vérité sur ce qu'il faut ÉCRIRE si on accepte —
// ça, c'est `engine/relecture/appliquerProposition.ts`, rejoué au moment du
// clic. Ce module ne fait que conserver ce que Filou a proposé et ce que le
// moteur lui reprochait, pour que l'écran puisse l'afficher sans tout
// reconstruire, et pour que la question ne se pose plus deux fois.
//
// ── LA RÈGLE DE PÉREMPTION ──────────────────────────────────────────────────
//
// Une proposition n'a de sens que sur LE planning qui l'a vue naître. Dès
// qu'une nouvelle relecture tourne sur la période (donc, indirectement, dès
// qu'une nouvelle génération a eu lieu), toute proposition encore
// `en_attente` de la fois précédente devient `perimee` : le planning qu'elle
// visait n'est plus forcément celui qui est affiché.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChangementPropose } from '@/engine/relecture/arbitrer'
import type { Violation } from '@/engine/validation/validerPlanning'
import type { StatutPropositionRelecture } from '@/types'

/** Une proposition telle qu'elle sort de la relecture, prête à persister. */
export interface PropositionAPersister {
  changement: ChangementPropose
  violations: Violation[]
  /** « Antoine 27 -> 25 » — cf. `lib/planning/compteursProjetes.ts`. */
  compteursProjetes: { prenom: string; avant: number; apres: number }[]
}

/** Une proposition telle qu'elle sort de la base. */
export interface PropositionEnAttente {
  id: string
  periodeId: string
  changementId: string
  statut: StatutPropositionRelecture
  changement: ChangementPropose
  violations: Violation[]
  compteursProjetes: { prenom: string; avant: number; apres: number }[]
  creeLe: string
}

/**
 * Périme toutes les propositions encore `en_attente` d'une période.
 *
 * Appelée à deux moments : avant d'insérer un nouveau lot (la relecture qui
 * vient de tourner remplace l'ancien aperçu), et au début d'une nouvelle
 * génération (filet de sécurité si aucune relecture ne suit — Filou
 * indisponible, par exemple). Best-effort : une périmée manquée laisse au pire
 * une proposition obsolète visible un peu plus longtemps, jamais une écriture
 * fausse — `appliquerProposition` revalide de toute façon au moment du clic.
 */
export async function perimerPropositionsDeLaPeriode(
  supabase: SupabaseClient,
  periodeId: string,
): Promise<void> {
  const { error } = await supabase
    .from('propositions_relecture')
    .update({ statut: 'perimee', decidee_le: new Date().toISOString() })
    .eq('periode_id', periodeId)
    .eq('statut', 'en_attente')

  if (error) console.error('[propositions_relecture] péremption non enregistrée :', error.message)
}

/**
 * Remplace le lot `en_attente` d'une période par les propositions fraîches.
 *
 * Ne lève jamais : une trace non enregistrée est un défaut d'affichage, pas
 * une raison de faire échouer une relecture déjà réussie — même principe que
 * `tracerRelecture`.
 */
export async function persisterPropositionsEnAttente(
  supabase: SupabaseClient,
  cabinetId: string,
  periodeId: string,
  relectureId: string | null,
  propositions: PropositionAPersister[],
): Promise<void> {
  await perimerPropositionsDeLaPeriode(supabase, periodeId)

  if (propositions.length === 0) return

  const { error } = await supabase.from('propositions_relecture').insert(
    propositions.map((p) => ({
      cabinet_id: cabinetId,
      periode_id: periodeId,
      relecture_id: relectureId,
      changement_id: p.changement.id,
      statut: 'en_attente',
      changement: p.changement,
      violations: p.violations,
      compteurs_projetes: p.compteursProjetes,
    })),
  )

  if (error) console.error('[propositions_relecture] insertion non enregistrée :', error.message)
}

interface LigneBrute {
  id: string
  periode_id: string
  changement_id: string
  statut: StatutPropositionRelecture
  changement: ChangementPropose
  violations: Violation[]
  compteurs_projetes: { prenom: string; avant: number; apres: number }[]
  cree_le: string
}

/** Les propositions encore en attente d'une période, les plus anciennes d'abord. */
export async function chargerPropositionsEnAttente(
  supabase: SupabaseClient,
  periodeId: string,
): Promise<{ propositions: PropositionEnAttente[]; erreur: string | null }> {
  const { data, error } = await supabase
    .from('propositions_relecture')
    .select('id, periode_id, changement_id, statut, changement, violations, compteurs_projetes, cree_le')
    .eq('periode_id', periodeId)
    .eq('statut', 'en_attente')
    .order('cree_le')

  if (error) return { propositions: [], erreur: error.message }

  const propositions = ((data ?? []) as LigneBrute[]).map((r) => ({
    id: r.id,
    periodeId: r.periode_id,
    changementId: r.changement_id,
    statut: r.statut,
    changement: r.changement,
    violations: r.violations ?? [],
    compteursProjetes: r.compteurs_projetes ?? [],
    creeLe: r.cree_le,
  }))

  return { propositions, erreur: null }
}

/** Marque une décision de l'admin — appliquée ou rejetée, jamais périmée ici. */
export async function marquerPropositionDecidee(
  supabase: SupabaseClient,
  propositionId: string,
  statut: Extract<StatutPropositionRelecture, 'appliquee' | 'rejetee'>,
): Promise<{ ok: boolean; erreur: string | null }> {
  const { error } = await supabase
    .from('propositions_relecture')
    .update({ statut, decidee_le: new Date().toISOString() })
    .eq('id', propositionId)
    .eq('statut', 'en_attente')

  if (error) return { ok: false, erreur: error.message }
  return { ok: true, erreur: null }
}
