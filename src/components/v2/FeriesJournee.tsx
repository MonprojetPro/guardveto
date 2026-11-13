'use client'

// ============================================================
// GUARDVETO V2 — Les jours fériés en journée (B-210)
// ============================================================
// Proposition de la cliente (Val d'Allier), relayée par MiKL le 13/11 : « le
// logiciel devrait considérer que personne ne travaille en journée lors d'un
// jour férié ». Puis, le même jour : « il faut prévoir une option dans les
// réglages journées pour savoir si les jours fériés comptent comme des journées
// normales, et par défaut on part du principe que non ».
//
// ── CE QUE CET ÉCRAN DOIT DIRE, ET QU'IL SERAIT TENTANT DE TAIRE ────────────
//
// 🔑 LE RÉGLAGE NE DÉFAIT RIEN ET NE REFAIT RIEN. Il décide du PROCHAIN
//    remplissage, pas de ce qui est déjà posé — l'application des trames est
//    additive depuis B-120 chantier 3, et MiKL a tranché le 13/11 que l'existant
//    ne serait pas repris (« on s'en fout, […] ça sera pour les prochains »).
//
//    Sans cette phrase à l'écran, l'admin allume l'option et attend que ses
//    25 décembre se remplissent seuls. Rien ne se passe, et elle n'a aucun
//    moyen de savoir si le produit a compris sa demande. C'est exactement la
//    famille du « bouton qui ne dit pas ce qu'il va faire », déjà payée sur ce
//    module.
//
// ── LES REFUS EN MODALE, LES SUCCÈS SANS BRUIT ──────────────────────────────
// Convention du projet, et même traitement que `BlocsJournee` juste au-dessus :
// le message de refus vient du SERVEUR, repris mot pour mot. Le succès se lit
// dans l'interrupteur qui a bougé.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reglerFeriesTravailles } from '@/app/(v2)/journee/actions'

interface Props {
  /**
   * L'état enregistré, lu côté serveur. `null` = la lecture a échoué.
   *
   * ⚠️ TROIS ÉTATS, PAS DEUX. Afficher « décoché » pour une lecture ratée se
   *    lirait comme un réglage posé, et un clic écraserait peut-être l'inverse
   *    de ce que le cabinet avait choisi.
   */
  travailles: boolean | null
}

export function FeriesJournee({ travailles }: Props) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [refus, setRefus] = useState<string | null>(null)
  // ⚠️ L'ÉTAT LOCAL SUIT LA CASE, PAS LA BASE, le temps de l'aller-retour.
  //    Sans lui, la case reviendrait à sa position d'origine pendant la seconde
  //    que dure l'enregistrement — on croirait le clic perdu et on recliquerait.
  const [coche, setCoche] = useState(travailles === true)
  // 🔑 CE QUE LA BASE A ACCEPTÉ EN DERNIER, et non la prop du premier rendu.
  //    Au refus, c'est ICI qu'on revient. La revue du 13/11 a montré le cas :
  //    bascule A acceptée, rafraîchissement pas encore revenu, bascule B
  //    refusée — en retombant sur la prop, la case affichait l'état d'avant A
  //    alors que la base contenait A.
  const [dernierAccepte, setDernierAccepte] = useState(travailles === true)

  const basculer = (valeur: boolean) => {
    setRefus(null)
    setCoche(valeur)
    demarrer(async () => {
      const r = await reglerFeriesTravailles(valeur)
      if ('error' in r) {
        setRefus(r.error)
        setCoche(dernierAccepte)
        return
      }
      setDernierAccepte(valeur)
      // `revalidatePath` invalide le cache ; `router.refresh()` redemande le
      // rendu. Les deux sont nécessaires, comme partout dans ce module.
      router.refresh()
    })
  }

  return (
    <section className="card bj-card">
      <div className="card-head">
        <h2>Les jours fériés</h2>
      </div>
      <div className="card-body">
        <p className="bj-lede">
          Par défaut, le cabinet est considéré comme fermé les jours fériés : le remplissage
          automatique n’y pose personne.
        </p>

        {/* La lecture a échoué : on le DIT, et on ne propose pas un
            interrupteur dont la position serait une invention. */}
        {travailles === null && (
          <p className="bj-refus" role="alert">
            Le réglage des jours fériés n’a pas pu être lu. Rechargez l’écran avant de le
            modifier : la position de l’interrupteur ne veut rien dire pour l’instant.
          </p>
        )}

        {refus && (
          <p className="bj-refus" role="alert">
            {refus}
          </p>
        )}

        <label className="fj-switch">
          <input
            type="checkbox"
            checked={coche}
            disabled={enCours || travailles === null}
            onChange={(e) => basculer(e.target.checked)}
          />
          <span>
            <b>Le cabinet ouvre les jours fériés</b>
            <small>
              Les semaines types s’y appliquent comme un jour ordinaire. Laissez décoché si
              personne ne travaille ces jours-là.
            </small>
          </span>
        </label>

        {/* ⚠️ `role="status"` et pas `role="alert"` : ce n'est pas un problème,
            c'est une limite du geste. Une alerte interromprait le lecteur
            d'écran à chaque bascule pour une information qui n'empêche rien. */}
        <p className="fj-portee" role="status">
          Ce réglage vaut pour les prochains remplissages. Il ne retire pas les présences déjà
          posées un jour férié, et ne pose pas celles qui manquent : pour les ajouter, relancez
          « Remplir les journées » depuis le planning.
        </p>
      </div>
    </section>
  )
}
