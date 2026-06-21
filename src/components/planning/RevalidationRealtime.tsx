'use client'

// ============================================================
// GUARDVETO — RevalidationRealtime (Chantier B)
// ============================================================
// Bandeau d'alerte ADMIN qui re-valide en CONTINU le planning publié.
//
// Pourquoi : avant ce chantier, le planning n'était vérifié qu'à la génération.
// Une fois publié, un congé validé a posteriori, une règle modifiée, une
// édition manuelle ou une réparation de crise pouvaient casser une contrainte
// dure sans aucune alerte. Ici on rebranche `validerPlanning` en prod.
//
// Temps réel : on s'abonne aux tables dont un changement peut introduire une
// violation (gardes, conges, periodes, veterinaires, regles_cabinet). À chaque
// event, on relance la re-validation côté serveur (debounce) et on rafraîchit
// le bandeau — sans rechargement de page.
//
// La re-validation initiale est calculée en SSR (cohérence au 1er rendu) puis
// remplacée par les résultats temps réel.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { revaliderPlanningPublie } from '@/data/revaliderPlanning'
import type { ViolationRevalidation } from './types-revalidation'

interface RevalidationRealtimeProps {
  /** Période(s) publiée(s) visibles sur le mois affiché, à re-valider. */
  periodeIds: string[]
  /** Violations calculées en SSR au 1er rendu (évite un flash vide). */
  initialViolations: ViolationRevalidation[]
}

// Tables dont un changement peut rendre le planning publié non conforme.
const TABLES_SURVEILLEES = [
  'gardes',
  'conges',
  'periodes',
  'veterinaires',
  'regles_cabinet',
] as const

const MAX_AFFICHEES = 12

function formatDateFr(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function RevalidationRealtime({
  periodeIds,
  initialViolations,
}: RevalidationRealtimeProps) {
  const [violations, setViolations] = useState<ViolationRevalidation[]>(initialViolations)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-validation serveur (debounced) — déclenchée par les events Realtime.
  const revalider = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await revaliderPlanningPublie(periodeIds)
        setViolations(res)
      } catch {
        // best-effort : on garde l'état précédent en cas d'échec réseau
      }
    }, 800)
  }, [periodeIds])

  useEffect(() => {
    if (periodeIds.length === 0) return
    const supabase = createClient()
    const channel = supabase.channel('revalidation-planning-publie')

    for (const table of TABLES_SURVEILLEES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => revalider()
      )
    }

    channel.subscribe()

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [periodeIds, revalider])

  if (violations.length === 0) return null

  const affichees = violations.slice(0, MAX_AFFICHEES)
  const reste = violations.length - affichees.length

  return (
    <div
      className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/20"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-red-800 dark:text-red-300">
            {violations.length === 1
              ? '1 incohérence détectée sur le planning publié'
              : `${violations.length} incohérences détectées sur le planning publié`}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-red-700 dark:text-red-400">
            Le planning ne respecte plus toutes les règles depuis sa publication
            (congé validé, règle modifiée, édition manuelle…). Vérifiez et corrigez
            les créneaux concernés.
          </p>

          <ul className="mt-2 space-y-1">
            {affichees.map((v, i) => (
              <li
                key={`${v.regle}-${v.date}-${v.type}-${v.vetId ?? i}`}
                className="text-xs leading-relaxed text-red-700 dark:text-red-300"
              >
                <span className="font-semibold">{formatDateFr(v.date)}</span>
                {' — '}
                <span className="font-mono text-[11px] opacity-70">{v.regle}</span>
                {' · '}
                {v.detail}
              </li>
            ))}
          </ul>

          {reste > 0 && (
            <p className="mt-1 text-xs italic text-red-600 dark:text-red-400">
              … et {reste} autre{reste > 1 ? 's' : ''}.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
