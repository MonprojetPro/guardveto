// ============================================================
// GUARDVETO — Qui lit la table `gardes`, et ce qu'il fait des remplacements
// ============================================================
// POURQUOI CE FICHIER EXISTE — demande de MiKL, le 2026-10-08 :
//
//   « je voudrais que tu refasses un point sur tous les juges et contrôles qui
//    existent et qui signalent, puisqu'aujourd'hui on a rencontré beaucoup de
//    problèmes à cause de ça, et je suis sûr qu'il y a encore plein de zones
//    d'ombre »
//
// Il avait raison, et au-delà de ce qu'on croyait : l'audit a trouvé HUIT
// lecteurs de plus.
//
// ── CE QUI S'EST PASSÉ CE JOUR-LÀ ───────────────────────────────────────────
//
// Depuis B-061, remplacer quelqu'un UN SEUL JOUR s'écrit dans
// `gardes_exceptions` — et la table `gardes` NE BOUGE PAS. Elle porte les
// TITULAIRES, c'est-à-dire ce qui était PRÉVU. La vue `planning_semaine`, elle,
// applique les remplacements : c'est elle que voient les écrans.
//
// Trois fois dans la même journée, un lecteur de `gardes` a donc jugé un
// planning qui n'existait pas :
//   · B-155  — la publication refusée devant le client, pour une garde pleine ;
//   · B-155a — « il n'y a personne le 14 », une heure après le correctif ;
//   · B-156  — huit autres lecteurs, dont un qui pouvait laisser un soir sans
//              personne (le congé d'un remplaçant passait pour sans conflit).
//
// 🔑 LA LEÇON N'EST PAS « il restait des bugs ». C'est que RIEN, dans le code,
//    ne posait la question « et celui-là, que fait-il des remplacements ? ».
//    Chaque correctif réparait SON lecteur et annonçait le problème réglé.
//    C'est le mécanisme exact de `lib/produit/attentes.ts` (le tableau qui se
//    taisait) et de `lib/ia/couverture-produit.ts` (Filou qui ignorait une
//    capacité) : une consigne déjà oubliée ne se répare pas en la réécrivant.
//
// ── CE QUE CE FICHIER FORCE, ET CE QU'IL NE FORCE PAS ───────────────────────
//
// Il ne force PAS tout le monde à appliquer les remplacements : beaucoup de
// lecteurs n'ont rien à en faire (ils écrivent, ils comptent des lignes, ils
// posent un verrou). Il force la DÉCISION — pour chaque fichier qui lit
// `gardes`, quelqu'un a écrit ce qu'il fait des remplacements. Quatre réponses
// sont admises, une seule est interdite : le silence.
//
//   `remplacements: 'brique'` — il les applique via `lib/gardes/exceptions-jour`
//   `remplacements: 'vue'`    — il les lit lui-même (`planning_semaine` ou
//                               `gardes_exceptions` en direct)
//   `delegue`                 — il ne juge pas : il appelle un juge qui, lui, a
//                               sa propre ligne ici
//   `manque`                  — il les ignore et ça se voit quelque part.
//                               Assumé, daté, visible. C'est la liste de travail.
//   `hors`                    — les remplacements ne le concernent pas, et voici
//                               pourquoi
//
// ── LA CONVENTION QUI REND LE TEST POSSIBLE ─────────────────────────────────
//
// Un juge du planning passe forcément par la table `gardes`. Le test recense
// donc tous les fichiers de `src/` qui contiennent `from('gardes')`, et exige
// une ligne pour chacun — dans les DEUX SENS : un fichier ajouté sans décision
// échoue, une décision qui désigne un fichier disparu échoue aussi.
//
// La clé est le chemin du fichier depuis `src/`, en barres obliques.
//
// ⚠️ CE QUE CE REGISTRE NE PEUT PAS FAIRE. Le test vérifie qu'un fichier qui se
//    déclare `brique` importe bien `exceptions-jour` — donc que le code est
//    ÉCRIT. Il ne prouve pas qu'il est APPELÉ sur le bon chemin : c'est la
//    leçon « un grep prouve qu'un code est écrit, jamais qu'il est exécuté ».
//    Ce registre empêche l'oubli, pas la mauvaise implémentation ; celle-là se
//    voit en recette, et c'est pour ça que les règles qui portaient les défauts
//    ont été extraites en fonctions PURES et testées.
// ============================================================

/** Ce qu'un lecteur de `gardes` fait des remplacements ponctuels. */
export type DecisionJuge =
  /**
   * Il applique les remplacements.
   * `brique` = via `lib/gardes/exceptions-jour` (le cas normal).
   * `vue`    = il lit `planning_semaine` ou `gardes_exceptions` lui-même, parce
   *            qu'il a besoin du planning jour par jour ou qu'il POSE les
   *            remplacements.
   */
  | { remplacements: 'brique' | 'vue'; limite?: string }
  /** Il ne juge pas lui-même : il appelle un juge, nommé ici. */
  | { delegue: string }
  /** Il les ignore, et la conséquence est connue. Assumé, daté. */
  | { manque: string }
  /** Les remplacements ne le concernent pas, et voici pourquoi. */
  | { hors: string }

