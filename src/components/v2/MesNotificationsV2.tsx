'use client'

// ============================================================
// GUARDVETO V2 — Mes notifications : les e-mails que je reçois (B-134)
// ============================================================
// Une case par e-mail, cochée = je le reçois. Pas de bouton « Enregistrer » :
// chaque case part seule, à la seconde où on la coche. Un écran de réglages avec
// un bouton à ne pas oublier finit toujours par quelqu'un qui décoche, ferme
// l'onglet, et continue de recevoir ce qu'il croyait avoir coupé.
//
// L'INTERRUPTEUR N'EST PAS UN NOUVEAU COMPOSANT : c'est la case `.aa-switch`
// déjà utilisée par l'agenda et la fiche véto — même famille d'interaction dans
// le projet, accessible au clavier sans rien réinventer.
//
// ⚠️ L'ÉTAT AFFICHÉ SUIT LE SERVEUR, PAS LE CLIC. En cas d'échec, la case
//    revient à sa position d'avant et le message le dit. Laisser une case
//    cochée sur un enregistrement raté serait la pire des deux options : la
//    personne repartirait convaincue d'avoir coupé un e-mail qui continue de
//    partir, et n'aurait aucune raison de soupçonner l'écran.
// ============================================================

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { setReceptionEmail } from '@/app/(v2)/reglages/notifications/actions'
import type { CleReglage } from '@/lib/notifications-reglages'

export interface LigneReglage {
  cle: CleReglage
  libelle: string
  explication: string
  recoit: boolean
}

interface Props {
  reglages: LigneReglage[]
  role: 'admin' | 'veto' | 'secretaire'
}

export function MesNotificationsV2({ reglages, role }: Props) {
  const [etats, setEtats] = useState<Record<string, boolean>>(
    Object.fromEntries(reglages.map((r) => [r.cle, r.recoit])),
  )
  const [enCours, demarrer] = useTransition()

  const basculer = (cle: CleReglage, veutRecevoir: boolean) => {
    const avant = etats[cle]
    setEtats((e) => ({ ...e, [cle]: veutRecevoir }))

    demarrer(async () => {
      const res = await setReceptionEmail(cle, veutRecevoir)
      if ('error' in res) {
        // Retour à l'état d'avant : l'écran ne doit jamais montrer un réglage
        // que la base n'a pas accepté.
        setEtats((e) => ({ ...e, [cle]: avant }))
        toast.error(res.error)
        return
      }
      toast.success(veutRecevoir ? 'E-mail réactivé' : 'E-mail coupé')
    })
  }

  return (
    <>
      {/* Même tête de page que les autres écrans V2 (`page-head` + `lede`) :
          un écran de réglages qui ne ressemble pas aux autres se lit comme une
          page d'un autre produit. */}
      <div className="page-head rise">
        <div>
          <h1>Mes notifications</h1>
          <p className="lede">
            Choisissez les e-mails que vous recevez. Ces réglages ne valent que
            pour vous : personne d’autre n’est affecté.
          </p>
        </div>
      </div>

      <section className="card conn-card rise rise-2" aria-label="E-mails que je reçois">
        {reglages.length === 0 ? (
          // ⚠️ LE CAS DU SECRÉTARIAT, DIT EN CLAIR PLUTÔT QU'EN CASES VIDES.
          // Aucun e-mail du produit ne lui est adressé aujourd'hui : tous les
          // envois ciblent la table `veterinaires`, où il ne figure pas (B-017).
          // Afficher des interrupteurs qui ne commandent rien lui ferait croire
          // qu'il a réglé quelque chose — c'est précisément le défaut que le
          // projet a déjà payé (« ne jamais afficher un paramètre que le moteur
          // n'évalue pas »). On préfère une phrase honnête à une fausse maîtrise.
          <p className="aa-vide">
            {role === 'secretaire'
              ? 'Aucun e-mail automatique ne vous est adressé pour le moment — il n’y a donc rien à régler ici. Cette page s’étoffera dès que le produit vous en enverra.'
              : 'Aucun e-mail automatique ne concerne votre profil pour le moment.'}
          </p>
        ) : (
          <>
            <div className="mn-liste">
              {reglages.map((r) => (
                <label key={r.cle} className="aa-switch mn-ligne">
                  <input
                    type="checkbox"
                    checked={etats[r.cle] ?? true}
                    disabled={enCours}
                    onChange={(e) => basculer(r.cle, e.target.checked)}
                  />
                  <span>
                    <b>{r.libelle}</b>
                    <small>{r.explication}</small>
                  </span>
                </label>
              ))}
            </div>

            {/* Ce paragraphe n'est pas une politesse : sans lui, quelqu'un qui
                décoche tout se croit injoignable, et l'admin qui coupe les
                demandes de congé pense ne plus rien voir arriver. */}
            <p className="mn-note">
              Décocher ne coupe que l’<strong>e-mail</strong>. L’information reste
              visible dans GuardVeto — la cloche et les écrans continuent de
              l’afficher normalement.
            </p>
          </>
        )}
      </section>
    </>
  )
}
