'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createVeterinaire, updateVeterinaire } from '@/app/(protected)/admin/veterinaires/actions'
import type { Veterinaire, StatutVeto, UserRole } from '@/types'

const COULEURS_PRESET = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
  '#06B6D4', '#A855F7',
]

interface VeterinaireFormProps {
  open: boolean
  onClose: () => void
  veterinaire?: Veterinaire | null
}

interface FormState {
  nom: string
  prenom: string
  email: string
  statut: StatutVeto
  role_app: UserRole
  couleur: string
  actif: boolean
  dernier_recours: boolean
}

const defaultForm: FormState = {
  nom: '',
  prenom: '',
  email: '',
  statut: 'salarie',
  role_app: 'veto',
  couleur: '#3B82F6',
  actif: true,
  dernier_recours: false,
}

export function VeterinaireForm({ open, onClose, veterinaire }: VeterinaireFormProps) {
  const isEdit = Boolean(veterinaire)
  const [isPending, startTransition] = useTransition()

  const [form, setForm] = useState<FormState>(() =>
    veterinaire
      ? {
          nom: veterinaire.nom,
          prenom: veterinaire.prenom,
          email: veterinaire.email,
          statut: veterinaire.statut,
          role_app: veterinaire.role_app,
          couleur: veterinaire.couleur,
          actif: veterinaire.actif,
          dernier_recours: veterinaire.dernier_recours,
        }
      : defaultForm
  )

  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})

  // Reset form when dialog opens/closes
  const handleClose = () => {
    setForm(veterinaire
      ? {
          nom: veterinaire.nom,
          prenom: veterinaire.prenom,
          email: veterinaire.email,
          statut: veterinaire.statut,
          role_app: veterinaire.role_app,
          couleur: veterinaire.couleur,
          actif: veterinaire.actif,
          dernier_recours: veterinaire.dernier_recours,
        }
      : defaultForm
    )
    setErrors({})
    onClose()
  }

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormState, string>> = {}
    if (!form.nom.trim()) newErrors.nom = 'Le nom est requis'
    if (!form.prenom.trim()) newErrors.prenom = 'Le prénom est requis'
    if (!form.email.trim()) {
      newErrors.email = 'L\'email est requis'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = 'Email invalide'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return

    startTransition(async () => {
      const result = isEdit && veterinaire
        ? await updateVeterinaire(veterinaire.id, form)
        : await createVeterinaire(form)

      if (result.error) {
        toast.error(result.error)
        if (result.error.includes('email')) {
          setErrors({ email: result.error })
        }
        return
      }

      toast.success(isEdit ? 'Vétérinaire modifié avec succès' : 'Vétérinaire ajouté avec succès')
      handleClose()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEdit ? 'Modifier le vétérinaire' : 'Ajouter un vétérinaire'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Prénom + Nom */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="prenom">Prénom *</Label>
              <Input
                id="prenom"
                value={form.prenom}
                onChange={(e) => setForm({ ...form, prenom: e.target.value })}
                placeholder="Marie"
                className={errors.prenom ? 'border-destructive' : ''}
              />
              {errors.prenom && <p className="text-xs text-destructive">{errors.prenom}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nom">Nom *</Label>
              <Input
                id="nom"
                value={form.nom}
                onChange={(e) => setForm({ ...form, nom: e.target.value })}
                placeholder="Dupont"
                className={errors.nom ? 'border-destructive' : ''}
              />
              {errors.nom && <p className="text-xs text-destructive">{errors.nom}</p>}
            </div>
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="marie.dupont@cabinet.fr"
              className={errors.email ? 'border-destructive' : ''}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>

          {/* Statut + Rôle */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Statut</Label>
              <Select
                value={form.statut}
                onValueChange={(v) => setForm({ ...form, statut: v as StatutVeto })}
                items={{ salarie: 'Salarié', associe: 'Associé' }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="salarie">Salarié</SelectItem>
                  <SelectItem value="associe">Associé</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Rôle</Label>
              <Select
                value={form.role_app}
                onValueChange={(v) => setForm({ ...form, role_app: v as UserRole })}
                items={{ veto: 'Véto', admin: 'Admin' }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="veto">Véto</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Couleur */}
          <div className="space-y-1.5">
            <Label>Couleur d&apos;identification</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {COULEURS_PRESET.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-ring"
                  style={{
                    backgroundColor: c,
                    outline: form.couleur === c ? '3px solid #0f172a' : 'none',
                    outlineOffset: '2px',
                  }}
                  onClick={() => setForm({ ...form, couleur: c })}
                  aria-label={`Couleur ${c}`}
                />
              ))}
            </div>
          </div>

          {/* Options booléennes */}
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.actif}
                onChange={(e) => setForm({ ...form, actif: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm">Actif</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.dernier_recours}
                onChange={(e) => setForm({ ...form, dernier_recours: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm">Dernier recours</span>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Enregistrement…' : isEdit ? 'Modifier' : 'Ajouter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
