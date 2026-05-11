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

  const isSecond = role === 'second'

  return (
    <span
      title={`${isSecond ? '2nd' : '1er'} : ${prenom} ${nom ?? ''}`}
      style={{
        backgroundColor: color,
        fontSize: compact ? '10px' : '11px',
        opacity: isSecond ? 0.82 : 1,
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-white font-semibold leading-none max-w-full shrink-0"
    >
      <span className="truncate">{prenom}</span>
      <span className="text-white/70 font-normal shrink-0">{isSecond ? '2' : '1'}</span>
    </span>
  )
}
