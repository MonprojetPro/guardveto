'use client'

// ============================================================
// GUARDVETO — Sélecteur d'effectif semaine par période (Vague 1)
// ============================================================
// Permet à l'admin de régler le nombre de vétos la nuit en semaine (1 à 4)
// pour une période — il SURCHARGE celui du profil. S'applique à la prochaine
// génération du planning. Verrouillé quand la période est verrouillée.
//
// Ce réglage plafonne le nombre de places du créneau « soir de semaine » :
// régler 2 ici sur un créneau qui en déclare 4 donne bien 2 gardes.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import { setEffectifPeriode } from '@/app/(protected)/admin/periodes/actions'

/** Effectifs proposables le soir en semaine (miroir du CHECK 1..4). */
const EFFECTIFS = [1, 2, 3, 4]

const libelle = (n: number) => (n === 1 ? '1 véto' : `${n} vétos`)

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
        toast.success(
          nb === 1
            ? 'Effectif : 1 véto la nuit en semaine.'
            : `Effectif : ${nb} vétos la nuit en semaine.`,
        )
        router.refresh()
      }
    })
  }

  if (disabled) {
    return (
      <span className="text-xs text-muted-foreground">{libelle(valeur)}</span>
    )
  }

  return (
    <Select value={val} onValueChange={(v) => v && onChange(v)} disabled={isPending}>
      <SelectTrigger className="h-8 w-[120px] text-xs">{libelle(Number(val))}</SelectTrigger>
      <SelectContent>
        {EFFECTIFS.map((n) => (
          <SelectItem key={n} value={String(n)}>
            {libelle(n)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
