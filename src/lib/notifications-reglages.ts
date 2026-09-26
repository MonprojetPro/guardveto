// ============================================================
// GUARDVETO — Les e-mails que chacun choisit de recevoir (B-134)
// ============================================================
// MiKL, le 26/09 : « faudrait prévoir un toggle pour ces demandes de réception
// de mail pour les congés et pour d'autres notifications qui viendraient après,
// dans les réglages… prévoir aussi que ce soit le cas du côté des autres
// profils ».
//
// ── CE FICHIER EST LA SOURCE UNIQUE ─────────────────────────────────────────
// L'écran de réglages et les envois lisent la MÊME liste. C'est ce qui empêche
// le défaut qu'on a déjà payé plusieurs fois : un interrupteur affiché que
// personne ne consulte au moment d'envoyer. Ajouter un réglage ici, c'est
// l'obtenir à l'écran ET le voir respecté par l'envoi — ou faire échouer
// `notifications-reglages.test.ts`, qui vérifie que chaque réglage déclaré est
// réellement consulté par un envoi.
//
// ── CE QUI EST RÉGLABLE, ET CE QUI NE L'EST PAS ─────────────────────────────
// Seul l'E-MAIL se coupe. La notification in-app (la cloche) reste TOUJOURS
// créée. Deux raisons : MiKL parle de « réception de mail », et une cloche
// muette laisserait quelqu'un sans aucune trace d'un événement qui le concerne
// — un silence total, alors qu'ici on veut seulement réduire le bruit de la
// boîte mail. Couper l'e-mail éloigne l'information ; couper la cloche la
// supprimerait.
//
// ── LA RÈGLE DE DÉFAUT ──────────────────────────────────────────────────────
// Pas de ligne en base, ou type absent de `desactivees` = ON REÇOIT. Voir la
// migration `20260926150000_preferences_notifications.sql` : on stocke ce qui
// est COUPÉ, jamais ce qui est allumé, pour qu'aucun oubli ne produise de
// silence.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

/** Rôles qui peuvent voir un réglage donné dans leur écran. */
export type RoleReglage = 'admin' | 'veto'

/**
 * Un réglage = une case à l'écran. Il peut commander PLUSIEURS types d'e-mails
 * quand la distinction n'intéresse personne : « ma demande a été tranchée »
 * vaut pour un accord comme pour un refus, et proposer deux cases obligerait à
 * réfléchir à une nuance dont l'utilisateur n'a rien à faire.
 */
export interface Reglage {
  cle: CleReglage
  /** Ce que la personne lit dans l'écran. Formulé à la première personne. */
  libelle: string
  /** Une ligne pour dire QUAND l'e-mail part. */
  explication: string
  /** Qui voit ce réglage. Un véto ne règle pas les rappels de l'admin. */
  roles: RoleReglage[]
  /** Les types `email_log` réellement gouvernés par cette case. */
  typesEmail: string[]
}

export type CleReglage =
  | 'conge_demande'
  | 'conge_decision'
  | 'planning_publie'
  | 'garde_modifiee'
  | 'appel_volontaires'
  | 'depannage_confirme'
  | 'rappel_publication'

/**
 * ⚠️ N'inscrire ici QUE des réglages dont l'envoi consulte réellement la
 * préférence. Un réglage affiché mais non consulté est pire que pas de
 * réglage : la personne croit s'être désabonnée, les e-mails continuent, et
 * elle n'a aucune raison de soupçonner l'écran.
 */
export const REGLAGES_EMAIL: readonly Reglage[] = [
  {
    cle: 'conge_demande',
    libelle: 'Une demande de congé est posée',
    explication:
      'Dès qu’un vétérinaire pose une demande. Le message signale à part les demandes qui tombent sur un planning déjà diffusé — ce sont les urgentes.',
    roles: ['admin'],
    typesEmail: ['conge_demande'],
  },
  {
    cle: 'conge_decision',
    libelle: 'Ma demande de congé est acceptée ou refusée',
    explication: 'Quand l’administratrice tranche une demande que j’ai posée.',
    roles: ['veto'],
    typesEmail: ['conge_valide', 'conge_refuse'],
  },
  {
    cle: 'planning_publie',
    libelle: 'Un nouveau planning est diffusé',
    explication: 'À chaque diffusion, avec le détail de mes gardes sur la période.',
    roles: ['admin', 'veto'],
    typesEmail: ['planning_publie'],
  },
  {
    cle: 'garde_modifiee',
    libelle: 'Une de mes gardes change',
    explication:
      'Quand une garde m’est retirée ou attribuée après la diffusion du planning.',
    roles: ['admin', 'veto'],
    typesEmail: ['garde_modifiee'],
  },
  {
    cle: 'appel_volontaires',
    libelle: 'On cherche un volontaire pour un dépannage',
    explication: 'Quand une garde se libère et que l’équipe est sollicitée.',
    roles: ['admin', 'veto'],
    typesEmail: ['appel_volontaires'],
  },
  {
    cle: 'depannage_confirme',
    libelle: 'Un dépannage est confirmé',
    explication: 'Quand quelqu’un a repris la garde qui était à pourvoir.',
    roles: ['admin', 'veto'],
    typesEmail: ['depannage_confirme'],
  },
  {
    cle: 'rappel_publication',
    libelle: 'Rappel : un planning n’est pas encore diffusé',
    explication:
      'À l’approche du début d’une période encore en brouillon, pour ne pas laisser l’équipe sans planning.',
    roles: ['admin'],
    typesEmail: ['rappel_publication'],
  },
] as const

