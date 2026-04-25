'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { createConge, updateConge } from '@/app/(protected)/conges/actions'
import type { Conge, TypeConge, Veterinaire } from '@/types'

const TYPES_CONGE: { value: TypeConge; label: string }[] = [
  { value: 'vacances', label: 'Vacances' },
  { value: 'formation', label: 'Formation' },
  { value: 'sante', label: 'Santé' },
  { value: 'autre', label: 'Autre' },
]

// Calcule le lundi de la semaine d'une date
function lundiDeSemaine(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

// Formate une date en yyyy-MM-dd
function toIso(date: Date): string {
  return date.toISOString().split('T')[0]
}

// Dimanche de la semaine (lundi + 6)
function dimancheDeSemaine(lundi: Date): Date {
  const d = new Date(lundi)
  d.setDate(d.getDate() + 6)
  return d
}

interface CongeFormProps {
  open: boolean
  onClose: () => void
  vets: Veterinaire[]
  currentUserId: string
  isAdmin: boolean
  conge?: Conge | null
  defaultVetId?: string
}

export function CongeForm({
  open, onClose, vets, currentUserId, isAdmin, conge, defaultVetId,
}: CongeFormProps) {
  const isEdit = Boolean(conge)
  const [isPending, startTransition] = useTransition()

  const today = lundiDeSemaine(new Date())

  const [vetId, setVetId] = useState(
    conge?.veterinaire_id ?? defaultVetId ?? vets[0]?.id ?? ''
  )
  const [dateDebut, setDateDebut] = useState(
    conge?.date_debut ?? toIso(today)
  )
  const [dateFin, setDateFin] = useState(
    conge?.date_fin ?? toIso(dimancheDeSemaine(today))
  )
  const [type, setType] = useState<TypeConge>(conge?.type ?? 'vacances')
  const [commentaire, setCommentaire] = useState(conge?.commentaire ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Quand date_debut change → recalcule date_fin au dimanche de la même semaine
  const handleDebutChange = (val: string) => {
    setDateDebut(val)
    if (val) {
      const lundi = lundiDeSemaine(new Date(val))
      setDateFin(toIso(dimancheDeSemaine(lundi)))
    }
    setErrors({})
  }

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!vetId) errs.vetId = 'Sélectionnez un vétérinaire'
    if (!dateDebut) errs.dateDebut = 'Date de début requise'
    if (!dateFin) errs.dateFin = 'Date de fin requise'
    if (dateDebut && dateFin && dateDebut > dateFin) {
      errs.dateFin = 'La date de fin doit être après la date de début'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleClose = () => {
    setErrors({})
    onClose()
  }

  const handleSubmit = () => {
    if (!validate()) return

    startTransition(async () => {
      const data = { veterinaire_id: vetId, date_debut: dateDebut, date_fin: dateFin, type, commentaire }
      const result = isEdit && conge
        ? await updateConge(conge.id, data)
        : await createConge(data, currentUserId, isAdmin)

      if (result.error) { toast.error(result.error); return }
      toast.success(isEdit ? 'Congé modifié' : 'Congé ajouté')
      handleClose()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEdit ? 'Modifier le congé' : isAdmin ? 'Ajouter un congé' : 'Demander un congé'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Vétérinaire — admin uniquement */}
          {isAdmin && (
            <div className="space-y-1.5">
              <Label>Vétérinaire</Label>
              <Select value={vetId} onValueChange={(v) => v && setVetId(v)}>
                <SelectTrigger className={`w-full ${errors.vetId ? 'border-destructive' : ''}`}>
                  {vetId
                    ? (() => { const v = vets.find((x) => x.id === vetId); return v ? `${v.prenom} ${v.nom}` : '' })()
                    : <span className="text-muted-foreground">Sélectionner…</span>
                  }
                </SelectTrigger>
                <SelectContent>
                  {vets.filter((v) => v.actif).map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.prenom} {v.nom}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.vetId && <p className="text-xs text-destructive">{errors.vetId}</p>}
            </div>
          )}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="date_debut">Début (lundi)</Label>
              <Input
                id="date_debut"
                type="date"
                value={dateDebut}
                onChange={(e) => handleDebutChange(e.target.value)}
                className={errors.dateDebut ? 'border-destructive' : ''}
              />
              {errors.dateDebut && <p className="text-xs text-destructive">{errors.dateDebut}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date_fin">Fin (dimanche)</Label>
              <Input
                id="date_fin"
                type="date"
                value={dateFin}
                onChange={(e) => { setDateFin(e.target.value); setErrors({}) }}
                className={errors.dateFin ? 'border-destructive' : ''}
              />
              {errors.dateFin && <p className="text-xs text-destructive">{errors.dateFin}</p>}
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Les congés se découpent par semaine (lundi → dimanche).
          </p>

          {/* Type */}
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => v && setType(v as TypeConge)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES_CONGE.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Commentaire */}
          <div className="space-y-1.5">
            <Label htmlFor="commentaire">Commentaire (optionnel)</Label>
            <Input
              id="commentaire"
              value={commentaire}
              onChange={(e) => setCommentaire(e.target.value)}
              placeholder="Ex : Congé maternité, Congrès vétérinaire…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Enregistrement…' : isEdit ? 'Modifier' : 'Ajouter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
