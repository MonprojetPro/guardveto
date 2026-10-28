// ============================================================
// GUARDVETO — Qui lit `conges` / `absences`, et ce qu'il fait du PÉRIMÈTRE
// ============================================================
// POURQUOI CE FICHIER EXISTE — exigence de MiKL, le 2026-10-13 :
//
//   « je compte sur toi pour faire ce qu'il faut et repérer les trous dans la
//    raquette. Il faut que systématiquement tu te poses la question : là j'ai
//    fait ça pour cet endroit, est-ce qu'il y a d'autres endroits concernés »
//
// ── LE DÉFAUT QU'IL EMPÊCHE, ET QUI S'EST PRODUIT DEUX FOIS ─────────────────
//
// 🔴 PREMIÈRE FOIS — B-043, août 2026. Le formulaire de congé offrait
//    « Matin / Après-midi / Journée / Soirée ». `checkR16Conge` ne lisait pas le
//    champ : quel que soit le créneau choisi, le congé bloquait la journée
//    entière. Quelqu'un posant une matinée perdait sa garde du soir, et aucun
//    écran ne le disait. On a supprimé le champ plutôt que de le brancher.
//
// 🔴 DEUXIÈME FOIS — B-160a, le 13/10. Le retrait des présences de journée
//    était branché sur DEUX chemins d'écriture, et il en existait QUATRE. Celui
//    que l'administratrice utilise (`createConge`, né validé) n'y était pas, et
//    celui de Filou non plus. Mesuré en base : un congé validé du 02 au 03/11,
//    la présence du 03 toujours là.
//
// 🔑 LA LEÇON COMMUNE N'EST PAS « il restait des bugs ». C'est que RIEN, dans le
//    code, ne posait la question « et celui-là, que fait-il du périmètre ? ».
//    Chaque correctif réparait SON lecteur et annonçait le problème réglé —
//    mécanisme identique à `juges.ts` (les 8 juges des remplacements), à
//    `attentes.ts` (le tableau qui se taisait) et à `couverture-produit.ts`
//    (Filou qui ignorait une capacité). Une consigne déjà oubliée ne se répare
//    pas en la réécrivant : elle se répare par un refus.
//
// ── CE QUE CE FICHIER FORCE, ET CE QU'IL NE FORCE PAS ───────────────────────
//
// Il ne force PAS tout le monde à lire le périmètre : beaucoup de lecteurs n'ont
// rien à en faire (ils comptent des demandes en attente, ils écrivent, ils
// suppriment). Il force la DÉCISION — pour chaque fichier qui lit `conges` ou
// `absences`, quelqu'un a écrit ce qu'il fait du périmètre. Cinq réponses sont
// admises, une seule est interdite : le silence.
//
//   `perimetre: 'decide'`  — il DÉCIDE d'une indisponibilité et lit le périmètre
//                            (`toucheLesGardes`, `blocsRetires`, `vautRepos`…)
//   `perimetre: 'affiche'` — il le MONTRE à l'écran, par mots ou par pastille
//   `perimetre: 'ecrit'`   — il le VALIDE et l'écrit en base
//   `perimetre: 'delegue'` — il passe la main à un lecteur qui, lui, a sa ligne
//   `manque`               — il devrait le lire et ne le fait pas encore.
//                            Assumé, daté, visible. C'est la liste de travail.
//   `hors`                 — le périmètre ne le concerne pas, et voici pourquoi
//
// ── LA CONVENTION QUI REND LE TEST POSSIBLE ─────────────────────────────────
//
// Une indisponibilité passe forcément par `conges` ou `absences`. Le test
// recense donc tous les fichiers de `src/` qui contiennent `from('conges')` ou
// `from('absences')`, et exige une ligne pour chacun — dans les DEUX SENS : un
// fichier ajouté sans décision échoue, une décision qui désigne un fichier
// disparu échoue aussi.
//
// La clé est le chemin du fichier depuis `src/`, en barres obliques.
// ============================================================

/** Ce qu'un lecteur fait du périmètre d'une absence. */
export type DecisionPerimetre =
  | { perimetre: 'decide' | 'affiche' | 'ecrit' | 'delegue'; note?: string }
  | { manque: string }
  | { hors: string }

