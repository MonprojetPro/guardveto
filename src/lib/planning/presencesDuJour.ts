// ============================================================
// GUARDVETO — Les présences de journée, telles que la grille les dessine
// ============================================================
// B-150 / B-145 lot 2a. Le lot précédent a livré l'ÉCRITURE des présences
// (`presences-actions.ts`) sans la LECTURE : `grep -rn "presences_journee" src/`
// ne trouvait aucun écran le 07/10, et MiKL l'a vu avant moi — « on est
// d'accord que poser ça n'apparaît pas sur le planning actuel ? ». Poser 40
// présences les écrivait en base et aucun écran ne les montrait.
//
// Ce module est la moitié aval manquante. Il est PUR, et c'est la seule raison
// pour laquelle il est testable : aucun test de ce projet ne monte un composant
// React (B-144b, ni jsdom ni @testing-library). Une règle d'affichage qui ne
// vit que dans le JSX n'est jamais vérifiée — c'est ce qui a laissé passer le
// cadenas dessiné « ouvert » sur une base qui enregistrait parfaitement (04/09).
//
// ── CE QUI NE DOIT JAMAIS DISPARAÎTRE EN SILENCE ────────────────────────────
//
// Trois cas font qu'une présence écrite en base pourrait ne pas se dessiner :
// sa tranche a été retirée, sa tranche a été effacée, ou la personne n'est plus
// dans la liste active. Dans les trois, on AFFICHE et on le dit — jamais on ne
// masque. Masquer rendrait l'effectif du jour faux sans qu'une seule ligne
// l'explique, et un effectif faux sur un planning se lit comme une panne. C'est
// le même raisonnement que « une erreur Supabase avalée devient zéro ligne ».
// ============================================================

/** Une présence telle qu'elle sort de `presences_journee`. */
export interface PresenceLue {
  id: string
  periode_id: string
  veterinaire_id: string
  bloc_id: string
  /** `AAAA-MM-JJ`. */
  date: string
  /** La trame qui l'a posée. `null` = posée à la main. */
  trame_id: string | null
}

/** Une tranche horaire du cabinet, réduite à ce qui se dessine. */
export interface TranchePourGrille {
  id: string
  nom: string
  /** `HH:MM:SS`, tel que Postgres rend un `time`. */
  debut: string
  fin: string
  ordre: number
}

/** Une personne, réduite à ce qui se dessine. */
export interface PersonnePourGrille {
  id: string
  prenom: string
  couleur: string | null
}

/** Une présence prête à dessiner. */
export interface PresenceAffichee {
  /** L'identifiant de la LIGNE — c'est lui que `retirerPresence` attend (lot 2b). */
  id: string
  vetId: string
  prenom: string
  couleur: string | null
  /** Le nom de la tranche (« Matin »), ou un repli qui dit l'anomalie. */
  tranche: string
  /** « 8h–13h », ou une chaîne vide si la tranche est introuvable. */
  heures: string
  /** Rang d'affichage, repris de l'ordre voulu par l'admin. */
  ordre: number
  /** Elle vient d'une trame : la retirer à la main ne tiendra pas une réapplication. */
  deLaTrame: boolean
  /**
   * Quelque chose ne colle pas et il faut que ça se voie : tranche retirée,
   * tranche introuvable, ou personne absente de la liste active. La phrase est
   * déjà en français, affichable telle quelle.
   */
  anomalie: string | null
}

/** Ce que la grille sait d'un jour, côté journée. */
export interface JourneeAffichee {
  presences: PresenceAffichee[]
  /**
   * Combien de PERSONNES distinctes sont là ce jour-là.
   *
   * ⚠️ PAS le nombre de lignes. Quelqu'un inscrit le matin ET l'après-midi
   *    produit deux présences et reste une seule personne — compter les lignes
   *    afficherait « 8 présents » pour 5 personnes, un chiffre faux sur l'écran
   *    dont c'est la raison d'être. Le design 3a l'appelle « N présents » : ce
   *    sont bien des gens.
   */
  personnes: number
}

