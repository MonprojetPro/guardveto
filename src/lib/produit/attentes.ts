// ============================================================
// GUARDVETO — Ce qui attend quelqu'un, et ce que le tableau en dit
// ============================================================
// POURQUOI CE FICHIER EXISTE — question de MiKL, le 2026-08-25 :
//
//   « Comment ça se fait qu'il y a encore des trucs comme ça en attente
//    et que je ne le sais que si je demande ? »
//
// Il regardait « le coup d'œil du matin », qui affichait sereinement
// « Rien à vérifier ». Il n'y avait effectivement rien à vérifier — sur les
// DEUX choses que le tableau savait regarder. Les quatre autres, il ne les
// avait jamais regardées : un échange de gardes proposé à un confrère, un
// échange accepté qui attend le feu vert de l'administratrice, une dette de
// dépannage jamais rendue, un souhait de congé qui traîne.
//
// ── LA CAUSE, ET POURQUOI ELLE N'EST PAS UN OUBLI DE PLUS ───────────────────
//
// Le tableau n'a jamais eu de LISTE MAÎTRESSE de ce qui attend quelqu'un. Ses
// fiches ont été écrites une par une, le jour où l'on travaillait sur le
// sujet : la fiche des congés existe parce qu'on parlait des congés ce
// jour-là. Puis les échanges sont arrivés, puis les dépannages, puis la
// gestion de crise — chacun avec son écran, aucun avec sa fiche. Rien, dans
// le code, ne posait la question « et ça, faut-il le remonter ? », donc
// personne ne se l'est jamais posée.
//
// C'est très exactement le mécanisme corrigé la veille pour Filou
// (`lib/ia/couverture-produit.ts`), et le symptôme est le même — le plus
// dangereux des deux : l'écran ne dit pas « je ne sais pas ». Il affiche
// « Rien à vérifier », c'est-à-dire une réponse INCOMPLÈTE PRÉSENTÉE COMME
// COMPLÈTE. On lit une salle vide là où il y a un angle mort.
//
// ── CE QUE CE FICHIER FORCE, ET CE QU'IL NE FORCE PAS ───────────────────────
//
// Il ne force PAS à tout afficher : un tableau qui remonte tout ne remonte
// plus rien, et la règle finirait contournée. Il force la DÉCISION — pour
// chaque état du produit dans lequel une chose peut rester en plan, quelqu'un
// a écrit ce que le tableau en fait. Trois réponses sont admises, une seule
// est interdite : le silence.
//
//   `fiche`  — cet état attend quelqu'un, et voici la fiche qui le dit.
//   `manque` — il attend quelqu'un et le tableau ne le montre pas encore.
//              Assumé, daté, visible. C'est la liste de travail.
//   `hors`   — cet état n'attend personne, et voici pourquoi.
//
// ── LA CONVENTION QUI REND LE TEST POSSIBLE ─────────────────────────────────
//
// Dans ce produit, tout ce qui attend quelqu'un est un STATUT, et tout statut
// s'écrit dans `types/index.ts` sous la forme `export type Statut<Quelque
// chose> = 'a' | 'b' | …`. Le test recompose donc les clés attendues depuis
// les types eux-mêmes : ajouter une valeur de statut, en retirer une, ou
// créer un domaine entier fait échouer le test tant que personne n'a répondu.
//
// La clé est `<NomDuType>.<valeur>` — rien à deviner, le test affiche la clé
// exacte qui manque.
//
// ── COMMENT ON S'EN SERT ────────────────────────────────────────────────────
//
// On n'ouvre pas ce fichier « pour le tenir à jour » : c'est le test qui vous
// y envoie, le jour où vous touchez à un statut. Il vous dira lequel manque,
// et vous écrirez une ligne — au moment exact où vous avez la réponse en
// tête, pas trois semaines plus tard quand plus personne ne saura si
// l'absence de fiche était un choix ou un oubli.
// ============================================================

