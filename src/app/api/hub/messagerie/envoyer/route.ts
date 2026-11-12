// ============================================================
// GUARDVETO — POST /api/hub/messagerie/envoyer (guichet du Hub MPP, B-207)
// ============================================================
// MiKL écrit depuis le Hub à une ou plusieurs personnes d'un cabinet. Chacune
// reçoit le message dans SON fil « MonProjetPro » de la messagerie, et la
// cloche sonne (trigger `messagerie_apres_insertion`).
//
// Corps : { cabinetId, destinataires: user_id[], corps }
// Réponse : { data: { envois: [{ userId, conversationId, messageId }] } }
//
// TOUT OU RIEN : la fonction SQL refuse l'envoi entier si un seul destinataire
// est invalide, ou si la messagerie du cabinet est éteinte.
// Pièces jointes et mail de prévenance : lots suivants (T-082 côté Hub).
// ============================================================

import { type NextRequest } from 'next/server'
import { ouvrirGuichet, reponseErreur, reponseOk } from '@/lib/guichet-hub/serveur'
import { lireDemandeEnvoi } from '@/lib/guichet-hub/envoi-editeur'

export const dynamic = 'force-dynamic'

interface RangeeEnvoi {
  user_id: string
  conversation_id: string
  message_id: string
}

export async function POST(req: NextRequest) {
  const g = ouvrirGuichet(req)
  if ('refus' in g) return g.refus

  let brut: unknown
  try {
    brut = await req.json()
  } catch {
    return reponseErreur('Requête illisible.', 400)
  }
  const lecture = lireDemandeEnvoi(brut)
  if (!lecture.ok) return reponseErreur(lecture.error, 400)
  const { cabinetId, destinataires, corps } = lecture.demande

  const { data, error } = await g.supabase.rpc('messagerie_envoyer_editeur', {
    p_cabinet: cabinetId,
    p_destinataires: destinataires,
    p_corps: corps,
  })
  if (error) {
    // Les refus de la fonction sont rédigés en français pour être montrés tels
    // quels dans le Hub (22023 = demande invalide, 42501 = messagerie éteinte).
    if (error.code === '22023') return reponseErreur(error.message, 400)
    if (error.code === '42501') return reponseErreur(error.message, 409)
    console.error('[Guichet Hub] envoi — refus inattendu :', error.code, error.message)
    return reponseErreur('L’envoi a échoué côté GuardVeto. Rien n’a été envoyé.', 500)
  }

  const envois = ((data ?? []) as RangeeEnvoi[]).map((r) => ({
    userId: r.user_id,
    conversationId: r.conversation_id,
    messageId: r.message_id,
  }))
  return reponseOk({ envois }, 201)
}
