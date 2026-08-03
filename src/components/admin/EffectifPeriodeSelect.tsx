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
import { GardienImpact } from '@/components/v2/GardienImpact'
import type { Impact } from '@/data/controleImpact'
import type { VetEtiquette } from '@/components/planning/PointPreVol'

/** Effectifs proposables le soir en semaine (miroir du CHECK 1..4). */
const EFFECTIFS = [1, 2, 3, 4]

const libelle = (n: number) => (n === 1 ? '1 véto' : `${n} vétos`)

interface EffectifPeriodeSelectProps {
  periodeId: string
  /** Valeur effective : explicite si réglée, sinon repli saison (hiver 2 / été 1). */
  valeur: number
  disabled?: boolean
  /**
   * Vétérinaires actifs — pour les gestes de correction qui portent sur une
   * étiquette. Absents, la fenêtre de Filou reste utile (assouplir, mettre en
   * pause, ouvrir les règles) : demander deux vétos par nuit se corrige
   * rarement en posant une étiquette.
   */
  vetsActifs?: VetEtiquette[]
}

export function EffectifPeriodeSelect({
  periodeId, valeur, disabled, vetsActifs = [],
}: EffectifPeriodeSelectProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [val, setVal] = useState(String(valeur))
  // Le refus du contrôle d'impact : demander plus de monde qu'il n'y en a est
  // LE cas d'école de ce réglage. Il s'explique en fenêtre, avec ses gestes.
  const [impact, setImpact] = useState<Impact | null>(null)
  const [nbVise, setNbVise] = useState<number | null>(null)

  const appliquer = (nb: number, confirme: boolean) => {
    setNbVise(nb)
    startTransition(async () => {
      const res = await setEffectifPeriode(periodeId, nb, confirme)
      if (res?.error) {
        if ('impact' in res && res.impact) {
          setImpact(res.impact)
          setVal(String(valeur)) // rollback visuel : le réglage n'a pas pris
          return
        }
        toast.error(res.error)
        setVal(String(valeur)) // rollback visuel
      } else {
        setImpact(null)
        toast.success(
          nb === 1
            ? 'Effectif : 1 véto la nuit en semaine.'
            : `Effectif : ${nb} vétos la nuit en semaine.`,
        )
        router.refresh()
      }
    })
  }

  const onChange = (v: string) => {
    const nb = Number(v)
    setVal(v)
    appliquer(nb, false)
  }

  if (disabled) {
    return (
      <span className="text-xs text-muted-foreground">{libelle(valeur)}</span>
    )
  }

  return (
    <>
    <GardienImpact
      impact={impact}
      geste="changer l’effectif des nuits de semaine"
      origine="historique"
      vets={vetsActifs}
      enCours={isPending}
      onAnnuler={() => setImpact(null)}
      onCorrige={() => { if (nbVise !== null) appliquer(nbVise, false) }}
      onPasserOutre={() => { if (nbVise !== null) appliquer(nbVise, true) }}
    />
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
    </>
  )
}
