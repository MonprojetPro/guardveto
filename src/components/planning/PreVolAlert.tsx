'use client'

// ============================================================
// GUARDVETO — Alerte de pré-vol (backlog n°23 + n°24)
// ============================================================
// Affichée sur l'écran de génération DÈS la sélection d'une période,
// AVANT le clic « Générer le planning » :
//   • demandes de congé en attente qui chevauchent la période (n°24 —
//     même détection que le gate de publication, signal plus précoce),
//   • incohérences de règles détectées par le pré-vol (n°23 — règles
//     fantômes, contradictions arithmétiques certaines).
// NON bloquant : l'admin peut toujours générer. Rien à signaler → rien
// n'est affiché (aucun bruit).
// ============================================================

import Link from 'next/link'
import { CalendarClock, ShieldAlert } from 'lucide-react'
import type { AvertissementPreVol } from '@/engine/pre-vol'

interface PreVolAlertProps {
  avertissements: AvertissementPreVol[]
  souhaitsEnAttente: number
}

export function PreVolAlert({ avertissements, souhaitsEnAttente }: PreVolAlertProps) {
  if (avertissements.length === 0 && souhaitsEnAttente === 0) return null

  const pluriel = souhaitsEnAttente > 1

  return (
    <div className="space-y-2">
      {/* n°24 — souhaits de congé en attente (avant même de générer) */}
      {souhaitsEnAttente > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <CalendarClock className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="text-sm text-amber-800 dark:text-amber-300">
              <span className="font-medium">
                {souhaitsEnAttente} demande{pluriel ? 's' : ''} de congé en attente
              </span>{' '}
              chevauche{pluriel ? 'nt' : ''} cette période — les traiter avant de générer ?
              Un congé validé après coup obligera à régénérer le planning.
              <div className="mt-1">
                <Link
                  href="/conges"
                  className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200"
                >
                  Voir les demandes de congé →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* n°23 — pré-vol de cohérence des règles */}
      {avertissements.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {avertissements.length > 1
                  ? `${avertissements.length} points à vérifier dans les règles avant de générer`
                  : 'Un point à vérifier dans les règles avant de générer'}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                Tu peux quand même générer — mais ces points risquent de faire échouer ou fausser le planning.
              </p>
            </div>
          </div>

          <ul className="space-y-2 pl-8">
            {avertissements.map((a, i) => (
              <li key={i} className="text-xs text-amber-800 dark:text-amber-300">
                {a.message}
                {a.regles.length > 0 && (
                  <ul className="mt-0.5 space-y-0.5 pl-4 list-disc text-amber-700 dark:text-amber-400">
                    {a.regles.map((r, j) => (
                      <li key={j} className="italic">« {r} »</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          <p className="text-xs text-amber-700 dark:text-amber-400 pl-8">
            <Link
              href="/regles"
              className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200"
            >
              Revoir les règles →
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}
