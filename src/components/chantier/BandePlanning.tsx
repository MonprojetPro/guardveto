'use client'

// ============================================================
// GUARDVETO — La bande du planning : Préparer · Remplir · Publier (B-172)
// ============================================================
// MiKL, 23/10, capture à l'appui : « je trouve que ce n'est pas clair et que
// ça va porter à confusion auprès des clients, il faut revoir le process pour
// que ce soit ergonomiquement plus fluide ».
//
// CE QUI EMBROUILLAIT : une étiquette « Brouillon · non publié » qui ne disait
// pas quoi faire, un « Générer » qui couvrait deux gestes sans rapport (le
// moteur des gardes, la recopie des présences), un « Vérifier et publier » qui
// ne parlait que des gardes alors qu'il diffusait aussi les journées.
//
// CE QUE CETTE BANDE DIT, EN UNE LECTURE : où en est CE planning, et quel est
// le geste suivant. Trois étapes, toujours dans le même ordre. UNE SEULE est
// en couleur : celle qui attend quelqu'un. Publié ou verrouillé, rien ne l'est.
//
// LE VOCABULAIRE, tranché par MiKL le 23/10 :
//   • les gardes se GÉNÈRENT — c'est le seul vrai calcul du produit ;
//   • les journées se REMPLISSENT — on pose des présences récurrentes, il n'y
//     a rien à calculer.
//
// ⚠️ Les nombres viennent de la base (`contenu`, compté par la page sur TOUT
//    le planning). `null` = lecture impossible : on écrit « ? », jamais « 0 »,
//    qui ferait croire à un planning vide et pousserait à le régénérer.
// ============================================================

import type { ReactNode } from 'react'
import { periodePorteDesGardes } from '@/lib/planning/usage-periode'
import { periodeFr } from '@/lib/dates-fr'
import type { ContenuPeriode } from './DialogPublicationChantier'
import type { Periode } from '@/types'

interface Props {
  periode: Periode | null
  /** Le sélecteur de planning (bouton + menu), rendu par l'écran. */
  selecteur: ReactNode
  /** Nom de la période type, ou null. */
  profil: string | null
  contenu: ContenuPeriode | null
  aGardes: boolean
  aJournee: boolean
  /** Ce que le pré-vol a relevé (avertissements + congés non tranchés). */
  pointsAVerifier: number
  onGenerer: () => void
  onRemplirJournees: () => void
  onPublier: () => void
  onNouveau: () => void
}

function nbSemaines(debut: string, fin: string): number {
  const jours = (Date.parse(`${fin}T12:00:00Z`) - Date.parse(`${debut}T12:00:00Z`)) / 86_400_000 + 1
  return Math.max(1, Math.round(jours / 7))
}

function dateDuJour(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' })
}

/** La pastille d'un compte : posé, vide, ou illisible. */
function Compte({ n, un, plusieurs }: { n: number | null; un: string; plusieurs: string }) {
  if (n === null) return <span className="bpl-pastille inconnu" title="Nombre illisible pour l’instant">?</span>
  if (n === 0) return <span className="bpl-pastille vide">vide</span>
  return <span className="bpl-pastille ok">{n} {n > 1 ? plusieurs : un}</span>
}

