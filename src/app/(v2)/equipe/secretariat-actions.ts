'use server'

// ============================================================
// GUARDVETO V2 — Gérer le SECRÉTARIAT (B-017, lot 3)
// ============================================================
// Ce qui rend Anne-Sophie autonome : créer une fiche de secrétariat, l'inviter,
// la désactiver. Sans ce lot, les fiches se posent en base à la main — donc par
// MiKL, donc jamais par elle.
//
// ── UNE FICHE N'EST PAS UNE PERSONNE ────────────────────────────────────────
//
// Chez Val d'Allier, trois secrétaires partagent UN compte : le cabinet crée
// une fiche « Secrétariat ». Ailleurs, ce seront trois fiches nominatives. Le
// produit ne connaît aucun « mode compte partagé » — c'est la maille choisie
// par le cabinet, et elle ne demande pas une ligne de code de plus.
//
// ── L'INVITATION NE SE FABRIQUE PAS EN SQL ──────────────────────────────────
//
// ⚠️ Leçon payée le 2026-08-25, sur le compte de recette : un compte auth créé
// par INSERT ne peut PAS se connecter. Supabase Auth exige une chaîne vide —
// jamais NULL — sur `confirmation_token`, `recovery_token`,
// `email_change_token_new` et `email_change`, et il répond alors un refus
// générique que l'écran de connexion traduit fidèlement en « e-mail ou mot de
// passe incorrect ». Le mot de passe n'y est pour rien, et personne ne peut le
// deviner. On passe donc par `inviteUserByEmail`, comme pour les vétérinaires.
//
// ── LE CABINET DOIT ÊTRE DANS LE JETON ──────────────────────────────────────
//
// ⚠️ Seconde leçon, celle du 2026-08-15 : `inviteUserByEmail` n'alimente que
// `user_metadata`. Or toute la sécurité repose sur `auth_cabinet_actif()`, qui
// lit `app_metadata.cabinet_id` DU JETON. Sans une seconde passe, le compte
// est créé, l'invitation part, le mot de passe se définit — et la connexion
// échoue sur « votre compte n'est pas encore activé ». Message exact sur la
// forme, trompeur sur le fond.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { adresseBienFormee, normaliserAdresse } from '@/lib/emails/destinataire'
import type { ReponseInvitation, ReponseSecretariat } from '@/lib/secretariat/types'

/** Le nom affiché : « Secrétariat », « Accueil », « Marie Dupont »… */
const NOM = { min: 2, max: 80 } as const

function revaliderEquipe() {
  revalidatePath('/equipe')
  revalidatePath('/planning')
}

/**
 * Garde d'administration.
 *
 * Posée dans CHAQUE action, jamais seulement à l'écran : un écran qui masque
 * un bouton n'empêche personne d'appeler l'action directement.
 */
async function assertAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  // Type de retour ANNOTÉ, pas inféré : sans lui, TypeScript produit une union
  // où `error` reste `string | undefined`, et le `if ('error' in garde)` des
  // appelants ne suffit plus à le convaincre.
): Promise<{ error: string } | { ok: true }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { data: vet, error } = await supabase
    .from('veterinaires')
    .select('id, role_app')
    .eq('user_id', user.id)
    .eq('actif', true)
    .maybeSingle()

  // L'erreur est LUE : une base muette ne doit pas se présenter comme un refus
  // de droits, sinon on cherche un problème de rôle là où il y a une panne.
  if (error) {
    console.error('[Secrétariat] Lecture du profil impossible :', error.message)
    return { error: "Je n'arrive pas à vérifier tes droits pour le moment. Réessaie dans un instant." }
  }
  if (!vet) {
    // ⚠️ CE CAS N'EST PAS « TU N'AS PAS LES DROITS ».
    //
    // Constaté le 2026-08-25 : MiKL, connecté en administratrice, crée une
    // fiche de secrétariat avec SA propre adresse, ouvre l'invitation reçue
    // dans le même navigateur — et la session bascule sur le compte
    // secrétariat, 41 secondes après. L'écran Équipe, lui, reste affiché tel
    // qu'il avait été rendu. Le clic suivant part donc avec la nouvelle
    // session, et s'entend répondre « réservé à l'administrateur » alors
    // qu'on se croit toujours administratrice.
    //
    // Le refus était juste ; le message était trompeur. On distingue donc le
    // cas et on dit ce qui s'est réellement passé — sans quoi on cherche un
    // problème de droits là où il y a un changement de session.
    const { data: sec } = await supabase
      .from('secretaires')
      .select('nom')
      .eq('user_id', user.id)
      .eq('actif', true)
      .maybeSingle()

    if (sec) {
      return {
        error:
          "Tu es maintenant connecté avec le compte « " +
          sec.nom +
          " », qui ne gère rien. Cet écran était encore affiché depuis ta session d’administratrice. Déconnecte-toi et reconnecte-toi avec ton compte habituel.",
      }
    }
    return { error: "Réservé à l'administrateur du cabinet." }
  }

  if (vet.role_app !== 'admin') {
    return { error: "Réservé à l'administrateur du cabinet." }
  }
  return { ok: true as const }
}

