'use client'

// ============================================================
// GUARDVETO — Réglages du planning (équité + structure) — section /regles
// ============================================================
// Bloc UNIQUE et homogène pour les règles GLOBALES du cabinet (pas par véto) :
//   • Équilibrage des charges (6 dimensions d'équité)
//   • Structure du week-end (R8/R9)
// Présentation identique partout : titre + explication + UN menu déroulant à
// droite, dont la PREMIÈRE option = désactivé (Ignorée pour l'équité,
// Désactivée pour la structure). Plus de case à cocher séparée.
//
// Modifier une ligne = upsert de la règle correspondante (action serveur).
// Effet à la prochaine génération. Véto = lecture seule.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { SlidersHorizontal } from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import {
  EQUITY_DIMENSIONS, IMPORTANCE_LEVELS,
  type EquityDimension, type ImportanceLevel,
} from '@/engine/equity-weights'
import { IMPORTANCE_LABELS } from '@/engine/briques/catalogue'
import { setEquiteImportance, setStructureRegle } from '@/app/(protected)/regles/actions'

// ── Référentiels d'affichage ─────────────────────────────────

const EQUITE_META: Record<EquityDimension, { titre: string; aide: string }> = {
  weekend: { titre: 'Week-ends', aide: 'Donner à chacun le même nombre de week-ends de garde.' },
  weekend_premier: { titre: 'Rôle de 1er le week-end', aide: 'Équilibrer qui est 1er le week-end (le rôle à l’avantage financier).' },
  ferie: { titre: 'Jours fériés', aide: 'Répartir équitablement les gardes des jours fériés.' },
  semaine_premier: { titre: 'Soirs de semaine — 1er', aide: 'Équilibrer les soirs de semaine assurés en 1er.' },
  semaine_second: { titre: 'Soirs de semaine — 2nd', aide: 'Équilibrer les soirs de semaine assurés en 2nd.' },
  grands_weekend: { titre: 'Grands week-ends (salariés)', aide: 'Répartir les grands week-ends perdus par les salariés.' },
}

const FORCE_LABELS: Record<string, string> = {
  desactivee: 'Désactivée',
  jamais: 'Ferme',
  sauf_crise: 'À éviter sauf crise',
  evitee: 'Préférence (évitée)',
  si_possible: 'Préférence (si possible)',
}
const FORCE_OPTIONS = ['desactivee', 'jamais', 'sauf_crise', 'evitee', 'si_possible']

