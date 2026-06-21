'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Pencil, PowerOff, Power, ChevronDown, ChevronUp, ShieldCheck, Star, UserX, CircleOff, Briefcase, Users, MailPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { VeterinaireForm } from './VeterinaireForm'
import { ContraintesSection } from './ContraintesSection'
import { inviterVeterinaire, toggleVeterinaireActif, type GardeAVenir } from '@/app/(protected)/admin/veterinaires/actions'
import type { ContrainteVeto, Veterinaire } from '@/types'

const LIBELLE_TYPE: Record<string, string> = {
  semaine: 'Semaine',
  weekend: 'Week-end',
  ferie: 'Férié',
}

function formatGardeFr(g: GardeAVenir): string {
  const d = new Date(g.date + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  return `${d} · ${LIBELLE_TYPE[g.type] ?? g.type}`
}

interface VeterinaireCardProps {
  veterinaire: Veterinaire
  contraintes: ContrainteVeto[]
  vets: Veterinaire[]
}

export function VeterinaireCard({ veterinaire, contraintes, vets }: VeterinaireCardProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [contraintesOpen, setContraintesOpen] = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState<GardeAVenir[] | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleInviter = () => {
    startTransition(async () => {
      const result = await inviterVeterinaire(veterinaire.id)
      if ('error' in result && result.error) { toast.error(result.error); return }
      if ('email' in result) toast.success(`Invitation envoyée à ${result.email}`)
    })
  }

  const handleToggleActif = () => {
    startTransition(async () => {
      const result = await toggleVeterinaireActif(veterinaire.id, !veterinaire.actif)
      if ('error' in result && result.error) { toast.error(result.error); return }
      // Garde-fou : véto encore de garde sur un planning publié → confirmation.
      if ('requiresConfirmation' in result) {
        setConfirmDeactivate(result.gardesAVenir)
        return
      }
      toast.success(
        veterinaire.actif
          ? `${veterinaire.prenom} ${veterinaire.nom} désactivé`
          : `${veterinaire.prenom} ${veterinaire.nom} réactivé`
      )
    })
  }

  const confirmerDesactivation = () => {
    startTransition(async () => {
      const result = await toggleVeterinaireActif(veterinaire.id, false, true)
      if ('error' in result && result.error) { toast.error(result.error); return }
      setConfirmDeactivate(null)
      toast.success(`${veterinaire.prenom} ${veterinaire.nom} désactivé`)
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

      {/* Confirmation de désactivation — véto encore de garde sur un planning publié */}
      <Dialog open={confirmDeactivate !== null} onOpenChange={(o) => { if (!o && !isPending) setConfirmDeactivate(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Désactiver {veterinaire.prenom} {veterinaire.nom} ?</DialogTitle>
            <DialogDescription>
              {veterinaire.prenom} est encore <strong>de garde sur un planning publié</strong> à venir.
              La désactivation ne supprime pas ces gardes — il faudra les
              <strong> réattribuer</strong> (édition manuelle ou gestion de crise),
              sinon elles resteront sans remplaçant et les compteurs d’équité seront faussés.
            </DialogDescription>
          </DialogHeader>
          {confirmDeactivate && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/20">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">
                {confirmDeactivate.length} garde{confirmDeactivate.length > 1 ? 's' : ''} à venir :
              </p>
              <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5 max-h-40 overflow-auto">
                {confirmDeactivate.map((g, i) => (
                  <li key={`${g.date}-${g.type}-${i}`}>{formatGardeFr(g)}</li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeactivate(null)} disabled={isPending}>
              Annuler
            </Button>
            <Button
              onClick={confirmerDesactivation}
              disabled={isPending}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              Désactiver quand même
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VeterinaireForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        veterinaire={veterinaire}
      />
    </>
  )
}
