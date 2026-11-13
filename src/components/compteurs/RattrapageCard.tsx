// ============================================================
// GUARDVETO — Ce que le moteur va rattraper (B-211)
// ============================================================
// LE DÉFAUT QUE CETTE CARTE RÉPARE, dans les mots de MiKL (13/11) :
//
//   « je ne peux pas faire le calcul tant qu'une période n'est pas
//    publiée, on est d'accord ? c'est dommage que ça n'apparaisse pas
//    quand même nan ? »
//
// Il avait raison, et le code le disait : `historique/page.tsx` masquait
// la carte « Bilan de la période » dès que le statut valait `brouillon`,
// et avec elle la colonne de rattrapage livrée le matin même.
//
// ⚠️ LA CAUSE N'ÉTAIT PAS LA CONDITION, C'ÉTAIT LE MÉLANGE. Cette seule
// condition commandait DEUX choses aux besoins différents :
//   • le BILAN mesure ce que chacun a fait SUR cette période — sur une
//     période vide il n'y a rien à mesurer, le masquer se défend ;
//   • le RATTRAPAGE vient des périodes PASSÉES closes. Il ne doit rien à
//     la période en cours, il est connu AVANT même de générer — et c'est
//     là qu'il sert, puisqu'il dit ce que le moteur va faire.
//
// D'où une carte à part plutôt qu'un « Bilan de la période » aux colonnes
// vides : un titre faux est pire qu'une carte en moins, et des rangées de
// tirets ne renseignent personne (principe de sobriété, DESIGN.md).
//
// ── CE QUE LA REVUE DU 13/11 A CORRIGÉ ICI ──────────────────────────
//
// Première version : la carte rendait `null` quand la porte de chantier
// `equite-grand-livre` était fermée. Le Val d'Allier n'étant pas bac à
// sable, elle ne s'y affichait JAMAIS — la demande de MiKL restait donc
// non satisfaite précisément là où il l'avait faite, et en silence, avec
// un `<div>` vide de 26 px à la place. Elle s'affiche maintenant partout
// et DIT la portée réelle du moteur de ce cabinet-là : porte fermée, il
// ne rattrape que les week-ends de la période précédente, et la carte
// l'écrit au lieu de laisser croire au rattrapage complet.
//
// Elle n'apparaît que pendant la préparation. Dès que la période est
// publiée, c'est `BonusMalusCard` qui reprend, avec sa propre colonne de
// rattrapage : jamais les deux à la fois.
// ============================================================

'use client'

import { stylePoint } from '@/lib/couleurs'
import {
  horsRotation,
  phraseCumul,
  phrasePortee,
  phraseRattrapage,
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
      rattrapage: phraseRattrapage(grandLivre.report[v.id]),
      cumul: grandLivre.cumul[v.id],
      hors: horsRotation(grandLivre, v.id),
    }))
    .filter((l) => l.rattrapage !== null || (l.cumul !== undefined && l.hors))

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

  return (
    <section className="card count-card" aria-label="Rattrapage d’équité">
      <div className="card-head">
        <h3>Ce que le moteur va rattraper</h3>
        <span className="sub">
          ce que chacun traîne des périodes closes, et que la génération corrigera
        </span>
      </div>

      <table className="count-table">
        <thead>
          <tr>
            <th>Vétérinaire</th>
            <th>Sur cette période</th>
            {/* ⚠️ L'écart réel est une COLONNE, pas seulement une infobulle.
                Première version : il ne vivait que dans un attribut `title`,
                avec une note disant « passez la souris ». Sur téléphone ou
                tablette, il n'y a pas de survol : Anne-So lisait « 1 week-end
                en moins » sans pouvoir savoir qu'il en restait deux derrière —
                exactement la phrase rassurante que l'infobulle devait
                empêcher. Le `title` ne reste qu'un confort. */}
            <th>Écart réel accumulé</th>
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
              </td>
              <td>
                {l.rattrapage ?? (
                  <span className="ecart none">rien — hors rotation</span>
                )}
              </td>
              <td title={phraseCumul(l.cumul, grandLivre.nbPeriodes, l.hors, grandLivre.chantierOuvert === true)}>
                <small className="bm-part">
                  {phraseCumul(l.cumul, grandLivre.nbPeriodes, l.hors, grandLivre.chantierOuvert === true)}
                </small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="count-note">
        Cette période est en préparation : son <b>bilan</b> n’existera qu’une
        fois les gardes posées et la période close. {phrasePortee(grandLivre)}
      </p>
    </section>
  )
}
