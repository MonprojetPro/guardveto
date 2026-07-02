'use client'

// ============================================================
// GUARDVETO — Sélecteur de profil de planning par période (P5 slice 3c)
// ============================================================
// Rattache une période à un profil de planning nommé (structure + effectif).
// NULL = profil défaut du cabinet. S'applique à la prochaine génération.
// Verrouillé quand la période est verrouillée (comme l'effectif).
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import { setProfilPeriode } from '@/app/(protected)/admin/periodes/actions'
import type { ProfilPlanning } from '@/types'

// Radix Select interdit la valeur vide → sentinelle pour « profil défaut ».
const DEFAUT = '__defaut__'

interface ProfilPeriodeSelectProps {
  periodeId: string
  /** Profil actuel de la période (NULL = profil défaut du cabinet). */
  valeur: string | null
  /** Profils du cabinet (déjà scopés par RLS côté page). */
  profils: ProfilPlanning[]
  disabled?: boolean
}

export function ProfilPeriodeSelect({ periodeId, valeur, profils, disabled }: ProfilPeriodeSelectProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [val, setVal] = useState(valeur ?? DEFAUT)

  const labelDe = (v: string) => {
    if (v === DEFAUT) return 'Par défaut'
    return profils.find((p) => p.id === v)?.nom ?? 'Par défaut'
  }

  const onChange = (v: string) => {
    const profilId = v === DEFAUT ? null : v
    const precedent = val
    setVal(v)
    startTransition(async () => {
      const res = await setProfilPeriode(periodeId, profilId)
      if (res?.error) {
        toast.error(res.error)
        setVal(precedent) // rollback visuel
      } else {
        toast.success(`Profil : ${labelDe(v)}.`)
        router.refresh()
      }
    })
  }

  if (disabled) {
    return <span className="text-xs text-muted-foreground">{labelDe(val)}</span>
  }

  return (
    <Select value={val} onValueChange={(v) => v && onChange(v)} disabled={isPending}>
      <SelectTrigger className="h-8 w-[170px] text-xs">
        {labelDe(val)}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAUT}>Par défaut</SelectItem>
        {profils
          .filter((p) => !p.est_defaut)
          .map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.nom}</SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}
