'use server'

import { createClient } from '@/lib/supabase/server'
import { refusSiBloquant } from '@/data/controleImpact'
import type { Impact } from '@/data/controleImpact'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import type { StatutVeto, UserRole } from '@/types'
import {
  adresseBienFormee,
  motifInvitationImpossible,
  normaliserAdresse,
} from '@/lib/emails/destinataire'
import { COULEUR_DEFAUT, normaliserHex } from '@/lib/couleurs'

/**
 * Rafraîchit les DEUX écrans qui listent l'équipe.
 *
 * La V2 (`/equipe`) et la V1 (`/admin/veterinaires`) cohabitent le temps de la
 * bascule : ne revalider que l'une laisse l'autre afficher l'état d'avant
 * (fiche créée invisible, invitation qui a l'air de n'avoir rien fait). Quand
 * la V1 sera retirée, il ne restera qu'une ligne à supprimer ici.
 */
function revaliderEquipe() {
  revalidatePath('/admin/veterinaires')
  revalidatePath('/equipe')
}

// ── Garde admin (même pattern que /regles et /admin/structure) ──
async function assertAdmin(
  supabase: SupabaseClient<any, any, any>,
): Promise<{ error: string } | { veto: { id: string; role_app: string } }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }
  const { data: vet } = await supabase
    .from('veterinaires')
    .select('id, role_app')
    .eq('user_id', user.id)
    .single()
  if (!vet) return { error: 'Non authentifié.' }
  if (vet.role_app !== 'admin') {
    return { error: "Action réservée à l'administrateur du cabinet." }
  }
  return { veto: vet }
}

export interface VeterinaireFormData {
  nom: string
  prenom: string
  /**
   * FACULTATIF — une fiche existe avant que la personne soit invitée.
   *
   * Avant le 2026-08-22, la base l'exigeait : pour créer la fiche de quelqu'un
   * dont on n'avait pas encore l'adresse, il fallait en INVENTER une
   * (`prenom@guardveto.local`). Ces fausses adresses se comportaient ensuite
   * comme des vraies — elles passaient les contrôles et partaient chez
   * l'expéditeur, qui les rejetait. Vide ou absent est enregistré `null`,
   * jamais `''` : une chaîne vide se comporterait, elle aussi, comme une
   * adresse.
   */
  email?: string | null
  statut: StatutVeto
  role_app: UserRole
  couleur: string
  actif: boolean
  dernier_recours: boolean
  /** Étiquettes d'équipe (junior/senior…) — règles de composition (n°6). */
  tags?: string[]
}

/**
 * Normalise la couleur (frontière de confiance), comme on le fait des tags.
 *
 * Tant que le formulaire n'offrait qu'une palette fermée de quatorze pastilles,
 * rien d'autre qu'un hexadécimal valide ne pouvait arriver ici : le contrôle
 * était dans la forme du choix. Depuis le 2026-08-24, la couleur se tape et se
 * colle — et cette action n'est pas le seul chemin d'écriture : l'outil IA
 * `lib/ia/outils/equipe.ts` repasse par elle. Une valeur bancale s'installerait
 * en base (la colonne n'a aucun CHECK) et s'afficherait comme du vide.
 *
 * On ne refuse pas : la couleur n'est pas ce qu'on est venu régler, et bloquer
 * l'enregistrement d'une fiche pour ça serait disproportionné. On replie sur le
 * gris par défaut, celui de la migration 001.
 */
function normaliserCouleur(couleur: string | null | undefined): string {
  return normaliserHex(couleur) ?? COULEUR_DEFAUT
}

/** Normalise les étiquettes (frontière de confiance) : minuscules, uniques, bornées. */
function normaliserTags(tags: string[] | undefined): string[] {
  return [
    ...new Set(
      (tags ?? [])
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t !== '' && t.length <= 30),
    ),
  ].slice(0, 10)
}

export async function createVeterinaire(data: VeterinaireFormData) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  // cabinet_id dérivé côté serveur (jamais du client) — sinon le véto
  // est inséré avec cabinet_id NULL et reste invisible sous RLS stricte.
  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  // L'adresse est facultative, mais si elle est là elle doit être exploitable.
  // `normaliserAdresse` rend `null` pour une saisie vide — surtout pas `''`,
  // qui compterait ensuite comme une adresse et bloquerait la deuxième fiche
  // sans adresse du cabinet (index unique sur cabinet_id + email).
  const email = normaliserAdresse(data.email)
  if (email !== null && !adresseBienFormee(email)) {
    return { error: "L'adresse e-mail n'a pas l'air valide." }
  }

  // Vérifie unicité email (au sein du cabinet) — sans objet s'il n'y en a pas.
  if (email !== null) {
    const { data: existing } = await supabase
      .from('veterinaires')
      .select('id')
      .eq('email', email)
      .eq('cabinet_id', cabinetId)
      .maybeSingle()

    if (existing) {
      return { error: 'Un vétérinaire avec cet email existe déjà.' }
    }
  }

  const { error } = await supabase.from('veterinaires').insert({
    cabinet_id: cabinetId,
    nom: data.nom.trim(),
    prenom: data.prenom.trim(),
    email,
    statut: data.statut,
    role_app: data.role_app,
    couleur: normaliserCouleur(data.couleur),
    actif: data.actif,
    dernier_recours: data.dernier_recours,
    tags: normaliserTags(data.tags),
    user_id: null,
  })

  if (error) return { error: error.message }

  revaliderEquipe()
  return { success: true }
}

