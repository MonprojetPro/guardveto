'use client'

// ============================================================
// GUARDVETO — CompteursClient
// ============================================================
// Composant client pour la page /compteurs :
//   - Sélecteur de période (navigation URL)
//   - 4 tableaux de compteurs (WE, Semaine, Fériés, Grands WE)
//   - Colonne écart colorée pour les week-ends
//   - Ligne du véto connecté mise en avant
// ============================================================

import { useRouter } from 'next/navigation'
import type { Periode } from '@/types'
import type { CompteursRow, BonusMalusRow } from '@/hooks/useCompteurs'

// ── Types ────────────────────────────────────────────────

interface CompteursClientProps {
  periodes: Periode[]
  periodeId: string
  compteurs: CompteursRow[]
  totalWE: number
  isAdmin: boolean
  currentVetId: string | null
  bonusMalusHeritage: BonusMalusRow[]
}

// ── Helpers ──────────────────────────────────────────────

function labelPeriode(p: Periode): string {
  const saison = p.saison === 'ete' ? 'Été' : 'Hiver'
  const num = p.numero ? ` — Période ${p.numero}` : ''
  const debut = new Date(p.date_debut + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
  const fin = new Date(p.date_fin + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${saison}${num} · ${debut} → ${fin}`
}

function couleurEcart(ecart: number): string {
  if (ecart === 0) return 'text-green-700 dark:text-green-400'
  if (Math.abs(ecart) === 1) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

function badgeEcart(ecart: number) {
  const sign = ecart > 0 ? '+' : ''
  const cls = [
    'inline-flex items-center justify-center rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums',
    ecart === 0
      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
      : Math.abs(ecart) === 1
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  ].join(' ')
  return <span className={cls}>{sign}{ecart}</span>
}

// ── Cellule de ligne ─────────────────────────────────────

function VetNom({ row, isCurrentVet }: { row: CompteursRow; isCurrentVet: boolean }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: row.couleur }}
      />
      <span className={`text-sm truncate ${isCurrentVet ? 'font-semibold' : ''}`}>
        {row.prenom} {row.nom}
      </span>
      {row.statut === 'salarie' && (
        <span className="text-[10px] text-muted-foreground border rounded px-1 shrink-0">sal.</span>
      )}
    </div>
  )
}

// ── Table générique ──────────────────────────────────────

function TableCard({
  titre,
  children,
}: {
  titre: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-semibold text-foreground">{titre}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  )
}

const Th = ({ children, align = 'right' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) => (
  <th className={`px-3 py-2 text-xs font-medium text-muted-foreground text-${align} whitespace-nowrap`}>
    {children}
  </th>
)

const Td = ({ children, align = 'right', highlight = false }: { children: React.ReactNode; align?: 'left' | 'right' | 'center'; highlight?: boolean }) => (
  <td className={`px-3 py-2.5 text-${align} tabular-nums ${highlight ? 'font-medium' : ''}`}>
    {children}
  </td>
)

// ── Composant principal ──────────────────────────────────

export function CompteursClient({
  periodes,
  periodeId,
  compteurs,
  totalWE,
  isAdmin,
  currentVetId,
  bonusMalusHeritage,
}: CompteursClientProps) {
  const router = useRouter()

  // Moyenne WE (uniquement vets avec données)
  const moyenneWE = compteurs.length > 0
    ? compteurs.reduce((s, r) => s + r.we_total, 0) / compteurs.length
    : 0

  // Salariés uniquement pour grands WE
  const salaries = compteurs.filter((r) => r.statut === 'salarie')

  // Bonus/malus par vet
  const bmMap = new Map(bonusMalusHeritage.map((b) => [b.veterinaire_id, b]))

  function rowClass(vetId: string) {
    return vetId === currentVetId
      ? 'bg-primary/5 dark:bg-primary/10'
      : 'hover:bg-muted/30 transition-colors'
  }

  return (
    <div className="space-y-6">

      {/* ── Sélecteur de période ───────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <label htmlFor="periode-sel" className="text-sm font-medium text-foreground whitespace-nowrap">
          Période :
        </label>
        <select
          id="periode-sel"
          value={periodeId}
          onChange={(e) => router.push(`/compteurs?periodeId=${e.target.value}`)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring flex-1 max-w-sm"
        >
          {periodes.map((p) => (
            <option key={p.id} value={p.id}>
              {labelPeriode(p)}
            </option>
          ))}
        </select>
        {compteurs.length === 0 && (
          <span className="text-xs text-muted-foreground">
            Aucune garde dans cette période.
          </span>
        )}
      </div>

      {compteurs.length > 0 && (
        <>
          {/* ── Table : Week-ends ─────────────────────── */}
          <TableCard titre="Gardes week-end">
            <thead>
              <tr className="border-b border-border">
                <Th align="left">Vétérinaire</Th>
                <Th>1er</Th>
                <Th>2nd</Th>
                <Th>Total</Th>
                <Th>Écart/moy.</Th>
                {isAdmin && <Th>BM hérité</Th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {compteurs.map((row) => {
                const ecart = parseFloat((row.we_total - moyenneWE).toFixed(1))
                const ecartEntier = Math.round(ecart)
                const bm = bmMap.get(row.veterinaire_id)
                const isCurrent = row.veterinaire_id === currentVetId
                return (
                  <tr key={row.veterinaire_id} className={rowClass(row.veterinaire_id)}>
                    <Td align="left">
                      <VetNom row={row} isCurrentVet={isCurrent} />
                    </Td>
                    <Td>{row.we_premier}</Td>
                    <Td>{row.we_second}</Td>
                    <Td highlight>{row.we_total}</Td>
                    <Td>
                      <span className={couleurEcart(ecartEntier)}>
                        {badgeEcart(ecartEntier)}
                      </span>
                    </Td>
                    {isAdmin && (
                      <Td>
                        {bm ? (
                          <span className={couleurEcart(bm.ecart_we)}>
                            {bm.ecart_we > 0 ? '+' : ''}{bm.ecart_we}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/20">
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  Moyenne : {moyenneWE.toFixed(1)} WE / véto
                </td>
                <td colSpan={isAdmin ? 5 : 4} />
              </tr>
            </tfoot>
          </TableCard>

          {/* ── Table : Gardes de semaine ─────────────── */}
          <TableCard titre="Gardes de semaine (soirs)">
            <thead>
              <tr className="border-b border-border">
                <Th align="left">Vétérinaire</Th>
                <Th>1er</Th>
                <Th>2nd</Th>
                <Th>Total</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {compteurs.map((row) => (
                <tr key={row.veterinaire_id} className={rowClass(row.veterinaire_id)}>
                  <Td align="left">
                    <VetNom row={row} isCurrentVet={row.veterinaire_id === currentVetId} />
                  </Td>
                  <Td>{row.sem_premier}</Td>
                  <Td>{row.sem_second}</Td>
                  <Td highlight>{row.sem_total}</Td>
                </tr>
              ))}
            </tbody>
          </TableCard>

          {/* ── Table : Jours fériés ─────────────────── */}
          <TableCard titre="Jours fériés">
            <thead>
              <tr className="border-b border-border">
                <Th align="left">Vétérinaire</Th>
                <Th>Total</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {compteurs.map((row) => (
                <tr key={row.veterinaire_id} className={rowClass(row.veterinaire_id)}>
                  <Td align="left">
                    <VetNom row={row} isCurrentVet={row.veterinaire_id === currentVetId} />
                  </Td>
                  <Td highlight>{row.feries_total}</Td>
                </tr>
              ))}
            </tbody>
          </TableCard>

          {/* ── Table : Grands week-ends (salariés) ──── */}
          {salaries.length > 0 && (
            <TableCard titre="Grands week-ends — salariés (Manon, Antoine, Victor)">
              <thead>
                <tr className="border-b border-border">
                  <Th align="left">Vétérinaire</Th>
                  <Th>WE de garde</Th>
                  <Th>Grands WE libres</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {salaries.map((row) => {
                  const grandsWE = Math.max(0, totalWE - row.we_total)
                  return (
                    <tr key={row.veterinaire_id} className={rowClass(row.veterinaire_id)}>
                      <Td align="left">
                        <VetNom row={row} isCurrentVet={row.veterinaire_id === currentVetId} />
                      </Td>
                      <Td>{row.we_total}</Td>
                      <Td highlight>{grandsWE}</Td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/20">
                  <td className="px-3 py-2 text-xs text-muted-foreground" colSpan={3}>
                    Total week-ends de la période : {totalWE}
                  </td>
                </tr>
              </tfoot>
            </TableCard>
          )}
        </>
      )}
    </div>
  )
}
