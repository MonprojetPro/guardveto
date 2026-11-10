// ============================================================
// GUARDVETO — HistoriqueFetesCard (Server Component)
// ============================================================
// Backlog n°14 — équité inter-annuelle des fêtes. Affiche à l'admin QUI a
// tenu Noël / le Nouvel An chaque année. Les SAISONS affichées sont celles de
// `historique_fete` (alimentée à la publication, lue par le moteur) ; les NOMS,
// soir par soir, viennent du planning publié (B-198).
//
// Pas de coquille vide : la page ne rend cette carte QUE si des données
// réelles existent (table migrée ET au moins une fête publiée).
// ============================================================

import type { SoirDeFete } from '@/lib/compteurs/fetesParSoir'

const LIBELLE_FETE: Record<'noel' | 'nouvel_an', string> = {
  noel: 'Noël',
  nouvel_an: 'Nouvel An',
}

const JOUR_COURT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

interface HistoriqueFetesCardProps {
  /** Un soir par ligne (B-198), lus dans les plannings publiés. */
  soirs: SoirDeFete[]
  noms: Record<string, string>
  /** Lecture en échec : on le dit, on n'affiche pas un tableau vide. */
  erreur?: string | null
}

// 🔴 B-198 — UNE LIGNE PAR SOIR. MiKL, 10/11 : « pourquoi il y a 2 noms notés
//    pour 1er et 2nd par événement ? ». Chaque fête compte deux soirs, et la
//    version précédente empilait les deux sous un seul « 1er » et un seul
//    « 2nd » sans dire lequel était lequel. Les noms viennent désormais du
//    planning publié, remplacements d'un jour compris (`occupantReel`).
export function HistoriqueFetesCard({ soirs, noms, erreur }: HistoriqueFetesCardProps) {
  if (!erreur && soirs.length === 0) return null

  const nom = (id: string | null) => (id ? noms[id] ?? '—' : '—')

  return (
    <section className="card count-card fetes-card" aria-label="Historique des fêtes de fin d'année">
      <div className="card-head">
        <h3>Fêtes de fin d&apos;année</h3>
      </div>
      {erreur ? (
        <p className="count-vide">
          Les gardes des fêtes n&apos;ont pas pu être lues — ce n&apos;est pas « personne ».
          <br />
          <code className="hist-detail-technique">{erreur}</code>
        </p>
      ) : (
        <table className="count-table">
          <thead>
            <tr>
              <th>Fête</th>
              <th>Soir</th>
              <th>1er</th>
              <th>2nd</th>
            </tr>
          </thead>
          <tbody>
            {soirs.map((s, i) => {
              const premierDeLaFete = i === 0 || soirs[i - 1].fete !== s.fete || soirs[i - 1].annee !== s.annee
              return (
                <tr key={s.date} className={premierDeLaFete ? 'fetes-debut' : undefined}>
                  {premierDeLaFete && (
                    <td className="fetes-fete" rowSpan={2}>
                      {s.fete === 'noel'
                        ? `${LIBELLE_FETE.noel} ${s.annee}`
                        : `${LIBELLE_FETE.nouvel_an} ${s.annee} → ${s.annee + 1}`}
                    </td>
                  )}
                  <td className="fetes-soir">{JOUR_COURT.format(new Date(s.date + 'T12:00:00Z'))}</td>
                  {s.publie ? (
                    <>
                      <td className="fetes-tenants">{nom(s.premierId)}</td>
                      <td className="fetes-tenants">{nom(s.secondId)}</td>
                    </>
                  ) : (
                    <td className="fetes-tenants fetes-absent" colSpan={2}>
                      pas de planning publié ce soir-là
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
