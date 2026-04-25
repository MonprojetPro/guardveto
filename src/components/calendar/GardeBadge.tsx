'use client'

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

  const color = couleur ?? '#6B7280'

  return (
    <span
      title={`${role === 'premier' ? '1er' : '2nd'} : ${prenom} ${nom ?? ''}`}
      style={{ backgroundColor: color, fontSize: compact ? '10px' : '11px' }}
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-white font-semibold leading-none max-w-full shrink-0"
    >
      <span className="truncate">{prenom}</span>
    </span>
  )
}
