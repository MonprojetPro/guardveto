'use client'

// ============================================================
// GUARDVETO — RealtimeRefresh (Chantier B)
// ============================================================
// La page planning est un Server Component (SSR pur) : sans Realtime, il faut
// recharger la page pour voir un changement. Ce composant abonne TOUT
// utilisateur (admin ET véto) aux changements de `gardes` et `periodes` et
// déclenche un `router.refresh()` (re-fetch SSR transparent, sans flash) dès
// qu'une garde est modifiée ou qu'une période est (dé)publiée.
//
// C'est le pendant « affichage temps réel » de la re-validation : le planning
// affiché reste toujours synchrone avec la base, sans action de l'utilisateur.
// ============================================================

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { abonnerEnSignalantLesEchecs } from '@/lib/realtime/statut-abonnement'

// ⚠️ B-150 — `presences_journee` EST DANS CETTE LISTE, ET C'EST OBLIGATOIRE.
//
// Sans elle, appliquer les récurrences ou poser une présence écrivait bien en
// base, et la grille restait identique jusqu'au rechargement suivant. Or
// `revalidatePath('/planning')` ne touche QUE l'onglet qui a cliqué : les autres
// écrans ouverts (le secrétariat au comptoir, typiquement) restaient en retard
// sans le savoir — et un planning en retard ne se distingue pas d'un planning
// vide. C'est le symptôme « faut que je rafraîchisse pour voir » de la règle
// INSPECTION DES CONSUMERS.
//
// La table est bien membre de la publication `supabase_realtime` (migration
// `20261006120000_presences_journee.sql`, vérifié) — sans quoi l'abonnement ne
// renverrait AUCUNE erreur et ne se déclencherait jamais.
const TABLES_SURVEILLEES = ['gardes', 'periodes', 'presences_journee'] as const

export function RealtimeRefresh() {
  const router = useRouter()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel('planning-live-refresh')

    const planifierRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => router.refresh(), 600)
    }

    for (const table of TABLES_SURVEILLEES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        planifierRefresh
      )
    }

    // Le libellé ÉNUMÈRE ce qui est réellement écouté, et rien d'autre. Il
    // annonçait « conges, veterinaires, regles » alors que ces trois tables
    // n'ont jamais été dans la liste : un message de diagnostic qui décrit un
    // abonnement imaginaire envoie chercher la panne au mauvais endroit.
    abonnerEnSignalantLesEchecs(channel, `planning : ${TABLES_SURVEILLEES.join(', ')}`)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [router])

  return null
}
