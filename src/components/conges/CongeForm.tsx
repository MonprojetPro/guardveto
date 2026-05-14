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
import type { Conge, CreneauConge, TypeConge, Veterinaire } from '@/types'

const TYPES_CONGE: { value: TypeConge; label: string }[] = [
  { value: 'vacances',        label: 'Vacances' },
  { value: 'formation',       label: 'Formation' },
  { value: 'sante',           label: 'Santé' },
  { value: 'indisponibilite', label: 'Indisponibilité ponctuelle' },
  { value: 'autre',           label: 'Autre' },
]

const CRENEAUX: { value: CreneauConge; label: string }[] = [
  { value: 'journee',   label: 'Toute la journée' },
  { value: 'matin',     label: 'Matin' },
  { value: 'apres-midi', label: 'Après-midi' },
  { value: 'soiree',    label: 'Soirée' },
]

function lundiDeSemaine(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

function toIso(date: Date): string {
  return date.toISOString().split('T')[0]
}

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
  const [dateDebut, setDateDebut] = useState(conge?.date_debut ?? toIso(today))
  const [dateFin, setDateFin] = useState(
    conge?.date_fin ?? toIso(dimancheDeSemaine(today))
  )
  const [type, setType] = useState<TypeConge>(conge?.type ?? 'vacances')
  const [creneau, setCreneau] = useState<CreneauConge>(conge?.creneau ?? 'journee')
  const [commentaire, setCommentaire] = useState(conge?.commentaire ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const isIndispo = type === 'indisponibilite'

  const handleTypeChange = (val: TypeConge) => {
    setType(val)
    if (val === 'indisponibilite') {
      // Passe en date unique (même jour)
      const d = toIso(new Date())
      setDateDebut(d)
      setDateFin(d)
    } else {
      const lundi = lundiDeSemaine(new Date())
      setDateDebut(toIso(lundi))
      setDateFin(toIso(dimancheDeSemaine(lundi)))
    }
    setErrors({})
  }

  const handleDebutChange = (val: string) => {
    setDateDebut(val)
    if (!isIndispo && val) {
      const lundi = lundiDeSemaine(new Date(val))
      setDateFin(toIso(dimancheDeSemaine(lundi)))
    } else if (isIndispo) {
      setDateFin(val)
    }
    setErrors({})
  }

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!vetId) errs.vetId = 'Sélectionnez un vétérinaire'
    if (!dateDebut) errs.dateDebut = 'Date requise'
    if (!isIndispo && !dateFin) errs.dateFin = 'Date de fin requise'
    if (!isIndispo && dateDebut && dateFin && dateDebut > dateFin)
      errs.dateFin = 'La date de fin doit être après la date de début'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleClose = () => { setErrors({}); onClose() }

  const handleSubmit = () => {
    if (!validate()) return
    startTransition(async () => {
      const data = {
        veterinaire_id: isAdmin ? vetId : currentUserId,
        date_debut: dateDebut,
        date_fin: isIndispo ? dateDebut : dateFin,
        type,
        creneau: isIndispo ? creneau : null,
        commentaire,
      }
      const result = isEdit && conge
        ? await updateConge(conge.id, data)
        : await createConge(data, currentUserId, isAdmin)

      if (result.error) { toast.error(result.error); return }
      toast.success(isEdit ? 'Demande modifiée' : isIndispo ? 'Indisponibilité soumise' : 'Congé ajouté')
      handleClose()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEdit
              ? 'Modifier la demande'
              : isAdmin
                ? 'Ajouter un congé / indisponibilité'
                : isIndispo ? 'Signaler une indisponibilité' : 'Demander un congé'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Type — en premier pour adapter le reste du formulaire */}
          <div className="space-y-1.5">
            <Label>Type de demande</Label>
            <Select value={type} onValueChange={(v) => v && handleTypeChange(v as TypeConge)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES_CONGE.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Vétérinaire — admin uniquement */}
          {isAdmin && (
            <div className="space-y-1.5">
              <Label>Vétérinaire</Label>
              <Select value={vetId} onValueChange={(v) => v && setVetId(v)}>
                <SelectTrigger className={errors.vetId ? 'border-destructive' : ''}>
                  {vetId
                    ? (() => { const v = vets.find((x) => x.id === vetId); return v ? `${v.prenom} ${v.nom}` : '' })()
                    : <span className="text-muted-foreground">Sélectionner…</span>}
                </SelectTrigger>
                <SelectContent>
                  {vets.filter((v) => v.actif).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.prenom} {v.nom}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.vetId && <p className="text-xs text-destructive">{errors.vetId}</p>}
            </div>
          )}

          {/* Dates */}
          {isIndispo ? (
            <div className="space-y-1.5">
              <Label htmlFor="date_indispo">Date</Label>
              <Input
                id="date_indispo"
                type="date"
                value={dateDebut}
                onChange={(e) => handleDebutChange(e.target.value)}
                className={errors.dateDebut ? 'border-destructive' : ''}
              />
              {errors.dateDebut && <p className="text-xs text-destructive">{errors.dateDebut}</p>}
            </div>
          ) : (
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
          )}

          {!isIndispo && (
            <p className="text-xs text-muted-foreground -mt-2">
              Les congés se découpent par semaine (lundi → dimanche).
            </p>
          )}

          {/* Créneau — uniquement pour indisponibilité */}
          {isIndispo && (
            <div className="space-y-1.5">
              <Label>Créneau</Label>
              <Select value={creneau} onValueChange={(v) => v && setCreneau(v as CreneauConge)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CRENEAUX.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Commentaire */}
          <div className="space-y-1.5">
            <Label htmlFor="commentaire">
              {isIndispo ? 'Motif (optionnel)' : 'Commentaire (optionnel)'}
            </Label>
            <Input
              id="commentaire"
              value={commentaire}
              onChange={(e) => setCommentaire(e.target.value)}
              placeholder={isIndispo
                ? 'Ex : réunion obligatoire, événement familial…'
                : 'Ex : Congé maternité, Congrès vétérinaire…'}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Enregistrement…' : isEdit ? 'Modifier' : 'Envoyer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
