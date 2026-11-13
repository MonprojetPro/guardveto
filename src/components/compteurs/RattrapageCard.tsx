// ============================================================
// GUARDVETO — Ce que le moteur va rattraper (B-211)
// ============================================================
// LE DÉFAUT QUE CETTE CARTE RÉPARE, dans les mots de MiKL (13/11) :
//
//   « je ne peux pas faire le calcul tant qu'une période n'est pas
//    publiée, on est d'accord ? c'est dommage que ça n'apparaisse pas
//    quand même nan ? »
//
// `historique/page.tsx` masquait toute la carte « Bilan de la période »
// dès que le statut valait `brouillon`, et avec elle la colonne de
// rattrapage. Une seule condition commandait DEUX choses aux besoins
// différents : le BILAN mesure ce que chacun a fait SUR la période (il
// lui faut des gardes posées) ; le RATTRAPAGE vient des périodes PASSÉES
// closes, il est connu AVANT même de générer — et c'est là qu'il sert.
//
// ── POURQUOI CETTE CARTE RESSEMBLE AU BILAN ─────────────────────────
//
// 🔴 PREMIÈRE VERSION LIVRÉE SANS ÊTRE VUE, ET RENVOYÉE EN CAPTURE PAR
//    MiKL : « c'est quoi ce truc dégueulasse ?! ». Elle mettait une
//    PHRASE entière dans chaque cellule (« 1 week-end en moins, 2 nuits
//    de semaine en moins ») d'un tableau dont le CSS attend un CHIFFRE :
//    `.count-table td` est centré et en gras 0.9rem, donc le texte
//    s'empilait sur six lignes dans une colonne étroite. Pire, la colonne
//    « écart réel » réutilisait `.bm-part`, qui porte `white-space:
//    nowrap` — la phrase débordait hors de la carte — et « rien — hors
//    rotation » réutilisait `.ecart none`, une pastille `border-radius:
//    999px` conçue pour UN tiret.
//
//    La leçon est celle du projet, payée une fois de plus : vérifier le
//    RENDU, pas la règle. Les tests validaient le texte produit, aucun
//    ne pouvait voir qu'il était illisible.
//
// Cette version reprend donc EXACTEMENT le motif du bilan, qui est déjà
// dessiné et déjà lu par Anne-So : une colonne par dimension, la pastille
// `Ecart` (source unique de l'affichage d'un écart) pour le rattrapage,
// et l'écart accumulé en petit dessous. Les phrases longues ne sont plus
// dans le tableau : une seule note les porte, sous la carte.
//
// Elle n'apparaît que pendant la préparation. Dès que la période est
// publiée, c'est `BonusMalusCard` qui reprend : jamais les deux à la fois.
// ============================================================

'use client'

import { Ecart } from '@/components/v2/Ecart'
import { stylePoint } from '@/lib/couleurs'
import {
  horsRotation,
  phrasePortee,
  phraseRienARattraper,
  type GrandLivreAffiche,
} from '@/lib/equite/phrases'

interface RattrapageCardProps {
  /** Le grand livre, lu par la MÊME fonction que le moteur. */
  grandLivre: GrandLivreAffiche
  /** Noms et couleurs, pour nommer les gens au lieu de leurs identifiants. */
  vetsInfo: Array<{ id: string; prenom: string; nom: string; couleur: string; statut?: string | null }>
}

function Coquille({ children }: { children: React.ReactNode }) {
  return (
    <section className="card count-card" aria-label="Rattrapage d’équité">
      <div className="card-head">
        <h3>Ce que le moteur va rattraper</h3>
      </div>
      {children}
    </section>
  )
}

/**
 * Le total accumulé, en petit sous la pastille — SEULEMENT s'il apporte
 * quelque chose.
 *
 * ⚠️ Vu au banc visuel du 13/11 : quand toute la dette se rattrape en une
 * fois (un seul week-end de retard), la pastille disait « −1 » et la
 * mention « −1 au total » juste dessous. Deux fois le même chiffre, donc
 * du bruit sur cinq lignes sur sept — et le seul cas qui comptait
 * vraiment, Antoine à −5, se noyait dedans. On ne l'affiche donc que
 * lorsqu'il reste quelque chose APRÈS cette période.
 */
