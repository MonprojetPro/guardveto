// ============================================================
// GUARDVETO — Utilitaires de dates pour le moteur
// ============================================================

import type { JourSemaine, Saison, CalendrierResolu, PlanningPartiel, AttributionGarde } from './types'

// ── Helpers de base ──────────────────────────────────────

/**
 * Numéro ISO de la semaine (1-53).
 *
 * ⚠️ B-209 — CE CALCUL A ÉTÉ FAUX SUR TOUTE L'ANNÉE 2027, et la formule fautive
 *    était recopiée dans `validerPlanning.ts`. Ce qu'elle faisait :
 *
 *      Math.ceil(((jeudi - 1er janvier) / 86400000 + 1) / 7)
 *
 *    Le jeudi était pris à 12:00 (convention du projet) mais le 1er janvier à
 *    00:00 : la soustraction portait une demi-journée de trop. `Math.ceil`
 *    l'absorbe la plupart du temps — sauf quand le jeudi tombe pile sur un
 *    multiple de 7 jours, où elle fait basculer au numéro SUIVANT. C'est le cas
 *    de toutes les années qui commencent un vendredi : 362 jours de 2027 étaient
 *    numérotés un cran trop haut, donc de PARITÉ INVERSÉE. Anne-Sophie a reçu
 *    ses repos de semaine paire pendant la semaine 1, impaire (retour du 13/11).
 *
 * 🔒 CE QUI REND LA VERSION CI-DESSOUS JUSTE, et pas seulement « corrigée » :
 *    elle ne compte plus des jours depuis le 1er janvier — une date qui n'est
 *    pas forcément dans la semaine 1. Elle compte des SEMAINES ENTIÈRES entre
 *    deux jeudis, et la définition ISO dit que le jeudi de la semaine du
 *    4 janvier est le jeudi de la semaine 1. Les deux bornes sont à la même
 *    heure : l'écart est un multiple exact de 7 jours, donc `Math.round` est
 *    exact et non « assez proche ».
 *
 *    C'est l'algorithme que `GrilleSemainesV2` appliquait déjà de son côté —
 *    d'où le symptôme : l'écran affichait « semaine 1 » pendant que le
 *    remplissage appliquait la semaine 2. Les deux appelants passent désormais
 *    par ici. Une convention recopiée n'est pas une convention.
 */
export function numeroSemaine(date: string): number {
  const d = new Date(date + 'T12:00:00Z')
  // Le jeudi de la semaine : c'est lui qui décide de quelle ANNÉE la semaine
  // relève, et donc de son numéro (une semaine à cheval sur deux années
  // appartient entièrement à celle de son jeudi).
  const jourIndex = (d.getUTCDay() + 6) % 7 // 0 = lundi … 6 = dimanche
  d.setUTCDate(d.getUTCDate() - jourIndex + 3)

  // Le 4 janvier est TOUJOURS dans la semaine 1 (définition ISO) : le jeudi de
  // sa semaine est donc le jeudi de la semaine 1 de cette année-là.
  const premierJeudi = new Date(Date.UTC(d.getUTCFullYear(), 0, 4, 12))
  premierJeudi.setUTCDate(
    premierJeudi.getUTCDate() - ((premierJeudi.getUTCDay() + 6) % 7) + 3,
  )

  return 1 + Math.round((d.getTime() - premierJeudi.getTime()) / (7 * 86400000))
}

