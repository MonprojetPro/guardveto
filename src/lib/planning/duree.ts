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
 * Le lundi de la semaine d'une date. `null` si la date est illisible.
 *
 * POURQUOI LE MOTEUR EXIGE UN LUNDI (question MiKL du 2026-08-03)
 * Ce n'est pas une contrainte d'interface : le solveur compte en semaines
 * PLEINES. Les rythmes (« 1 week-end sur N », les séries, les repos entre
 * gardes), le report d'équité et le lookback inter-périodes s'ancrent tous sur
 * le lundi (`lundisDePeriode` dans `engine/solver.ts` remonte au lundi de la
 * date de début). Un planning démarré un mercredi ferait donc calculer le
 * moteur à partir du lundi précédent — deux jours HORS de la période affichée,
 * qui pourraient déjà appartenir au planning d'avant.
 *
 * D'où le choix de CALER plutôt que de refuser : l'écran annonce le lundi
 * retenu, et personne n'a à connaître cette mécanique.
 */
export function lundiDeLaSemaine(iso: string): string | null {
  if (!ISO.test(iso)) return null
  const d = new Date(`${iso}T12:00:00Z`)
  // getUTCDay : dimanche = 0. On recule de 0 à 6 jours pour retomber sur lundi.
  const recul = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - recul)
  return d.toISOString().slice(0, 10)
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