export async function updateVeterinaire(id: string, data: VeterinaireFormData) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  const email = normaliserAdresse(data.email)
  if (email !== null && !adresseBienFormee(email)) {
    return { error: "L'adresse e-mail n'a pas l'air valide." }
  }

  // Vérifie unicité email (hors soi-même) — sans objet s'il n'y en a pas.
  // `maybeSingle` et non `single` : sans doublon il n'y a aucune ligne, et
  // `single` ferait remonter une « erreur » pour le cas normal.
  if (email !== null) {
    const { data: existing } = await supabase
      .from('veterinaires')
      .select('id')
      .eq('email', email)
      .neq('id', id)
      .maybeSingle()

    if (existing) {
      return { error: 'Un vétérinaire avec cet email existe déjà.' }
    }
  }

  const { error } = await supabase
    .from('veterinaires')
    .update({
      nom: data.nom.trim(),
      prenom: data.prenom.trim(),
      email,
      statut: data.statut,
      role_app: data.role_app,
      couleur: normaliserCouleur(data.couleur),
      actif: data.actif,
      dernier_recours: data.dernier_recours,
      tags: normaliserTags(data.tags),
    })
    .eq('id', id)

  if (error) return { error: error.message }

  revaliderEquipe()
  return { success: true }
}

export async function inviterVeterinaire(id: string) {
  const supabase = await createClient()

  // Garde admin OBLIGATOIRE : cette action bascule ensuite en service_role
  // (bypass RLS) — la RLS ne peut donc pas nous rattraper plus bas.
  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  // Récupère l'email du véto via le client AUTHENTIFIÉ : la RLS garantit que
  // la cible appartient au cabinet du caller (scope tenant vérifié ici).
  const { data: vet } = await supabase
    .from('veterinaires')
    .select('email, prenom, nom, user_id, cabinet_id, role_app')
    .eq('id', id)
    .single()

  if (!vet) return { error: 'Vétérinaire introuvable.' }

  // ── Pas d'adresse, pas d'invitation ─────────────────────────────────────
  // Depuis que l'e-mail est facultatif, on peut arriver ici sur une fiche qui
  // n'en a pas. Le refus est posé AVANT toute bascule en service_role, et il
  // dit quoi faire : sans lui, `inviteUserByEmail(null)` renverrait une erreur
  // technique brute, et surtout `listUsers().find(u => u.email === vet.email)`
  // comparerait deux `null` — un compte auth sans adresse serait pris pour
  // celui de ce vétérinaire, et pourrait être SUPPRIMÉ juste en dessous.
  // L'écran désactive déjà le bouton ; ce contrôle-ci est celui qui compte.
  const motifRefus = motifInvitationImpossible(vet)
  if (motifRefus) return { error: motifRefus }
  const adresseInvitation = vet.email as string

  // Client admin avec service_role
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.SUPABASE_SERVICE_ROLE_KEY!.trim()
  )

  // Vérifie si un compte auth existe déjà pour cet email
  const { data: existingUsers } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  const existingUser = existingUsers?.users?.find((u) => u.email === adresseInvitation)

  let authUserId: string

  if (existingUser) {
    if (existingUser.confirmed_at) {
      // Compte déjà confirmé et actif → rien à faire
      return { error: 'Ce compte est déjà actif.' }
    }
    // Compte invité mais non confirmé → supprime et ré-invite pour générer un
    // nouveau lien. Uniquement si ce compte est bien celui de CE véto (lié par
    // user_id ou par la métadonnée d'invitation) — jamais le compte en attente
    // d'un homonyme, potentiellement d'un autre cabinet.
    const lieACeVeto =
      vet.user_id === existingUser.id ||
      existingUser.user_metadata?.veterinaire_id === id
    if (!lieACeVeto) {
      return {
        error:
          "Un compte en attente existe déjà pour cet email mais n'est pas lié à ce vétérinaire.",
      }
    }
    await adminClient.auth.admin.deleteUser(existingUser.id)
  }

  // Invite (nouveau ou après suppression)
  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    adresseInvitation,
    { data: { veterinaire_id: id } }
  )
  if (inviteError) return { error: inviteError.message }
  authUserId = inviteData.user.id

  // ── Le rattachement au cabinet, DANS LE JETON ────────────────────────────
  // Sans ceci, le compte est créé, l'invitation part, le mot de passe se
  // définit… et la connexion échoue sur « Votre compte n'est pas encore
  // activé ». Incident vécu le 2026-08-15 sur le compte d'Anne-Catherine, à
  // quelques heures d'une démonstration client.
  //
  // Pourquoi : toute la sécurité repose sur `auth_cabinet_actif()`, qui lit
  // `app_metadata.cabinet_id` DU JETON — pas la colonne `veterinaires.cabinet_id`.
  // Sans cette clé, la policy RESTRICTIVE d'isolation refuse TOUT, y compris la
  // propre fiche du vétérinaire. `login/actions.ts` ne la trouve pas et conclut
  // que le compte est inactif — un message exact sur la forme et trompeur sur le
  // fond, qui envoie chercher du côté de l'activation alors que le compte l'est.
  //
  // `inviteUserByEmail(..., { data })` n'alimente QUE `user_metadata` : il n'y a
  // aucun moyen de poser `app_metadata` à l'invitation, d'où cette seconde passe.
  // `role` est posé en même temps par cohérence — les droits eux-mêmes sont
  // décidés par `get_user_role()`, qui lit la table, jamais le jeton.
  const { error: metaError } = await adminClient.auth.admin.updateUserById(authUserId, {
    app_metadata: { cabinet_id: vet.cabinet_id },
    user_metadata: { veterinaire_id: id, role: vet.role_app },
  })
  if (metaError) {
    // On ne laisse pas passer un compte à moitié créé en annonçant « invitation
    // envoyée » : il ne pourrait jamais se connecter, et personne ne saurait
    // pourquoi. On efface le compte auth pour que la ré-invitation reparte
    // d'une base saine.
    await adminClient.auth.admin.deleteUser(authUserId)
    return {
      error:
        "L'invitation n'a pas pu être finalisée (rattachement au cabinet). Réessaie — si ça persiste, préviens l'assistance.",
    }
  }

  // Met à jour user_id et invite_pending (toujours, car l'auth user peut avoir changé)
  const { error: updateError } = await adminClient
    .from('veterinaires')
    .update({ user_id: authUserId, invite_pending: true })
    .eq('id', id)
  if (updateError) return { error: updateError.message }

  revaliderEquipe()
  return { success: true, email: adresseInvitation }
}