/**
 * Chaque fichier qui lit la table `gardes`, et ce qu'il fait des remplacements.
 *
 * Clé : chemin depuis `src/`, exactement comme le test le recompose.
 */
export const JUGES: Record<string, DecisionJuge> = {
  // ── LES JUGES DU PLANNING — ceux qui disent « ça ne va pas » ─────────────

  'data/monterValidationPeriode.ts': {
    remplacements: 'brique',
    limite:
      "Une substitution qui ne vaudrait QUE pour le vendredi n'est pas vue : le vendredi est synthétisé depuis le samedi et hérite de son remplaçant (B-155b).",
  },
  'data/casesAPourvoir.ts': {
    remplacements: 'vue',
    limite:
      "Les rôles sur-mesure (3e place et plus) ne figurent pas dans la vue et gardent le miroir `garde_placements` — aucun n'accepte de remplacement ponctuel à ce jour.",
  },
  'data/revaliderPlanning.ts': { delegue: 'monterValidationPeriode + validerPlanning' },
  'app/api/publish/route.ts': { delegue: 'casesAPourvoir + revaliderPlanning' },
  'app/api/gardes/[id]/route.ts': { delegue: 'monterValidationPeriode (garde-fou du PATCH)' },
  'lib/crise/changements.ts': { remplacements: 'brique' },
  'lib/conges/detection-conflit.ts': {
    remplacements: 'brique',
    limite:
      'La seconde source (`attributions`) ignore les remplacements — elle ne sert plus qu\'aux plannings importés, où il n\'y en a pas.',
  },

  // ── CE QUI S'ÉCRIT DANS UN REGISTRE QUE PERSONNE NE RELIT ────────────────
  // Le plus sournois de l'audit : muet, et à retardement d'un an.

  'data/historiqueFetes.ts': { remplacements: 'brique' },

  // ── CE QUI PART CHEZ LES VÉTÉRINAIRES ───────────────────────────────────

  'lib/notifications.ts': {
    remplacements: 'brique',
    limite:
      "`sendPlanningPublie` est corrigé (liste et binôme réels). `sendGardeModifiee`, lui, prévient les titulaires d'avant et d'après sans mentionner un remplacement ponctuel qui primerait sur le nouveau venu — borné, et dit plutôt que bricolé (08/10).",
  },
  'lib/sync-calendrier.ts': { remplacements: 'vue' },
  'app/api/export-pdf/route.ts': { remplacements: 'vue' },

  // ── LES CHEMINS QUI RÉPARENT UNE ABSENCE ────────────────────────────────
  // Ils écrivent la place NATIVE ; un remplacement ponctuel prime dessus. Les
  // trois disent désormais la MÊME phrase (`avertissementRemplacementPonctuel`).

  'app/api/absences/[id]/reparer/route.ts': { remplacements: 'brique' },
  'app/api/absences/[id]/volontaire/route.ts': { remplacements: 'brique' },
  'lib/ia/outils/absences.ts': { remplacements: 'brique' },

  // ── LES ÉCHANGES DE GARDES ──────────────────────────────────────────────

  'app/(protected)/echanges/actions.ts': {
    remplacements: 'brique',
    limite:
      "Une garde déjà remplacée ne s'échange pas en bloc : on refuse en le disant. Un échange partiel demanderait un second modèle de remplacement, divergent du premier.",
  },
  'app/(protected)/echanges/page.tsx': {
    manque:
      "La liste « mes gardes à céder » vient des titulaires : un remplaçant n'y voit pas sa garde, et un titulaire remplacé y voit une garde que le gardien refusera à l'envoi. Friction, jamais faute — le refus est juste et expliqué. Noté le 2026-10-08.",
  },
  'app/(v2)/absences/page.tsx': {
    manque:
      'Même liste que l\'écran Échanges, même limite, même gardien derrière. Noté le 2026-10-08.',
  },
  'lib/ia/outils/echanges.ts': {
    manque:
      "Filou propose les mêmes gardes depuis les titulaires. Son écriture passe par `proposerEchange`, donc par LE gardien — il peut proposer un échange qui sera refusé, il ne peut pas en faire un de travers. Noté le 2026-10-08.",
  },

  // ── L'EFFECTIF ──────────────────────────────────────────────────────────

  'app/(protected)/admin/veterinaires/actions.ts': { remplacements: 'vue' },

  // ── LES MANQUES ASSUMÉS, ET ILS SONT À DÉCIDER ──────────────────────────

  'engine/loader.ts': {
    manque:
      "Le lookback inter-périodes (#17) charge les TITULAIRES des gardes passées : les règles de rythme (espacement, charge) croient donc que le titulaire remplacé était de garde. À ne pas confondre avec l'ÉQUITÉ, où la convention est inverse et assumée (un jour exceptionnel ne compte pas, cf. la vue `compteurs_gardes`). Le rythme, lui, parle de qui a réellement veillé. ➜ arbitrage MiKL, noté le 2026-10-08.",
  },
  'data/syncAttributions.ts': {
    manque:
      "La copie technique V2 (`attributions`) recopie les titulaires : la pose d'un remplacement ne la resynchronise pas. Conséquence tenue pour l'instant côté lecture (le détecteur de dérive compare aux titulaires, cf. `gardesTitulaires`), mais la vraie correction est que la V2 porte les remplacements. ➜ B-156a, noté le 2026-10-08.",
  },
  'lib/crise/contexte.ts': {
    manque:
      "`recenserCreneauxImpactes` trouve les jours par la VUE (donc remplacements compris), puis dérive les rôles à réparer depuis la TABLE — c'est volontaire, on répare une place native. Angle mort qui en découle : l'absence de quelqu'un qui n'est QUE remplaçant ne fait apparaître aucun créneau à réparer. Noté le 2026-10-08.",
  },

  // ── CEUX QUE LES REMPLACEMENTS NE CONCERNENT PAS ─────────────────────────
  // Listés parce que le test énumère TOUS les lecteurs de `gardes`, sans savoir
  // lesquels jugent. Répondre `hors` coûte une ligne ; ne pas répondre
  // laisserait croire à un oubli.

  'data/ecrirePlanningV1.ts': {
    hors: "Écrit le planning généré. À la génération, aucun remplacement n'existe encore — ils se posent sur un planning diffusé.",
  },
  'app/api/generate/route.ts': {
    hors: 'Compte les gardes avant republication, puis écrit le résultat du moteur. Ne juge aucun occupant.',
  },
  'lib/gardes/appliquer-changement.ts': {
    hors: 'Écrit la place native (titulaire). Le remplacement ponctuel a son propre chemin, juste à côté.',
  },
  'lib/gardes/appliquer-exception.ts': {
    hors: "C'est LUI qui pose les remplacements, et il lit déjà la vue pour vérifier ce qu'il remplace.",
  },
  'app/(protected)/filou/import-actions.ts': {
    hors: "Importe un historique de plannings passés. Aucun remplacement n'y existe : la table est alimentée de zéro.",
  },
  'app/api/cron/lock-gardes/route.ts': {
    hors: 'Pose le verrou des gardes passées (`verrouille`). Ne lit aucun occupant.',
  },
  'app/api/planning/places-figees/route.ts': {
    hors: "Les cadenas de l'admin figent une place pour la GÉNÉRATION, sur un brouillon. Les remplacements vivent sur un planning publié : les deux ne se croisent jamais.",
  },
  'data/chargerPlacesFigees.ts': {
    hors: 'Même concept que ci-dessus, côté lecture.',
  },
  'app/api/gardes/[id]/disponibilites/route.ts': {
    hors: "Lit la TABLE délibérément (choix écrit dans le fichier) : il propose qui pourrait PRENDRE la place, il ne dit pas qui la tient.",
  },
  'hooks/useCompteurs.ts': {
    hors: "Convention d'équité, écrite et testée : un jour exceptionnel ne change pas les compteurs de gardes, il se compte à part (`jours_exceptionnels_pris`). Appliquer les remplacements ici CASSERAIT la règle au lieu de la servir.",
  },
  'app/(protected)/admin/periodes/actions.ts': {
    hors: "Supprime une période et nettoie les poignées d'agenda. Les remplacements partent en CASCADE avec les gardes.",
  },
  'app/(protected)/crise/volontaire/page.tsx': {
    hors: "Affiche la date et le type du créneau proposé, jamais un occupant. Qui est de garde vient du recensement, pas d'ici.",
  },
  'app/(v2)/planning/page.tsx': {
    hors: "Ne lit que `periode_id` (y a-t-il des gardes, pour le bouton PDF). La grille, elle, vient de la vue `planning_semaine`.",
  },
  'lib/ia/outils/planning.ts': {
    delegue: 'casesAPourvoir pour les réserves, la vue `planning_semaine` pour lire le planning',
  },
}

/**
 * Les lecteurs qui ignorent les remplacements, avec la conséquence assumée.
 *
 * Sert au test comme au rapport de fin : la liste doit rester COURTE et chaque
 * ligne doit pouvoir être défendue à voix haute. Ce n'est pas une dette qu'on
 * empile, c'est un aveu qu'on assume.
 */
export function juges_quiIgnorentLesRemplacements(): { fichier: string; raison: string }[] {
  return Object.entries(JUGES)
    .filter(([, d]) => 'manque' in d)
    .map(([fichier, d]) => ({ fichier, raison: (d as { manque: string }).manque }))
}

/** Les fichiers qui déclarent passer par la brique partagée. */
export function juges_surLaBrique(): string[] {
  return Object.entries(JUGES)
    .filter(([, d]) => 'remplacements' in d && d.remplacements === 'brique')
    .map(([fichier]) => fichier)
}

/** Les fichiers qui déclarent lire les remplacements eux-mêmes. */
export function juges_surLaVue(): string[] {
  return Object.entries(JUGES)
    .filter(([, d]) => 'remplacements' in d && d.remplacements === 'vue')
    .map(([fichier]) => fichier)
}
