'use client'

// ============================================================
// GUARDVETO — Alerte « créneaux ignorés » (backlog n°4, tranche 1)
// ============================================================
// Affichée après une génération quand des créneaux du catalogue
// (créés via /admin/structure ou l'assistant IA) n'ont produit
// AUCUNE garde : type sur-mesure que le moteur ne sait pas encore
// planifier, ou créneau masqué par un autre le même jour.
// Fin du silence : l'admin sait que son planning est incomplet.
// ============================================================

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import type { CreneauIgnore } from '@/engine/creneau-modele'

const NOMS_JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

function labelJours(jours: number[]) {
  if (jours.length === 0) return ''
  const ordonnes = [...jours].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) // lun…dim
  return ordonnes.map((j) => NOMS_JOURS[j] ?? `jour ${j}`).join(', ')
}

function labelRaison(c: CreneauIgnore) {
  if (c.raison === 'jour_masque') {
    return `un autre créneau couvre déjà ${labelJours(c.jours) || 'ces jours'} — un seul créneau par jour est planifié pour l'instant`
  }
  return 'type de garde sur-mesure — le moteur ne sait pas encore le planifier'
}

export function CreneauxIgnoresAlert({ creneaux }: { creneaux: CreneauIgnore[] }) {
  if (creneaux.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            {creneaux.length > 1
              ? `${creneaux.length} créneaux de ta structure n'ont produit aucune garde`
              : 'Un créneau de ta structure n\'a produit aucune garde'}
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
            Le planning a été généré SANS ces créneaux — vérifie qu'il couvre bien ton besoin.
          </p>
        </div>
      </div>

      <ul className="space-y-1 pl-8">
        {creneaux.map((c) => (
          <li key={c.id} className="text-xs text-amber-800 dark:text-amber-300">
            <span className="font-medium">{c.nom}</span>
            {c.raison === 'type_inconnu' && c.jours.length > 0 && (
              <span> ({labelJours(c.jours)})</span>
            )}
            <span className="text-amber-700 dark:text-amber-400"> — {labelRaison(c)}</span>
          </li>
        ))}
      </ul>

      <p className="text-xs text-amber-700 dark:text-amber-400 pl-8">
        <Link
          href="/admin/structure"
          className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200"
        >
          Revoir la structure des gardes →
        </Link>
      </p>
    </div>
  )
}