export interface GardeAVenir {
  date: string
  type: string
}

type ToggleActifResult =
  /**
   * `impact` accompagne un refus du contrôle d'impact (palier 3 de l'audit du
   * 2026-08-03) : l'écran ouvre alors la fenêtre de Filou, qui porte les gestes
   * de correction, au lieu d'un toast muet sur la suite à donner.
   */
  | { error: string; impact?: Impact }
  | { success: true }
  | { requiresConfirmation: true; gardesAVenir: GardeAVenir[] }

/**
 * Active / désactive un vétérinaire.
 *
 * Garde-fou Chantier B : désactiver un véto qui est ENCORE de garde sur un
 * planning PUBLIÉ à venir le fait sortir des compteurs (équité faussée) et
 * laisse une garde « orpheline » que personne ne couvre vraiment. On refuse
 * donc de désactiver en silence : sans `confirm`, on renvoie la liste des
 * gardes publiées à venir pour que l'UI demande une confirmation explicite.
 * (La désactivation n'efface PAS ces gardes — il faudra les réattribuer via
 * une édition manuelle ou la gestion de crise.)
 */
export async function toggleVeterinaireActif(
  id: string,
  actif: boolean,
  confirm: boolean = false
): Promise<ToggleActifResult> {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  // Contrôle uniquement à la DÉSACTIVATION (réactiver est toujours sûr).
  if (!actif && !confirm) {
    const today = new Date().toISOString().slice(0, 10)
    const { data: gardes } = await supabase
      .from('gardes')
      .select('date, type, periodes!inner(statut)')
      .or(`premier_id.eq.${id},second_id.eq.${id}`)
      .gte('date', today)
      .eq('periodes.statut', 'publie')
      .order('date')

    if (gardes && gardes.length > 0) {
      return {
        requiresConfirmation: true as const,
        gardesAVenir: (gardes as { date: string; type: string }[]).map((g) => ({
          date: g.date,
          type: g.type,
        })),
      }
    }
  }

  // ── LE PASSAGE OBLIGÉ (palier 2 de l'audit du 2026-08-03) ──
  // Le contrôle ci-dessus regarde les gardes DÉJÀ ATTRIBUÉES ; celui-ci
  // regarde l'avenir : retirer quelqu'un de l'effectif peut rendre un créneau
  // impossible à pourvoir, ou changer en règles fantômes toutes celles qui le
  // visent. C'est une modification du monde comme une autre, et c'était l'une
  // des plus lourdes à passer sans un mot.
  if (!actif) {
    let cabinetId: string | null = null
    try {
      cabinetId = await resoudreCabinetId(supabase)
    } catch {
      cabinetId = null // cabinet irrésolu : on ne bloque pas une désactivation
    }
    if (cabinetId) {
      const refus = await refusSiBloquant(
        supabase,
        cabinetId,
        { genre: 'veto_retire', vetId: id },
        confirm,
      )
      if (refus) return { error: refus.error, impact: refus.impact }
    }
  }

  const { error } = await supabase
    .from('veterinaires')
    .update({ actif })
    .eq('id', id)

  if (error) return { error: error.message }

  revaliderEquipe()
  return { success: true }
}