export const PERIMETRES_LUS: Record<string, DecisionPerimetre> = {
  // ── CEUX QUI DÉCIDENT : ils lisent le périmètre pour trancher ─────────────

  'lib/absences/doublon.ts': {
    perimetre: 'decide',
    note:
      'B-163a ④ — décide si deux absences de la même personne se marchent '
      + 'dessus, via `perimetresSeRecouvrent`. C’est le seul endroit du produit '
      + 'qui REFUSE une écriture sur la foi d’un périmètre : deux périmètres '
      + 'disjoints (« le matin » et « la nuit ») doivent passer, et les refuser '
      + 'reprendrait d’une main ce que B-163 a donné de l’autre.',
  },

  'engine/loader.ts': {
    perimetre: 'decide',
    note:
      'Charge `perimetre` dans `vet.conges` et le replie à l’entrée du moteur. '
      + 'Ne filtre PAS : quatre règles en aval n’ont pas la même question.',
  },
  'app/api/gardes/[id]/disponibilites/route.ts': {
    perimetre: 'decide',
    note:
      'Reconstruit un contexte de génération à la main. Sans le périmètre, R16 '
      + 'écarterait de la liste des remplaçants quelqu’un absent le matin seul.',
  },
  'app/api/gardes/[id]/route.ts': {
    perimetre: 'decide',
    note:
      'N’avertit l’admin que si le congé couvre la nuit. Avertir sur une '
      + 'matinée l’habituerait à passer outre.',
  },
  'app/(protected)/echanges/actions.ts': {
    perimetre: 'decide',
    note:
      'Un congé du matin n’empêche pas de reprendre la garde d’un confrère le '
      + 'soir. Lit TOUS les congés du jour, pas le premier : quelqu’un peut '
      + 'avoir une matinée ET une nuit posées sur la même date.',
  },
  'app/(v2)/journee/presences-actions.ts': {
    perimetre: 'delegue',
    note:
      'Lit `perimetre` dans les DEUX requêtes (congés et absences) et le passe '
      + 'à `presencesVoulues` (`lib/journee/presences.ts`), qui décide bloc par '
      + 'bloc via `blocsRetires`. ⚠️ CLASSÉ `delegue` ET NON `decide` — c’est le '
      + 'gardien de couverture qui l’a corrigé le 13/10 : le fichier ne juge '
      + 'rien lui-même, et se déclarer décideur aurait fait croire que la règle '
      + 'est relue ici. Ce qu’il doit faire, lui, c’est CHARGER la colonne : '
      + 'l’oublier replierait tout sur « journée et nuit » et une absence du '
      + 'matin viderait l’après-midi.',
  },

  // ── CEUX QUI ÉCRIVENT : ils valident et posent le périmètre ───────────────

  'app/(protected)/conges/actions.ts': {
    perimetre: 'ecrit',
    note:
      'Trois chemins : `createConge` (né validé côté admin), `validerConge`, '
      + '`updateConge`. Les trois valident par `validerPerimetre` et appellent '
      + 'la brique de retrait. C’est ICI que B-160a manquait.',
  },
  'app/api/absences/route.ts': {
    perimetre: 'ecrit',
    note:
      'Valide, écrit, retire les présences couvertes, et NE LANCE PAS le '
      + 'parcours de réparation si l’absence ne touche pas les gardes.',
  },
  'lib/ia/outils/absences.ts': {
    perimetre: 'ecrit',
    note:
      'Filou déclare une absence SANS passer par la route : il écrit en direct. '
      + 'Valide le périmètre, retire les présences, et n’annonce des créneaux à '
      + 'réparer que si les gardes sont touchées.',
  },
  'lib/ia/outils/conges.ts': {
    perimetre: 'ecrit',
    note:
      'Filou pose un congé et LIT le périmètre dans ses réponses (`porte_sur`). '
      + 'Les deux sens sont nécessaires : « pouvoir agir » et « être au courant ».',
  },

  // ── CEUX QUI AFFICHENT : la moitié visible de l’option A ──────────────────

  'app/(v2)/absences/page.tsx': {
    perimetre: 'affiche',
    note: 'Passe le périmètre au verdict de conflit ; `AbsencesV2` pose la pastille.',
  },
  'app/(v2)/planning/page.tsx': {
    perimetre: 'affiche',
    note:
      'Le panneau « qui est absent » met le périmètre en français. C’est la '
      + 'réponse au téléphone : « absent jeudi » sur une matinée est faux.',
  },
  'data/v2/accueilEpicentre.ts': {
    perimetre: 'affiche',
    note:
      'Compte les demandes en attente et nomme la prochaine absence. Le '
      + 'périmètre ne change pas le décompte ; la fiche détaillée le porte.',
  },

  // ── CEUX QUE ÇA NE CONCERNE PAS, ET POURQUOI ─────────────────────────────

  'data/v2/dock.ts': {
    hors: 'Même décompte de souhaits en attente, pour le dock.',
  },
  'data/v2/enAttente.ts': {
    hors:
      'Compte MES souhaits en attente. Le périmètre ne change pas le fait '
      + 'qu’une demande attend.',
  },
  'data/souhaitsCongesEnAttente.ts': {
    hors: 'Décompte pur, pour savoir s’il reste des demandes sur une période.',
  },
  'app/api/absences/[id]/reparer/route.ts': {
    perimetre: 'decide',
    note:
      'REFUSE (422) de réparer une absence qui ne touche pas les gardes : il '
      + 'n’y a rien à réattribuer, et le faire retirerait sa garde à quelqu’un '
      + 'qui peut l’assurer.',
  },
  'app/api/absences/[id]/volontaire/route.ts': {
    perimetre: 'decide',
    note: 'Même refus : aucune garde n’est à pourvoir.',
  },
  'app/api/absences/[id]/appel-volontaires/route.ts': {
    perimetre: 'decide',
    note:
      'Même refus. Appeler toute l’équipe pour une garde que son titulaire '
      + 'assure userait l’attention — et c’est l’attention qui fait marcher ce '
      + 'produit.',
  },
}
