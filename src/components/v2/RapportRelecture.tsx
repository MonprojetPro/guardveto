'use client'

// ============================================================
// GUARDVETO — Le rapport de relecture de Filou (B-062, refondu B-107)
// ============================================================
// Ce que l'admin lit après une génération, une fois que Filou a relu le
// planning et que le moteur a contrôlé ses propositions.
//
// ── TROIS CATÉGORIES, ET ELLES NE SE MÉLANGENT PAS ──────────────────────────
//
//   ① APPLIQUÉ    — Filou l'a proposé, le moteur l'a validé, c'est déjà fait.
//   ② À TRANCHER  — Filou l'a proposé, le moteur a refusé. Les deux avis sont
//                   montrés côte à côte, et c'est l'admin qui décide.
//   ③ SIGNALÉ     — Filou l'a vu, il ne sait pas le corriger. Personne d'autre
//                   dans le produit ne dit ces choses-là.
//
// ── REFONTE DU 2026-09-02 (B-107) — « c'est imbuvable » ────────────────────
//
// MiKL, trois captures à l'appui : trois écrans de défilement. Le fond était
// bon ; c'est la présentation qui échouait, sur cinq points mesurés :
//
//   • tout au même niveau visuel — la seule DÉCISION à prendre était coincée
//     entre des constats informatifs ;
//   • chaque mouvement listé en entier, ligne par ligne, en texte brut ;
//   • neuf constats affichés en entier, dont six « pas de correction » ;
//   • sept de ces neuf parlaient d'Antoine : le même problème, dit sept fois ;
//   • le critère, qui devrait être l'entrée de lecture, était en gris dessous.
//
// D'où l'ordre retenu, qui répond à trois questions dans cet ordre :
//
//     puis-je publier ?  →  qu'est-ce qui attend MA décision ?  →  que savoir ?
//
// ── LA RÈGLE QUI ENCADRE TOUT REPLI ────────────────────────────────────────
//
// Replier n'est pas supprimer. Chaque bloc replié annonce CE QU'IL CONTIENT et
// COMBIEN — « Antoine · 7 points », jamais « voir plus ». Un intitulé vague
// rendrait le repli équivalent à un effacement, et ce projet sait ce que coûte
// une information vraie que personne ne va chercher (B-005 : « Rien à vérifier »
// s'est lu comme une salle vide alors que six sources n'étaient pas regardées).
//
// ⚠️ RÈGLE DE MAISON — aucun code machine, aucun compteur brut : des phrases,
//    des prénoms, des dates en toutes lettres. Le motif de Filou est affiché
//    TEL QUEL — le reformuler ferait dire au produit ce que Filou n'a pas dit.
//    Les résumés ajoutés ici COMPTENT (« Antoine −1 · Fanny +1 »), ils
//    n'interprètent pas.
// ============================================================

import { Sparkles, Check, AlertTriangle, Eye, CircleSlash } from 'lucide-react'
import { resumerEffet, grouperParPersonne } from '@/lib/relecture/resume'

export interface LigneRelecture {
  id: string
  motif: string
  critere: string
  geste: string[]
  objections: string[]
  effetScore?: 'ameliore' | 'egal' | 'degrade'
}

export interface LigneRevue {
  critere: string
  verdict: 'probleme' | 'a_surveiller' | 'rien_a_signaler'
  /** UNE phrase courte — la seule ligne qui sera lue à coup sûr. */
  constat: string
  /** Le reste : dates, historique, comparaisons. Replié. */
  detail?: string
  corrigeable: boolean
}

export interface DonneesRelecture {
  issue: 'relu' | 'indisponible'
  synthese?: string
  revue?: LigneRevue[]
  /** Critères sur lesquels Filou ne s'est pas prononcé, malgré la consigne. */
  criteresNonTraites?: string[]
  appliques?: LigneRelecture[]
  aTrancher?: LigneRelecture[]
  ecartes?: number
  planningModifie?: boolean
  historiqueIndisponible?: boolean
  error?: string
  /** La cause technique de l'échec, telle que le serveur l'a rapportée. */
  detail?: string
}

