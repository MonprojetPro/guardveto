'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Pencil, PowerOff, Power, ChevronDown, ChevronUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { VeterinaireForm } from './VeterinaireForm'
import { ContraintesSection } from './ContraintesSection'
import { toggleVeterinaireActif } from '@/app/(protected)/admin/veterinaires/actions'
import type { ContrainteVeto, Veterinaire } from '@/types'

interface VeterinaireCardProps {
  veterinaire: Veterinaire
  contraintes: ContrainteVeto[]
  vets: Veterinaire[]
}

export function VeterinaireCard({ veterinaire, contraintes, vets }: VeterinaireCardProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [contraintesOpen, setContraintesOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleToggleActif = () => {
    startTransition(async () => {
      const result = await toggleVeterinaireActif(veterinaire.id, !veterinaire.actif)
      if (result.error) { toast.error(result.error); return }
      toast.success(
        veterinaire.actif
          ? `${veterinaire.prenom} ${veterinaire.nom} désactivé`
          : `${veterinaire.prenom} ${veterinaire.nom} réactivé`
      )
    })
  }

  return (
    <>
      <div
        className={`rounded-lg border bg-background transition-opacity ${
          veterinaire.actif ? 'border-border opacity-100' : 'border-border/50 opacity-60'
        }`}
      >
        {/* Ligne principale */}
        <div className="flex items-center gap-3 p-3">
          {/* Avatar couleur */}
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
            style={{ backgroundColor: veterinaire.couleur }}
          >
            {veterinaire.prenom.charAt(0)}
          </div>

          {/* Infos */}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-foreground">
              {veterinaire.prenom} {veterinaire.nom}
            </p>
            <p className="text-xs text-muted-foreground truncate">{veterinaire.email}</p>
          </div>

          {/* Badges */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <Badge variant="outline" className="text-xs capitalize">
              {veterinaire.statut === 'associe' ? 'Associé' : 'Salarié'}
            </Badge>
            <Badge
              variant={veterinaire.role_app === 'admin' ? 'default' : 'secondary'}
              className="text-xs capitalize"
            >
              {veterinaire.role_app}
            </Badge>
            {veterinaire.dernier_recours && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Dernier recours
              </Badge>
            )}
            {!veterinaire.actif && (
              <Badge variant="destructive" className="text-xs">Inactif</Badge>
            )}
            {!veterinaire.user_id && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                Sans compte
              </Badge>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Toggle contraintes */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 relative"
              onClick={() => setContraintesOpen((o) => !o)}
              title={`Contraintes (${contraintes.length})`}
            >
              {contraintesOpen ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              {contraintes.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center font-bold">
                  {contraintes.length}
                </span>
              )}
            </Button>

            <Button
              variant="ghost" size="icon"
              className="h-8 w-8"
              onClick={() => setEditOpen(true)}
              title="Modifier"
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>

            <Button
              variant="ghost" size="icon"
              className={`h-8 w-8 ${veterinaire.actif ? 'text-destructive hover:text-destructive' : 'text-emerald-600 hover:text-emerald-600'}`}
              onClick={handleToggleActif}
              disabled={isPending}
              title={veterinaire.actif ? 'Désactiver' : 'Réactiver'}
            >
              {veterinaire.actif ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>

        {/* Section contraintes dépliable */}
        {contraintesOpen && (
          <div className="border-t border-border/60 px-3">
            <ContraintesSection
              veterinaire_id={veterinaire.id}
              contraintes={contraintes}
              vets={vets}
            />
          </div>
        )}
      </div>

      <VeterinaireForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        veterinaire={veterinaire}
      />
    </>
  )
}
