// ============================================================
// GUARDVETO — Les 11 couleurs d'événement Google Agenda
// ============================================================
// Un événement Google Agenda n'accepte pas une couleur hexadécimale libre
// (contrairement au véto dans `src/lib/couleurs.ts`) : `colorId` prend une
// valeur fermée de '1' à '11', et c'est Google qui décide de la teinte
// exacte derrière chaque id.
//
// ⚠️ RÉPLI, PAS SOURCE DE VÉRITÉ. Les hexadécimaux ci-dessous sont recopiés
// à la main depuis la doc Google (état 2026) pour afficher un aperçu SANS
// appel réseau — un formulaire de config ne va pas interroger l'API à
// chaque frappe. La vraie source d'autorité, c'est `colors.get` de l'API
// Google Calendar : si Google fait évoluer sa palette, cette liste devient
// fausse silencieusement. Un écran qui doit être fidèle à 100% (pas un
// simple aperçu) doit appeler `colors.get`, pas lire ce fichier.
// ============================================================

export interface CouleurGoogle {
  /** La valeur que Google attend dans `colorId`. Toujours une chaîne. */
  id: string
  /** Le nom officiel Google (documentation, support). */
  nomGoogle: string
  /** Le libellé que l'admin du cabinet lit à l'écran, en français. */
  libelleFr: string
  /** Aperçu hors ligne — voir l'avertissement de repli ci-dessus. */
  hex: string
}

export const COULEURS_GOOGLE: readonly CouleurGoogle[] = [
  { id: '1', nomGoogle: 'Lavender', libelleFr: 'Lavande', hex: '#7986CB' },
  { id: '2', nomGoogle: 'Sage', libelleFr: 'Sauge', hex: '#33B679' },
  { id: '3', nomGoogle: 'Grape', libelleFr: 'Raisin', hex: '#8E24AA' },
  { id: '4', nomGoogle: 'Flamingo', libelleFr: 'Flamant', hex: '#E67C73' },
  { id: '5', nomGoogle: 'Banana', libelleFr: 'Banane', hex: '#F6BF26' },
  { id: '6', nomGoogle: 'Tangerine', libelleFr: 'Mandarine', hex: '#F4511E' },
  { id: '7', nomGoogle: 'Peacock', libelleFr: 'Paon', hex: '#039BE5' },
  { id: '8', nomGoogle: 'Graphite', libelleFr: 'Graphite', hex: '#616161' },
  { id: '9', nomGoogle: 'Blueberry', libelleFr: 'Myrtille', hex: '#3F51B5' },
  { id: '10', nomGoogle: 'Basil', libelleFr: 'Basilic', hex: '#0B8043' },
  { id: '11', nomGoogle: 'Tomato', libelleFr: 'Tomate', hex: '#D50000' },
] as const

const IDS_VALIDES = new Set(COULEURS_GOOGLE.map((c) => c.id))

/** Le portier — sur le modèle de `hexValide` dans `src/lib/couleurs.ts`. */
export function estColorIdValide(v: string | null | undefined): boolean {
  return typeof v === 'string' && IDS_VALIDES.has(v)
}

/** Retrouve la fiche complète d'un `colorId`, ou `undefined` si invalide. */
export function couleurGooglePar(id: string | null | undefined): CouleurGoogle | undefined {
  return COULEURS_GOOGLE.find((c) => c.id === id)
}