/**
 * Semaine impaire (numéro ISO % 2 !== 0).
 *
 * ⛔ NE PAS « CORRIGER » CET APPEL EN `estSemaineImpaireAncrée`.
 *
 *    Cette fonction a longtemps porté un `@deprecated` invitant à le faire. Il a
 *    été retiré le 13/11 (B-209) parce qu'il était un piège : suivre ce conseil
 *    dans UN SEUL des quatre appelants recrée exactement la divergence que
 *    B-209 vient de supprimer — « semaines impaires » voudrait dire une chose
 *    dans les règles de garde et une autre dans la semaine type de journée, et
 *    rien ne lèverait d'erreur. Le planning décalerait d'une semaine, en
 *    silence, jusqu'à ce qu'un cabinet le lise.
 *
 *    Appelants, au 13/11 : `hard-constraints.ts` (repos fixe et alternance sans
 *    ancre), `validation/validerPlanning.ts`, `lib/journee/trames.ts`.
 *
 * ⚠️ LA CONTREPARTIE, CONNUE ET ASSUMÉE : sans ancre, le numéro vient du
 *    calendrier. Au passage d'une année à 53 semaines ISO, deux semaines
 *    impaires se suivent une fois (le 2026-12-28 est en semaine 53, le
 *    2027-01-04 en semaine 1). Ce n'est pas un défaut de calcul, c'est la
 *    convention. La changer est une décision produit, pas une correction : elle
 *    se prend avec MiKL, et elle fait bouger les gardes ET les journées DANS LE
 *    MÊME COMMIT.
 *
 * ⚠️ TROU CONNU, NON FERMÉ (B-209a) : une date malformée rend `NaN`, et
 *    `NaN % 2 !== 0` vaut `true`. N'importe quelle saisie invalide est donc
 *    déclarée « semaine impaire » sans erreur ni trace. Épinglé par un test
 *    dans `src/engine/__tests__/utils.test.ts` pour que ce soit visible plutôt
 *    que silencieux.
 */
export function estSemaineImpaire(date: string): boolean {
  return numeroSemaine(date) % 2 !== 0
}

/**
 * Calcule si une semaine est "impaire" relativement à une ancre.
 * L'ancre se recale à chaque début de vacances scolaires (évite le bug semaine ISO 53).
 *
 * @param date - Date ISO yyyy-mm-dd à tester
 * @param ancre - Date ISO du début de la période (lundi de référence)
 * @param vacancesScolaires - Plages de vacances pour les recalages
 *
 * @example
 * // Sans vacances : comptage simple depuis l'ancre.
 * // ⚠️ Cet exemple annonçait « 118 jours → semaine 16 → paire (false) » et
 * //    c'était FAUX : la fonction ramène les deux bornes au LUNDI de leur
 * //    semaine, donc du lundi 2026-08-31 au lundi 2026-12-28 il y a 119 jours,
 * //    soit 17 semaines, soit IMPAIRE. Corrigé le 13/11 (B-209) après
 * //    exécution ; le test `utils.test.ts` attendait déjà `true`.
 * estSemaineImpaireAncrée('2026-12-28', '2026-09-01', []) // 17 semaines → impaire (true)
 *
 * // Avec vacances : l'ancre se recale au début des vacances
 * estSemaineImpaireAncrée('2026-11-02', '2026-09-01', [{ debut: '2026-10-17', fin: '2026-10-31' }])
 * // ancre effective = '2026-10-17', diff = ~2 semaines → paire
 */
