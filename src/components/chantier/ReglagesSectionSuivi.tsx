'use client'

// ============================================================
// GUARDVETO — Réglages refondus : la section « Suivi » (B-202)
// ============================================================
// Le journal des e-mails : ce que GuardVeto a réellement expédié. Un tableau
// sur ordinateur, une liste sur téléphone (les deux sont rendus, la feuille
// n'en montre qu'un : pas de détection d'appareil côté serveur).
//
// ⚠️ « Parti », pas « Envoyé » : le journal sait que le message a quitté
//    l'application, pas qu'il est arrivé. Le 21/08, « Envoyé » désignait des
//    messages que Brevo avait rejetés dans la seconde.
// ============================================================

import { Info } from 'lucide-react'
import { raisonEchec } from '@/lib/emails/echec'
import {
  LIBELLE_STATUT, TON_STATUT, TYPE_EMAIL, dateHeure, montrerRaison, type LigneEmail,
} from '@/lib/reglages/libelles'
import { nbEchecs } from '@/lib/reglages/coquille'
import { Bloc, Pastille, type Ton } from './ReglagesCommun'

/** Le ton de la pastille d'un e-mail : vert s'il est parti, orange s'il attend, rouge s'il n'arrivera pas. */
function tonDe(statut: string): Ton {
  const t = TON_STATUT[statut]
  return t === 'echec' ? 'bad' : t === 'attente' ? 'warn' : 'ok'
}

function Raison({ e }: { e: LigneEmail }) {
  if (!montrerRaison(e) || !e.erreur) return null
  return (
    <span className={TON_STATUT[e.statut] === 'attente' ? 'rg-raison att' : 'rg-raison'} title={e.erreur}>
      {raisonEchec(e.erreur)}
    </span>
  )
}

export function ReglagesSectionSuivi({ emails }: { emails: LigneEmail[] }) {
  const echecs = nbEchecs(emails)
  const partis = emails.length - echecs

  return (
    <div className="rg-panneau">
      <Bloc
        titre="Journal des e-mails"
        etat={
          <div className="rg-chips">
            {/* Une pastille verte « 0 partis » est un contresens : on ne
                montre le succès que s'il y en a un. */}
            {partis > 0 && <Pastille ton="ok" nue>{partis} partis</Pastille>}
            {echecs > 0 && <Pastille ton="bad" nue>{echecs} en échec</Pastille>}
          </div>
        }
      >
        {emails.length === 0 ? (
          <p className="rg-vide">Aucun e-mail parti pour l’instant.</p>
        ) : (
          <>
            <table className="rg-tj">
              <thead>
                <tr>
                  <th>Quand</th>
                  <th>Type</th>
                  <th>Destinataire</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {emails.map((e) => (
                  <tr key={e.id}>
                    <td>{dateHeure(e.created_at)}</td>
                    <td>{TYPE_EMAIL[e.type] ?? e.type}</td>
                    <td>
                      {e.vetNom ?? e.destinataire}
                      {e.vetNom && <small>{e.destinataire}</small>}
                    </td>
                    <td>
                      <Pastille ton={tonDe(e.statut)}>{LIBELLE_STATUT[e.statut] ?? e.statut}</Pastille>
                      <Raison e={e} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="rg-lj">
              {emails.map((e) => (
                <div className="rg-lj-it" key={e.id}>
                  <span className="rg-lj-t">{TYPE_EMAIL[e.type] ?? e.type}</span>
                  <Pastille ton={tonDe(e.statut)}>{LIBELLE_STATUT[e.statut] ?? e.statut}</Pastille>
                  <span className="rg-lj-m">
                    {e.vetNom ?? e.destinataire} · {dateHeure(e.created_at)}
                  </span>
                  <Raison e={e} />
                </div>
              ))}
            </div>
          </>
        )}
        <p className="rg-note">
          <Info className="rg-ico sm" aria-hidden="true" />
          <span>Parti : accepté par le service d’envoi. Remis : arrivé chez le destinataire.</span>
        </p>
      </Bloc>
    </div>
  )
}
