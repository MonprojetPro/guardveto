// ============================================================
// GUARDVETO — Le lien qui mène DROIT sur une règle (`?focus=`)
// ============================================================
// L'écran Règles sait défiler jusqu'à un réglage et l'entourer d'un halo
// quand l'URL porte `?focus=<ancre>`. Ce module tient les deux bouts de ce
// contrat — la fabrication du lien et sa relecture — pour qu'ils ne puissent
// pas diverger.
//
// PLUSIEURS ANCRES (2026-08-03). Un point de pré-vol met souvent plusieurs
// règles en cause : « les limites cumulées de week-end » en désigne six d'un
// coup. N'en éclairer qu'une renverrait l'admin chercher les cinq autres à la
// main — exactement ce que le halo était censé supprimer. Les ancres se
// séparent donc par des virgules, et un id seul reste traité comme avant.
// ============================================================

/** L'écran des règles, ciblé sur zéro, une ou plusieurs règles. */
export function lienVersRegles(regleIds: string[], base = '/regles'): string {
  const ancres = regleIds.map((a) => a.trim()).filter(Boolean)
  if (ancres.length === 0) return base
  return `${base}?focus=${encodeURIComponent(ancres.join(','))}`
}

/**
 * Les ancres portées par `?focus=`. Défensif de bout en bout : une valeur
 * vide, des virgules en trop ou des espaces ne doivent jamais produire une
 * ancre fantôme — elle ne correspondrait à rien et le halo ne ferait rien,
 * mais le sélecteur CSS construit à partir d'elle, lui, serait invalide.
 */
export function ancresDeFocus(focus: string | null | undefined): string[] {
  if (!focus) return []
  return focus.split(',').map((a) => a.trim()).filter(Boolean)
}

/** Le libellé du bouton — il annonce COMBIEN de règles on va éclairer. */
export function libelleRenvoiRegles(nb: number, defaut = 'Ouvrir les règles'): string {
  if (nb <= 0) return defaut
  return nb > 1 ? `Voir les ${nb} règles en cause` : 'Voir la règle en cause'
}
