// ============================================================
// GUARDVETO — Les chantiers en cours, et qui a le droit de les voir
// ============================================================
// POURQUOI CE FICHIER EXISTE — l'incident du 2026-10-08 (B-151).
//
// Un renouveau visuel du planning est parti sur le compte du client, Val
// d'Allier, alors que MiKL avait demande qu'il ne touche que les bacs a sable :
//
//   « je croyais avoir ete clair, qu il n y aurait que les bacs a sable qui
//    seraient affectes »
//
// 🔑 LA CAUSE N'ETAIT PAS UN OUBLI, C'ETAIT UNE ABSENCE DE MECANISME. La
// consigne n'apparaissait nulle part au board — mais surtout, RIEN DANS LE CODE
// N'AURAIT PU L'APPLIQUER MEME SI ELLE Y AVAIT ETE. `cabinets.est_bac_a_sable`
// existait depuis B-090 et n'etait lue qu'a UN endroit, pour afficher un
// bandeau. Il n'y avait ni drapeau, ni chemin de rendu alternatif.
//
// C'est exactement le mecanisme de FILOU SUIT LE PRODUIT et de LE TABLEAU NE
// PEUT PAS SE TAIRE : une consigne qu'aucun garde-fou ne porte est une consigne
// deja oubliee. Les deux regles du projet disent qu'on ne repare pas ca en la
// reecrivant — on la rend IMPOSSIBLE A ENFREINDRE EN SILENCE.
//
// ── CE QUE CE FICHIER FORCE ─────────────────────────────────────────────────
//
// Un chantier qui n'est pas declare ici est FERME. Pas « ouvert par defaut,
// restreint si on y pense » : ferme, et il faut une ligne pour l'ouvrir. Une
// faute de frappe dans un appelant (`'planning-grille-v3'`) ne peut donc pas
// se traduire par une livraison au client — elle ne trouve aucune entree, et
// `chantierOuvert` rend `false`.
//
// ⚠️ CE N'EST PAS UN MODULE. Un module (`produit/modules.ts`) est une capacite
//    que LE CABINET choisit d'allumer. Un chantier est un etat de LIVRAISON que
//    MiKL seul controle : le cabinet ne doit pas pouvoir se l'offrir, et aucun
//    ecran de reglages ne l'expose.
//
// ⚠️ CE N'EST PAS UNE SECURITE. Comme le ruban bac a sable, il informe le
//    rendu — il ne ferme aucune porte serveur. Un chantier qui exposerait des
//    DONNEES et pas seulement un dessin devrait en plus passer par
//    `modules-serveur.ts`, qui, lui, refuse.
// ============================================================

/** Ce qu'on a decide de la diffusion d'un chantier. */
export type Diffusion =
  /** Visible uniquement sur un cabinet marque bac a sable, et voici pourquoi. */
  | { bacASableSeulement: string }
  /** Ouvert a tout le monde : le chantier a ete recette et bascule. */
  | { tousLesCabinets: string }

export interface Chantier {
  /** Le nom que MiKL lit dans un rapport. */
  nom: string
  /** L'item de board qui le porte — la filiation doit rester lisible. */
  item: string
  /** Date d'ouverture du chantier, au format AAAA-MM-JJ. */
  depuis: string
  diffusion: Diffusion
}

/**
 * Les chantiers en cours. **Une entree par renouveau visible par un cabinet.**
 *
 * Retirer une entree ferme le chantier partout — c'est la facon de revenir en
 * arriere sans toucher au rendu, et sans `git revert`.
 */
export const CHANTIERS: Record<string, Chantier> = {
  'planning-grille-v2': {
    nom: 'Planning — la grille « Planning Cabinet V2 »',
    item: 'B-153',
    depuis: '2026-10-08',
    diffusion: {
      bacASableSeulement:
        'Renouveau visuel demande par MiKL le 08/10, le jour meme ou la version ' +
        'precedente (B-145) a du etre revertee parce qu elle etait partie chez le ' +
        'client sans garde-fou. Il reste au bac a sable jusqu a sa recette.',
    },
  },
}

/** Le contexte dont depend l'ouverture d'un chantier. */
export interface ContexteDiffusion {
  /** Le cabinet de la personne connectee est-il marque bac a sable ? */
  estBacASable: boolean
}

/**
 * Ce chantier est-il ouvert a ce cabinet ?
 *
 * ⚠️ LE DEFAUT EST FERME, DANS TOUS LES CAS DE DOUTE — chantier inconnu, faute
 *    de frappe, contexte illisible. C'est l'inverse du choix fait pour le ruban
 *    bac a sable (« en cas de doute, on n'affiche rien »), et c'est voulu : le
 *    risque n'est pas le meme. Un ruban manquant est un confort perdu ; un
 *    chantier ouvert par erreur, c'est l'incident du 08/10.
 */
export function chantierOuvert(id: string, ctx: ContexteDiffusion): boolean {
  const chantier = CHANTIERS[id]
  if (!chantier) return false
  if ('tousLesCabinets' in chantier.diffusion) return true
  return ctx.estBacASable === true
}