/** Les réglages visibles pour un rôle donné, dans l'ordre de la liste. */
export function reglagesPourRole(role: string): readonly Reglage[] {
  const cible: RoleReglage | null =
    role === 'admin' ? 'admin' : role === 'veto' ? 'veto' : null
  // Le SECRÉTARIAT n'est destinataire d'aucun e-mail aujourd'hui : les envois
  // ciblent tous la table `veterinaires`, et il n'y figure pas (B-017). On lui
  // rend donc une liste VIDE plutôt que des cases sans effet — l'écran, lui, le
  // dit en clair. Le jour où un e-mail le concernera, il suffira d'ajouter son
  // rôle ici : la case apparaîtra du même geste.
  if (!cible) return []
  return REGLAGES_EMAIL.filter((r) => r.roles.includes(cible))
}

/**
 * Les désactivations d'une personne, telles qu'on les consulte à l'envoi.
 *
 * ⚠️ FAIL-OPEN ASSUMÉ : tout ce qui rate (table absente, cabinet inconnu,
 * erreur réseau) fait renvoyer « cette personne reçoit tout ». Un fail-closed
 * transformerait la moindre panne de lecture en silence général sur les
 * e-mails, et un silence ne se remarque pas. Mieux vaut un e-mail de trop
 * qu'une équipe qui n'apprend jamais qu'un planning a changé.
 */
export interface ReglagesCharges {
  /** `false` seulement si la personne a explicitement coupé ce réglage. */
  recoit(userId: string | null | undefined, cle: CleReglage): boolean
  /** Même question, depuis un `veterinaires.id` (ce que manipulent les envois). */
  recoitVeto(veterinaireId: string, cle: CleReglage): boolean
}

const TOUT_PASSE: ReglagesCharges = {
  recoit: () => true,
  recoitVeto: () => true,
}

/**
 * Charge en UNE fois les désactivations de tout un cabinet.
 *
 * Appelé une seule fois par envoi, même pour une boucle de sept vétérinaires —
 * comme `lecteurExpediteur`. Pas de cache au niveau du module : en
 * « serverless » l'instance survit entre deux requêtes, et un réglage tout
 * juste modifié resterait ignoré.
 */
export async function chargerReglagesEmail(
  supabase: SupabaseClient,
  cabinetId: string | null | undefined,
): Promise<ReglagesCharges> {
  if (!cabinetId) return TOUT_PASSE

  try {
    const [prefsRes, vetosRes] = await Promise.all([
      supabase
        .from('preferences_notifications')
        .select('user_id, desactivees')
        .eq('cabinet_id', cabinetId),
      // Le pont `veterinaires.id → user_id` : les envois raisonnent en fiches,
      // la préférence est portée par le compte. Une fiche jamais invitée a
      // `user_id` null — elle reçoit donc tout, ce qui est sans conséquence
      // puisqu'elle n'a pas encore d'adresse non plus.
      supabase
        .from('veterinaires')
        .select('id, user_id')
        .eq('cabinet_id', cabinetId),
    ])

    if (prefsRes.error) {
      console.error('[notif-reglages] Lecture des préférences en échec — tout est envoyé:', prefsRes.error.message)
      return TOUT_PASSE
    }

    const coupees = new Map<string, Set<string>>()
    for (const ligne of (prefsRes.data ?? []) as { user_id: string; desactivees: string[] | null }[]) {
      coupees.set(ligne.user_id, new Set(ligne.desactivees ?? []))
    }

    const comptes = new Map<string, string | null>()
    for (const v of (vetosRes.data ?? []) as { id: string; user_id: string | null }[]) {
      comptes.set(v.id, v.user_id)
    }

    const recoit = (userId: string | null | undefined, cle: CleReglage): boolean => {
      if (!userId) return true
      return !coupees.get(userId)?.has(cle)
    }

    return {
      recoit,
      recoitVeto: (veterinaireId, cle) => recoit(comptes.get(veterinaireId), cle),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[notif-reglages] Exception — tout est envoyé:', msg)
    return TOUT_PASSE
  }
}

/**
 * Lit les désactivations de la personne connectée, pour l'écran de réglages.
 * Renvoie un tableau vide quand il n'y a pas encore de ligne — « je reçois
 * tout », qui est bien l'état initial.
 */
export async function lireMesDesactivations(
  supabase: SupabaseClient,
  userId: string,
): Promise<CleReglage[]> {
  const { data, error } = await supabase
    .from('preferences_notifications')
    .select('desactivees')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[notif-reglages] Lecture de mes préférences en échec:', error.message)
    return []
  }
  const brut = (data?.desactivees as string[] | null) ?? []
  const connues = new Set<string>(REGLAGES_EMAIL.map((r) => r.cle))
  // Un réglage retiré du produit laisse sa clé en base. On l'ignore à la
  // lecture plutôt que de la réécrire : l'écran n'a pas à faire du ménage dans
  // le dos de l'utilisateur, et une clé orpheline ne commande rien.
  return brut.filter((c): c is CleReglage => connues.has(c))
}
