'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { supprimerPeriode } from '@/app/(protected)/admin/periodes/actions'

/**
 * La corbeille d'un planning, sur l'écran « Historique & compteurs ».
 *
 * Depuis le 2026-08-03 le serveur accepte de supprimer un brouillon MÊME
 * rempli (il n'a jamais été vu par l'équipe) — la confirmation doit donc le
 * dire quand c'est le cas, sinon on efface un planning calculé sans avoir été
 * prévenu. Le second endroit d'où l'on supprime, le parcours de génération,
 * annonce la même chose : les deux écrans doivent raconter la même histoire.
 */
export function SupprimerPeriodeButton({
  periodeId,
  label,
  aDesGardes = false,
}: { periodeId: string; label: string; aDesGardes?: boolean }) {
  const [confirme, setConfirme] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSupprimer() {
    setLoading(true)
    setError(null)
    const result = await supprimerPeriode(periodeId)
    setLoading(false)
    if (result?.error) {
      setError(result.error)
      setConfirme(false)
    }
  }

  if (confirme) {
    return (
      <div className="flex items-center gap-2">
        {error && <span className="text-xs text-red-600">{error}</span>}
        {!error && aDesGardes && (
          <span className="text-xs text-muted-foreground">
            Ses gardes seront effacées —
          </span>
        )}
        <button
          onClick={() => setConfirme(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Annuler
        </button>
        <button
          onClick={handleSupprimer}
          disabled={loading}
          className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
        >
          {loading ? 'Suppression...' : 'Confirmer'}
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirme(true)}
      title={aDesGardes ? `Supprimer ${label} et ses gardes` : `Supprimer ${label}`}
      className="p-1.5 rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  )
}