/** Le score, dit en français. Il informe, il ne tranche pas. */
function effetEnMots(effet?: LigneRelecture['effetScore']): string | null {
  if (effet === 'ameliore') return 'Le calcul d’équité y gagne aussi.'
  if (effet === 'degrade')
    return 'Le calcul d’équité y perd un peu — Filou juge sur ce que ce calcul ne mesure pas.'
  return null
}

/** Le détail d'un mouvement : le motif tel quel, puis les places touchées. */
function DetailMouvement({ ligne }: { ligne: LigneRelecture }) {
  return (
    <>
      <p className="rl-motif">{ligne.motif}</p>
      <ul className="rl-geste">
        {ligne.geste.map((g, i) => (
          <li key={i}>{g}</li>
        ))}
      </ul>
      <p className="rl-meta">
        {ligne.critere}
        {effetEnMots(ligne.effetScore) ? ` · ${effetEnMots(ligne.effetScore)}` : ''}
      </p>
    </>
  )
}

export function RapportRelecture({
  donnees,
  prenoms = [],
}: {
  donnees: DonneesRelecture
  /**
   * Les prénoms de l'équipe, pour regrouper les constats par personne.
   *
   * Optionnel À DESSEIN : sans eux, le rapport s'affiche à plat comme avant,
   * ce qui est moins lisible mais jamais faux. Un regroupement approximatif
   * serait pire — il rangerait un constat sous le mauvais nom.
   */
  prenoms?: string[]
}) {
  // ── Filou n'a pas pu relire ──
  // Jamais un silence : sans ce bloc, l'absence de rapport se lirait « rien à
  // signaler », et personne ne va vérifier une bonne nouvelle (B-005).
  if (donnees.issue === 'indisponible') {
    return (
      <div className="rl-bloc rl-indispo">
        <CircleSlash className="rl-ico" aria-hidden />
        <div>
          <p className="rl-titre">Filou n’a pas pu relire ce planning</p>
          <p className="rl-sous">
            {donnees.error ??
              'Le planning généré est bien enregistré et reste utilisable tel quel.'}{' '}
            Tu peux relancer la relecture plus tard, ou continuer sans.
          </p>
          {/* La cause technique, repliée. Un « il n'a pas pu » sans cause est un
              mur : personne ne peut agir dessus, et le signaler devient un
              aller-retour de plus. Repliée parce qu'elle ne s'adresse pas à
              l'admin — mais accessible, pour qu'une capture d'écran suffise. */}
          {donnees.detail && (
            <details className="rl-detail">
              <summary>Ce que le serveur a répondu</summary>
              <p>{donnees.detail}</p>
            </details>
          )}
        </div>
      </div>
    )
  }

  const appliques = donnees.appliques ?? []
  const aTrancher = donnees.aTrancher ?? []
  const revue = donnees.revue ?? []
  // Les problèmes d'abord, le reste ensuite : l'admin doit voir ce qui cloche
  // sans avoir à trier. Mais le reste est MONTRÉ, pas effacé — c'est lui qui
  // prouve que le silence sur un critère est un silence délibéré.
  const aVoir = revue.filter((r) => r.verdict !== 'rien_a_signaler')
  const verifie = revue.filter((r) => r.verdict === 'rien_a_signaler')
  const nonTraites = donnees.criteresNonTraites ?? []
  const groupes = grouperParPersonne(aVoir, prenoms)

  // ── LE VERDICT, EN UNE LIGNE ────────────────────────────────────────────
  //
  // La première chose lue, et pour beaucoup la seule. Elle dit ce qui a
  // changé et ce qui attend une décision — pas ce que Filou pense.
  const verdict: string[] = []
  if (appliques.length > 0)
    verdict.push(appliques.length === 1 ? '1 changement appliqué' : `${appliques.length} changements appliqués`)
  if (aTrancher.length > 0)
    verdict.push(aTrancher.length === 1 ? '1 décision à prendre' : `${aTrancher.length} décisions à prendre`)
  if (aVoir.length > 0)
    verdict.push(aVoir.length === 1 ? '1 point relevé' : `${aVoir.length} points relevés`)
  if (verdict.length === 0) verdict.push('Aucun changement, aucun point relevé')

  return (
    <section className="rl-rapport" aria-label="Relecture de Filou">
      <header className="rl-entete">
        <Sparkles className="rl-ico-titre" aria-hidden />
        <div>
          <p className="rl-titre">Filou a relu le planning</p>
          <p className="rl-verdict">{verdict.join(' · ')}</p>
        </div>
      </header>

      {/* La synthèse est l'avis de Filou, pas un état du planning : elle est
          donc REPLIÉE sous le verdict, qui, lui, est factuel. Elle restait
          affichée en entier jusqu'au 02/09 et occupait le haut de l'écran —
          quatre lignes de texte avant la moindre information actionnable. */}
      {donnees.synthese && (
        <details className="rl-plus rl-synthese-repli">
          <summary>Ce que Filou en dit</summary>
          <p>{donnees.synthese}</p>
        </details>
      )}

      {/* ① CE QUI ATTEND UNE DÉCISION — en premier, parce que c'est la seule
          chose qui ne se fera pas sans l'admin. Jamais replié. */}
      {aTrancher.length > 0 && (
        <div className="rl-bloc rl-trancher">
          <p className="rl-bloc-titre">
            <AlertTriangle className="rl-ico" aria-hidden />
            {aTrancher.length === 1
              ? 'Une proposition attend ta décision'
              : `${aTrancher.length} propositions attendent ta décision`}
          </p>
          <p className="rl-bloc-sous">
            Rien n’a été modifié. Le moteur refuse, Filou insiste — à toi de trancher, et
            d’appliquer à la main sur le planning si tu lui donnes raison.
          </p>
          <ul className="rl-liste">
            {aTrancher.map((l) => {
              const resume = resumerEffet(l.geste)
              return (
                <li key={l.id} className="rl-item rl-verdict-probleme">
                  {/* Ce que ça ferait, et pourquoi c'est refusé : les deux
                      seules choses nécessaires pour trancher. Le reste se
                      déplie. */}
                  {resume && <p className="rl-resume">{resume}</p>}
                  <ul className="rl-objections">
                    {l.objections.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                  <details className="rl-plus">
                    <summary>
                      Ce que dit Filou, et les {l.geste.length} places concernées
                    </summary>
                    <DetailMouvement ligne={l} />
                  </details>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* ② CE QUI EST DÉJÀ FAIT — replié : c'est acquis, le moteur l'a validé,
          et le planning affiché en dessous en tient déjà compte. Le résumé dit
          l'essentiel (qui est allégé, qui est chargé) sans forcer la lecture
          de six lignes de dates. */}
      {appliques.length > 0 && (
        <details className="rl-bloc rl-applique">
          <summary className="rl-bloc-titre">
            <Check className="rl-ico" aria-hidden />
            <span>
              {appliques.length === 1
                ? 'Un changement a été appliqué'
                : `${appliques.length} changements ont été appliqués`}
              {(() => {
                // Le résumé de TOUS les mouvements réunis : c'est le bilan qui
                // intéresse l'admin, pas le détail mouvement par mouvement.
                const resume = resumerEffet(appliques.flatMap((l) => l.geste))
                return resume ? <span className="rl-resume-inline"> — {resume}</span> : null
              })()}
            </span>
          </summary>
          <p className="rl-bloc-sous">
            Le moteur a vérifié que chacun respecte les règles du cabinet avant de
            l’enregistrer. Le planning ci-dessous en tient déjà compte.
          </p>
          <ul className="rl-liste">
            {appliques.map((l) => (
              <li key={l.id} className="rl-item">
                <DetailMouvement ligne={l} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ③ CE QU'IL A RELEVÉ SANS SAVOIR LE CORRIGER — groupé PAR PERSONNE.
          Sur le rapport du 02/09, sept constats sur neuf parlaient d'Antoine :
          sept cartes de même taille pour un seul problème. Groupés, ils
          deviennent une ligne dépliable, et l'admin voit d'un coup d'œil QUI
          est concerné. */}
      {aVoir.length > 0 && (
        <div className="rl-bloc rl-constats">
          <p className="rl-bloc-titre">
            <Eye className="rl-ico" aria-hidden />
            Ce que Filou a relevé
          </p>
          <ul className="rl-liste rl-groupes">
            {groupes.map((g, gi) => (
              <li key={gi} className="rl-groupe">
                <details>
                  <summary>
                    <span className="rl-groupe-qui">{g.qui ?? 'Le planning'}</span>
                    <span className="rl-groupe-nb">
                      {g.points.length === 1 ? '1 point' : `${g.points.length} points`}
                    </span>
                  </summary>
                  <ul className="rl-liste">
                    {g.points.map((r, i) => (
                      <li key={i} className={`rl-item rl-verdict-${r.verdict}`}>
                        <p className="rl-constat">{r.constat}</p>
                        {r.detail && (
                          <details className="rl-plus">
                            <summary>Le détail</summary>
                            <p>{r.detail}</p>
                          </details>
                        )}
                        <p className="rl-meta">
                          {r.critere}
                          {!r.corrigeable ? ' · il ne voit pas de correction automatique' : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ④ CE QU'IL A REGARDÉ SANS RIEN TROUVER — la pièce qui manquait.
          Sans elle, l'écran disait « Filou n'a rien à redire » et l'admin ne
          pouvait pas distinguer « il a tout vérifié » de « il n'a rien fait ».
          Repliée : c'est une preuve de travail, pas une liste d'actions. */}
      {verifie.length > 0 && (
        <details className="rl-verifie">
          <summary>
            {verifie.length === revue.length
              ? `Rien à signaler sur les ${verifie.length} points regardés — voir le détail`
              : `${verifie.length} autre${verifie.length > 1 ? 's' : ''} point${verifie.length > 1 ? 's' : ''} regardé${verifie.length > 1 ? 's' : ''}, rien à signaler`}
          </summary>
          <ul className="rl-liste">
            {verifie.map((r, i) => (
              <li key={i} className="rl-item">
                <p className="rl-constat">{r.constat}</p>
                <p className="rl-meta">{r.critere}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {/* Le détail des points sans problème n'est jamais affiché : celui qui
          ouvre ce bloc veut vérifier que ça a été regardé, pas tout relire. */}

      {revue.length === 0 && (
        <p className="rl-rien">
          Filou n’a rendu aucune revue. Ce n’est pas un planning sans reproche : c’est une
          relecture qui n’a pas abouti. Relance-la, ou continue sans son avis.
        </p>
      )}

      {/* Un critère non traité ne doit JAMAIS ressembler à un critère sans
          problème. C'est exactement la confusion qui a produit le faux
          « rien à redire » du 27/08. Il reste DÉPLIÉ, contrairement au reste :
          un angle mort replié serait un angle mort au carré. */}
      {nonTraites.length > 0 && (
        <p className="rl-note rl-manquant">
          Filou ne s’est pas prononcé sur {nonTraites.length === 1 ? 'ce point' : 'ces points'} :{' '}
          {nonTraites.join(' · ')}. Ce n’est pas « rien à signaler » — c’est un angle mort.
        </p>
      )}

      {/* Ce qui a été écarté avant même d'arriver au moteur. Compté et dit :
          en silence, ça se lirait « Filou n'avait rien proposé ». */}
      {(donnees.ecartes ?? 0) > 0 && (
        <p className="rl-note">
          {donnees.ecartes === 1
            ? 'Une proposition de Filou ne correspondait à aucune case réelle du planning : elle a été écartée.'
            : `${donnees.ecartes} propositions de Filou ne correspondaient à aucune case réelle du planning : elles ont été écartées.`}
        </p>
      )}

      {donnees.historiqueIndisponible && (
        <p className="rl-note">
          L’historique des périodes précédentes n’a pas pu être lu : Filou a jugé cette
          période seule, sans l’équilibre de fond.
        </p>
      )}
    </section>
  )
}
