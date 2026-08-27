'use client'

// ============================================================
// GUARDVETO — Le rapport de relecture de Filou (B-062, lot 1)
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
// Le mélange serait le pire des rendus : une chose faite et une chose à faire
// ne se lisent pas de la même façon, et l'admin doit pouvoir refermer l'écran
// en sachant exactement ce qui l'attend.
//
// ⚠️ RÈGLE DE MAISON — un bandeau est un SIGNAL, pas un rapport (19/08). Aucun
//    code machine ici, aucun compteur brut : des phrases, des prénoms, des
//    dates en toutes lettres. C'est aussi pour ça que le motif de Filou est
//    affiché TEL QUEL — le reformuler ferait dire au produit ce que Filou n'a
//    pas dit.
// ============================================================

import { Sparkles, Check, AlertTriangle, Eye, CircleSlash } from 'lucide-react'

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

export function RapportRelecture({ donnees }: { donnees: DonneesRelecture }) {
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

  return (
    <section className="rl-rapport" aria-label="Relecture de Filou">
      <header className="rl-entete">
        <Sparkles className="rl-ico-titre" aria-hidden />
        <div>
          <p className="rl-titre">Filou a relu le planning</p>
          {donnees.synthese && <p className="rl-synthese">{donnees.synthese}</p>}
        </div>
      </header>

      {/* ① Ce qui est déjà fait */}
      {appliques.length > 0 && (
        <div className="rl-bloc rl-applique">
          <p className="rl-bloc-titre">
            <Check className="rl-ico" aria-hidden />
            {appliques.length === 1
              ? 'Un changement a été appliqué'
              : `${appliques.length} changements ont été appliqués`}
          </p>
          <p className="rl-bloc-sous">
            Le moteur a vérifié que chacun respecte les règles du cabinet avant de
            l’enregistrer. Le planning ci-dessous en tient déjà compte.
          </p>
          <ul className="rl-liste">
            {appliques.map((l) => (
              <li key={l.id} className="rl-item">
                <p className="rl-motif">{l.motif}</p>
                <ul className="rl-geste">
                  {l.geste.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
                <p className="rl-meta">
                  {l.critere}
                  {effetEnMots(l.effetScore) ? ` · ${effetEnMots(l.effetScore)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ② Ce que l'admin doit trancher */}
      {aTrancher.length > 0 && (
        <div className="rl-bloc rl-trancher">
          <p className="rl-bloc-titre">
            <AlertTriangle className="rl-ico" aria-hidden />
            {aTrancher.length === 1
              ? 'Filou propose un changement que le moteur refuse'
              : `Filou propose ${aTrancher.length} changements que le moteur refuse`}
          </p>
          <p className="rl-bloc-sous">
            Rien n’a été modifié pour ceux-là. Voici les deux avis, à toi de trancher —
            tu peux appliquer le changement à la main sur le planning si tu donnes
            raison à Filou.
          </p>
          <ul className="rl-liste">
            {aTrancher.map((l) => (
              <li key={l.id} className="rl-item rl-item-double">
                <div className="rl-avis">
                  <p className="rl-avis-qui">Ce que dit Filou</p>
                  <p className="rl-motif">{l.motif}</p>
                  <ul className="rl-geste">
                    {l.geste.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </div>
                <div className="rl-avis">
                  <p className="rl-avis-qui">Ce que dit le moteur</p>
                  <ul className="rl-objections">
                    {l.objections.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ③ Ce qu'il a relevé sans savoir le corriger */}
      {aVoir.length > 0 && (
        <div className="rl-bloc rl-constats">
          <p className="rl-bloc-titre">
            <Eye className="rl-ico" aria-hidden />
            Ce que Filou a relevé
          </p>
          {/* Une phrase par point, le reste replié. MiKL, 27/08 : « beaucoup
              trop long, trop de détails, pas bien présenté ». Le fond était
              juste — c'est le mur de texte qui rendait le rapport illisible,
              et un rapport qu'on n'a pas envie de lire ne sert à personne. */}
          <ul className="rl-liste">
            {aVoir.map((r, i) => (
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
          « rien à redire » du 27/08. */}
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