export function estSemaineImpaireAncrée(
  date: string,
  ancre: string,
  vacancesScolaires: Array<{ debut: string; fin: string }>
): boolean {
  // ⚠️ CORRECTIF parité intra-semaine (2026-06) :
  // La parité est une propriété de la SEMAINE entière (une semaine est paire OU
  // impaire — pas certains de ses jours). On RAMÈNE donc date, ancre et chaque
  // recalage de vacances au LUNDI de leur semaine avant de compter les semaines.
  // Sans cette normalisation, une ancre tombant un mardi (ex. 2026-09-01)
  // coupait les semaines en deux : le lundi et le samedi d'une même semaine
  // recevaient des parités OPPOSÉES → Anne-Sophie pouvait être déclarée dispo
  // un jour et indispo un autre de la même semaine (gardes incohérentes
  // observées en semaines ISO 28/29/31/32).
  const ancreLundi = lundiDeSemaine(ancre)
  const dateLundi = lundiDeSemaine(date)

  // Trouver l'ancre effective = dernier début de vacances AVANT ou ÉGAL à la date
  // et STRICTEMENT après l'ancre initiale (pour avancer l'ancre uniquement).
  // On compare la date de début de vacances brute (chevauchement), mais on
  // ancre sur le LUNDI de cette semaine de vacances.
  let ancreEffectiveLundi = ancreLundi
  for (const v of vacancesScolaires) {
    const vLundi = lundiDeSemaine(v.debut)
    if (v.debut <= date && vLundi > ancreEffectiveLundi) {
      ancreEffectiveLundi = vLundi
    }
  }

  // Nombre de semaines pleines entre deux lundis (différence multiple de 7 jours).
  // On arrondit (Math.round) pour neutraliser tout résidu de fuseau/DST.
  const msParSemaine = 7 * 24 * 60 * 60 * 1000
  const diffMs =
    new Date(dateLundi + 'T12:00:00Z').getTime() -
    new Date(ancreEffectiveLundi + 'T12:00:00Z').getTime()
  const diffSemaines = Math.round(diffMs / msParSemaine)

  return diffSemaines % 2 !== 0
}

/** Jour de la semaine (0=dimanche … 6=samedi) */
export function jourIndex(date: string): number {
  return new Date(date + 'T12:00:00Z').getUTCDay()
}

/** Nom du jour en français */
export function jourDeLaSemaine(date: string): JourSemaine {
  const jours: JourSemaine[] = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
  return jours[jourIndex(date)]
}

/** Lundi de la semaine contenant la date */
export function lundiDeSemaine(date: string): string {
  const d = new Date(date + 'T12:00:00Z')
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}

/** Vendredi de la semaine contenant la date */
export function vendrediDeSemaine(date: string): string {
  const lundi = lundiDeSemaine(date)
  const d = new Date(lundi + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 4)
  return d.toISOString().split('T')[0]
}

/** Samedi de la semaine contenant la date */
export function samediDeSemaine(date: string): string {
  const lundi = lundiDeSemaine(date)
  const d = new Date(lundi + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 5)
  return d.toISOString().split('T')[0]
}

/** Ajouter N jours à une date ISO */
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

/** Comparer deux dates ISO */
export function dateEntre(date: string, debut: string, fin: string): boolean {
  return date >= debut && date <= fin
}

/**
 * Les JOURS calendaires qu'une ligne de `gardes` (V1) occupe réellement.
 *
 * 🔑 UNE SEULE CONVENTION, ICI. Un week-end est daté du SAMEDI mais occupe le
 *    calendrier du vendredi soir au dimanche : `gardes` ne porte pas de ligne
 *    vendredi, l'équipe du week-end le tient. Trois lecteurs avaient besoin de
 *    cette liste (l'historique des fêtes, le conflit de congé, et la vue SQL qui
 *    la refait en SQL) — la recopier une quatrième fois, c'est ce que ce projet
 *    a déjà payé sous le nom « une convention recopiée trois fois n'est pas une
 *    convention » (B-130b).
 *
 * ⚠️ N'EST PAS la convention de `syncAttributions/joursImpactesGarde`, qui
 *    s'arrête au samedi. Les deux diffèrent volontairement : aligner l'une sur
 *    l'autre sans comprendre pourquoi casserait la synchro V2.
 */
export function datesCouvertesParGardeV1(date: string, type: string): string[] {
  return type === 'weekend' ? [addDays(date, -1), date, addDays(date, 1)] : [date]
}

// ── Saisons ─────────────────────────────────────────────

/** Premier lundi de mai d'une année */
function premierLundiMai(annee: number): string {
  for (let j = 1; j <= 7; j++) {
    const d = new Date(Date.UTC(annee, 4, j)) // mai = 4
    if (d.getUTCDay() === 1) return d.toISOString().split('T')[0]
  }
  return `${annee}-05-01`
}

