'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { supprimerPeriode } from '@/app/(protected)/admin/periodes/actions'

export function SupprimerPeriodeButton({ periodeId, label }: { periodeId: string; label: string }) {
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
      title={`Supprimer ${label}`}
      className="p-1.5 rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  )
}