const STRUCTURE_META: Record<'liaison_creneaux' | 'inversion_role', { titre: string; aide: string }> = {
  liaison_creneaux: {
    titre: 'Même binôme vendredi soir et week-end',
    aide: 'Les deux vétos de garde le week-end sont ceux du vendredi soir.',
  },
  inversion_role: {
    titre: 'Inversion des rôles 1er / 2nd vendredi ↔ week-end',
    aide: 'Le 1er du vendredi soir devient 2nd le week-end. Sans la règle ci-dessus, sans effet.',
  },
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export interface StructureRegleUI {
  actif: boolean
  force: string
}

// ── Ligne générique (présentation identique partout) ────────
function Ligne({
  titre, aide, value, valueLabel, options, isAdmin, isPending, onChange,
}: {
  titre: string
  aide: string
  value: string
  valueLabel: string
  options: { value: string; label: string }[]
  isAdmin: boolean
  isPending: boolean
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-3 p-3.5 rounded-lg border border-border bg-card">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{titre}</p>
        <p className="text-xs text-muted-foreground leading-5">{aide}</p>
      </div>
      {isAdmin ? (
        <Select value={value} onValueChange={(v) => v && onChange(v)} disabled={isPending}>
          <SelectTrigger className="w-52 shrink-0">{valueLabel}</SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-sm text-muted-foreground shrink-0 w-52 text-right">{valueLabel}</span>
      )}
    </div>
  )
}

interface ReglagesPlanningClientProps {
  equite: Record<EquityDimension, ImportanceLevel>
  structure: { liaison_creneaux: StructureRegleUI; inversion_role: StructureRegleUI }
  isAdmin: boolean
}

export function ReglagesPlanningClient({ equite, structure, isAdmin }: ReglagesPlanningClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [eq, setEq] = useState(equite)
  const [st, setSt] = useState(structure)

  const optionsImportance = IMPORTANCE_LEVELS.map((n) => ({ value: n, label: cap(IMPORTANCE_LABELS[n]) }))
  const optionsForce = FORCE_OPTIONS.map((f) => ({ value: f, label: FORCE_LABELS[f] }))

  const changerEquite = (dim: EquityDimension, niveau: ImportanceLevel) => {
    const avant = eq[dim]
    setEq((p) => ({ ...p, [dim]: niveau }))
    startTransition(async () => {
      const res = await setEquiteImportance(dim, niveau)
      if (res?.error) { toast.error(res.error); setEq((p) => ({ ...p, [dim]: avant })) }
      else { toast.success('Réglage enregistré — appliqué à la prochaine génération.'); router.refresh() }
    })
  }

  const changerStructure = (
    briqueId: 'liaison_creneaux' | 'inversion_role',
    choix: string,
  ) => {
    const avant = st[briqueId]
    // « desactivee » → actif=false (on conserve la dernière force) ; sinon actif=true + force.
    const next: StructureRegleUI =
      choix === 'desactivee'
        ? { actif: false, force: avant.force === 'desactivee' ? 'jamais' : avant.force }
        : { actif: true, force: choix }
    setSt((p) => ({ ...p, [briqueId]: next }))
    startTransition(async () => {
      const res = await setStructureRegle(briqueId, next.actif, next.force)
      if (res?.error) { toast.error(res.error); setSt((p) => ({ ...p, [briqueId]: avant })) }
      else { toast.success('Réglage enregistré — appliqué à la prochaine génération.'); router.refresh() }
    })
  }

  return (
    <section className="space-y-4 max-w-3xl">
      <div>
        <h2 className="font-heading text-lg font-bold text-foreground flex items-center gap-2">
          <SlidersHorizontal className="w-5 h-5 text-primary" /> Réglages du planning
        </h2>
        <p className="text-muted-foreground text-sm mt-1 leading-5">
          Les règles globales du cabinet. La première option d&apos;un menu (
          <em>Ignorée</em> / <em>Désactivée</em>) coupe la règle ; les suivantes
          en règlent l&apos;importance. Effet à la prochaine génération.
        </p>
      </div>

      {/* Équilibrage des charges */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Équilibrage des charges
        </h3>
        {EQUITY_DIMENSIONS.map((dim) => (
          <Ligne
            key={dim}
            titre={EQUITE_META[dim].titre}
            aide={EQUITE_META[dim].aide}
            value={eq[dim]}
            valueLabel={cap(IMPORTANCE_LABELS[eq[dim]])}
            options={optionsImportance}
            isAdmin={isAdmin}
            isPending={isPending}
            onChange={(v) => changerEquite(dim, v as ImportanceLevel)}
          />
        ))}
      </div>

      {/* Structure du week-end */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Structure du week-end
        </h3>
        {(['liaison_creneaux', 'inversion_role'] as const).map((briqueId) => {
          const v = st[briqueId]
          const courant = v.actif ? v.force : 'desactivee'
          return (
            <Ligne
              key={briqueId}
              titre={STRUCTURE_META[briqueId].titre}
              aide={STRUCTURE_META[briqueId].aide}
              value={courant}
              valueLabel={FORCE_LABELS[courant]}
              options={optionsForce}
              isAdmin={isAdmin}
              isPending={isPending}
              onChange={(v2) => changerStructure(briqueId, v2)}
            />
          )
        })}
      </div>
    </section>
  )
}
