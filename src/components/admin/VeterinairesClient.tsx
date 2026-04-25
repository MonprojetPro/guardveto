'use client'

import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VeterinaireCard } from './VeterinaireCard'
import { VeterinaireForm } from './VeterinaireForm'
import type { ContrainteVeto, Veterinaire } from '@/types'

interface VeterinairesClientProps {
  veterinaires: Veterinaire[]
  contraintes: ContrainteVeto[]
}

export function VeterinairesClient({ veterinaires, contraintes }: VeterinairesClientProps) {
  const [addOpen, setAddOpen] = useState(false)

  const actifs = veterinaires.filter((v) => v.actif)
  const inactifs = veterinaires.filter((v) => !v.actif)

  const contraintesParVet = (vetId: string) =>
    contraintes.filter((c) => c.veterinaire_id === vetId)

  return (
    <>
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Gestion des vétérinaires
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {actifs.length} actif{actifs.length > 1 ? 's' : ''}
            {inactifs.length > 0 && ` · ${inactifs.length} inactif${inactifs.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-2">
          <UserPlus className="w-4 h-4" />
          Ajouter un vétérinaire
        </Button>
      </div>

      {/* Liste — actifs */}
      <div className="space-y-2">
        {actifs.map((veto) => (
          <VeterinaireCard
            key={veto.id}
            veterinaire={veto}
            contraintes={contraintesParVet(veto.id)}
            vets={veterinaires}
          />
        ))}
        {actifs.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Aucun vétérinaire actif pour le moment.
          </p>
        )}
      </div>

      {/* Liste — inactifs */}
      {inactifs.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Inactifs ({inactifs.length})
          </p>
          {inactifs.map((veto) => (
            <VeterinaireCard
              key={veto.id}
              veterinaire={veto}
              contraintes={contraintesParVet(veto.id)}
              vets={veterinaires}
            />
          ))}
        </div>
      )}

      {/* Dialog ajout véto */}
      <VeterinaireForm open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  )
}
