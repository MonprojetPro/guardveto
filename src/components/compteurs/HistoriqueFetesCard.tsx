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

  // B-194 ① bis — UNE LIGNE PAR FÊTE, plus une ligne par « saison ».
  // MiKL, 10/11 : « faire une ligne unique pour 2026-2027 c'est bizarre, ça
  // devait être séparé ». Noël 2026 et le Nouvel An 2026 → 2027 sont deux
  // fêtes : chacune sa ligne, ses dates, et ses titulaires rangés par rôle.
  // La phrase « le moteur évite la même fête deux ans de suite » est retirée
  // (sobriété) : la règle existe toujours (`penaliteFeteHistorique`, souple).
  const lignes: Array<{ cle: string; fete: 'noel' | 'nouvel_an'; annee: number; tenants: HistoriqueFeteAffichage[] }> = []
  for (const r of rows) {
    const cle = `${r.annee}-${r.fete}`
    const ligne = lignes.find((l) => l.cle === cle)
    if (ligne) ligne.tenants.push(r)
    else lignes.push({ cle, fete: r.fete, annee: r.annee, tenants: [r] })
  }
  // Le plus récent d'abord ; dans une même année, Noël avant le Nouvel An.
  lignes.sort((a, b) => b.annee - a.annee || (a.fete === 'noel' ? -1 : 1))

  const sansRole = rows.some((r) => r.role !== 'premier' && r.role !== 'second')

  const noms = (tenants: HistoriqueFeteAffichage[]) =>
    tenants.length === 0
      ? '—'
      : tenants.map((t) => (
          <span key={`${t.veterinaire_id}-${t.role ?? ''}`} className="fetes-tenant">
            {t.prenom} {t.nom}
          </span>
        ))

  return (
    <section className="card count-card fetes-card" aria-label="Historique des fêtes de fin d'année">
      <div className="card-head">
        <h3>Fêtes de fin d&apos;année</h3>
      </div>
      <table className="count-table">
        <thead>
          <tr>
            <th>Fête</th>
            <th>{LIBELLE_ROLE.premier}</th>
            <th>{LIBELLE_ROLE.second}</th>
            {sansRole && <th>Rôle non noté</th>}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.cle}>
              <td className="fetes-fete">
                {l.fete === 'noel' ? `${LIBELLE_FETE.noel} ${l.annee}` : `${LIBELLE_FETE.nouvel_an} ${l.annee} → ${l.annee + 1}`}
                <em>{l.fete === 'noel' ? '24 et 25 déc.' : '31 déc. et 1er janv.'}</em>
              </td>
              <td className="fetes-tenants">{noms(l.tenants.filter((t) => t.role === 'premier'))}</td>
              <td className="fetes-tenants">{noms(l.tenants.filter((t) => t.role === 'second'))}</td>
              {sansRole && (
                <td className="fetes-tenants">
                  {noms(l.tenants.filter((t) => t.role !== 'premier' && t.role !== 'second'))}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
