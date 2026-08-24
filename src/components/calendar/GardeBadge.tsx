'use client'

import { stylePastille } from '@/lib/couleurs'

// ── Types ────────────────────────────────────────────────

interface GardeBadgeProps {
  prenom: string | null
  nom: string | null
  couleur: string | null
  role: 'premier' | 'second'
  compact?: boolean
}

// ── Composant ────────────────────────────────────────────

export function GardeBadge({ prenom, nom, couleur, role, compact }: GardeBadgeProps) {
  if (!prenom) return null

  const isSecond = role === 'second'

  return (
    <span
      title={`${isSecond ? '2nd' : '1er'} : ${prenom} ${nom ?? ''}`}
      // L'encre n'est plus supposée blanche : depuis que la couleur d'un véto
      // se choisit librement, un jaune clair est possible — et sur un jaune
      // clair, un prénom blanc n'existe pas. Voir `src/lib/couleurs.ts`.
      style={{
        ...stylePastille(couleur),
        fontSize: compact ? '10px' : '11px',
        opacity: isSecond ? 0.82 : 1,
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold leading-none max-w-full shrink-0"
    >
      <span className="truncate">{prenom}</span>
      {/* Le rang, en retrait : il se lit après le prénom, pas avant. Le retrait
          se fait à l'opacité, sur l'encre héritée — `text-white/70` l'aurait
          rendu invisible sur une teinte claire, comme le prénom. */}
      <span className="font-normal shrink-0 opacity-70">{isSecond ? '2' : '1'}</span>
    </span>
  )
}
