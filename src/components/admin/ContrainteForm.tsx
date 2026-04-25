'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { createContrainte, updateContrainte } from '@/app/(protected)/admin/veterinaires/contraintes-actions'
import type { ContrainteVeto, Veterinaire } from '@/types'
import type { TypeContrainte } from '@/app/(protected)/admin/veterinaires/contraintes-actions'

const JOURS = [
  { value: 'lundi', label: 'Lundi' },
  { value: 'mardi', label: 'Mardi' },
  { value: 'mercredi', label: 'Mercredi' },
  { value: 'jeudi', label: 'Jeudi' },
  { value: 'vendredi', label: 'Vendredi' },
]

const TYPES: { value: TypeContrainte; label: string }[] = [
  { value: 'jour_repos_fixe', label: 'Jour de repos fixe' },
  { value: 'jour_repos_conditionnel', label: 'Repos conditionnel (WE)' },
  { value: 'indisponibilite_cyclique', label: 'Indisponibilité cyclique' },
  { value: 'duo_interdit', label: 'Duo interdit' },
]

const PERIODES_CYCL = [
  { value: 'soir_semaine', label: 'Soirs de semaine' },
  { value: 'weekend', label: 'Weekends' },
  { value: 'journee_semaine', label: 'Journées semaine' },
]

interface ContrainteFormProps {
  open: boolean
  onClose: () => void
  veterinaire_id: string
  vets: Veterinaire[]
  contrainte?: ContrainteVeto | null
}

export function ContrainteForm({
  open, onClose, veterinaire_id, vets, contrainte,
}: ContrainteFormProps) {
  const isEdit = Boolean(contrainte)
  const [isPending, startTransition] = useTransition()

  const cfg = contrainte?.config as Record<string, unknown> ?? {}

  const [type, setType] = useState<TypeContrainte>(
    contrainte?.type ?? 'jour_repos_fixe'
  )

  // jour_repos_fixe
  const [rfJour, setRfJour] = useState(
    typeof cfg.jour === 'string' ? cfg.jour : 'mercredi'
  )
  const [rfFlexible, setRfFlexible] = useState(Boolean(cfg.flexible_vacances))

  // jour_repos_conditionnel
  const [rcSiWe, setRcSiWe] = useState(
    typeof cfg.si_garde_we === 'string' ? cfg.si_garde_we : 'mardi'
  )
  const [rcSinon, setRcSinon] = useState(
    typeof cfg.sinon === 'string' ? cfg.sinon : 'vendredi'
  )

  // indisponibilite_cyclique
  const [icSemaines, setIcSemaines] = useState<'paires' | 'impaires' | 'toutes'>(
    (cfg.semaines as 'paires' | 'impaires' | 'toutes') ?? 'impaires'
  )
  const [icPeriodes, setIcPeriodes] = useState<string[]>(
    Array.isArray(cfg.periodes) ? (cfg.periodes as string[]) : ['weekend']
  )

  // duo_interdit
  const autresVets = vets.filter((v) => v.id !== veterinaire_id && v.actif)
  const [diVetId, setDiVetId] = useState(
    typeof cfg.avec_veterinaire_id === 'string'
      ? cfg.avec_veterinaire_id
      : (autresVets[0]?.id ?? '')
  )

  const togglePeriode = (p: string) => {
    setIcPeriodes((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    )
  }

  const buildConfig = () => {
    switch (type) {
      case 'jour_repos_fixe':
        return { jour: rfJour, flexible_vacances: rfFlexible }
      case 'jour_repos_conditionnel':
        return { si_garde_we: rcSiWe, sinon: rcSinon }
      case 'indisponibilite_cyclique':
        return { semaines: icSemaines, periodes: icPeriodes as ('soir_semaine' | 'weekend' | 'journee_semaine')[] }
      case 'duo_interdit':
        return { avec_veterinaire_id: diVetId }
    }
  }

  const handleSubmit = () => {
    if (type === 'indisponibilite_cyclique' && icPeriodes.length === 0) {
      toast.error('Sélectionnez au moins une période.')
      return
    }
    if (type === 'duo_interdit' && !diVetId) {
      toast.error('Sélectionnez un vétérinaire.')
      return
    }

    startTransition(async () => {
      const result = isEdit && contrainte
        ? await updateContrainte(contrainte.id, type, buildConfig())
        : await createContrainte(veterinaire_id, type, buildConfig())

      if (result.error) { toast.error(result.error); return }
      toast.success(isEdit ? 'Contrainte modifiée' : 'Contrainte ajoutée')
      onClose()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEdit ? 'Modifier la contrainte' : 'Ajouter une contrainte'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Type */}
          <div className="space-y-1.5">
            <Label>Type de contrainte</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as TypeContrainte)}
              disabled={isEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Champs dynamiques */}
          {type === 'jour_repos_fixe' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Jour de repos</Label>
                <Select value={rfJour} onValueChange={(v) => v && setRfJour(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JOURS.map((j) => (
                      <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rfFlexible}
                  onChange={(e) => setRfFlexible(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Flexible en vacances scolaires</span>
              </label>
            </div>
          )}

          {type === 'jour_repos_conditionnel' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Si ce vétérinaire est de garde le weekend, quel jour se repose-t-il ?
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Si garde WE</Label>
                  <Select value={rcSiWe} onValueChange={(v) => v && setRcSiWe(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {JOURS.map((j) => (
                        <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Sinon</Label>
                  <Select value={rcSinon} onValueChange={(v) => v && setRcSinon(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {JOURS.map((j) => (
                        <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {type === 'indisponibilite_cyclique' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Semaines concernées</Label>
                <Select value={icSemaines} onValueChange={(v) => setIcSemaines(v as typeof icSemaines)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paires">Semaines paires</SelectItem>
                    <SelectItem value="impaires">Semaines impaires</SelectItem>
                    <SelectItem value="toutes">Toutes les semaines</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Périodes indisponibles</Label>
                <div className="space-y-2 mt-1">
                  {PERIODES_CYCL.map((p) => (
                    <label key={p.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={icPeriodes.includes(p.value)}
                        onChange={() => togglePeriode(p.value)}
                        className="rounded"
                      />
                      <span className="text-sm">{p.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {type === 'duo_interdit' && (
            <div className="space-y-1.5">
              <Label>Ne peut pas être seul avec</Label>
              <Select value={diVetId} onValueChange={(v) => v && setDiVetId(v)}>
                <SelectTrigger>
                  {diVetId
                    ? (() => { const v = autresVets.find((x) => x.id === diVetId); return v ? `${v.prenom} ${v.nom}` : '' })()
                    : <span className="text-muted-foreground">Sélectionner…</span>
                  }
                </SelectTrigger>
                <SelectContent>
                  {autresVets.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.prenom} {v.nom}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {autresVets.length === 0 && (
                <p className="text-xs text-muted-foreground">Aucun autre vétérinaire actif.</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Enregistrement…' : isEdit ? 'Modifier' : 'Ajouter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