/** Le nom, détouré et borné — mêmes bornes que la contrainte `CHECK` en base. */
function refusNom(nom: string): string | null {
  const n = nom.trim()
  if (n.length < NOM.min) return 'Donne un nom à cette fiche — « Secrétariat » convient très bien.'
  if (n.length > NOM.max) return `Ce nom est trop long (${n.length} caractères pour ${NOM.max} au maximum).`
  return null
}

export async function creerSecretaire(
  data: { nom: string; email: string },
): Promise<ReponseSecretariat> {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  const refus = refusNom(data.nom)
  if (refus) return { error: refus }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch {
    return { error: 'Cabinet introuvable — je ne peux pas rattacher cette fiche.' }
  }

  // `null` et surtout pas `''` : une chaîne vide compterait comme une adresse
  // et bloquerait la deuxième fiche sans adresse (index unique cabinet+email).
  const email = normaliserAdresse(data.email)
  if (email !== null && !adresseBienFormee(email)) {
    return { error: "L'adresse e-mail n'a pas l'air valide." }
  }

  if (email !== null) {
    const { data: existant } = await supabase
      .from('secretaires')
      .select('id')
      .eq('email', email)
      .eq('cabinet_id', cabinetId)
      .maybeSingle()
    if (existant) return { error: 'Une fiche de secrétariat utilise déjà cette adresse.' }
  }

  const { error } = await supabase.from('secretaires').insert({
    cabinet_id: cabinetId,
    nom: data.nom.trim(),
    email,
    user_id: null,
    actif: true,
  })
  if (error) {
    console.error('[Secrétariat] Création refusée :', error.message)
    return { error: "La fiche n'a pas pu être créée. Réessaie dans un instant." }
  }

  revaliderEquipe()
  return { success: true }
}

export async function modifierSecretaire(
  id: string,
  data: { nom: string; email: string },
): Promise<ReponseSecretariat> {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  const refus = refusNom(data.nom)
  if (refus) return { error: refus }

  const email = normaliserAdresse(data.email)
  if (email !== null && !adresseBienFormee(email)) {
    return { error: "L'adresse e-mail n'a pas l'air valide." }
  }

  const { error } = await supabase
    .from('secretaires')
    .update({ nom: data.nom.trim(), email })
    .eq('id', id)
  if (error) {
    console.error('[Secrétariat] Modification refusée :', error.message)
    return { error: "La fiche n'a pas pu être enregistrée. Réessaie dans un instant." }
  }

  revaliderEquipe()
  return { success: true }
}

/**
 * Invite le secrétariat à créer son mot de passe.
 *
 * Reprend pas à pas le chemin de `inviterVeterinaire`, qui porte deux
 * incidents déjà payés (voir l'en-tête). On ne le raccourcit pas : les deux
 * pièges se referment exactement de la même manière ici.
 */
export async function inviterSecretaire(id: string): Promise<ReponseInvitation> {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  const { data: sec, error: erreurLecture } = await supabase
    .from('secretaires')
    .select('id, nom, email, cabinet_id, user_id, actif')
    .eq('id', id)
    .maybeSingle()

  if (erreurLecture) {
    console.error('[Secrétariat] Lecture de la fiche impossible :', erreurLecture.message)
    return { error: "Je n'arrive pas à lire cette fiche pour le moment. Réessaie dans un instant." }
  }
  if (!sec) return { error: 'Fiche de secrétariat introuvable.' }
  if (!sec.actif) return { error: 'Cette fiche est désactivée — réactive-la avant de l’inviter.' }

  const adresse = normaliserAdresse(sec.email as string | null)
  if (!adresse) {
    return {
      error:
        "Cette fiche n'a pas d'adresse e-mail — l'invitation n'a nulle part où aller. Renseigne-la d'abord.",
    }
  }

  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!cle) {
    // On le DIT plutôt que d'échouer sur une erreur technique : c'est un
    // réglage de serveur, pas une faute de l'administratrice.
    return { error: "L'envoi d'invitations n'est pas configuré sur le serveur. Préviens l'assistance." }
  }

  const adminClient = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), cle)

  // Un compte existe-t-il déjà pour cette adresse ?
  const { data: comptes } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const existant = comptes?.users?.find((u) => u.email === adresse)

  if (existant) {
    if (existant.confirmed_at) {
      return { error: 'Un compte actif existe déjà pour cette adresse.' }
    }
    if (existant.id !== sec.user_id) {
      return {
        error: "Un compte en attente existe déjà pour cette adresse, mais il n'est pas lié à cette fiche.",
      }
    }
    // Compte en attente rattaché à CETTE fiche : on repart d'une base saine.
    await adminClient.auth.admin.deleteUser(existant.id)
  }

  const { data: invitation, error: erreurInvitation } =
    await adminClient.auth.admin.inviteUserByEmail(adresse, { data: { secretaire_id: id } })

  if (erreurInvitation) {
    console.error('[Secrétariat] Invitation refusée :', erreurInvitation.message)
    return { error: `L'invitation n'est pas partie : ${erreurInvitation.message}` }
  }

  const compteId = invitation.user.id

  // ⚠️ LE CABINET DANS LE JETON — sans cette passe, la connexion réussit puis
  // l'application rejette (incident du 2026-08-15).
  const { error: erreurMeta } = await adminClient.auth.admin.updateUserById(compteId, {
    app_metadata: { cabinet_id: sec.cabinet_id },
    user_metadata: { secretaire_id: id, role: 'secretaire' },
  })
  if (erreurMeta) {
    // On n'annonce pas « invitation envoyée » pour un compte qui ne pourra
    // jamais se connecter : on l'efface pour que la prochaine tentative
    // reparte proprement.
    await adminClient.auth.admin.deleteUser(compteId)
    console.error('[Secrétariat] Rattachement au cabinet impossible :', erreurMeta.message)
    return {
      error:
        "L'invitation n'a pas pu être finalisée (rattachement au cabinet). Réessaie — si ça persiste, préviens l'assistance.",
    }
  }

  const { error: erreurLien } = await adminClient
    .from('secretaires')
    .update({ user_id: compteId })
    .eq('id', id)
  if (erreurLien) {
    console.error('[Secrétariat] Lien fiche ↔ compte non enregistré :', erreurLien.message)
    return {
      error:
        "Le compte est créé mais je n'ai pas pu le rattacher à la fiche. Préviens l'assistance avant de réessayer.",
    }
  }

  revaliderEquipe()
  return { success: true, email: adresse }
}