/** Ce qu'on a décidé pour un état du produit. */
export type Attente =
  /**
   * Cet état attend quelqu'un : la ou les fiches qui le remontent.
   *
   * PLUSIEURS FICHES QUAND UN MÊME ÉTAT ATTEND DEUX PERSONNES. Un souhait de
   * congé attend la décision de l'administratrice ET la réponse promise au
   * vétérinaire qui l'a déposé — ce sont deux attentes distinctes, sur deux
   * écrans, avec deux phrases différentes. Les fondre en une seule fiche
   * revenait à choisir laquelle des deux personnes reste dans le noir, ce qui
   * est précisément l'erreur que ce fichier existe pour empêcher.
   */
  | { fiche: string | string[] }
  /** Il attend quelqu'un, le tableau ne le montre pas encore. Assumé. */
  | { manque: string }
  /** Personne n'attend rien dans cet état, et voici pourquoi. */
  | { hors: string }

/**
 * Chaque état du produit, et ce que le tableau en dit.
 *
 * Clé : `<NomDuType>.<valeur>`, exactement comme le test la recompose depuis
 * `types/index.ts`.
 */
export const ATTENTES: Record<string, Attente> = {
  // ── LES SOUHAITS DE CONGÉ ───────────────────────────────────────────────
  // Le seul domaine que le tableau regardait déjà avant le 2026-08-25 — et
  // encore, pour la seule administratrice : le vétérinaire qui avait déposé
  // le souhait n'avait aucun moyen de savoir qu'il dormait depuis trois
  // semaines, sinon retourner voir l'écran.
  'StatutConge.souhait': { fiche: ['conges-a-decider', 'mon-conge-en-attente'] },
  'StatutConge.valide': {
    hors: "Le congé est accordé : le vétérinaire est prévenu, le moteur en tient compte. Plus personne n'a la main.",
  },
  'StatutConge.refuse': {
    hors: "Refus notifié avec son motif (lib/regles/refus.ts). Fin de parcours — un nouveau souhait serait une nouvelle ligne.",
  },

  // ── LES ÉCHANGES DE GARDES ──────────────────────────────────────────────
  // Le domaine le plus oublié du produit : livré en juillet 2026, jamais
  // remonté sur aucun tableau de bord, et sans même un type TypeScript pour
  // ses statuts jusqu'au 2026-08-25.
  //
  // ⚠️ DEUX ATTENTES, DEUX PERSONNES DIFFÉRENTES — c'est ce qui rendait
  // l'oubli si facile. `proposee` attend un VÉTÉRINAIRE (celui qu'on a
  // sollicité, ou n'importe qui si l'échange est ouvert à l'équipe) ;
  // `acceptee` attend l'ADMINISTRATRICE. Une fiche qui n'aurait servi que
  // l'administratrice aurait laissé la première moitié dans le noir.
  'StatutEchange.proposee': { fiche: 'echange-a-repondre' },
  'StatutEchange.acceptee': { fiche: 'echange-a-valider' },
  'StatutEchange.validee': {
    hors: "L'échange est fait, les gardes ont changé de main, les compteurs sont à jour.",
  },
  'StatutEchange.refusee': {
    hors: 'Le confrère a dit non. Le demandeur est notifié ; à lui de proposer autre chose.',
  },
  'StatutEchange.refusee_admin': {
    hors: "L'administratrice a refusé, motif à l'appui. Fin de parcours.",
  },
  'StatutEchange.annulee': {
    hors: 'Le demandeur a retiré sa proposition lui-même.',
  },

  // ── LES DÉPANNAGES (« qui a repris la garde de qui ») ────────────────────
  // Une dette ouverte n'expire pas toute seule : elle reste due jusqu'à ce
  // que l'administratrice la solde en rendant une garde. Sans fiche, elle
  // n'existait que sur un écran où personne n'allait sans raison.
  'StatutCompensation.a_compenser': { fiche: 'depannage-a-rendre' },
  'StatutCompensation.compensee': {
    hors: 'La garde a été rendue : la dette est soldée, il n\'y a plus rien à faire.',
  },
  'StatutCompensation.annulee': {
    hors: "Le dépannage n'a finalement pas eu lieu — il ne compte ni comme dette ni comme service rendu (cf. queryDepannages).",
  },

  // ── LES ABSENCES IMPRÉVUES ──────────────────────────────────────────────
  // ⚠️ SEUL MANQUE ASSUMÉ DE CE REGISTRE, et il est délibéré.
  //
  // Une absence `active` n'attend quelqu'un que s'il lui reste des créneaux
  // DÉCOUVERTS. Or « découvert » ne se lit pas dans la table : il faut
  // rejouer `recenserCreneauxImpactes` puis confronter chaque créneau à la
  // garde réelle — c'est-à-dire charger le contexte complet de la période.
  // Beaucoup trop lourd pour un écran d'accueil qui doit s'ouvrir vite.
  //
  // Afficher « N absences en cours » à la place serait pire que rien : une
  // absence entièrement réparée resterait `active` jusqu'à sa date de fin, et
  // la fiche réclamerait éternellement une action déjà faite. Une fiche qui
  // crie au loup se fait ignorer, puis fait ignorer les autres — on l'a déjà
  // payé avec le faux positif de l'espacement minimum (`bb180d4`).
  //
  // La vraie correction est un compteur tenu EN BASE (un `nb_creneaux_
  // decouverts` mis à jour par les mêmes chemins qui pourvoient un créneau).
  // Tant qu'il n'existe pas, ce manque reste écrit ici, à découvert.
  'StatutAbsence.active': {
    manque:
      "Un créneau laissé découvert par cette absence attend l'administratrice (réparer) et les vétérinaires (se porter volontaire). Pas de fiche : « découvert » exige de rejouer le recensement des créneaux impactés, trop lourd pour l'accueil. À reprendre avec un compteur tenu en base — noté le 2026-08-25.",
  },
  'StatutAbsence.resolue': {
    hors: 'Tous les créneaux libérés ont été repourvus. Rien ne reste en plan.',
  },
  'StatutAbsence.annulee': {
    hors: "L'absence n'a pas eu lieu : le vétérinaire garde ses gardes.",
  },

  // ── LES ÉTATS QUI NE SONT PAS DES ATTENTES ──────────────────────────────
  // Ils sont listés parce que le test énumère TOUS les `Statut*` des types,
  // sans savoir lesquels décrivent une file d'attente. Répondre `hors` coûte
  // une ligne ; ne pas répondre laisserait croire qu'on a oublié.
  'StatutVeto.associe': {
    hors: "Décrit le contrat d'un vétérinaire, pas l'état d'une demande.",
  },
  'StatutVeto.salarie': {
    hors: "Décrit le contrat d'un vétérinaire, pas l'état d'une demande.",
  },
  'StatutPeriode.brouillon': {
    fiche: 'periode-a-publier',
  },
  'StatutPeriode.publie': {
    hors: "Le planning est diffusé. Ce qu'il reste à surveiller (règles enfreintes) relève de la fiche de cohérence, pas d'une file d'attente.",
  },
  'StatutPeriode.verrouille': {
    hors: 'Période close : plus aucune modification possible.',
  },
}

