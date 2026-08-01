// ============================================================
// GUARDVETO — Le vocabulaire des REFUS de l'écran Organisation
// ============================================================
// Pendant que `libelle.ts` est la source unique de ce qu'une règle DIT, ce
// fichier est la source unique de ce qu'un refus VEUT DIRE. Il ne connaît ni
// React ni le DOM : c'est de la traduction de texte, donc c'est testable.
//
// LE PRINCIPE
//
// Le serveur renvoie un message court et exact (« Aucun vétérinaire actif ne
// porte l'étiquette « junior ». »). Ce message n'est JAMAIS réécrit : il est
// repris mot pour mot. Le décodeur AJOUTE, à côté, un titre qui dit ce qui n'a
// pas eu lieu, une explication en français, et — quand elle existe — une porte
// de sortie.
//
// POURQUOI UNE RECONNAISSANCE PAR MOTIF, ET PAS UN CODE D'ERREUR
//
// L'écran compte une trentaine de points de refus, écrits sur plus d'un an.
// Leur passer à tous un code aurait voulu dire retoucher trente appels — et
// oublier le trentième. Les motifs ci-dessous reconnaissent des FAMILLES : un
// message inconnu retombe sur le cas générique, affiché tel quel dans une vraie
// modale. On dégrade vers « moins riche », jamais vers « invisible ».
//
// ⚠️ Les motifs suivent les messages RÉELS de `app/(protected)/regles/actions.ts`.
//    Le test `refus.test.ts` les vérifie l'un après l'autre : changer un message
//    côté serveur sans passer ici fait rougir le test, pas la production.
// ============================================================

/** Ce que le pied de la modale propose comme porte de sortie. */
export type ActionRefus =
  /** Aller sur un autre écran (`/equipe`, `/login`…). */
  | { genre: 'aller'; label: string; href: string }
  /** Repartir de l'état réel du serveur. */
  | { genre: 'recharger'; label: string }

export interface RefusDecode {
  /** Ce qui n'a PAS eu lieu — jamais le mot « Erreur ». */
  titre: string
  /** Ce que ça veut dire, et quoi faire. Absent = message déjà limpide. */
  explication?: string
  action?: ActionRefus
}

const MOTIFS: Array<{ quand: RegExp; alors: RefusDecode }> = [
  {
    // Deux formulations pour un seul fait : celle du serveur (« Aucun
    // vétérinaire actif NE PORTE L'ÉTIQUETTE… ») et celle que l'écran fabrique
    // avant même d'appeler (« Personne NE PORTE ENCORE L'ÉTIQUETTE… »). Le
    // motif porte donc sur ce qu'elles ont en commun, apostrophe droite ou
    // courbe indifféremment.
    quand: /ne porte (?:encore |pas )?l['’]étiquette/i,
    alors: {
      titre: 'Personne ne porte cette étiquette',
      explication:
        'Une étiquette n’existe qu’à travers les vétérinaires qui la portent : sans porteur, la règle serait soit impossible à tenir, soit sans le moindre effet sur le planning. Coche les vétérinaires concernés dans le panneau (« Qui porte cette étiquette ? »), ou pose l’étiquette sur leurs fiches depuis la page Équipe.',
      action: { genre: 'aller', label: 'Ouvrir la page Équipe', href: '/equipe' },
    },
  },
  {
    quand: /réservée? à l['’]administrateur/i,
    alors: {
      titre: 'Réglage réservé à l’administrateur',
      explication:
        'Cet écran est ouvert à toute l’équipe en lecture : chacun peut voir les règles qui produisent son planning, seul l’administrateur les modifie.',
    },
  },
  {
    quand: /non authentifié/i,
    alors: {
      titre: 'Session expirée',
      explication:
        'Ta session n’est plus valide — le plus souvent parce qu’elle a duré trop longtemps. Reconnecte-toi : rien de ce que tu as déjà enregistré n’est perdu.',
      action: { genre: 'aller', label: 'Se reconnecter', href: '/login' },
    },
  },
  {
    quand: /existe déjà/i,
    alors: {
      titre: 'Cette règle existe déjà',
      explication:
        'Une règle identique est déjà posée. Plutôt que d’en créer une seconde, retrouve-la dans la liste et change son niveau de fermeté — deux règles jumelles finiraient par se contredire.',
    },
  },
  {
    // « … ne correspond à cette sélection » : la fiche cochée a été désactivée
    // ou supprimée entre l'affichage de l'écran et le clic. Même remède que
    // pour un identifiant devenu fantôme — repartir de l'état réel.
    quand: /introuvable|ne correspond à cette sélection|inconnus?\s*(?:\(s\))?\s*(?:pour|:)|inconnue\s*:/i,
    alors: {
      titre: 'Réglage impossible en l’état',
      explication:
        'Un élément désigné par ce réglage n’existe plus (il a pu être supprimé depuis un autre onglet, ou depuis un autre appareil). Recharge la page pour repartir de l’état réel.',
      action: { genre: 'recharger', label: 'Recharger la page' },
    },
  },
  {
    quand: /invalide/i,
    alors: {
      titre: 'Cette saisie n’est pas acceptée',
      explication:
        'Le serveur revérifie tout ce que l’écran envoie — c’est sa dernière ligne de défense. Corrige la valeur signalée ci-dessus et réessaie.',
    },
  },
]

/** Le repli : un refus qu'on ne sait pas expliquer reste un refus AFFICHÉ. */
const GENERIQUE: RefusDecode = { titre: 'Ce réglage n’a pas pu être enregistré' }

/**
 * Traduit un message de refus serveur en contenu de modale.
 * Le message d'origine n'est pas inclus dans le retour : l'appelant l'affiche
 * tel quel, au-dessus de l'explication.
 */
export function decoderRefus(message: string): RefusDecode {
  const texte = message ?? ''
  return MOTIFS.find((m) => m.quand.test(texte))?.alors ?? GENERIQUE
}
