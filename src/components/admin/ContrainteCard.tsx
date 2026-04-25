'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ContrainteForm } from './ContrainteForm'
import { deleteContrainte } from '@/app/(protected)/admin/veterinaires/contraintes-actions'
import { formatContrainte, TYPE_LABELS } from '@/lib/formatContrainte'
import type { ContrainteVeto, Veterinaire } from '@/types'

interface ContrainteCardProps {
  contrainte: ContrainteVeto
  veterinaire_id: string
  vets: Veterinaire[]
}

export function ContrainteCard({ contrainte, veterinaire_id, vets }: ContrainteCardProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteContrainte(contrainte.id)
      if (result.error) { toast.error(result.error); return }
      toast.success('Contrainte supprimée')
    })
  }

  return (
    <>
      <div className="flex items-start gap-2 p-2.5 rounded-md border border-border/60 bg-muted/30">
        <div className="flex-1 min-w-0 space-y-1">
          <Badge variant="outline" className="text-xs">
            {TYPE_LABELS[contrainte.type]}
          </Badge>
          <p className="text-xs text-foreground leading-snug">
            {formatContrainte(contrainte, vets)}
          </p>
        </div>
        <div className="flex gap-0.5 shrink-0">
          <Button
            variant="ghost" size="icon"
            className="h-6 w-6"
            onClick={() => setEditOpen(true)}
            title="Modifier"
          >
            <Pencil className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-6 w-6 text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={isPending}
            title="Supprimer"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <ContrainteForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        veterinaire_id={veterinaire_id}
        vets={vets}
        contrainte={contrainte}
      />
    </>
  )
}
