// ============================================================
// GUARDVETO — GET /api/hub/comptes (guichet du Hub MPP, B-207 lot 1)
// ============================================================
// Les fiches vétérinaires et secrétariat, avec l'état de leur compte :
// sans compte · invitation en attente · actif — et la dernière connexion.
// `?cabinetId=<uuid>` restreint à un cabinet ; sans lui, tous les cabinets.
//
// Lecture seule. Jamais de métadonnées auth, de jetons ni de mots de passe :
// trois dates par compte, c'est tout ce qui sort.
// ============================================================

import { type NextRequest } from 'next/server'
import { lireComptesAuth, ouvrirGuichet, reponseErreur, reponseOk } from '@/lib/guichet-hub/serveur'
import { etatCompte } from '@/lib/guichet-hub/lectures'
import { estUuid } from '@/lib/messagerie/regles'

export const dynamic = 'force-dynamic'

interface RangeeVeto {
  id: string
  cabinet_id: string
  user_id: string | null
  prenom: string
  nom: string
  email: string | null
  role_app: string
  actif: boolean
  invitation_en_sourdine: boolean | null
}

interface RangeeSec {
  id: string
  cabinet_id: string
  user_id: string | null
  nom: string
  email: string | null
  actif: boolean
  mot_de_passe_le: string | null
}

export async function GET(req: NextRequest) {
  const g = ouvrirGuichet(req)
  if ('refus' in g) return g.refus
  const db = g.supabase

  const cabinetId = req.nextUrl.searchParams.get('cabinetId')
  if (cabinetId !== null && !estUuid(cabinetId)) return reponseErreur('Cabinet introuvable.', 400)

  let qVetos = db
    .from('veterinaires')
    .select('id, cabinet_id, user_id, prenom, nom, email, role_app, actif, invitation_en_sourdine')
  let qSecs = db.from('secretaires').select('id, cabinet_id, user_id, nom, email, actif, mot_de_passe_le')
  if (cabinetId) {
    qVetos = qVetos.eq('cabinet_id', cabinetId)
    qSecs = qSecs.eq('cabinet_id', cabinetId)
  }

  const [vetos, secs, comptes] = await Promise.all([qVetos, qSecs, lireComptesAuth(db)])
  if (vetos.error || secs.error) {
    console.error('[Guichet Hub] comptes — lecture impossible :', (vetos.error ?? secs.error)?.message)
    return reponseErreur('La base de GuardVeto ne répond pas.', 502)
  }

  const fiches = [
    ...((vetos.data ?? []) as RangeeVeto[]).map((v) => {
      const compte = v.user_id ? comptes?.get(v.user_id) : undefined
      return {
        genre: 'veterinaire' as const,
        id: v.id,
        cabinetId: v.cabinet_id,
        nom: `${v.prenom} ${v.nom}`.trim(),
        email: v.email,
        role: v.role_app,
        actif: v.actif,
        etat: comptes ? etatCompte(v.user_id, compte) : null,
        derniereConnexion: compte?.last_sign_in_at ?? null,
        inviteLe: compte?.invited_at ?? null,
        invitationEnSourdine: v.invitation_en_sourdine === true,
      }
    }),
    ...((secs.data ?? []) as RangeeSec[]).map((s) => {
      const compte = s.user_id ? comptes?.get(s.user_id) : undefined
      return {
        genre: 'secretaire' as const,
        id: s.id,
        cabinetId: s.cabinet_id,
        nom: s.nom,
        email: s.email,
        role: 'secretaire',
        actif: s.actif,
        etat: comptes ? etatCompte(s.user_id, compte, { motDePasseExige: true, motDePasseLe: s.mot_de_passe_le }) : null,
        derniereConnexion: compte?.last_sign_in_at ?? null,
        inviteLe: compte?.invited_at ?? null,
        invitationEnSourdine: false,
      }
    }),
  ].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))

  return reponseOk({ comptes: fiches, comptesLisibles: comptes !== null })
}
