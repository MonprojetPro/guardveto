// ============================================================
// GUARDVETO — APPLIQUER une proposition EN ATTENTE (B-122 lot 2)
// ============================================================
// C'est le geste qu'un clic sur le planning déclenche : « accepte cette
// proposition de Filou », que ce soit seule ou dans un lot entier.
//
// ── POURQUOI CE N'EST PAS UN SIMPLE REJEU DE `arbitrerChangements` ─────────
//
// Une proposition qui vit dans `propositions_relecture` a le verdict `refuse`
// (`engine/relecture/arbitrer.ts`) — sinon elle aurait été appliquée
// automatiquement pendant la relecture et ne serait jamais devenue une
// proposition « en attente ». Rejouer `arbitrerChangements` dessus renvoie
// donc, MÉCANIQUEMENT, `refuse` une seconde fois : la règle qu'elle enfreint
// n'a pas changé.
//
// Ce n'est PAS un refus qui doit bloquer ce module : c'est exactement ce que
// l'admin vient de choisir en cliquant. La doctrine maison le dit sans
// ambiguïté (arbitrage MiKL du 27/08, retouche manuelle déjà permise) :
// « le système INFORME, il n'interdit pas ». Le bouton doit dire ce qu'il
// enfreint — c'est fait en amont, dans le panneau d'aperçu — pas empêcher le
// geste une seconde fois ici.
//
// ── CE QUE CE MODULE VÉRIFIE VRAIMENT ───────────────────────────────────────
//
// Le planning a pu bouger ENTRE la relecture qui a produit la proposition et
// le clic qui l'accepte (retouche manuelle, une autre proposition acceptée
// juste avant dans le même lot, un cadenas posé entre-temps). Trois issues
// possibles, et une seule est un blocage réel :
//
//   • `refuse_cadenas` — un cadenas protège maintenant une des places visées.
//     C'est un fait nouveau depuis la relecture, PAS ce que la proposition
//     annonçait : on bloque, et on le dit.
//   • `sans_objet` — une des places n'existe plus dans le planning actuel
//     (créneau retiré, période modifiée). On bloque, et on le dit.
//   • `applique` — les règles ont changé favorablement depuis (rare, mais
//     rien n'empêche une autre proposition acceptée juste avant d'avoir
//     changé la donne) : le moteur l'accepterait maintenant de lui-même.
//   • `refuse` — LE CAS ATTENDU. On force l'écriture avec
//     `appliquerAffectations`, exactement l'outil que la relecture originale
//     a utilisé pour simuler ce même geste.
// ============================================================

import type { PlanningPartiel } from '../types'
import {
  arbitrerChangements, appliquerAffectations, type ChangementPropose, type OptionsArbitrage,
} from './arbitrer'

export type IssueApplication = 'appliquee' | 'bloquee_cadenas' | 'bloquee_sans_objet'

export interface ResultatApplicationProposition {
  issue: IssueApplication
  /** Absent quand `issue !== 'appliquee'` : rien n'a été écrit. */
  planning?: PlanningPartiel
  /** En français, pour l'écran — vide sur `appliquee`. */
  raison?: string
}

/**
 * Rejoue UNE proposition sur le planning ACTUEL, et rend soit le planning
 * modifié, soit pourquoi elle ne peut plus s'appliquer.
 *
 * N'écrit rien en base — c'est à l'appelant de persister le résultat
 * (`persisterResultat` + `ecrirePlanningV1`), comme le fait déjà la relecture.
 */
export function reappliquerProposition(
  planningActuel: PlanningPartiel,
  changement: ChangementPropose,
  options: OptionsArbitrage,
): ResultatApplicationProposition {
  const resultat = arbitrerChangements(planningActuel, [changement], options)
  const arbitrage = resultat.arbitrages[0]

  if (arbitrage.verdict === 'refuse_cadenas') {
    const lieux = (arbitrage.placesFigeesTouchees ?? [])
      .map((p) => `${p.date} · ${p.type} · ${p.role}`)
      .join(', ')
    return {
      issue: 'bloquee_cadenas',
      raison: `Un cadenas protège maintenant cette place (${lieux}) — retire-le d'abord si tu veux appliquer ce changement.`,
    }
  }

  if (arbitrage.verdict === 'sans_objet') {
    return {
      issue: 'bloquee_sans_objet',
      raison: 'Cette place n’existe plus dans le planning actuel — le planning a changé depuis la proposition.',
    }
  }

  if (arbitrage.verdict === 'applique') {
    // Les règles ont changé favorablement depuis la relecture : le moteur
    // l'accepte de lui-même maintenant. `arbitrerChangements` a déjà produit
    // le planning à jour, rien à forcer.
    return { issue: 'appliquee', planning: resultat.planning }
  }

  // verdict === 'refuse' : LE CAS ATTENDU. On force — c'est la décision que
  // l'admin vient de prendre, pas une question qu'on lui repose.
  const force = appliquerAffectations(planningActuel, changement.affectations)
  if (!force) {
    // Ne devrait pas arriver : `arbitrerChangements` vient de trouver ces
    // mêmes places pour rendre `refuse`. Filet de sécurité, pas un chemin
    // attendu.
    return {
      issue: 'bloquee_sans_objet',
      raison: 'Cette place n’existe plus dans le planning actuel — le planning a changé depuis la proposition.',
    }
  }
  return { issue: 'appliquee', planning: force.planning }
}

/**
 * Rejoue TOUT UN LOT, dans l'ordre — « appliquer tout » du panneau d'aperçu.
 *
 * ⚠️ CUMULATIF, même raisonnement que `arbitrerChangements` : chaque
 * proposition acceptée modifie le planning sur lequel la suivante est jugée.
 * Deux propositions qui visent la MÊME place et passeraient chacune seule ne
 * doivent pas s'écraser en silence — la seconde y trouvera la première déjà
 * posée, et `appliquerAffectations` écrira par-dessus (dernier gagne, comme
 * partout ailleurs dans ce fichier).
 */
export function reappliquerLot(
  planningInitial: PlanningPartiel,
  changements: ChangementPropose[],
  options: OptionsArbitrage,
): { appliquees: string[]; bloquees: { id: string; issue: IssueApplication; raison: string }[]; planning: PlanningPartiel } {
  let courant = planningInitial
  const appliquees: string[] = []
  const bloquees: { id: string; issue: IssueApplication; raison: string }[] = []

  for (const changement of changements) {
    const resultat = reappliquerProposition(courant, changement, options)
    if (resultat.issue === 'appliquee' && resultat.planning) {
      courant = resultat.planning
      appliquees.push(changement.id)
    } else {
      bloquees.push({ id: changement.id, issue: resultat.issue, raison: resultat.raison ?? '' })
    }
  }

  return { appliquees, bloquees, planning: courant }
}
