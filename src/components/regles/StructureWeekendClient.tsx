'use client'

// ============================================================
// GUARDVETO — Structure du week-end (R8/R9 réglables) — section /regles
// ============================================================
// R9 (même binôme vendredi soir = week-end) et R8 (inversion des rôles 1er/2nd
// entre les deux) étaient codées en dur. Elles deviennent réglables comme les
// autres règles : on peut les DÉSACTIVER (toggle) et changer leur NIVEAU
// (Ferme → préférence). Règles GLOBALES (pas de véto) → section dédiée.
//
// Défaut = Ferme + activée (comportement historique). Le moteur ET le validateur
// indépendant lisent la même config (sinon violations fantômes).
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarRange } from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import { setStructureRegle } from '@/app/(protected)/regles/actions'

// Les 4 niveaux de force (mêmes que les autres règles, hors invariants).
const FORCES = [
  { value: 'jamais', label: 'Ferme', symbole: '🔴' },
  { value: 'sauf_crise', label: 'À éviter sauf crise', symbole: '🟠' },
  { value: 'evitee', label: 'Préférence (évitée)', symbole: '🟡' },
  { value: 'si_possible', label: 'Préférence (si possible)', symbole: '⚪' },
] as const

const LABEL_FORCE: Record<string, string> = Object.fromEntries(
  FORCES.map((f) => [f.value, `${f.symbole} ${f.label}`]),
)

export interface StructureRegleUI {
  actif: boolean
  force: string // 'jamais' | 'sauf_crise' | 'evitee' | 'si_possible'
}

const REGLES: Array<{
  briqueId: 'liaison_creneaux' | 'inversion_role'
  cle: 'r9' | 'r8'
  titre: string
  aide: string
}> = [
  {
    briqueId: 'liaison_creneaux',
    cle: 'r9',
    titre: 'Même binôme le vendredi soir et le week-end',
    aide: 'Les deux vétos de garde le week-end sont ceux qui étaient de garde le vendredi soir.',
  },
  {
    briqueId: 'inversion_role',
    cle: 'r8',
    titre: 'Inversion des rôles 1er / 2nd entre vendredi et week-end',
    aide: 'Celui qui était 1er le vendredi soir devient 2nd le week-end (et inversement). Sans la règle ci-dessus, cette inversion n’a pas d’effet.',
  },
]

interface StructureWeekendClientProps {
  config: { r9: StructureRegleUI; r8: StructureRegleUI }
  isAdmin: boolean
}

export function StructureWeekendClient({ config, isAdmin }: StructureWeekendClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [etat, setEtat] = useState(config)

  const appliquer = (cle: 'r9' | 'r8', briqueId: string, next: StructureRegleUI) => {
    const avant = etat[cle]
    setEtat((prev) => ({ ...prev, [cle]: next })) // optimiste
    startTransition(async () => {
      const res = await setStructureRegle(briqueId, next.actif, next.force)
      if (res?.error) {
        toast.error(res.error)
        setEtat((prev) => ({ ...prev, [cle]: avant })) // rollback
      } else {
        toast.success('Règle enregistrée — appliquée à la prochaine génération.')
        router.refresh()
      }
    })
  }

  return (
    <section className="space-y-3 max-w-3xl">
      <div>
        <h2 className="font-semibold text-sm text-foreground flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-primary" /> Structure du week-end
        </h2>
        <p className="text-muted-foreground text-xs mt-1 leading-5">
          Le couplage vendredi soir ↔ week-end. Désactivez une règle si elle ne
          correspond pas à votre cabinet, ou rendez-la souple (préférence).
        </p>
      </div>

      <div className="space-y-2">
        {REGLES.map((r) => {
          const v = etat[r.cle]
          return (
            <div
              key={r.cle}
              className="flex items-center gap-3 p-3.5 rounded-lg border border-border bg-card"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{r.titre}</p>
                <p className="text-xs text-muted-foreground leading-5">{r.aide}</p>
              </div>

              {isAdmin ? (
                <div className="flex items-center gap-2 shrink-0">
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={v.actif}
                      disabled={isPending}
                      onChange={(e) => appliquer(r.cle, r.briqueId, { ...v, actif: e.target.checked })}
                      className="rounded"
                    />
                    Activée
                  </label>
                  <Select
                    value={v.force}
                    onValueChange={(f) => f && appliquer(r.cle, r.briqueId, { ...v, force: f })}
                    disabled={isPending || !v.actif}
                  >
                    <SelectTrigger className="w-52">
                      {LABEL_FORCE[v.force]}
                    </SelectTrigger>
                    <SelectContent>
                      {FORCES.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.symbole} {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground shrink-0 text-right">
                  {v.actif ? LABEL_FORCE[v.force] : 'Désactivée'}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
