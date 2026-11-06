'use client'

// ============================================================
// GUARDVETO V2 — Le nombre de messages non lus, dans le dock (B-193)
// ============================================================
// La barre est rendue côté serveur avec un premier chiffre ; cette pastille
// s'abonne ensuite seule aux messages et aux lectures, et se recompte. Sans
// elle, il faudrait que CHAQUE écran écoute la messagerie pour que la barre
// reste juste — et le dixième écran l'oublierait.
//
// Le secrétariat n'a pas de cloche : c'est ce chiffre qui le prévient.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { nombreMessagesNonLus } from '@/app/(v2)/messagerie/actions'
import { chiffreNonLus } from '@/lib/messagerie/regles'
import { abonnerEnSignalantLesEchecs } from '@/lib/realtime/statut-abonnement'

const DEBOUNCE_MS = 700

/**
 * `initial` ne sert qu'au premier affichage : la barre remonte ce composant
 * (clé = chiffre serveur) quand une navigation apporte un chiffre plus frais.
 */
export function PastilleMessagerie({ initial }: { initial: number }) {
  const [nb, setNb] = useState(initial)
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const canal = supabase.channel('messagerie-pastille')
    // Seules MES lectures changent mon chiffre. Sans ce filtre, chaque fois
    // que n'importe qui ouvre le fil d'équipe, tous les postes du cabinet se
    // recompteraient.
    let moi: string | null = null
    void supabase.auth.getUser().then(({ data }) => {
      moi = data.user?.id ?? null
    })
    const recompter = () => {
      if (minuterie.current) clearTimeout(minuterie.current)
      minuterie.current = setTimeout(async () => {
        const n = await nombreMessagesNonLus()
        // `null` = lecture impossible : on garde le dernier chiffre connu
        // plutôt que d'afficher « rien de neuf » sur une panne.
        if (n !== null) setNb(n)
      }, DEBOUNCE_MS)
    }
    canal.on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, recompter)
    canal.on('postgres_changes', { event: '*', schema: 'public', table: 'messagerie_lectures' }, (charge) => {
      const qui = (charge.new as { user_id?: string } | null)?.user_id
      if (!moi || qui === moi) recompter()
    })
    abonnerEnSignalantLesEchecs(canal, 'dock : messages non lus (messages, messagerie_lectures)')
    return () => {
      if (minuterie.current) clearTimeout(minuterie.current)
      supabase.removeChannel(canal)
    }
  }, [])

  const chiffre = chiffreNonLus(nb)
  if (!chiffre) return null
  return <i className="di-pip count">{chiffre}</i>
}
