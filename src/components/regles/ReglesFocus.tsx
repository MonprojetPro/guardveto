'use client'

// ============================================================
// GUARDVETO — Surlignage de la règle ciblée par le diagnostic
// ============================================================
// Quand on arrive sur /regles?focus=<cible> depuis une suggestion
// d'assouplissement (bandeau d'impasse), on scrolle vers la règle visée
// et on la surligne brièvement. Purement cosmétique et défensif : si la
// cible n'existe pas (ou pas de param), le composant ne fait RIEN — la page
// ne casse jamais.
// ============================================================

import { useEffect } from 'react'

interface ReglesFocusProps {
  focus?: string
}

export function ReglesFocus({ focus }: ReglesFocusProps) {
  useEffect(() => {
    if (!focus) return

    // Échappe la valeur pour un sélecteur CSS valide (ids/clé peuvent contenir
    // des caractères réservés). Fallback manuel si CSS.escape indisponible.
    const safe =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(focus)
        : focus.replace(/["\\]/g, '\\$&')

    const el = document.querySelector<HTMLElement>(
      `[data-regle-cible="${safe}"], [data-regle-cible-alt="${safe}"]`,
    )
    if (!el) return

    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.dataset.focus = 'on'
    const timer = window.setTimeout(() => {
      delete el.dataset.focus
    }, 2600)

    return () => window.clearTimeout(timer)
  }, [focus])

  return null
}
