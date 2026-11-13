// ============================================================
// GUARDVETO — POST /api/hub/comptes/action (guichet du Hub MPP, B-207 lot 1)
// ============================================================
// Les DEUX seuls gestes que le Hub peut faire sur un compte (décision MiKL du
// 11/11 — ni suppression ni désactivation depuis le Hub) :
//
//   • `inviter`       — (re)envoyer l'invitation d'une fiche qui n'a pas
//                       encore ouvert son lien. Même chemin que l'écran Équipe
//                       (`envoyerInvitation`), donc mêmes garde-fous.
//   • `reinitialiser` — envoyer le mail « choisir un nouveau mot de passe » à
//                       un compte déjà actif. Même mail que « Mot de passe
//                       oublié » sur la page de connexion : rien n'est effacé,
//                       l'ancien mot de passe reste valable tant que le
//                       nouveau n'est pas choisi.
//
// Corps : { action: 'inviter' | 'reinitialiser', genre: 'veterinaire' | 'secretaire', id }
// ============================================================

import { type NextRequest } from 'next/server'
import { lireComptesAuth, ouvrirGuichet, reponseErreur, reponseOk } from '@/lib/guichet-hub/serveur'
import { etatCompte } from '@/lib/guichet-hub/lectures'
import { envoyerInvitation, type GenreFiche } from '@/lib/comptes/invitation'
import { normaliserAdresse } from '@/lib/emails/destinataire'
import { estUuid } from '@/lib/messagerie/regles'

export const dynamic = 'force-dynamic'

const MESSAGES_INVITATION: Record<string, string> = {
  sans_adresse: 'Cette fiche n’a pas d’adresse e-mail : l’invitation n’a nulle part où aller.',
  deja_ouvert: 'Le lien d’invitation a déjà été ouvert : utilisez plutôt « Réinitialiser l’accès ».',
  conflit: 'Un compte en attente existe pour cette adresse, mais il n’est pas lié à cette fiche.',
}

export async function POST(req: NextRequest) {
  const g = ouvrirGuichet(req)
  if ('refus' in g) return g.refus
  const db = g.supabase

  let brut: Record<string, unknown>
  try {
    brut = (await req.json()) as Record<string, unknown>
  } catch {
    return reponseErreur('Requête illisible.', 400)
  }
  const action = brut?.action
  const genre = brut?.genre
  const id = brut?.id
  if (action !== 'inviter' && action !== 'reinitialiser') return reponseErreur('Action inconnue.', 400)
  if (genre !== 'veterinaire' && genre !== 'secretaire') return reponseErreur('Type de fiche inconnu.', 400)
  if (!estUuid(id)) return reponseErreur('Fiche introuvable.', 400)

  const table = genre === 'veterinaire' ? 'veterinaires' : 'secretaires'
  const colonnes = genre === 'veterinaire' ? 'id, cabinet_id, user_id, email, actif, role_app' : 'id, cabinet_id, user_id, email, actif, mot_de_passe_le'
  const { data: fiche, error } = await db.from(table).select(colonnes).eq('id', id).maybeSingle()
  if (error) {
    console.error('[Guichet Hub] action compte — lecture impossible :', error.message)
    return reponseErreur('La base de GuardVeto ne répond pas.', 502)
  }
  if (!fiche) return reponseErreur('Fiche introuvable.', 404)
  const f = fiche as unknown as {
    id: string
    cabinet_id: string
    user_id: string | null
    email: string | null
    actif: boolean
    role_app?: string
    mot_de_passe_le?: string | null
  }
  if (!f.actif) return reponseErreur('Cette fiche est désactivée dans le cabinet.', 409)

  if (action === 'inviter') {
    const r = await envoyerInvitation(db, {
      genre: genre as GenreFiche,
      id: f.id,
      email: f.email,
      cabinetId: f.cabinet_id,
      userId: f.user_id,
      role: f.role_app ?? null,
    })
    if (!r.ok) {
      if (r.code === 'echec') {
        console.error('[Guichet Hub] invitation refusée :', r.detail)
        return reponseErreur('L’invitation n’est pas partie côté GuardVeto.', 502)
      }
      return reponseErreur(MESSAGES_INVITATION[r.code], 409)
    }
    return reponseOk({ envoyeA: r.email })
  }

  // ── reinitialiser ──────────────────────────────────────────────────────────
  const comptes = await lireComptesAuth(db)
  if (!comptes) return reponseErreur('Les comptes de GuardVeto ne répondent pas.', 502)
  const etat = etatCompte(f.user_id, f.user_id ? comptes.get(f.user_id) : undefined, {
    motDePasseExige: genre === 'secretaire',
    motDePasseLe: f.mot_de_passe_le ?? null,
  })
  if (etat !== 'actif' && etat !== 'mot_de_passe_a_choisir') {
    return reponseErreur('Ce compte n’est pas encore actif : renvoyez plutôt l’invitation.', 409)
  }
  const adresse = normaliserAdresse(f.email)
  if (!adresse) return reponseErreur('Cette fiche n’a pas d’adresse e-mail.', 409)

  // Le MÊME mail et le MÊME retour que « Mot de passe oublié » (login/actions.ts).
  const { error: erreurReset } = await db.auth.resetPasswordForEmail(adresse, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://guardveto.vercel.app'}/set-password`,
  })
  if (erreurReset) {
    console.error('[Guichet Hub] réinitialisation refusée :', erreurReset.message)
    return reponseErreur('Le mail de réinitialisation n’est pas parti côté GuardVeto.', 502)
  }
  return reponseOk({ envoyeA: adresse })
}
