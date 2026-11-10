'use client'

// ============================================================
// GUARDVETO V2 — Les e-mails que je reçois : l'état et son enregistrement
// ============================================================
// Partagé par « Mes notifications » (B-134) et par l'onglet Réglages refondu
// (B-202), pour qu'il n'existe qu'une seule façon d'enregistrer ce réglage.
//
// ⚠️ L'ÉTAT AFFICHÉ SUIT LE SERVEUR, PAS LE CLIC. En cas d'échec, la case
//    revient à sa position d'avant et le message le dit. Laisser une case
//    cochée sur un enregistrement raté ferait repartir la personne convaincue
//    d'avoir coupé un e-mail qui continue de partir.
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

export function useReceptionEmails(reglages: LigneReglage[]) {
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

  return { etats, enCours, basculer }
}
