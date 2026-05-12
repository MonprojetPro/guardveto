'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Pencil, PowerOff, Power, ChevronDown, ChevronUp, ShieldCheck, Star, UserX, CircleOff, Briefcase, Users, MailPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VeterinaireForm } from './VeterinaireForm'
import { ContraintesSection } from './ContraintesSection'
import { inviterVeterinaire, toggleVeterinaireActif } from '@/app/(protected)/admin/veterinaires/actions'
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

  const handleInviter = () => {
    startTransition(async () => {
      const result = await inviterVeterinaire(veterinaire.id)
      if (result.error) { toast.error(result.error); return }
      toast.success(`Invitation envoyée à ${result.email}`)
    })
  }

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
        className={`rounded-lg border bg-card transition-opacity ${
          veterinaire.actif ? 'border-border opacity-100' : 'border-border/50 opacity-60'
        }`}
      >
        {/* Ligne principale */}
        <div className="flex items-stretch gap-0">
          <div className="flex items-center gap-3 px-3 py-2.5 flex-1 min-w-0">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
              style={{ backgroundColor: veterinaire.couleur }}
            >
              {veterinaire.prenom.charAt(0)}
            </div>
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="font-semibold text-sm text-foreground leading-snug truncate">
                {veterinaire.prenom} {veterinaire.nom}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs text-muted-foreground">{veterinaire.email}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Statut contrat */}
                  {veterinaire.statut === 'associe' ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-primary/10 text-primary text-[11px] font-medium leading-none">
                      <Users className="w-3 h-3" />
                      Associé
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground text-[11px] font-medium leading-none">
                      <Briefcase className="w-3 h-3" />
                      Salarié
                    </span>
                  )}
                  {/* Rôle admin */}
                  {veterinaire.role_app === 'admin' && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold leading-none">
                      <ShieldCheck className="w-3 h-3" />
                      Admin
                    </span>
                  )}
                  {/* Dernier recours */}
                  {veterinaire.dernier_recours && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700 text-[11px] font-medium leading-none">
                      <Star className="w-3 h-3" />
                      Dernier recours
                    </span>
                  )}
                  {/* Inactif */}
                  {!veterinaire.actif && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive text-[11px] font-medium leading-none">
                      <CircleOff className="w-3 h-3" />
                      Inactif
                    </span>
                  )}
                  {/* Sans compte / Invitation en attente */}
                  {!veterinaire.user_id && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-medium leading-none">
                      <UserX className="w-3 h-3" />
                      Sans compte
                    </span>
                  )}
                  {veterinaire.user_id && veterinaire.invite_pending && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-600 border border-orange-200 text-[11px] font-medium leading-none">
                      <MailPlus className="w-3 h-3" />
                      Invitation envoyée
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 px-2 bg-muted/40 border-l border-border shrink-0">
            <Button
              variant="ghost" size="icon"
              className="h-8 w-8 text-amber-600 hover:text-amber-600 hover:bg-amber-50"
              onClick={handleInviter}
              disabled={isPending}
              title="Envoyer (ou renvoyer) une invitation par email"
            >
              <MailPlus className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-8 w-8 relative"
              onClick={() => setContraintesOpen((o) => !o)}
              title={`Contraintes (${contraintes.length})`}
            >
              {contraintesOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {contraintes.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center font-bold">
                  {contraintes.length}
                </span>
              )}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditOpen(true)} title="Modifier">
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