/** Dernier dimanche d'août d'une année */
function dernierDimancheAout(annee: number): string {
  for (let j = 31; j >= 25; j--) {
    const d = new Date(Date.UTC(annee, 7, j)) // août = 7
    if (d.getUTCDay() === 0) return d.toISOString().split('T')[0]
  }
  return `${annee}-08-31`
}

/** La date est-elle en saison été ? */
export function estEnEte(date: string): boolean {
  const annee = parseInt(date.substring(0, 4))
  return dateEntre(date, premierLundiMai(annee), dernierDimancheAout(annee))
}

export function getSaison(date: string): Saison {
  return estEnEte(date) ? 'ete' : 'hiver'
}

// ── Jours fériés français ────────────────────────────────

function calculerPaques(annee: number): Date {
  // Algorithme de Meeus/Jones/Butcher
  const a = annee % 19
  const b = Math.floor(annee / 100)
  const c = annee % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mois = Math.floor((h + l - 7 * m + 114) / 31)
  const jour = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(annee, mois - 1, jour))
}

export function estJourFerie(date: string, calendrier?: CalendrierResolu): boolean {
  if (calendrier) return calendrier.feries.has(date)

  const annee = parseInt(date.substring(0, 4))
  const mmjj = date.substring(5) // MM-DD

  // Fériés fixes
  const fixes = ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25']
  if (fixes.includes(mmjj)) return true

  // Fériés mobiles (basés sur Pâques)
  const paques = calculerPaques(annee)
  const lundiPaques = new Date(paques); lundiPaques.setUTCDate(paques.getUTCDate() + 1)
  const ascension = new Date(paques); ascension.setUTCDate(paques.getUTCDate() + 39)
  const lundiPentecote = new Date(paques); lundiPentecote.setUTCDate(paques.getUTCDate() + 50)

  const mobiles = [lundiPaques, ascension, lundiPentecote].map(d => d.toISOString().split('T')[0])
  return mobiles.includes(date)
}

// ── Vacances scolaires France Zone C (Paris) ─────────────
// Données 2025-2026 (à mettre à jour chaque année)

const VACANCES_SCOLAIRES: Array<{ debut: string; fin: string; label: string }> = [
  { debut: '2025-10-18', fin: '2025-11-03', label: 'Toussaint 2025' },
  { debut: '2025-12-20', fin: '2026-01-05', label: 'Noël 2025-2026' },
  { debut: '2026-02-14', fin: '2026-03-02', label: 'Hiver 2026' },
  { debut: '2026-04-11', fin: '2026-04-27', label: 'Pâques 2026' },
  { debut: '2026-07-04', fin: '2026-08-31', label: 'Été 2026' },
  // 2026-2027
  { debut: '2026-10-17', fin: '2026-11-02', label: 'Toussaint 2026' },
  { debut: '2026-12-19', fin: '2027-01-04', label: 'Noël 2026-2027' },
  { debut: '2027-02-13', fin: '2027-03-01', label: 'Hiver 2027' },
  { debut: '2027-04-10', fin: '2027-04-26', label: 'Pâques 2027' },
  { debut: '2027-07-03', fin: '2027-08-31', label: 'Été 2027' },
]

export function estEnVacancesScolaires(date: string, calendrier?: CalendrierResolu): boolean {
  if (calendrier) return calendrier.vacancesScolaires.some(({ debut, fin }) => dateEntre(date, debut, fin))
  return VACANCES_SCOLAIRES.some(({ debut, fin }) => dateEntre(date, debut, fin))
}

/**
 * Dernière date couverte par la liste de vacances scolaires EN DUR (fallback
 * hors-DB). Au-delà, la liste est OBSOLÈTE : `estEnVacancesScolaires` sans
 * calendrier zone-aware renverra `false` pour des dates réellement en vacances,
 * ce qui fausse silencieusement les règles « repos sauf vacances ».
 */
export const VACANCES_FALLBACK_FIN = '2027-08-31'

