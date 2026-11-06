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

  // B-194 ① — CARTE V2, comme le bilan voisin. Elle était greffée dans un
  // cadre V1 (`.v2-greffe`) : un cadre dans un cadre, texte collé aux bords,
  // et toutes les fêtes d'une année sur une seule phrase. Un tableau
  // Année / Noël / Nouvel An se lit d'un coup d'œil.
  return (
    <section className="card count-card fetes-card" aria-label="Historique des fêtes de fin d'année">
      <div className="card-head">
        <h3>Fêtes de fin d&apos;année</h3>
        <span className="sub spacer">
          qui a tenu chaque fête · le moteur évite la même fête deux ans de suite
        </span>
      </div>
      <table className="count-table">
        <thead>
          <tr>
            <th>Saison</th>
            <th>{LIBELLE_FETE.noel}</th>
            <th>{LIBELLE_FETE.nouvel_an}</th>
          </tr>
        </thead>
        <tbody>
          {annees.map((annee) => {
            const entrees = parAnnee.get(annee) ?? []
            return (
              <tr key={annee}>
                {/* Année de saison : le Nouvel An 2026 = 31/12/2026 → 01/01/2027 */}
                <td>
                  {annee}–{(annee + 1) % 100}
                </td>
                {(['noel', 'nouvel_an'] as const).map((fete) => {
                  const tenants = entrees.filter((e) => e.fete === fete)
                  return (
                    <td key={fete} className="fetes-tenants">
                      {tenants.length === 0
                        ? '—'
                        : tenants.map((t) => {
                            const role = t.role ? LIBELLE_ROLE[t.role] ?? t.role : null
                            return (
                              <span key={`${t.prenom}-${t.nom}-${t.role ?? ''}`} className="fetes-tenant">
                                {t.prenom} {t.nom}
                                {role && <em>{role}</em>}
                              </span>
                            )
                          })}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
