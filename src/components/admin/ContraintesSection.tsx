'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ContrainteCard } from './ContrainteCard'
import { ContrainteForm } from './ContrainteForm'
import type { ContrainteVeto, Veterinaire } from '@/types'

interface ContraintesSectionProps {
  veterinaire_id: string
  contraintes: ContrainteVeto[]
  vets: Veterinaire[]
}

export function ContraintesSection({ veterinaire_id, contraintes, vets }: ContraintesSectionProps) {
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div className="pt-2 pb-1 px-1 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Contraintes ({contraintes.length})
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1 px-2"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="w-3 h-3" />
          Ajouter
        </Button>
      </div>

      {contraintes.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-1">
          Aucune contrainte configurée.
        </p>
      ) : (
        <div className="space-y-1.5">
          {contraintes.map((c) => (
            <ContrainteCard
              key={c.id}
              contrainte={c}
              veterinaire_id={veterinaire_id}
              vets={vets}
            />
          ))}
        </div>
      )}

      <ContrainteForm
        open={addOpen}
        onClose={() => setAddOpen(false)}
        veterinaire_id={veterinaire_id}
        vets={vets}
      />
    </div>
  )
}
