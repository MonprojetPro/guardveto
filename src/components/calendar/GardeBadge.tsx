'use client'

// ── Types ────────────────────────────────────────────────

interface GardeBadgeProps {
  prenom: string | null
  nom: string | null
  couleur: string | null
  role: 'premier' | 'second'
  /** Mode compact : affiche les initiales au lieu du prénom */
  compact?: boolean
}

// ── Helpers ──────────────────────────────────────────────

function initiales(prenom: string | null, nom: string | null): string {
  if (!prenom) return '?'
  // Ex : "Anne-Sophie" → "AS", "Jean" → "J", "Anne-Cat" → "AC"
  const partsPrenom = prenom.split('-').map((p) => p[0]).join('')
  return partsPrenom.toUpperCase().slice(0, 2)
}

/** Génère une couleur de fond légère à partir d'une couleur hex */
function couleurFond(hex: string | null): string {
  if (!hex) return 'rgba(107,114,128,0.12)'
  // Ajoute 20% d'opacité à la couleur (hex + "33")
  return `${hex}22`
}

// ── Composant ────────────────────────────────────────────

export function GardeBadge({ prenom, nom, couleur, role, compact }: GardeBadgeProps) {
  if (!prenom) return null

  const color = couleur ?? '#6B7280'
  const bg = couleurFond(couleur)

  if (compact) {
    return (
      <span
        title={`${role === 'premier' ? '1er' : '2nd'} : ${prenom} ${nom ?? ''}`}
        style={{
          backgroundColor: bg,
          borderColor: color,
          color: color,
        }}
        className="inline-flex items-center justify-center rounded-full border text-[10px] font-semibold w-5 h-5 shrink-0 leading-none"
      >
        {initiales(prenom, nom)}
      </span>
    )
  }

  return (
    <span
      style={{
        backgroundColor: bg,
        borderColor: `${color}55`,
        color: color,
      }}
      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium max-w-full truncate leading-none"
    >
      {/* Dot coloré */}
      <span
        style={{ backgroundColor: color }}
        className="w-1.5 h-1.5 rounded-full shrink-0"
      />
      <span className="truncate">{prenom}</span>
    </span>
  )
}
