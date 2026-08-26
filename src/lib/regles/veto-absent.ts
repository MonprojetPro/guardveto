// ============================================================
// GUARDVETO — Nommer un vétérinaire qui n'est plus dans l'équipe
// ============================================================
// MODULE VOLONTAIREMENT SANS AUCUN IMPORT.
//
// Il est lu par le catalogue de briques (`engine/briques/catalogue.ts`) ET par
// `lib/regles/libelle.ts`, qui lui-même importe le catalogue. Poser la
// constante dans `libelle.ts` créait donc un cycle catalogue → libelle →
// catalogue : TypeScript ne dit rien, mais à l'exécution l'un des deux modules
// s'initialise avant l'autre et la constante y vaut `undefined` — on aurait
// affiché « en même temps que undefined » à la place de l'identifiant, soit un
// correctif pire que le défaut.
//
// LE DÉFAUT D'ORIGINE, signalé par MiKL le 2026-08-26 sur une capture :
//
//     « n'est jamais de garde en même temps que
//       00000000-0000-0000-0000-000000000005 »
//
// Six endroits fabriquaient chacun leur repli quand une règle désigne un
// vétérinaire retiré de l'équipe — cinq affichaient l'IDENTIFIANT TECHNIQUE
// (`?? id`), un affichait `'?'`. Six copies d'un même choix, déjà divergentes.
//
// Le plus gênant n'est pas la laideur. La phrase juste au-dessus, dans le même
// bandeau, sait déjà le dire correctement — « Une règle concerne un
// vétérinaire qui a été retiré de l'équipe » (`engine/pre-vol.ts`).
// L'application a donc DEUX vocabulaires pour la même situation, à trois lignes
// d'écart : elle explique le problème en français, puis le renomme en code
// machine. Un identifiant ne dit rien à personne, ne se cherche pas, et fait
// passer un simple départ d'équipe pour une panne.
// ============================================================

/** Le seul repli admis quand un identifiant de vétérinaire ne résout plus. */
export const VETO_RETIRE = 'un vétérinaire retiré de l’équipe'

/**
 * Construit la fonction `nomVeto` attendue par le catalogue de briques, avec ce
 * repli. À utiliser partout plutôt que de réécrire `?? id` une septième fois.
 *
 * `equipe` accepte n'importe quelle liste porteuse d'un `id` et d'un `prenom` :
 * les écrans, le moteur et le pré-vol n'ont pas le même type de vétérinaire, et
 * les faire converger ici ne créerait qu'un import de plus — au prix du cycle
 * que ce module existe précisément pour éviter.
 */
export function nomVetoOuRetire(
  equipe: readonly { id: string; prenom: string }[],
): (id: string) => string {
  return (id: string) => equipe.find((v) => v.id === id)?.prenom ?? VETO_RETIRE
}
