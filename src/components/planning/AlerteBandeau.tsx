'use client'

// ============================================================
// GUARDVETO — AlerteBandeau
// ============================================================
// Bandeau d'alerte contextuel pour la page planning.
// Utilisations :
//   - variante='warning' → rappel de publication (période brouillon < 15 jours)
//   - variante='danger'  → impasse moteur ou alerte critique
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import { X, Clock, AlertTriangle } from 'lucide-react'

// ── Types ────────────────────────────────────────────────

export interface ActionBandeau {
  label: string
  href: string
}

interface AlerteBandeauProps {
  variante: 'danger' | 'warning'
  titre: string
  description?: string
  actions?: ActionBandeau[]
  dismissable?: boolean
}

// ── Tokens de style par variante ─────────────────────────

const styles = {
  danger: {
    outer:  'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20',
    icon:   'text-red-600 dark:text-red-400',
    titre:  'text-red-800 dark:text-red-300',
    desc:   'text-red-700 dark:text-red-400',
    action: 'text-red-700 hover:text-red-900 dark:text-red-400 dark:hover:text-red-200 underline underline-offset-2',
    close:  'text-red-500 hover:text-red-700 dark:text-red-400',
  },
  warning: {
    outer:  'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20',
    icon:   'text-amber-600 dark:text-amber-400',
    titre:  'text-amber-800 dark:text-amber-300',
    desc:   'text-amber-700 dark:text-amber-400',
    action: 'text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200 underline underline-offset-2',
    close:  'text-amber-500 hover:text-amber-700 dark:text-amber-400',
  },
}

// ── Composant ────────────────────────────────────────────

export function AlerteBandeau({
  variante,
  titre,
  description,
  actions,
  dismissable = true,
}: AlerteBandeauProps) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  const t = styles[variante]
  const Icon = variante === 'danger' ? AlertTriangle : Clock

  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 ${t.outer}`} role="alert">
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${t.icon}`} aria-hidden />

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium leading-snug ${t.titre}`}>{titre}</p>

        {description && (
          <p className={`text-xs mt-0.5 leading-relaxed ${t.desc}`}>{description}</p>
        )}

        {actions && actions.length > 0 && (
          <div className="flex flex-wrap gap-4 mt-2">
            {actions.map((a) => (
              <Link key={a.href} href={a.href} className={`text-xs font-medium ${t.action}`}>
                {a.label} →
              </Link>
            ))}
          </div>
        )}
      </div>

      {dismissable && (
        <button
          onClick={() => setDismissed(true)}
          className={`shrink-0 mt-0.5 ${t.close} transition-opacity hover:opacity-70`}
          aria-label="Fermer le bandeau"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
