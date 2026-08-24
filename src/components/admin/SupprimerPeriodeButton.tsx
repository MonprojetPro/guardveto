'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { RetirerPlanningModale } from '@/components/planning/RetirerPlanningModale'

/**
 * La corbeille d'un planning, sur l'écran « Historique & compteurs ».
 *
 * ⚠️ Ce composant n'est monté NULLE PART aujourd'hui — `HistoriqueV2` le cite
 * dans son en-tête comme réutilisé, mais ne le rend pas. Il est conservé (le
 * geste a vocation à revenir sur cet écran) et remis d'aplomb le 2026-08-22
 * plutôt que laissé en l'état : tel qu'il était, il portait sa propre
 * confirmation en une ligne — celle-là même qu'on venait de retirer des deux
 * écrans vivants. Le remonter aurait rouvert le chemin léger vers un geste qui
 * ne l'est plus.
 *
 * Toute la mécanique (l'inventaire réel, les deux confirmations, l'ordre
 * agenda-puis-base) vit dans `RetirerPlanningModale`. Ici : un bouton.
 */
export function SupprimerPeriodeButton({
  periodeId,
  label,
  aDesGardes = false,
}: { periodeId: string; label: string; aDesGardes?: boolean }) {
  const router = useRouter()
  const [ouvert, setOuvert] = useState(false)

  return (
    <>
      <button
        onClick={() => setOuvert(true)}
        title={aDesGardes ? `Supprimer ${label} et ses gardes` : `Supprimer ${label}`}
        aria-label={`Supprimer le planning ${label}`}
        className="p-1.5 rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {ouvert && (
        <RetirerPlanningModale
          periodeId={periodeId}
          nomConnu={label}
          geste="supprimer"
          onFerme={() => setOuvert(false)}
          onFait={(message) => {
            setOuvert(false)
            toast.success(message)
            router.refresh()
          }}
        />
      )}
    </>
  )
}
