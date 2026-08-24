// ============================================================
// GUARDVETO — Ce que Filou a le droit de lire, et pour qui
// ============================================================
// ⚠️ LE PIÈGE QUE CE MODULE EXISTE POUR FERMER.
//
// Les vues `planning_semaine` et `compteurs_gardes` appartiennent à `postgres`
// et ne sont PAS déclarées `security_invoker`. Une vue non-invoker s'exécute
// avec les droits de son propriétaire : quand on la lit, **aucune politique
// RLS ne s'applique** — ni le filtre de rôle, ni même l'isolation par cabinet.
// Vérifié en base le 2026-08-21 :
//
//   relname          | owner    | bypassrls | reloptions
//   planning_semaine | postgres | true      | null
//   compteurs_gardes | postgres | true      | null
//
// Les écrans s'en sortent parce qu'ils posent le tri en TypeScript
// (`lib/planning/diffusion.ts`, commit c1f538b). Filou, lui, ne le posait
// nulle part : un vétérinaire obtenait par le chat le planning non diffusé que
// son écran venait de cesser de lui montrer, et les compteurs d'équité de
// toute l'équipe que `/historique` venait de lui fermer.
//
// LA RÈGLE, en une phrase : tout outil qui lit une VUE doit d'abord demander
// ici quelles périodes la personne a le droit de voir, puis borner sa requête
// à celles-là. Trois protections d'un coup — le cabinet, le rôle, la diffusion.
//
// Le critère de diffusion est `publie_at`, JAMAIS le statut : une période peut
// être « verrouillée » sans avoir jamais été diffusée (historique amorcé en
// base), et c'est exactement le cas du cabinet pilote aujourd'hui.
// ============================================================

import { lignesLues } from './lecture'
import type { ContexteOutil } from './types'

export interface PeriodeAutorisee {
  id: string
  libelle: string | null
  saison: string
  numero: number | null
  date_debut: string
  date_fin: string
  statut: string
  publie_at: string | null
}

export interface PerimetrePeriodes {
  /** Les périodes que cette personne a le droit de voir, plus récente d'abord. */
  periodes: PeriodeAutorisee[]
  /** Leurs identifiants — à passer tel quel à un `.in('periode_id', …)`. */
  ids: string[]
  /**
   * Vrai si la personne n'a le droit de voir AUCUNE période. Un `.in()` sur une
   * liste vide ne renvoie rien, ce qui est le bon comportement ; ce drapeau
   * existe pour que l'outil puisse le DIRE (« aucun planning ne t'a encore été
   * diffusé ») au lieu de laisser croire à un cabinet sans planning.
   */
  vide: boolean
}

/**
 * Les périodes lisibles par la personne qui parle à Filou.
 *
 * L'administratrice voit toutes celles de SON cabinet — elle les prépare.
 * Un vétérinaire ne voit que celles qui lui ont été DIFFUSÉES : un brouillon
 * qu'il obtiendrait par le chat serait une promesse que personne ne lui a
 * faite, et il organiserait sa vie dessus.
 *
 * Le filtre `cabinet_id` est explicite et non négociable, même si la table
 * `periodes` porte déjà une RLS : ce périmètre sert aussi à borner des lectures
 * de VUES, qui, elles, n'en ont aucune.
 */
export async function perimetrePeriodes(ctx: ContexteOutil): Promise<PerimetrePeriodes> {
  let requete = ctx.supabase
    .from('periodes')
    .select('id, libelle, saison, numero, date_debut, date_fin, statut, publie_at')
    .eq('cabinet_id', ctx.cabinetId)
    .order('date_debut', { ascending: false })
    .limit(50)

  if (!ctx.estAdmin) requete = requete.not('publie_at', 'is', null)

  // ⚠️ `vide: true` est une AFFIRMATION : « aucun planning ne t'a été diffusé ».
  // Une lecture en panne ne doit jamais la produire — c'est la différence entre
  // informer et mentir poliment.
  const periodes = lignesLues<PeriodeAutorisee>(await requete, 'la liste des plannings du cabinet')
  return {
    periodes,
    ids: periodes.map((p) => p.id),
    vide: periodes.length === 0,
  }
}

/**
 * La phrase à renvoyer quand la personne n'a droit à aucune période.
 *
 * Elle est volontairement neutre côté vétérinaire : dire « il existe un
 * brouillon mais tu n'y as pas accès » trahirait déjà l'existence et l'état
 * d'un planning qu'il n'est pas censé connaître.
 */
export function messagePerimetreVide(ctx: ContexteOutil): string {
  return ctx.estAdmin
    ? "Aucun planning n'existe encore pour ce cabinet."
    : "Aucun planning ne t'a encore été diffusé. Tes gardes apparaîtront dès qu'il sera publié."
}
