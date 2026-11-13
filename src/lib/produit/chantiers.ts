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
      tousLesCabinets:
        'Recette au bac a sable du 08/10 au 03/11. Bascule decidee par MiKL le ' +
        '03/11 (B-185) : « tout a fini d etre developpe, on peut lancer la ' +
        'bascule ». Photographie du Val d Allier prise juste avant (B-184).',
    },
  },
  'reglages-v2': {
    nom: 'Réglages — l’onglet refondu (sommaire et cinq sections)',
    item: 'B-202',
    depuis: '2026-11-10',
    diffusion: {
      tousLesCabinets:
        'Maquette validee par MiKL le 10/11 (docs/maquettes/B-202-reglages.html), ' +
        'recette au bac a sable du 10 au 11/11. Bascule decidee par MiKL le 11/11 : ' +
        '« c est bon fais la bascule ». Aucune donnee touchee : seul le dessin change.',
    },
  },
  'boutons-relief': {
    nom: 'Boutons — le système « Relief » (une seule feuille pour tous les boutons)',
    item: 'B-206',
    depuis: '2026-11-12',
    diffusion: {
      bacASableSeulement:
        'Direction A choisie par MiKL le 12/11 sur docs/maquettes/B-206-boutons.html. ' +
        'Branchement ecran par ecran (lot 1 : Planning, socle .btn, boutons des fenetres). ' +
        'Le Val d Allier ne bascule que sur validation de MiKL (B-206a). Ce chantier ne ' +
        'rend aucun composant : il pose l attribut data-boutons sur la coquille V2, et ' +
        'styles/v2-boutons.css ne s applique que sous cet attribut.',
    },
  },
  'feries-journees': {
    nom: 'Journées — l’interrupteur « le cabinet ouvre les jours fériés »',
    item: 'B-210',
    depuis: '2026-11-13',
    diffusion: {
      bacASableSeulement:
        'MiKL le 13/11 : « je veux juste que le bac a sable affiche tjrs les dernieres ' +
        'versions et la vetovaldalier affiche une autre version d organisation ». ' +
        '⚠️ CE CHANTIER NE PORTE QUE L ECRAN, PAS LE COMPORTEMENT, et la distinction ' +
        'est le coeur de la decision : le remplissage saute les jours feries chez TOUS ' +
        'les cabinets, parce que c est la cliente du Val d Allier elle-meme qui l a ' +
        'demande (« personne ne travaille en journee lors d un jour ferie »). Fermer ' +
        'ce chantier lui retirerait ce qu elle a demande. Ce qui attend la bascule, ' +
        'c est la CARTE de reglage, posee dans un onglet Organisation que B-204 doit ' +
        'encore refondre. Tant qu elle est fermee, le Val d Allier a le comportement ' +
        'au defaut voulu (ferme) et ne peut pas le changer a l ecran : acceptable, ' +
        'puisque ce defaut EST sa demande.',
    },
  },
  'equite-grand-livre': {
    nom: 'Equite — le grand livre (cumul de toutes les periodes, 3 dimensions)',
    item: 'B-196',
    depuis: '2026-11-13',
    diffusion: {
      bacASableSeulement:
        'Lot 0 du chantier « repenser la generation » (strategie du 10/11). Feu vert ' +
        'de MiKL le 13/11 sur le tableau des lecteurs. ⚠️ CONTRAIREMENT AUX AUTRES ' +
        'CHANTIERS, celui-ci ne change pas un DESSIN mais le COMPORTEMENT DU MOTEUR : ' +
        'ferme, le report reste celui d avant (ecart_we de la seule periode ' +
        'precedente) ; ouvert, il cumule toutes les periodes de gardes closes sur ' +
        'trois dimensions, plafonne a 1 week-end / 2 gardes de semaine / 1 ferie par ' +
        'periode. Le repli est donc le comportement ACTUEL, pas l absence de report : ' +
        'fermer ce chantier ne doit RIEN retirer au Val d Allier. Bascule apres recette ' +
        'de MiKL sur une generation reelle au bac a sable.',
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
export function chantierOuvert(
  id: string,
  ctx: ContexteDiffusion,
  catalogue: Record<string, Chantier> = CHANTIERS,
): boolean {
  const chantier = catalogue[id]
  if (!chantier) return false
  if ('tousLesCabinets' in chantier.diffusion) return true
  return ctx.estBacASable === true
}
