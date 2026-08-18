// ============================================================
// GUARDVETO — L'interrupteur de l'import d'ancien planning
// ============================================================
// L'IMPORT EST VOLONTAIREMENT ÉTEINT. Ce n'est pas une panne, ni une dette :
// c'est une décision produit de MiKL, prise le 2026-08-18.
//
// POURQUOI. La fonctionnalité marchait sur des documents simples et cassait sur
// les vrais. L'export réel du cabinet Val d'Allier — 8 456 événements sur neuf
// ans — a montré ce qui manquait pour la rendre automatique et fiable :
//
//   • 20 % des lignes d'un agenda de cabinet ne sont pas des gardes (réunions,
//     vacances, formations, « pas de garde svp »), sur 952 libellés différents ;
//   • les gardes s'écrivent en sigles maison (« AS1 », « Man j », « Victor 2 »)
//     dont la convention est PROPRE À CHAQUE CABINET — la coder en dur ferait du
//     sur-mesure Val d'Allier dans un produit qui doit rester générique ;
//   • un quart des gardes appartient à d'anciens confrères, et certains sigles
//     sont irréductiblement ambigus (« M1 » : Mélanie, Manon ou Marie ?) — seul
//     quelqu'un qui connaît le cabinet peut trancher.
//
// Conclusion de MiKL : « j'ai peur que ce soit trop complexe à mettre en
// automatique ». La reprise d'historique devient donc une PRESTATION
// D'ACCOMPAGNEMENT qu'il réalise lui-même à la configuration initiale, et une
// option payante pour les cabinets qui la souhaitent.
//
// CE QUI EST GARDÉ, ET POURQUOI. Rien n'est supprimé : la lecture, l'écran de
// validation ligne par ligne et l'écriture restent entiers, en état de marche,
// derrière cet unique interrupteur. Le jour où la convention d'écriture saura se
// déduire au lieu de se coder, il suffira de repasser cette constante à `true`.
//
// CE QUE L'INTERRUPTEUR COUPE. Les deux bouts, pas seulement l'écran :
//   ① le bouton disparaît (`ImportPlanningLanceur`) ;
//   ② le serveur refuse (`contexteAdmin`, le passage obligé de la route de
//      lecture ET de l'action d'écriture).
// Masquer le bouton en laissant la route ouverte n'aurait rien désactivé du
// tout — la porte serait restée franchissable par qui la connaît.
//
// Détail de la décision : `docs/decisions-produit.md`.
// ============================================================

/** L'import d'ancien planning est-il proposé aux cabinets ?
 *
 *  `false` depuis le 2026-08-18 — reprise d'historique assurée en prestation
 *  d'accompagnement. Repasser à `true` réactive la chaîne complète. */
export const IMPORT_PLANNING_ACTIF = false

/** Ce que le serveur répond quand on frappe à la porte éteinte. Une phrase qui
 *  dit la vérité — la reprise existe, elle passe juste par un humain — plutôt
 *  qu'un « non » sec qui ferait croire à une panne. */
export const IMPORT_PLANNING_ETEINT =
  "La reprise d’un ancien planning ne se fait pas depuis l’application : elle est réalisée avec toi lors de la configuration du cabinet. Prends contact pour qu’on la mette en place."
