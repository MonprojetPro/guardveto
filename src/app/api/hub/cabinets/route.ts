// ============================================================
// GUARDVETO — GET /api/hub/cabinets (guichet du Hub MPP, B-207 lot 1)
// ============================================================
// Tous les cabinets, chacun avec ce qu'il faut pour le piloter d'un coup
// d'œil : équipe et comptes, période en cours et suivante, demandes de
// support à traiter, dernière génération. Le tableau de bord du Hub ADDITIONNE
// ces lignes : une seule source, pas deux calculs qui divergent.
//
// Lecture seule. Aucune donnée de planning détaillée (gardes de chacun) :
// décision MiKL du 11/11, c'est la donnée du cabinet.
// ============================================================

import { type NextRequest } from 'next/server'
import { lireComptesAuth, ouvrirGuichet, reponseErreur, reponseOk } from '@/lib/guichet-hub/serveur'
import { etatCompte, jourAParis, periodesDuCabinet, plusRecente, type RangeePeriode } from '@/lib/guichet-hub/lectures'

export const dynamic = 'force-dynamic'

const JOURS_GENERATIONS = 30

interface RangeeCabinet {
  id: string
  nom: string
  ville: string | null
  actif: boolean
  est_bac_a_sable: boolean | null
  modules_actifs: string[] | null
  cree_le: string | null
}

export async function GET(req: NextRequest) {
  const g = ouvrirGuichet(req)
  if ('refus' in g) return g.refus
  const db = g.supabase

  const depuis = new Date(Date.now() - JOURS_GENERATIONS * 86_400_000).toISOString()
  const [cabinets, vetos, secs, periodes, support, generations, comptes] = await Promise.all([
    db.from('cabinets').select('id, nom, ville, actif, est_bac_a_sable, modules_actifs, cree_le').order('nom'),
    db.from('veterinaires').select('cabinet_id, user_id, actif'),
    db.from('secretaires').select('cabinet_id, user_id, actif, mot_de_passe_le'),
    db.from('periodes').select('id, cabinet_id, libelle, date_debut, date_fin, statut, publie_at'),
    db.from('demandes_support').select('cabinet_id, statut').in('statut', ['recue', 'en_cours']),
    db.from('generations_trace').select('cabinet_id, ouverte_le').gte('ouverte_le', depuis),
    lireComptesAuth(db),
  ])

  const echec = [cabinets, vetos, secs, periodes, support, generations].find((r) => r.error)
  if (echec?.error) {
    console.error('[Guichet Hub] cabinets — lecture impossible :', echec.error.message)
    return reponseErreur('La base de GuardVeto ne répond pas.', 502)
  }

  const jour = jourAParis()
  const lignes = ((cabinets.data ?? []) as RangeeCabinet[]).map((c) => {
    const sesVetos = (vetos.data ?? []).filter((v) => v.cabinet_id === c.id && v.actif)
    const sesSecs = (secs.data ?? []).filter((s) => s.cabinet_id === c.id && s.actif)

    // Les états de compte ne sont calculables que si l'API Auth a répondu.
    const etats = comptes
      ? [
          ...sesVetos.map((v) => etatCompte(v.user_id, v.user_id ? comptes.get(v.user_id) : undefined)),
          ...sesSecs.map((s) =>
            etatCompte(s.user_id, s.user_id ? comptes.get(s.user_id) : undefined, {
              motDePasseExige: true,
              motDePasseLe: s.mot_de_passe_le,
            }),
          ),
        ]
      : null
    const derniereConnexion = comptes
      ? plusRecente(
          [...sesVetos, ...sesSecs].map((m) => (m.user_id ? comptes.get(m.user_id)?.last_sign_in_at : null)),
        )
      : null

    const sesGenerations = (generations.data ?? []).filter((x) => x.cabinet_id === c.id)

    return {
      id: c.id,
      nom: c.nom,
      ville: c.ville,
      actif: c.actif,
      bacASable: c.est_bac_a_sable === true,
      modules: c.modules_actifs ?? [],
      creeLe: c.cree_le,
      equipe: {
        vetosActifs: sesVetos.length,
        secretariatActif: sesSecs.length,
        comptesActifs: etats ? etats.filter((e) => e === 'actif').length : null,
        invitationsEnAttente: etats
          ? etats.filter((e) => e === 'invitation_en_attente' || e === 'mot_de_passe_a_choisir').length
          : null,
        sansCompte: etats ? etats.filter((e) => e === 'sans_compte').length : null,
      },
      derniereConnexion,
      periodes: periodesDuCabinet(
        ((periodes.data ?? []) as RangeePeriode[]).filter((p) => p.cabinet_id === c.id),
        jour,
      ),
      support: { aTraiter: (support.data ?? []).filter((s) => s.cabinet_id === c.id).length },
      generations: {
        nb30j: sesGenerations.length,
        derniere: plusRecente(sesGenerations.map((x) => x.ouverte_le)),
      },
    }
  })

  return reponseOk({ cabinets: lignes, jour, comptesLisibles: comptes !== null })
}
