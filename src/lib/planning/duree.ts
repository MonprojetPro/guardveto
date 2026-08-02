// ============================================================
// GUARDVETO — La durée d'un planning
// ============================================================
// Un planning de gardes se compte en SEMAINES ENTIÈRES : il démarre un lundi
// et se termine un dimanche. C'est ce que l'assistant de génération demande
// à l'admin (« il dure 12 semaines ») plutôt que deux dates à compter soi-même.
//
// Ces trois fonctions sont ici, et pas dans le composant, parce qu'elles
// portent une règle du cabinet — 12 semaines l'hiver, 17 l'été — et qu'une
// erreur d'un jour sur la borne de fin passerait inaperçue à l'écran tout en
// décalant toute la génération.
// ============================================================

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Un planning démarre un lundi (le moteur raisonne en semaines pleines). */
export function estLundi(iso: string): boolean {
  if (!ISO.test(iso)) return false
  return new Date(`${iso}T12:00:00Z`).getUTCDay() === 1
}

/**
 * Durée proposée par défaut selon le mois de départ : 17 semaines pour l'été
 * (mai → août), 12 le reste de l'année. Le découpage des mois est le MÊME que
 * `detecterSaison` côté serveur — s'ils divergeaient, l'écran proposerait une
 * durée d'été à un planning que la base enregistrerait en hiver.
 */
export function dureeProposee(dateDebut: string): number {
  if (!ISO.test(dateDebut)) return 12
  const mois = new Date(`${dateDebut}T12:00:00Z`).getUTCMonth() + 1
  return mois >= 5 && mois <= 8 ? 17 : 12
}

/**
 * Dernier jour d'un planning de N semaines démarré le lundi donné : le dimanche
 * soir, donc `debut + N×7 − 1` jour. Le « −1 » est tout l'enjeu : sans lui, le
 * planning mordrait sur le lundi du suivant et les deux se chevaucheraient —
 * refus à la création, sans que personne comprenne pourquoi.
 *
 * Renvoie `null` si la date est mal formée ou la durée nulle/négative.
 */
export function finApres(dateDebut: string, semaines: number): string | null {
  if (!ISO.test(dateDebut) || !Number.isFinite(semaines) || semaines < 1) return null
  const d = new Date(`${dateDebut}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + Math.floor(semaines) * 7 - 1)
  return d.toISOString().slice(0, 10)
}
