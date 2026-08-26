// ============================================================
// GUARDVETO V2 — Écran « Assistance » (B-016)
// ============================================================
// Le point de DÉPÔT des demandes de support. Le traitement (répondre, classer,
// prioriser) vit dans le hub MonProjetPro — décision MiKL du 2026-08-22 — et
// rien ici ne prétend le contraire : l'écran affiche le statut qu'il LIT, il
// n'en invente aucun.
//
// Ouvert à toute l'équipe (arbitrage MiKL du 25/08) : le vétérinaire qui a vu
// le problème est celui qui sait le décrire, et joindre sa capture. En lecture,
// chacun voit ses demandes, l'administrateur voit celles du cabinet — c'est la
// RLS qui l'impose, pas ce fichier. Le filtre écrit ici n'est qu'un confort
// d'affichage ; la barrière est en base (migration 20260825120000).
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { exigerVeterinaire } from '@/lib/identite'
import '@/styles/v2-support.css'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { SupportV2 } from '@/components/v2/SupportV2'
import { chargerDock } from '@/data/v2/dock'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import type { LigneDemande } from '@/lib/support/types'
import type { Veterinaire } from '@/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'GuardVeto — Assistance' }

interface RangeeDemande {
  id: string
  type: 'bug' | 'amelioration'
  titre: string
  description: string
  statut: 'recue' | 'en_cours' | 'traitee' | 'fermee'
  pieces_jointes: string[] | null
  email_envoye: boolean
  email_erreur: string | null
  auteur_id: string | null
  created_at: string
}

/**
 * B-050 — le formulaire peut arriver PRÉ-REMPLI.
 *
 * Quand un écran bute (aujourd'hui la génération de planning), il n'envoie plus
 * un message à l'aveugle : il oriente ici avec le contexte technique déjà écrit
 * dans la description. La personne le relit, le corrige, joint sa capture — ce
 * qu'un envoi silencieux ne permettait pas.
 *
 * Lu côté SERVEUR et passé en props : `useSearchParams` dans le composant
 * client obligerait à une frontière Suspense pour rien.
 */
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ titre?: string; description?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Le secretariat n'a pas de fiche veterinaire : `exigerVeterinaire` le
  // renvoie vers le planning au lieu de le deconnecter (B-017, 2026-08-25).
  // C'est ce refus SERVEUR qui ferme la porte -- le dock reduit n'est qu'un
  // confort d'affichage.
  const { veto: moi } = await exigerVeterinaire(supabase)

  const vet = moi as Veterinaire
  const estAdmin = vet.role_app === 'admin'

  let cabinetId: string | null = null
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch {
    cabinetId = null
  }

  // ── Les demandes déjà déposées ─────────────────────────────────────────
  // L'erreur est LUE. Sans ça, une base muette afficherait « rien d'envoyé
  // pour l'instant » à quelqu'un qui vient d'écrire trois demandes — le mode
  // de panne le plus trompeur de ce projet (leçon B-011, 2026-08-24).
  const { data: brutes, error: erreurLecture } = await supabase
    .from('demandes_support')
    .select(
      'id, type, titre, description, statut, pieces_jointes, email_envoye, email_erreur, auteur_id, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(50)

  if (erreurLecture) {
    console.error('[Support] Lecture des demandes impossible :', erreurLecture.message)
  }

  // Les noms d'auteurs, pour l'administrateur qui voit toute l'équipe.
  const auteurs = new Map<string, string>()
  if (estAdmin && cabinetId) {
    const { data: vets } = await supabase
      .from('veterinaires')
      .select('id, prenom, nom')
      .eq('cabinet_id', cabinetId)
    for (const v of (vets ?? []) as { id: string; prenom: string; nom: string }[]) {
      auteurs.set(v.id, `${v.prenom} ${v.nom}`)
    }
  }

  const demandes: LigneDemande[] = ((brutes ?? []) as RangeeDemande[]).map((d) => ({
    id: d.id,
    type: d.type,
    titre: d.titre,
    description: d.description,
    statut: d.statut,
    nbPieces: d.pieces_jointes?.length ?? 0,
    emailEnvoye: d.email_envoye,
    emailErreur: d.email_erreur,
    auteurNom: d.auteur_id ? (auteurs.get(d.auteur_id) ?? null) : null,
    deMoi: d.auteur_id === vet.id,
    createdAt: d.created_at,
  }))

  const dock = await chargerDock(supabase, vet)

  return (
    <>
      <Satin />
      <div className="shell">
        <BarreV2 prenom={vet.prenom} estAdmin={estAdmin} dock={dock} />
        {/* `cabinetId` peut manquer si le compte n'est rattaché à rien : le
            formulaire serait alors incapable de composer un chemin de dépôt
            valide. On préfère le dire que laisser essayer et échouer sur un
            refus du stockage, qui ne s'expliquerait pas tout seul. */}
        {cabinetId ? (
          <SupportV2
            demandes={demandes}
            cabinetId={cabinetId}
            estAdmin={estAdmin}
            titreInitial={params.titre}
            descriptionInitiale={params.description}
          />
        ) : (
          <div className="page-head">
            <h1>Assistance</h1>
            <p className="lede">
              Ton compte n’est rattaché à aucun cabinet — je ne peux pas rattacher une demande.
              Préviens l’administrateur de ton cabinet, c’est un réglage de son côté.
            </p>
          </div>
        )}
      </div>
    </>
  )
}