function Accumule({ report, total }: { report: number; total: number }) {
  if (total === 0 || total === report) return null
  return (
    <small className="bm-part" title="Ce qu’il reste à rattraper en tout, cette période comprise">
      {total > 0 ? `+${total}` : `−${Math.abs(total)}`} au total
    </small>
  )
}

export function RattrapageCard({ grandLivre, vetsInfo }: RattrapageCardProps) {
  // Une panne de lecture se DIT : muette, elle se lirait « personne ne
  // traîne rien », et personne ne va vérifier une bonne nouvelle.
  if (grandLivre.erreur) {
    return (
      <Coquille>
        <p className="count-note" role="status">
          <b>L’historique des périodes passées n’a pas pu être lu.</b> Impossible
          de dire ce que le moteur rattrapera sur cette période — ce n’est pas
          qu’il n’y a rien à rattraper.
        </p>
      </Coquille>
    )
  }

  // On ne liste que ceux qui ont quelque chose à rattraper, ou un écart
  // réel sans rattrapage possible (le dernier recours, qu'il faut nommer
  // au lieu de le laisser disparaître d'un tableau d'équité).
  const lignes = vetsInfo
    .map((v) => ({
      ...v,
      report: grandLivre.report[v.id],
      cumul: grandLivre.cumul[v.id],
      hors: horsRotation(grandLivre, v.id),
    }))
    .filter((l) => l.report !== undefined || (l.cumul !== undefined && l.hors))

  if (lignes.length === 0) {
    // Trois raisons possibles, trois phrases : aucune période close, des
    // périodes closes sans bilan calculé (ça se débloque en un clic), ou
    // tout le monde à sa juste part. Les confondre afficherait une bonne
    // nouvelle à la place d'une action à faire.
    return (
      <Coquille>
        <p className="count-note">{phraseRienARattraper(grandLivre)}</p>
      </Coquille>
    )
  }

  // Porte de chantier fermée : le moteur de ce cabinet ne rattrape que les
  // week-ends. Afficher trois colonnes y laisserait croire le contraire.
  const complet = grandLivre.chantierOuvert === true

  return (
    <section className="card count-card bm-card" aria-label="Rattrapage d’équité">
      <div className="card-head">
        <h3>Ce que le moteur va rattraper</h3>
        <span className="sub">ce que chacun traîne des périodes closes</span>
      </div>

      <table className="count-table">
        <thead>
          <tr>
            <th>Vétérinaire</th>
            <th>Week-ends</th>
            {complet && <th>Nuits de semaine</th>}
            {complet && <th>Jours fériés</th>}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.id}>
              <td>
                <span className="ct-vet">
                  <i style={stylePoint(l.couleur)} />
                  {l.prenom} {l.nom}
                </span>
                {l.hors && (
                  <small className="bm-part" title="Dernier recours : il n’est pas candidat aux gardes, son écart ne sera pas rattrapé">
                    hors rotation
                  </small>
                )}
              </td>
              <td>
                <Ecart valeur={l.report?.we ?? 0} horsRepartition={l.hors} />
                {!l.hors && <Accumule report={l.report?.we ?? 0} total={-(l.cumul?.we ?? 0)} />}
              </td>
              {complet && (
                <td>
                  <Ecart valeur={l.report?.semaine ?? 0} horsRepartition={l.hors} />
                  {!l.hors && <Accumule report={l.report?.semaine ?? 0} total={-(l.cumul?.semaine ?? 0)} />}
                </td>
              )}
              {complet && (
                <td>
                  <Ecart valeur={l.report?.feries ?? 0} horsRepartition={l.hors} />
                  {!l.hors && <Accumule report={l.report?.feries ?? 0} total={-(l.cumul?.feries ?? 0)} />}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="count-note">
        <b>−1</b> = une garde <b>en moins</b> sur cette période, <b>+1</b> = une
        garde <b>en plus</b>. « au total » n’apparaît que s’il reste quelque
        chose à rattraper ensuite. {phrasePortee(grandLivre)}
      </p>
    </section>
  )
}