/**
 * Active / désactive une fiche.
 *
 * Aucune confirmation à demander, contrairement aux vétérinaires : une
 * secrétaire n'a pas de garde à orpheliner. La désactivation lui retire
 * simplement l'accès — `get_user_role()` ne la reconnaît plus, donc plus
 * aucune des quatre lectures ne lui est accordée.
 */
/**
 * Supprime une fiche de secrétariat, et le compte qui va avec.
 *
 * Arbitrage MiKL du 2026-08-25 : « prévois une fonction suppression pour les
 * secrétaires, de toute façon il n'y a pas d'enjeu comme pour les vétos ».
 *
 * C'est exact, et c'est ce qui distingue les deux gestes. Désactiver un
 * VÉTÉRINAIRE demande un garde-fou : il peut rester titulaire de gardes
 * publiées à venir, que la désactivation laisserait sans personne. Une fiche
 * de secrétariat n'apparaît dans aucun planning, aucun compteur, aucune règle
 * — la supprimer ne laisse rien d'orphelin. Le seul geste à ne pas oublier est
 * de retirer AUSSI le compte : une fiche effacée sans son compte laisserait
 * quelqu'un capable de se connecter sans que rien ne l'affiche à l'écran.
 *
 * La désactivation reste offerte à côté : elle sert à retirer un accès
 * temporairement (un remplacement d'été) sans perdre la fiche.
 */
export async function supprimerSecretaire(id: string): Promise<ReponseSecretariat> {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  const { data: sec, error: erreurLecture } = await supabase
    .from('secretaires')
    .select('id, user_id')
    .eq('id', id)
    .maybeSingle()

  if (erreurLecture) {
    console.error('[Secrétariat] Lecture avant suppression impossible :', erreurLecture.message)
    return { error: "Je n'arrive pas à lire cette fiche pour le moment. Réessaie dans un instant." }
  }
  if (!sec) return { error: 'Fiche de secrétariat introuvable.' }

  // ── Le compte d'abord, la fiche ensuite ────────────────────────────────
  // Dans cet ordre, une panne au milieu laisse une fiche SANS compte : c'est
  // visible à l'écran (« jamais invitée ») et rattrapable. L'ordre inverse
  // laisserait un compte capable de se connecter que plus rien n'affiche —
  // invisible, donc jamais corrigé.
  if (sec.user_id) {
    const cle = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    if (!cle) {
      return {
        error:
          "Le compte lié ne peut pas être supprimé (réglage serveur manquant). Préviens l'assistance plutôt que de laisser un accès ouvert.",
      }
    }
    const adminClient = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), cle)
    const { error: erreurCompte } = await adminClient.auth.admin.deleteUser(sec.user_id as string)
    if (erreurCompte) {
      console.error('[Secrétariat] Compte non supprimé :', erreurCompte.message)
      return {
        error:
          "Le compte lié n'a pas pu être supprimé — la fiche est conservée pour ne pas laisser d'accès orphelin. Réessaie dans un instant.",
      }
    }
  }

  const { error } = await supabase.from('secretaires').delete().eq('id', id)
  if (error) {
    console.error('[Secrétariat] Suppression refusée :', error.message)
    return { error: "La fiche n'a pas pu être supprimée. Réessaie dans un instant." }
  }

  revaliderEquipe()
  return { success: true }
}

export async function basculerSecretaireActif(
  id: string,
  actif: boolean,
): Promise<ReponseSecretariat> {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  const { error } = await supabase.from('secretaires').update({ actif }).eq('id', id)
  if (error) {
    console.error('[Secrétariat] Changement d’état refusé :', error.message)
    return { error: "L'état n'a pas pu être changé. Réessaie dans un instant." }
  }

  revaliderEquipe()
  return { success: true }
}
