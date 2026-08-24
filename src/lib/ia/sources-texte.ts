// ============================================================
// GUARDVETO — La mise en mots des sources de Filou
// ============================================================
// Tenu À PART de `outils/sources.ts`, et ce n'est pas un rangement : ce dernier
// importe le CATALOGUE, donc les actions serveur, donc tout le serveur. La
// fenêtre de réponse est un composant client — elle ne peut pas le charger.
//
// Ici, rien que du texte pur : aucune lecture, aucun accès au catalogue. Les
// deux bouts de l'écran écrivent donc la même phrase, sans la recopier.
// ============================================================

/** « a », « a et b », « a, b et c ». Une virgule avant le dernier élément se
 *  lit comme une liste inachevée. */
export function enumerer(elements: string[]): string {
  if (elements.length === 0) return ''
  if (elements.length === 1) return elements[0]
  return `${elements.slice(0, -1).join(', ')} et ${elements[elements.length - 1]}`
}

/** Ce qu'on dit quand AUCUNE lecture n'a fondé la réponse.
 *
 *  Elle ne disparaît pas discrètement : une absence de mention se lirait comme
 *  « pas d'information », alors que c'est l'information la plus importante de
 *  la fenêtre. */
export const AUCUNE_LECTURE =
  "Filou n’a consulté aucune donnée du cabinet pour cette réponse — vérifie avant de t’y fier."

/** La ligne complète à afficher sous une réponse fondée. */
export function phraseDApres(sources: string[]): string {
  return `D’après ${enumerer(sources)}.`
}
