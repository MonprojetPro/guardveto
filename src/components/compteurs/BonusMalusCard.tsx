'use client'

// ============================================================
// GUARDVETO — BonusMalusCard
// ============================================================
// Carte de bilan de fin de période.
//   - Affiche les écarts réalisé / quote-part pour chaque véto
//   - Bouton "Calculer / Recalculer le bilan" (admin)
//   - Interprétation : écart+ = malus, écart- = bonus
// ============================================================

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Calculator, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BilanVet } from '@/engine/bilan'
import type { BonusMalusRow } from '@/hooks/useCompteurs'

// ── Types ────────────────────────────────────────────────

interface BonusMalusCardProps {
  periodeId: string
  periodeStatut: 'brouillon' | 'publie' | 'verrouille'
  /** Bilan déjà calculé en base (peut être null si jamais calculé) */
  existingBilan: BonusMalusRow[]
  /** Bonus/malus hérités de la période précédente (pour comparaison) */
  heritage: BonusMalusRow[]
  /** Noms et couleurs des vétos (pour l'affichage) */
  vetsInfo: Array<{ id: string; prenom: string; nom: string; couleur: string }>
}

// ── Helpers ──────────────────────────────────────────────

function EcartBadge({ ecart }: { ecart: number }) {
  if (ecart === 0) return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
      <Minus className="w-3 h-3" /> 0
    </span>
  )
  if (ecart > 0) return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
      <TrendingUp className="w-3 h-3" /> +{ecart} malus
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400">
      <TrendingDown className="w-3 h-3" /> {ecart} bonus
    </span>
  )
}

function EcartNumero({ ecart }: { ecart: number }) {
  const sign = ecart > 0 ? '+' : ''
  const cls = ecart === 0
    ? 'text-muted-foreground'
    : ecart > 0
      ? 'text-red-600 dark:text-red-400 font-semibold'
      : 'text-blue-600 dark:text-blue-400 font-semibold'
  return <span className={`tabular-nums ${cls}`}>{sign}{ecart}</span>
}

// ── Composant ────────────────────────────────────────────

export function BonusMalusCard({
  periodeId,
  periodeStatut,
  existingBilan,
  heritage,
  vetsInfo,
}: BonusMalusCardProps) {
  const [calculating, setCalculating] = useState(false)
  const [bilan, setBilan] = useState<BilanVet[] | null>(null)

  const heritageMap = new Map(heritage.map((b) => [b.veterinaire_id, b]))
  const hasExisting = existingBilan.length > 0

  async function handleCalculer() {
    setCalculating(true)
    try {
      const res = await fetch('/api/bilan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodeId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erreur lors du calcul.')
        return
      }
      setBilan(data.bilans)
      toast.success('Bilan calculé et sauvegardé.')
    } catch {
      toast.error('Impossible de joindre le serveur.')
    } finally {
      setCalculating(false)
    }
  }

  // Données à afficher : bilan fraîchement calculé OU données existantes converties
  const lignes: Array<{
    veterinaire_id: string
    prenom: string
    nom: string
    couleur: string
    statut: string
    we_realise: number
    we_quota: number
    ecart_we: number
    sem_realise: number
    sem_quota: number
    ecart_semaine: number
    feries_realise: number
    feries_quota: number
    ecart_feries: number
    grands_we_realise: number
    ecart_grands_we: number
    heritage_we: number | null
  }> = bilan
    ? bilan.map((b) => ({
        ...b,
        heritage_we: heritageMap.get(b.veterinaire_id)?.ecart_we ?? null,
      }))
    : existingBilan.map((eb) => {
        const info = vetsInfo.find((v) => v.id === eb.veterinaire_id)
        return {
          veterinaire_id: eb.veterinaire_id,
          prenom: info?.prenom ?? '—',
          nom: info?.nom ?? '',
          couleur: info?.couleur ?? '#888',
          statut: 'inconnu',
          we_realise: 0,
          we_quota: 0,
          ecart_we: eb.ecart_we,
          sem_realise: 0,
          sem_quota: 0,
          ecart_semaine: eb.ecart_semaine,
          feries_realise: 0,
          feries_quota: 0,
          ecart_feries: eb.ecart_feries,
          grands_we_realise: 0,
          ecart_grands_we: eb.ecart_grands_we,
          heritage_we: heritageMap.get(eb.veterinaire_id)?.ecart_we ?? null,
        }
      })

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b bg-muted/30">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Calculator className="w-4 h-4 text-primary" />
            Bilan de période — Bonus / Malus
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Écart vs quote-part théorique ·{' '}
            <span className="text-red-600">+N = malus</span>
            {' · '}
            <span className="text-blue-600">−N = bonus</span>
          </p>
        </div>
        {periodeStatut !== 'brouillon' && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleCalculer}
            disabled={calculating}
          >
            {calculating
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Calcul…</>
              : hasExisting || bilan ? 'Recalculer' : 'Calculer le bilan'
            }
          </Button>
        )}
      </div>

      {/* ── Tableau ──────────────────────────────────────── */}
      {lignes.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/10">
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Vétérinaire</th>
                <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground" colSpan={2}>Week-ends</th>
                <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground" colSpan={2}>Semaine</th>
                <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground" colSpan={2}>Fériés</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">BM hérité</th>
              </tr>
              <tr className="border-b border-border text-[11px] text-muted-foreground/70">
                <th />
                <th className="text-center px-3 pb-2">Réalisé / quota</th>
                <th className="text-center px-3 pb-2">Écart</th>
                <th className="text-center px-3 pb-2">Réalisé / quota</th>
                <th className="text-center px-3 pb-2">Écart</th>
                <th className="text-center px-3 pb-2">Réalisé / quota</th>
                <th className="text-center px-3 pb-2">Écart</th>
                <th className="text-right px-3 pb-2">(WE)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lignes.map((l) => (
                <tr key={l.veterinaire_id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: l.couleur }} />
                      <span className="text-sm font-medium">{l.prenom} {l.nom}</span>
                    </div>
                  </td>
                  {/* WE */}
                  <td className="px-3 py-2.5 text-center tabular-nums text-xs">
                    {bilan ? `${l.we_realise} / ${l.we_quota}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <EcartBadge ecart={l.ecart_we} />
                  </td>
                  {/* Semaine */}
                  <td className="px-3 py-2.5 text-center tabular-nums text-xs">
                    {bilan ? `${l.sem_realise} / ${l.sem_quota}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <EcartNumero ecart={l.ecart_semaine} />
                  </td>
                  {/* Fériés */}
                  <td className="px-3 py-2.5 text-center tabular-nums text-xs">
                    {bilan ? `${l.feries_realise} / ${l.feries_quota}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <EcartNumero ecart={l.ecart_feries} />
                  </td>
                  {/* Héritage */}
                  <td className="px-3 py-2.5 text-right">
                    {l.heritage_we !== null
                      ? <EcartNumero ecart={l.heritage_we} />
                      : <span className="text-muted-foreground text-xs">—</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {periodeStatut === 'brouillon'
            ? 'Le bilan est disponible une fois la période publiée.'
            : 'Cliquez sur "Calculer le bilan" pour générer les bonus/malus.'
          }
        </div>
      )}
    </div>
  )
}