/**
 * Le fallback en dur est-il obsolète pour couvrir une période finissant à
 * `dateFin` ? (true = la liste en dur ne couvre pas toute la période → il faut
 * alerter et/ou étendre la table `vacances_scolaires`.)
 *
 * N'est utile que sur le CHEMIN FALLBACK (aucun calendrier zone-aware résolu) :
 * appelé par les assembleurs d'input (loader / resoudreContexte) pour lever
 * l'alerte AU BON ENDROIT (période connue), jamais dans la fonction chaude
 * `estEnVacancesScolaires` (appelée par date → spam de logs).
 */
export function fallbackVacancesObsolete(dateFin: string): boolean {
  return dateFin > VACANCES_FALLBACK_FIN
}

// ── Fêtes de fin d'année ─────────────────────────────────

/**
 * Retourne true pour les 4 jours de fêtes de fin d'année :
 * 24-25 décembre (Noël) et 31 décembre - 1er janvier (Nouvel An).
 * Dec 25 et Jan 1 sont déjà des jours fériés officiels.
 * Dec 24 et Dec 31 sont des veilles de fête (soirs sensibles).
 */
export function estFeteFinAnnee(date: string): boolean {
  const mmjj = date.substring(5) // MM-DD
  return mmjj === '12-24' || mmjj === '12-25' || mmjj === '12-31' || mmjj === '01-01'
}

// ── Helpers planning ────────────────────────────────────

/** La date est-elle un week-end (sam ou dim) ? */
export function estWeekend(date: string): boolean {
  const j = jourIndex(date)
  return j === 0 || j === 6
}

// ── Lookback inter-périodes (#17 — vue étendue des règles de rythme) ──

/**
 * attributionsAvecContexte — vue ÉTENDUE d'un planning pour les seules règles
 * de RYTHME (R10, espacement_min, espacement_weekend, R3, au_plus_n fenêtre).
 *
 * À la jonction de deux périodes, ces règles doivent « voir » les gardes de la
 * FIN de la période précédente (le `contexteAnterieur`, ~10 jours de lookback)
 * pour ne pas laisser un véto enchaîner deux week-ends à cheval sur deux
 * périodes. On concatène donc les attributions figées antérieures DEVANT les
 * attributions courantes, et on ne fait consommer cette vue QUE par les
 * prédicats de rythme (jamais par la couverture, l'équité, R21/R22, etc.).
 *
 * Le lookback ne crée AUCUN slot, ne compte dans AUCUNE équité : il ne sert
 * qu'à juger les écarts / consécutivités.
 *
 * Distinction VOLONTAIRE `undefined` vs `[]` (leçon RG2) :
 *   • `undefined` / absent → repli HISTORIQUE : on renvoie le planning tel quel
 *     (référence identique → byte-identique, pas d'allocation superflue).
 *   • `[]` (donnée vide voulue) → on renvoie aussi le planning tel quel (aucune
 *     garde antérieure à ajouter) — même effet, mais l'intention est explicite.
 */
export function attributionsAvecContexte(
  planning: PlanningPartiel,
  contexteAnterieur?: AttributionGarde[],
): PlanningPartiel {
  // Absent OU vide → aucune extension (référence inchangée = byte-identique).
  if (!contexteAnterieur || contexteAnterieur.length === 0) return planning
  // Lookback DEVANT les attributions courantes. Les dates du lookback sont
  // strictement antérieures au début de la période (filtre par date côté
  // loader) → aucune collision (date, type) avec le planning courant.
  return { attributions: [...contexteAnterieur, ...planning.attributions] }
}

/** Vérifie si un véto est en congé validé à cette date */
export function estEnConge(
  vetId: string,
  date: string,
  congesParVet: Record<string, Array<{ date_debut: string; date_fin: string }>>
): boolean {
  const conges = congesParVet[vetId] ?? []
  return conges.some(({ date_debut, date_fin }) => dateEntre(date, date_debut, date_fin))
}
