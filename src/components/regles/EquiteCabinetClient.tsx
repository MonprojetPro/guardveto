'use client'

// ============================================================
// GUARDVETO — Équité réglable (curseurs) — bloc de la page Règles
// ============================================================
// 6 curseurs : l'admin règle l'importance relative de chaque dimension
// d'équité (week-ends, fériés, soirs de semaine…). S'applique à la PROCHAINE
// génération de planning. Le véto consulte en lecture seule.
//
// Stockage : table equite_cabinet (une ligne par cabinet, RLS write admin-only).
// Repli moteur : si aucune ligne, DEFAULT_EQUITY_WEIGHTS (= ces défauts).
// « Temps réel » GuardVeto : après enregistrement, router.refresh().
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { SlidersHorizontal, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  setEquiteCabinet,
  type EquiteCabinetPayload,
} from '@/app/(protected)/regles/actions'

// ── Défauts métier (miroir de DEFAULT_EQUITY_WEIGHTS côté moteur) ──
export const EQUITE_DEFAUTS: EquiteCabinetPayload = {
  we_garde: 100,
  we_premier_role: 25,
  feries: 60,
  semaine_premier: 30,
  semaine_second: 10,
  grands_we: 60,
}

const EQUITE_MAX = 500

/** Métadonnées d'affichage — chaque curseur expliqué en langage naturel. */
const CURSEURS: Array<{
  cle: keyof EquiteCabinetPayload
  titre: string
  aide: string
}> = [
  {
    cle: 'we_garde',
    titre: 'Égalité des week-ends',
    aide: 'Plus c’est haut, plus le moteur s’acharne à donner le même nombre de week-ends de garde à chacun.',
  },
  {
    cle: 'we_premier_role',
    titre: 'Égalité du « 1er » le week-end',
    aide: 'Équilibre qui est 1er de garde le week-end (le rôle à l’avantage financier).',
  },
  {
    cle: 'feries',
    titre: 'Égalité des jours fériés',
    aide: 'Répartit équitablement les gardes qui tombent un jour férié.',
  },
  {
    cle: 'semaine_premier',
    titre: 'Égalité des soirs de semaine (1er)',
    aide: 'Équilibre les soirs de semaine assurés en tant que 1er de garde.',
  },
  {
    cle: 'semaine_second',
    titre: 'Égalité des soirs de semaine (2nd)',
    aide: 'Équilibre les soirs de semaine assurés en tant que 2nd de garde.',
  },
  {
    cle: 'grands_we',
    titre: 'Égalité des grands week-ends (salariés)',
    aide: 'Répartit les « grands week-ends » perdus par les vétos salariés.',
  },
]

interface EquiteCabinetClientProps {
  /** Poids actuels du cabinet (ou les défauts si aucune config posée). */
  poids: EquiteCabinetPayload
  isAdmin: boolean
}

export function EquiteCabinetClient({ poids, isAdmin }: EquiteCabinetClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [valeurs, setValeurs] = useState<EquiteCabinetPayload>(poids)

  // Égalité champ par champ pour savoir si quelque chose a changé.
  const modifie = CURSEURS.some((c) => valeurs[c.cle] !== poids[c.cle])
  const auxDefauts = CURSEURS.every((c) => valeurs[c.cle] === EQUITE_DEFAUTS[c.cle])

  const set = (cle: keyof EquiteCabinetPayload, v: number) =>
    setValeurs((prev) => ({ ...prev, [cle]: v }))

  const onEnregistrer = () => {
    startTransition(async () => {
      const res = await setEquiteCabinet(valeurs)
      if (res?.error) toast.error(res.error)
      else {
        toast.success('Équité enregistrée — appliquée à la prochaine génération.')
        router.refresh()
      }
    })
  }

  const onRemettreDefauts = () => setValeurs(EQUITE_DEFAUTS)

  return (
    <section className="space-y-3 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-sm text-foreground flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-primary" />
            Équilibre de l&apos;équité
          </h2>
          <p className="text-muted-foreground text-xs mt-1 leading-5">
            Réglez l&apos;importance de chaque dimension. Le moteur ne peut pas tout égaliser
            d&apos;un coup : ces curseurs disent <strong>quoi prioriser</strong>. Effet à la
            prochaine génération de planning.
          </p>
        </div>
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={onRemettreDefauts}
            disabled={isPending || auxDefauts}
            title="Remettre les valeurs par défaut"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Défauts
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        {CURSEURS.map((c) => (
          <div key={c.cle} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <label
                htmlFor={`equite-${c.cle}`}
                className="text-sm text-foreground font-medium"
              >
                {c.titre}
              </label>
              <span className="text-sm tabular-nums text-muted-foreground w-10 text-right">
                {valeurs[c.cle]}
              </span>
            </div>
            <input
              id={`equite-${c.cle}`}
              type="range"
              min={0}
              max={EQUITE_MAX}
              step={5}
              value={valeurs[c.cle]}
              disabled={!isAdmin || isPending}
              onChange={(e) => set(c.cle, Number(e.target.value))}
              className="w-full accent-primary disabled:opacity-60 disabled:cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground leading-5">{c.aide}</p>
          </div>
        ))}
      </div>

      {isAdmin && (
        <div className="flex items-center gap-3">
          <Button onClick={onEnregistrer} disabled={isPending || !modifie}>
            {isPending ? 'Enregistrement…' : 'Enregistrer l’équité'}
          </Button>
          {modifie && (
            <span className="text-xs text-muted-foreground">
              Modifications non enregistrées
            </span>
          )}
        </div>
      )}
    </section>
  )
}
