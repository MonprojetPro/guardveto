'use client'

// ============================================================
// GUARDVETO — Sélecteur de profil de planning par période (P5 slice 3c)
// ============================================================
// Rattache une période à une PÉRIODE TYPE nommée (structure + effectif).
// S'applique à la prochaine génération. Verrouillé quand la période l'est.
//
// CE QUI A CHANGÉ LE 2026-08-04 (MiKL : « je ne veux pas qu'il y ait une
// période par défaut ») : l'option « Par défaut » a disparu de la liste. Elle
// laissait un planning sans structure désignée, et le moteur retombait en
// silence sur le profil `est_defaut` du cabinet. Un planning existant qui est
// encore dans cet état l'AFFICHE (« Aucune — à choisir ») : on peut en sortir,
// on ne peut plus y revenir.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import { setProfilPeriode } from '@/app/(protected)/admin/periodes/actions'
import type { ProfilPlanning } from '@/types'

// Le Select interdit la valeur vide → sentinelle pour l'état « pas encore
// choisie » d'un planning d'avant la règle. Jamais proposée dans la liste.
const AUCUNE = '__aucune__'

interface ProfilPeriodeSelectProps {
  periodeId: string
  /** Période type actuelle (NULL = planning d'avant la règle, à corriger). */
  valeur: string | null
  /** Profils du cabinet (déjà scopés par RLS côté page). */
  profils: ProfilPlanning[]
  disabled?: boolean
}

export function ProfilPeriodeSelect({ periodeId, valeur, profils, disabled }: ProfilPeriodeSelectProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [val, setVal] = useState(valeur ?? AUCUNE)

  const labelDe = (v: string) => {
    if (v === AUCUNE) return 'Aucune — à choisir'
    return profils.find((p) => p.id === v)?.nom ?? 'Aucune — à choisir'
  }

  const onChange = (v: string) => {
    if (v === AUCUNE) return // on ne revient jamais à « aucune »
    const profilId = v
    const precedent = val
    setVal(v)
    startTransition(async () => {
      const res = await setProfilPeriode(periodeId, profilId)
      if (res?.error) {
        toast.error(res.error)
        setVal(precedent) // rollback visuel
      } else {
        toast.success(`Période type : ${labelDe(v)}.`)
        router.refresh()
      }
    })
  }

  if (disabled) {
    return <span className="text-xs text-muted-foreground">{labelDe(val)}</span>
  }

  return (
    <Select value={val} onValueChange={(v) => v && onChange(v)} disabled={isPending}>
      <SelectTrigger className="h-8 min-w-[170px] max-w-full text-xs">
        {labelDe(val)}
      </SelectTrigger>
      <SelectContent>
        {profils
          .filter((p) => !p.est_defaut)
          .map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.nom}</SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}