export function BandePlanning({
  periode,
  selecteur,
  profil,
  contenu,
  aGardes,
  aJournee,
  pointsAVerifier,
  onGenerer,
  onRemplirJournees,
  onPublier,
  onNouveau,
}: Props) {
  // ── Aucun planning sur ce mois ─────────────────────────────
  if (!periode) {
    return (
      <div className="bpl bpl-hors">
        <div className="bpl-choix">{selecteur}</div>
        <div className="bpl-hors-txt">
          <p>Aucun planning ne couvre ce mois.</p>
          <button type="button" className="bpl-btn cta" onClick={onNouveau}>
            + Nouveau planning
          </button>
        </div>
      </div>
    )
  }

  const verrouille = periode.statut === 'verrouille'
  const publie = periode.statut === 'publie'
  const voitGardes = aGardes && periodePorteDesGardes(periode.usage)
  const voitJournees = aJournee
  const nbGardes = contenu?.gardes ?? null
  const nbPresences = contenu?.presences ?? null

  // Rien de posé du tout (et lu comme tel) : l'étape 2 attend. Un compte
  // illisible ne la rend PAS vide — on laisse alors la main à « Publier », que
  // le serveur contrôle de toute façon.
  const rienDePose =
    (!voitGardes || nbGardes === 0) && (!voitJournees || nbPresences === 0)
  const etape2EnCours = !verrouille && !publie && rienDePose
  const etape3EnCours = !verrouille && !publie && !rienDePose

  const semaines = nbSemaines(periode.date_debut, periode.date_fin)

  return (
    <div className="bpl" role="region" aria-label="Où en est ce planning">
      <div className="bpl-choix">{selecteur}</div>

      <ol className="bpl-etapes">
        {/* ── 1. Préparer ── */}
        <li className="bpl-et fait">
          <p className="bpl-et-t"><span className="bpl-pt" aria-hidden>✓</span>Préparer</p>
          <p className="bpl-quoi">
            {periodeFr(periode.date_debut, periode.date_fin)}
            <small>
              {semaines} semaine{semaines > 1 ? 's' : ''}
              {voitGardes && (profil
                ? <> · période type {profil}</>
                : <> · <span className="bpl-alerte">aucune période type</span></>)}
              {!periodePorteDesGardes(periode.usage) && <> · journées seules</>}
            </small>
          </p>
        </li>

        {/* ── 2. Remplir ── */}
        <li className={`bpl-et${etape2EnCours ? ' encours' : ' fait'}`}>
          <p className="bpl-et-t">
            <span className="bpl-pt" aria-hidden>{etape2EnCours ? '2' : '✓'}</span>Remplir
          </p>
          {voitGardes && (
            <div className="bpl-ligne">
              <p className="bpl-quoi">
                Gardes <Compte n={nbGardes} un="posée" plusieurs="posées" />
                {pointsAVerifier > 0 && !verrouille && (
                  <small className="bpl-points">
                    {pointsAVerifier} point{pointsAVerifier > 1 ? 's' : ''} à régler · détail sous l’en-tête
                  </small>
                )}
              </p>
              {!verrouille && (
                <button
                  type="button"
                  className={`bpl-btn${etape2EnCours ? ' cta' : ''}`}
                  onClick={onGenerer}
                  title={nbGardes ? 'Relancer le moteur sur ce planning' : 'Le moteur calcule qui est de garde'}
                >
                  {/* Un compte illisible n'est pas un planning vide : « Générer »
                      neutre, jamais « Générer les gardes » qui le laisserait croire. */}
                  {nbGardes === null ? 'Générer' : nbGardes > 0 ? 'Régénérer' : 'Générer les gardes'}
                </button>
              )}
            </div>
          )}
          {voitJournees && (
            <div className="bpl-ligne">
              <p className="bpl-quoi">
                Journées <Compte n={nbPresences} un="présence" plusieurs="présences" />
              </p>
              {!verrouille && (
                <button
                  type="button"
                  className={`bpl-btn${etape2EnCours && !voitGardes ? ' cta' : ''}`}
                  onClick={onRemplirJournees}
                  title={nbPresences
                    ? 'Ajouter les présences qui manquent — rien n’est retiré'
                    : 'Poser les présences récurrentes sur ce planning'}
                >
                  {nbPresences ? 'Compléter' : 'Remplir'}
                </button>
              )}
            </div>
          )}
        </li>

        {/* ── 3. Publier ── */}
        <li className={`bpl-et${etape3EnCours ? ' encours' : publie || verrouille ? ' fait' : ''}`}>
          <p className="bpl-et-t">
            <span className="bpl-pt" aria-hidden>{publie || verrouille ? '✓' : '3'}</span>Publier
          </p>
          {verrouille ? (
            <p className="bpl-statut"><b>Verrouillé</b> — consultation seule.</p>
          ) : publie ? (
            <>
              <p className="bpl-statut">
                <span className="bpl-pastille publie">
                  Publié{periode.publie_at ? ` le ${dateDuJour(periode.publie_at)}` : ''}
                </span>
              </p>
              <p className="bpl-aide">Une case à changer ? Clique dessus : l’équipe est prévenue.</p>
            </>
          ) : (
            <>
              <p className="bpl-statut"><b>Brouillon</b> — l’équipe ne voit rien encore.</p>
              <button
                type="button"
                className={`bpl-btn${etape3EnCours ? ' cta' : ' eteint'}`}
                onClick={onPublier}
              >
                Publier à l’équipe
              </button>
            </>
          )}
        </li>
      </ol>
    </div>
  )
}