/** `08:00:00` → `8h`, `13:30:00` → `13h30`. */
export function heureCourte(time: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? '')
  if (!m) return ''
  const h = Number(m[1])
  if (Number.isNaN(h)) return ''
  return m[2] === '00' ? `${h}h` : `${h}h${m[2]}`
}

/** « 8h–13h ». Vide si l'une des deux bornes est illisible. */
export function plageCourte(debut: string, fin: string): string {
  const d = heureCourte(debut)
  const f = heureCourte(fin)
  return d && f ? `${d}–${f}` : ''
}

/**
 * Compose, par date, les présences à dessiner.
 *
 * Les tranches INACTIVES sont passées comme les autres : une tranche retirée ne
 * reçoit plus de nouvelles présences (`validerPresence`), mais celles déjà
 * posées dessus survivent — c'est écrit dans le type `BlocJournee`. Les écarter
 * ici les ferait disparaître de l'écran tout en les laissant en base.
 */
export function composerPresencesParJour(
  presences: readonly PresenceLue[],
  tranches: readonly TranchePourGrille[],
  personnes: readonly PersonnePourGrille[],
  /** Les tranches retirées, par identifiant — pour le dire, pas pour masquer. */
  tranchesRetirees: ReadonlySet<string> = new Set(),
): Map<string, JourneeAffichee> {
  const parTranche = new Map(tranches.map((t) => [t.id, t]))
  const parPersonne = new Map(personnes.map((p) => [p.id, p]))

  const parJour = new Map<string, PresenceAffichee[]>()

  for (const p of presences) {
    const t = parTranche.get(p.bloc_id)
    const v = parPersonne.get(p.veterinaire_id)

    // Une seule anomalie est annoncée, la plus parlante d'abord : si la tranche
    // a disparu, dire en plus que la personne est inactive n'ajoute rien à ce
    // que l'admin doit faire.
    let anomalie: string | null = null
    if (!t) anomalie = 'Tranche horaire introuvable — cette présence n’a plus de créneau.'
    else if (tranchesRetirees.has(t.id)) anomalie = `La tranche « ${t.nom} » a été retirée.`
    else if (!v) anomalie = 'Cette personne ne fait plus partie de l’équipe active.'

    const ligne: PresenceAffichee = {
      id: p.id,
      vetId: p.veterinaire_id,
      prenom: v?.prenom ?? 'Personne retirée',
      couleur: v?.couleur ?? null,
      tranche: t?.nom ?? 'Tranche inconnue',
      heures: t ? plageCourte(t.debut, t.fin) : '',
      // Une tranche introuvable passe en DERNIER, pas en premier : l'ordre 0
      // l'aurait hissée en tête de case, là où elle n'est qu'une anomalie.
      ordre: t?.ordre ?? Number.MAX_SAFE_INTEGER,
      deLaTrame: p.trame_id !== null,
      anomalie,
    }

    const liste = parJour.get(p.date)
    if (liste) liste.push(ligne)
    else parJour.set(p.date, [ligne])
  }

  const resultat = new Map<string, JourneeAffichee>()
  for (const [date, liste] of parJour) {
    liste.sort(
      (a, b) =>
        a.ordre - b.ordre ||
        a.prenom.localeCompare(b.prenom, 'fr') ||
        a.id.localeCompare(b.id),
    )
    resultat.set(date, {
      presences: liste,
      personnes: new Set(liste.map((l) => l.vetId)).size,
    })
  }
  return resultat
}

/**
 * Le résumé d'une case repliée : « 5 présents », et qui manque.
 *
 * ⚠️ AUCUN MINIMUM D'EFFECTIF. MiKL l'a écarté le 06/10 — « c'est lui qui a
 *    fait du zèle ». Tout l'affichage rouge « 2/3 » du prototype en dépendait,
 *    et la donnée n'existe nulle part dans le schéma (mesuré). Le chiffre est
 *    donc NEUTRE : il informe, il ne juge pas.
 */
export function resumePresences(jour: JourneeAffichee | undefined): string {
  const n = jour?.personnes ?? 0
  if (n === 0) return ''
  return `${n} présent${n > 1 ? 's' : ''}`
}
