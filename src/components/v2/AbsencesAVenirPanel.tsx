'use client'

// ============================================================
// GUARDVETO V2 — « Qui est absent », à droite du planning (B-017)
// ============================================================
// Demande de MiKL le 2026-08-25 : remettre le panneau de droite pour le
// secrétariat, mais avec ce qui lui sert vraiment — les absences et congés à
// VENIR — au lieu des compteurs d'équité, qui relèvent de la vie interne de
// l'équipe.
//
// C'est le bon geste : la place existait, et elle était occupée par la seule
// information qu'on venait de lui retirer. Le planning montre déjà les congés
// dans les cases du jour, mais en contexte : pour répondre au téléphone, il
// faut la question inverse — « le docteur X, il revient quand ? » — donc une
// liste triée par date, lisible d'un coup d'œil.
//
// ── DEUX ORIGINES, UNE SEULE LISTE ──────────────────────────────────────────
//
// Une personne peut manquer pour deux raisons, écrites dans deux tables :
//   · un CONGÉ posé à l'avance et validé (`conges`, statut « valide ») ;
//   · une ABSENCE déclarée en cours de route par l'administratrice, maladie le
//     plus souvent (`absences`, statut « active »).
// Au téléphone, la distinction n'a aucune importance : la personne n'est pas
// là. On fond donc les deux dans une liste unique, et on garde le motif comme
// nuance, pas comme classement. Séparer aurait obligé à lire deux listes pour
// répondre à une seule question.
//
// ⚠️ Les SOUHAITS n'y figurent pas. Un souhait n'est pas une absence : c'est
// une demande que l'administratrice n'a pas encore tranchée. L'annoncer au
// téléphone reviendrait à décider à sa place. La RLS ne les laisse d'ailleurs
// pas passer (policy `conges_secretaire_read_valides`) : le filtre est ici pour
// que l'écran dise la même chose que la base, pas pour tenir la barrière.
// ============================================================

import { stylePastille } from '@/lib/couleurs'

/** Une absence, quelle que soit sa provenance. */
export interface AbsenceAVenir {
  id: string
  prenom: string
  nom: string
  couleur: string
  dateDebut: string
  dateFin: string
  /** « Vacances », « Maladie »… — la nuance, pas le classement. */
  motif: string
  /** Vrai si la période a commencé : elle se lit « en ce moment ». */
  enCours: boolean
}

/** « lundi 7 septembre », sans l'année quand c'est cette année. */
function jourCourt(iso: string, anneeCourante: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    ...(d.getUTCFullYear() === anneeCourante ? {} : { year: 'numeric' }),
  })
}

/**
 * La période en une ligne lisible.
 *
 * Un jour unique s'écrit « le 7 septembre », jamais « du 7 au 7 » : la
 * répétition se lit comme un défaut d'affichage et fait douter du reste
 * (même règle que `periodeFr`, posée le 2026-08-21).
 */
function periode(debut: string, fin: string, annee: number): string {
  if (debut === fin) return `le ${jourCourt(debut, annee)}`
  return `du ${jourCourt(debut, annee)} au ${jourCourt(fin, annee)}`
}

export function AbsencesAVenirPanel({ absences }: { absences: AbsenceAVenir[] }) {
  const annee = new Date().getUTCFullYear()

  return (
    <aside className="counters-panel" aria-label="Absences et congés à venir">
      <div className="cnt-head">
        <h4>Absences à venir</h4>
        <p>Congés validés et absences déclarées. Les demandes en attente n’y figurent pas.</p>
      </div>

      {absences.length === 0 ? (
        // Un état vide qui DIT ce qu'il constate. « Aucune absence » tout court
        // laisse penser que la liste n'a pas chargé.
        <p className="abs-vide">
          Personne n’est absent dans les semaines qui viennent — tout le monde est là.
        </p>
      ) : (
        <ul className="abs-liste">
          {absences.map((a) => (
            <li key={a.id} className={`abs-item${a.enCours ? ' en-cours' : ''}`}>
              <span
                className="vet-avatar abs-pastille"
                style={stylePastille(a.couleur)}
                aria-hidden="true"
              >
                {`${a.prenom.charAt(0)}${a.nom.charAt(0)}`.toUpperCase()}
              </span>
              <span className="abs-txt">
                <b>
                  {a.prenom} {a.nom}
                </b>
                <span className="abs-quand">{periode(a.dateDebut, a.dateFin, annee)}</span>
              </span>
              <span className="abs-motif">
                {/* « En ce moment » prime sur le motif : c'est la réponse à la
                    question qu'on pose au téléphone. */}
                {a.enCours ? 'en ce moment' : a.motif}
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
