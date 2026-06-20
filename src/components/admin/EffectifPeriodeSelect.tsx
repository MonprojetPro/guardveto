'use client'

// ============================================================
// GUARDVETO — Sélecteur d'effectif semaine par période (Vague 1)
// ============================================================
// Permet à l'admin de régler le nombre de vétos la nuit en semaine (1 ou 2)
// pour une période. S'applique à la prochaine génération du planning.
// Verrouillé quand la période est verrouillée.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import { setEffectifPeriode } from '@/app/(protected)/admin/periodes/actions'

interface EffectifPeriodeSelectProps {
  periodeId: string
  /** Valeur effective : explicite si réglée, sinon repli saison (hiver 2 / été 1). */
  valeur: number
  disabled?: boolean
}

export function EffectifPeriodeSelect({ periodeId, valeur, disabled }: EffectifPeriodeSelectProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [val, setVal] = useState(String(valeur))

  const onChange = (v: string) => {
    const nb = Number(v)
    setVal(v)
    startTransition(async () => {
      const res = await setEffectifPeriode(periodeId, nb)
      if (res?.error) {
        toast.error(res.error)
        setVal(String(valeur)) // rollback visuel
      } else {
        toast.success(nb === 1 ? 'Effectif : 1 véto la nuit en semaine.' : 'Effectif : 2 vétos (1er + 2nd).')
        router.refresh()
      }
    })
  }

  if (disabled) {
    return (
      <span className="text-xs text-muted-foreground">
        {valeur === 1 ? '1 véto' : '2 vétos'}
      </span>
    )
  }

  return (
    <Select value={val} onValueChange={(v) => v && onChange(v)} disabled={isPending}>
      <SelectTrigger className="h-8 w-[120px] text-xs">
        {val === '1' ? '1 véto' : '2 vétos'}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="1">1 véto</SelectItem>
        <SelectItem value="2">2 vétos</SelectItem>
      </SelectContent>
    </Select>
  )
}
