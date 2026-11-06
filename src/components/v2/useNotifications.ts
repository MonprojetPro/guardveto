'use client'

// ============================================================
// GUARDVETO V2 — L'état des notifications, partagé par la cloche et par
// l'écran « Toutes mes notifications » (B-191, 06/11)
// ============================================================
// Un seul endroit sait lire, marquer, retirer et vider : la cloche et la page
// ne peuvent pas diverger (une croix qui marche dans l'une et pas dans l'autre).
//
// ⚠️ Chaque appelant donne SON nom de canal temps réel : la page monte aussi la
//    cloche de la barre, deux abonnements du même nom se marcheraient dessus.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { abonnerEnSignalantLesEchecs } from '@/lib/realtime/statut-abonnement'
import {
  lireNotifications,
  marquerNotificationLue,
  marquerToutesNotificationsLues,
  retirerNotification,
  viderCloche,
} from '@/app/(v2)/cloche-actions'
import type { EtatCloche, NotificationCloche } from '@/lib/notifications/types'

export function useNotifications(canalTempsReel: string) {
  const [etat, setEtat] = useState<EtatCloche>({ items: [], nbNonLues: 0, erreur: false })
  const [charge, setCharge] = useState(false)
  const delai = useRef<ReturnType<typeof setTimeout> | null>(null)

  // La source de vérité est le serveur (RLS) : on relit plutôt que de deviner.
  // Une relecture ramène la PREMIÈRE page : ce qui avait été chargé en plus se
  // recharge au besoin, plutôt que d'afficher une liste à moitié périmée.
  const relire = useCallback(async () => {
    try {
      setEtat(await lireNotifications())
    } catch {
      setEtat((e) => ({ ...e, erreur: true }))
    } finally {
      setCharge(true)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void relire(), 0)
    return () => clearTimeout(t)
  }, [relire])

  // Tout changement sur SES notifications (la RLS filtre) → relecture, groupée.
  useEffect(() => {
    const supabase = createClient()
    const canal = supabase.channel(canalTempsReel)
    canal.on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
      if (delai.current) clearTimeout(delai.current)
      delai.current = setTimeout(() => void relire(), 500)
    })
    abonnerEnSignalantLesEchecs(canal, `${canalTempsReel} : notifications`)
    return () => {
      if (delai.current) clearTimeout(delai.current)
      void supabase.removeChannel(canal)
    }
  }, [relire, canalTempsReel])

  /** Marque lue (si besoin). Un échec remet la vérité du serveur à l'écran. */
  const marquerLue = useCallback(async (n: NotificationCloche) => {
    if (n.lu) return
    setEtat((e) => ({
      ...e,
      items: e.items.map((i) => (i.id === n.id ? { ...i, lu: true } : i)),
      nbNonLues: Math.max(0, e.nbNonLues - 1),
    }))
    if (!(await marquerNotificationLue(n.id))) void relire()
  }, [relire])

  const toutLire = useCallback(async () => {
    setEtat((e) => ({ ...e, items: e.items.map((i) => ({ ...i, lu: true })), nbNonLues: 0 }))
    if (!(await marquerToutesNotificationsLues())) void relire()
  }, [relire])

  const retirer = useCallback(async (n: NotificationCloche) => {
    setEtat((e) => ({
      ...e,
      items: e.items.filter((i) => i.id !== n.id),
      nbNonLues: n.lu ? e.nbNonLues : Math.max(0, e.nbNonLues - 1),
    }))
    if (!(await retirerNotification(n.id))) void relire()
  }, [relire])

  const vider = useCallback(async () => {
    setEtat((e) => ({ ...e, items: [], nbNonLues: 0, aSuite: false }))
    if (!(await viderCloche())) void relire()
  }, [relire])

  /** Charge la page suivante. */
  const chargerPlus = useCallback(async () => {
    if (etat.items.length === 0) return
    try {
      // Par position : un doublon possible (une notification arrivée entre-temps
      // décale la liste) est filtré par id ci-dessous ; un trou, jamais.
      const suite = await lireNotifications(etat.items.length)
      if (suite.erreur) return void setEtat((e) => ({ ...e, erreur: true }))
      setEtat((e) => ({
        items: [...e.items, ...suite.items.filter((s) => !e.items.some((i) => i.id === s.id))],
        nbNonLues: suite.nbNonLues,
        erreur: false,
        aSuite: suite.aSuite,
      }))
    } catch {
      setEtat((e) => ({ ...e, erreur: true }))
    }
  }, [etat.items])

  return { etat, charge, marquerLue, toutLire, retirer, vider, chargerPlus }
}
