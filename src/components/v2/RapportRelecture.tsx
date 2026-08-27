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

export interface ConstatRelecture {
  critere: string
  gravite: 'bloquant' | 'notable' | 'mineur'
  constat: string
  corrigeable: boolean
}

export interface DonneesRelecture {
  issue: 'relu' | 'indisponible'
  synthese?: string
  constats?: ConstatRelecture[]
  appliques?: LigneRelecture[]
  aTrancher?: LigneRelecture[]
  ecartes?: number
  planningModifie?: boolean
  historiqueIndisponible?: boolean
  error?: string
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
        </div>
      </div>
    )
  }

  const appliques = donnees.appliques ?? []
  const aTrancher = donnees.aTrancher ?? []
  const constats = donnees.constats ?? []
  const rienASignaler =
    appliques.length === 0 && aTrancher.length === 0 && constats.length === 0

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

      {/* ③ Ce qu'il voit sans savoir le corriger */}
      {constats.length > 0 && (
        <div className="rl-bloc rl-constats">
          <p className="rl-bloc-titre">
            <Eye className="rl-ico" aria-hidden />
            Ce que Filou a relevé
          </p>
          <ul className="rl-liste">
            {constats.map((c, i) => (
              <li key={i} className={`rl-item rl-gravite-${c.gravite}`}>
                <p className="rl-constat">{c.constat}</p>
                <p className="rl-meta">
                  {c.critere}
                  {!c.corrigeable ? ' · il ne voit pas de correction automatique' : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rienASignaler && (
        <p className="rl-rien">
          Filou n’a rien à redire à ce planning. C’est un résultat, pas un oubli : il a
          regardé la charge de chacun, le rythme des gardes et l’équilibre des rôles.
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
