// ============================================================
// GUARDVETO — HistoriqueFetesCard (Server Component)
// ============================================================
// Backlog n°14 — équité inter-annuelle des fêtes. Affiche à l'admin QUI a
// tenu Noël / le Nouvel An chaque année (table `historique_fete`, alimentée
// à la publication). C'est la donnée que le moteur consomme pour éviter
// qu'un même véto refasse la même fête deux années de suite.
//
// Pas de coquille vide : la page ne rend cette carte QUE si des données
// réelles existent (table migrée ET au moins une fête publiée).
// ============================================================

import { Gift } from 'lucide-react'
import type { HistoriqueFeteAffichage } from '@/hooks/useCompteurs'

const LIBELLE_FETE: Record<'noel' | 'nouvel_an', string> = {
  noel: 'Noël',
  nouvel_an: 'Nouvel An',
}

const LIBELLE_ROLE: Record<string, string> = {
  premier: '1er',
  second: '2nd',
}

interface HistoriqueFetesCardProps {
  rows: HistoriqueFeteAffichage[]
}

export function HistoriqueFetesCard({ rows }: HistoriqueFetesCardProps) {
  if (rows.length === 0) return null

  // Groupement par année de saison (desc), puis Noël avant Nouvel An.
  const parAnnee = new Map<number, HistoriqueFeteAffichage[]>()
  for (const r of rows) {
    const liste = parAnnee.get(r.annee) ?? []
    liste.push(r)
    parAnnee.set(r.annee, liste)
  }
  const annees = [...parAnnee.keys()].sort((a, b) => b - a)

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div>
        <h2 className="font-heading text-base font-semibold text-foreground flex items-center gap-2">
          <Gift className="w-4 h-4 text-primary" />
          Fêtes de fin d&apos;année — historique
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Qui a tenu chaque fête. Le moteur évite qu&apos;un même vétérinaire refasse
          la même fête deux années de suite (préférence, jamais bloquant).
        </p>
      </div>

      <div className="space-y-2">
        {annees.map((annee) => {
          const entrees = parAnnee.get(annee) ?? []
          const parFete: Array<{ fete: 'noel' | 'nouvel_an'; tenants: HistoriqueFeteAffichage[] }> =
            (['noel', 'nouvel_an'] as const)
              .map((fete) => ({ fete, tenants: entrees.filter((e) => e.fete === fete) }))
              .filter((g) => g.tenants.length > 0)

          return (
            <div key={annee} className="text-sm">
              <span className="font-medium text-foreground tabular-nums">
                {/* Année de saison : le Nouvel An 2026 = 31/12/2026 → 01/01/2027 */}
                {annee}–{(annee + 1) % 100}
              </span>
              <span className="text-muted-foreground">
                {' — '}
                {parFete
                  .map(
                    (g) =>
                      `${LIBELLE_FETE[g.fete]} : ${g.tenants
                        .map((t) => {
                          const role = t.role ? LIBELLE_ROLE[t.role] ?? t.role : null
                          return `${t.prenom} ${t.nom}${role ? ` (${role})` : ''}`
                        })
                        .join(', ')}`,
                  )
                  .join(' · ')}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