/**
 * Les états qui attendent quelqu'un sans que le tableau le dise.
 *
 * Sert au test comme au rapport de fin : la liste doit rester COURTE et
 * chaque ligne doit pouvoir être défendue à voix haute. Elle n'est pas une
 * dette qu'on empile, c'est un aveu qu'on assume.
 */
export function trousDAffichage(): { cle: string; raison: string }[] {
  return Object.entries(ATTENTES)
    .filter(([, a]) => 'manque' in a)
    .map(([cle, a]) => ({ cle, raison: (a as { manque: string }).manque }))
}

/**
 * Les clés de fiche citées par le registre — le test vérifie qu'elles
 * existent VRAIMENT dans le catalogue.
 *
 * Ce contrôle n'est pas un luxe de typage : une clé mal orthographiée
 * déclarerait un affichage qui n'a jamais lieu, et donnerait exactement la
 * fausse assurance que ce fichier existe pour empêcher. C'est la même leçon
 * que pour les outils de Filou, où une faute de frappe aurait annoncé une
 * couverture inexistante.
 */
export function fichesCitees(): string[] {
  return Object.values(ATTENTES)
    .filter((a): a is { fiche: string | string[] } => 'fiche' in a)
    .flatMap((a) => (Array.isArray(a.fiche) ? a.fiche : [a.fiche]))
}
