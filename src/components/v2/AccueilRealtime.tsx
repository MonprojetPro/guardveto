'use client'

// ============================================================
// GUARDVETO V2 — L'accueil se met à jour tout seul
// ============================================================
// L'accueil était un écran serveur PUR : aucun abonnement, aucun rafraîchis-
// sement. Une demande de congé déposée pendant qu'on regarde le tableau n'y
// apparaissait qu'après un rechargement de page — c'est-à-dire jamais, puisque
// personne ne recharge un écran qui vient de dire « rien à vérifier ».
//
// C'est la moitié la plus littérale de la question de MiKL le 2026-08-25 :
// « pourquoi je ne le sais que si je demande ? ». Il fallait effectivement
// demander : appuyer sur F5 était la seule façon d'obtenir la vérité.
//
// Le planning avait déjà son équivalent (`planning/RealtimeRefresh`) depuis le
// chantier B. L'accueil ne l'a jamais eu, et personne ne s'en est aperçu parce
// que les deux seules fiches qu'il affichait (la garde du soir, la cohérence)
// ne bougent presque jamais en cours de journée.
//
// ⚠️ LA CHAÎNE SE VÉRIFIE DE BOUT EN BOUT, PAS AU MILIEU. Un abonnement à une
// table absente de la publication `supabase_realtime` ne renvoie AUCUNE erreur :
// il ne se déclenche simplement jamais. `compensations` était dans ce cas —
// d'où la migration `20260825_realtime_attentes.sql` livrée avec ce fichier.
// Ajouter la ligne ici sans la migration aurait produit le pire des deux
// mondes : du code qui a l'air de brancher quelque chose, et rien derrière.
// ============================================================

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { TABLES_ECOUTEES } from '@/data/v2/enAttente'

/**
 * Les tables qui alimentent le tableau.
 *
 * `TABLES_ECOUTEES` vient du catalogue des fiches : ajouter une source
 * d'attente là-bas la branche ici automatiquement. On y ajoute les deux
 * tables des fiches historiques (la garde du soir, la période à publier),
 * qui ne passent pas par le catalogue.
 */
const TABLES = [...TABLES_ECOUTEES, 'gardes', 'periodes'] as const

/** Le temps qu'on laisse aux écritures en cascade de se terminer. */
const DEBOUNCE_MS = 600

export function AccueilRealtime() {
  const router = useRouter()
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const canal = supabase.channel('accueil-en-attente')

    // Une validation d'échange écrit la garde, la compensation ET l'échange :
    // sans temporisation, trois rafraîchissements se déclencheraient coup sur
    // coup pour un seul geste.
    const planifier = () => {
      if (debounce.current) clearTimeout(debounce.current)
      debounce.current = setTimeout(() => router.refresh(), DEBOUNCE_MS)
    }

    for (const table of TABLES) {
      canal.on('postgres_changes', { event: '*', schema: 'public', table }, planifier)
    }

    canal.subscribe()

    return () => {
      if (debounce.current) clearTimeout(debounce.current)
      supabase.removeChannel(canal)
    }
  }, [router])

  return null
}
