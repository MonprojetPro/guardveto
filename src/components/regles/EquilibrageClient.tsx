'use client'

// ============================================================
// GUARDVETO — Équilibrage des charges (équité) — section de /regles
// ============================================================
// L'équité est gérée comme les autres règles, mais de forme différente :
// elle concerne un COMPTEUR (pas un véto). Chaque dimension (week-ends,
// fériés, soirs…) a une IMPORTANCE en 4 crans nommés. Pas de chiffres.
//
// Chaque dimension = une règle de famille `equilibrer` (brique catalogue).
// Modifier une importance = upsert de cette règle (setEquiteImportance).
// Le moteur traduit le cran en poids (equity-weights.ts). Véto = lecture seule.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Scale } from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import {
  EQUITY_DIMENSIONS,
  IMPORTANCE_LEVELS,
  type EquityDimension,
  type ImportanceLevel,
} from '@/engine/equity-weights'
import { IMPORTANCE_LABELS } from '@/engine/briques/catalogue'
import { setEquiteImportance } from '@/app/(protected)/regles/actions'

// Titres courts par dimension (le rendu « phrase » du catalogue est plus long).
const TITRES: Record<EquityDimension, string> = {
  weekend: 'Week-ends',
  weekend_premier: 'Rôle de 1er le week-end',
  ferie: 'Jours fériés',
  semaine_premier: 'Soirs de semaine — 1er',
  semaine_second: 'Soirs de semaine — 2nd',
  grands_weekend: 'Grands week-ends (salariés)',
}

// Phrase d'aide par dimension (ce que ça équilibre, en clair).
const AIDES: Record<EquityDimension, string> = {
  weekend: 'Donner à chacun le même nombre de week-ends de garde.',
  weekend_premier: 'Équilibrer qui est 1er le week-end (le rôle à l’avantage financier).',
  ferie: 'Répartir équitablement les gardes des jours fériés.',
  semaine_premier: 'Équilibrer les soirs de semaine assurés en 1er.',
  semaine_second: 'Équilibrer les soirs de semaine assurés en 2nd.',
  grands_weekend: 'Répartir les grands week-ends perdus par les salariés.',
}

interface EquilibrageClientProps {
  /** Importance courante de chaque dimension (règle posée, ou défaut). */
  importances: Record<EquityDimension, ImportanceLevel>
  isAdmin: boolean
}

export function EquilibrageClient({ importances, isAdmin }: EquilibrageClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [valeurs, setValeurs] = useState(importances)

  const onChange = (dimension: EquityDimension, niveau: ImportanceLevel) => {
    const avant = valeurs[dimension]
    setValeurs((prev) => ({ ...prev, [dimension]: niveau })) // optimiste
    startTransition(async () => {
      const res = await setEquiteImportance(dimension, niveau)
      if (res?.error) {
        toast.error(res.error)
        setValeurs((prev) => ({ ...prev, [dimension]: avant })) // rollback
      } else {
        toast.success('Importance enregistrée — appliquée à la prochaine génération.')
        router.refresh()
      }
    })
  }

  return (
    <section className="space-y-3 max-w-3xl">
      <div>
        <h2 className="font-semibold text-sm text-foreground flex items-center gap-2">
          <Scale className="w-4 h-4 text-primary" /> Équilibrage des charges
        </h2>
        <p className="text-muted-foreground text-xs mt-1 leading-5">
          À quel point le moteur doit s&apos;efforcer d&apos;égaliser chaque type de garde.
          Il ne peut pas tout égaliser d&apos;un coup : ces niveaux disent <strong>quoi prioriser</strong>.
          Effet à la prochaine génération.
        </p>
      </div>

      <div className="space-y-2">
        {EQUITY_DIMENSIONS.map((dim) => (
          <div
            key={dim}
            className="flex items-center gap-3 p-3.5 rounded-lg border border-border bg-card"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{TITRES[dim]}</p>
              <p className="text-xs text-muted-foreground leading-5">{AIDES[dim]}</p>
            </div>

            {isAdmin ? (
              <Select
                value={valeurs[dim]}
                onValueChange={(v) => v && onChange(dim, v as ImportanceLevel)}
                disabled={isPending}
              >
                <SelectTrigger className="w-40 shrink-0 capitalize">
                  {IMPORTANCE_LABELS[valeurs[dim]]}
                </SelectTrigger>
                <SelectContent>
                  {IMPORTANCE_LEVELS.map((niv) => (
                    <SelectItem key={niv} value={niv} className="capitalize">
                      {IMPORTANCE_LABELS[niv]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-sm text-muted-foreground capitalize shrink-0 w-40 text-right">
                {IMPORTANCE_LABELS[valeurs[dim]]}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
