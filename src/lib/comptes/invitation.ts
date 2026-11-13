// ============================================================
// GUARDVETO — Envoyer une invitation : le chemin UNIQUE (B-207 lot 1)
// ============================================================
// Avant le 13/11, ce chemin était écrit DEUX fois — `inviterVeterinaire` et
// `inviterSecretaire` — et le guichet du Hub MPP allait en faire une troisième
// copie. Il porte deux incidents payés ; trois copies, c'est trois endroits où
// l'un des deux peut revenir :
//
//   ① 2026-08-25 : un compte auth fabriqué en SQL ne peut pas se connecter →
//      on passe TOUJOURS par `inviteUserByEmail`.
//   ② 2026-08-15 : `inviteUserByEmail` n'alimente que `user_metadata`, or toute
//      la sécurité lit `app_metadata.cabinet_id` DU JETON → seconde passe
//      `updateUserById`, et si elle échoue on efface le compte plutôt que
//      d'annoncer une invitation qui ne pourra jamais servir.
//
// Ce fichier ne contrôle PAS les droits : l'appelant l'a fait (garde admin +
// lecture de la fiche sous RLS côté écran ; secret du guichet côté Hub). Il
// reçoit une fiche déjà lue et un client service.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliserAdresse } from '@/lib/emails/destinataire'

export type GenreFiche = 'veterinaire' | 'secretaire'

export interface FicheAInviter {
  genre: GenreFiche
  id: string
  email: string | null
  cabinetId: string
  userId: string | null
  /** `role_app` du vétérinaire ; ignoré pour le secrétariat (toujours « secretaire »). */
  role?: string | null
}

export type ResultatInvitation =
  | { ok: true; email: string; userId: string }
  | {
      ok: false
      /**
       * `sans_adresse`  — rien où envoyer ;
       * `deja_ouvert`   — le compte existe et a été confirmé : réinviter l'effacerait ;
       * `conflit`       — un compte en attente existe pour cette adresse mais n'est pas celui de cette fiche ;
       * `echec`         — Supabase a refusé (message dans `detail`).
       */
      code: 'sans_adresse' | 'deja_ouvert' | 'conflit' | 'echec'
      detail?: string
    }

/** La clé de métadonnée qui relie un compte auth à sa fiche. */
function cleFiche(genre: GenreFiche): 'veterinaire_id' | 'secretaire_id' {
  return genre === 'veterinaire' ? 'veterinaire_id' : 'secretaire_id'
}

export async function envoyerInvitation(
  admin: SupabaseClient,
  fiche: FicheAInviter,
): Promise<ResultatInvitation> {
  const adresse = normaliserAdresse(fiche.email)
  if (!adresse) return { ok: false, code: 'sans_adresse' }

  const cle = cleFiche(fiche.genre)

  // Un compte existe-t-il déjà pour cette adresse ?
  const { data: comptes, error: erreurListe } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (erreurListe) return { ok: false, code: 'echec', detail: erreurListe.message }
  const existant = comptes?.users?.find((u) => u.email === adresse)

  if (existant) {
    if (existant.confirmed_at) return { ok: false, code: 'deja_ouvert' }
    // Uniquement le compte en attente de CETTE fiche — jamais celui d'un
    // homonyme, potentiellement d'un autre cabinet.
    const lie = existant.id === fiche.userId || existant.user_metadata?.[cle] === fiche.id
    if (!lie) return { ok: false, code: 'conflit' }
    await admin.auth.admin.deleteUser(existant.id)
  }

  const { data: invitation, error: erreurInvitation } = await admin.auth.admin.inviteUserByEmail(adresse, {
    data: { [cle]: fiche.id },
  })
  if (erreurInvitation || !invitation?.user) {
    return { ok: false, code: 'echec', detail: erreurInvitation?.message ?? 'Invitation refusée.' }
  }
  const compteId = invitation.user.id

  // ② LE CABINET DANS LE JETON.
  const { error: erreurMeta } = await admin.auth.admin.updateUserById(compteId, {
    app_metadata: { cabinet_id: fiche.cabinetId },
    user_metadata: { [cle]: fiche.id, role: fiche.genre === 'veterinaire' ? fiche.role ?? null : 'secretaire' },
  })
  if (erreurMeta) {
    await admin.auth.admin.deleteUser(compteId)
    return { ok: false, code: 'echec', detail: `rattachement au cabinet : ${erreurMeta.message}` }
  }

  const lien =
    fiche.genre === 'veterinaire'
      ? admin.from('veterinaires').update({ user_id: compteId, invite_pending: true }).eq('id', fiche.id)
      : admin.from('secretaires').update({ user_id: compteId }).eq('id', fiche.id)
  const { error: erreurLien } = await lien
  if (erreurLien) return { ok: false, code: 'echec', detail: `lien fiche ↔ compte : ${erreurLien.message}` }

  return { ok: true, email: adresse, userId: compteId }
}
