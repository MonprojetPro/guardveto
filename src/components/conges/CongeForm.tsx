'use client'

import { useState, useTransition, useEffect } from 'react'
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
import { createConge, updateConge, type ConflitPlanning } from '@/app/(protected)/conges/actions'
import type { Conge, CreneauConge, TypeConge, Veterinaire } from '@/types'

const TYPES_CONGE: { value: TypeConge; label: string }[] = [
  { value: 'vacances',        label: 'Vacances' },
  { value: 'formation',       label: 'Formation' },
  { value: 'sante',           label: 'Santé' },
  { value: 'indisponibilite', label: 'Indisponibilité ponctuelle' },
  { value: 'autre',           label: 'Autre' },
]

// ⚠️ LE CHOIX DE CRÉNEAU A ÉTÉ RETIRÉ (B-043, 2026-08-26).
//
// Il proposait « Toute la journée / Matin / Après-midi / Soirée ». Or
// `checkR16Conge` (hard-constraints.ts) n'a JAMAIS lu ce champ : quel que soit
// le créneau choisi, le congé bloquait la journée entière. Quelqu'un posant une
// matinée perdait sa garde du soir, sans que rien ne le signale.
//
// Et le choix n'avait de toute façon aucun sens ici : le produit ne planifie
// que les soirs et les week-ends. « Matin » et « après-midi » ne peuvent rien
// libérer ni rien bloquer.
//
// Mesuré avant de retirer : les 32 congés des deux cabinets portaient tous
// `creneau = null`. Personne ne s'en était servi — on ne casse aucune donnée.
//
// La colonne `conges.creneau` reste en base, volontairement : la supprimer est
// une migration, et le jour où le produit couvrira les journées de travail
// (B-006), c'est là qu'elle reprendra du sens. Elle est simplement écrite
// `null` désormais.

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
  /**
   * Appelé quand la CRÉATION (admin → congé validé) a détecté un conflit avec
   * un planning publié (cas « Antoine »). Le parent ouvre alors l'alerte.
   */
  onConflit?: (conflit: ConflitPlanning) => void
}

export function CongeForm({
  open, onClose, vets, currentUserId, isAdmin, conge, defaultVetId, onConflit,
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
  const [commentaire, setCommentaire] = useState(conge?.commentaire ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Réinitialise le formulaire à chaque ouverture (sinon il garde le contexte de la demande précédente)
  useEffect(() => {
    if (!open) return
    const lundi = lundiDeSemaine(new Date())
    setVetId(conge?.veterinaire_id ?? defaultVetId ?? vets[0]?.id ?? '')
    setDateDebut(conge?.date_debut ?? toIso(lundi))
    setDateFin(conge?.date_fin ?? toIso(dimancheDeSemaine(lundi)))
    setType(conge?.type ?? 'vacances')
    setCommentaire(conge?.commentaire ?? '')
    setErrors({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conge, defaultVetId])

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
        // Toujours `null` depuis B-043 : voir la note en tête de fichier.
        creneau: null,
        commentaire,
      }
      if (isEdit && conge) {
        const result = await updateConge(conge.id, data)
        if (result.error) { toast.error(result.error); return }
        toast.success('Demande modifiée')
        handleClose()
        return
      }

      const result = await createConge(data, currentUserId, isAdmin)
      if (result.error) { toast.error(result.error); return }
      toast.success(isIndispo ? 'Indisponibilité soumise' : 'Congé ajouté')
      handleClose()
      // createConge (branche admin/validé) peut renvoyer un conflit planning publié.
      if (result.conflit) onConflit?.(result.conflit)
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
            <Select value={type} onValueChange={(v) => v && handleTypeChange(v as TypeConge)} items={TYPES_CONGE}>
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
