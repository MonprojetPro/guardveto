// ============================================================
// GUARDVETO — « Antoine 27 → 25 », AVANT d'appliquer (B-122 lot 1)
// ============================================================
// POURQUOI CE FICHIER EXISTE — MiKL, le 2026-09-15 :
//
//   « Ça doit apparaître AU COMPTEUR également, AVANT qu'il fasse le
//    changement, comme ça elle sait ce que ça implique de tout faire. C'est
//    visuel, c'est clair, c'est ergonomique. »
//
// C'est le cœur du chantier. Le rapport de Filou met six lignes à expliquer
// qu'une réorganisation soulage Antoine ; « 27 → 25 » le dit d'un coup d'œil.
// L'admin n'a plus à croire un paragraphe, elle lit un chiffre.
//
// ── CE QUE CE FICHIER NE FAIT SURTOUT PAS ───────────────────────────────────
//
// ⚠️ IL NE RECOMPTE JAMAIS LE PLANNING. La source de vérité des compteurs est
//    la vue `compteurs_gardes`, et recompter tout ici créerait une SECONDE
//    façon de compter — qui finirait par diverger de la première, en silence.
//    On part des compteurs réels et on n'applique QUE l'effet du mouvement.
//    Le chiffre affiché est donc « ce que la vue dira », pas « ce que je
//    pense qu'elle dira ».
//
// ⚠️ IL NE TRADUIT PAS LES TYPES LUI-MÊME. `mapTypeGardeEnDb` est LA traduction
//    du projet (moteur → table `gardes`) ; la réécrire ici serait la troisième
//    table de correspondance sur le même sujet.
//
// ── LE PIÈGE, ET IL EST RÉEL ────────────────────────────────────────────────
//
// `vendredi_soir` N'EST JAMAIS ÉCRIT dans `gardes` : il est fusionné dans le
// week-end (`ecrirePlanningV1.ts`, et vérifié en base le 15/09 — 0 garde un
// vendredi sur 120). Or les propositions de Filou couplent presque toujours le
// vendredi et le samedi, le couple étant imposé par les règles du cabinet.
//
// Compter les deux annoncerait « Antoine −2 » pour UN SEUL week-end perdu. Et
// un compteur projeté faux est pire que pas de compteur : l'admin décide
// dessus, et ne voit l'écart qu'après avoir appliqué.
//
// ── CE QUI A CHANGÉ LE 2026-09-30 (B-137) ───────────────────────────────────
//
// MiKL : « le vendredi doit compter comme un soir de garde comme les autres
// jours de la semaine ». La vue `compteurs_gardes` DÉRIVE désormais le vendredi
// du week-end et le range dans `sem_*` et `total_gardes`.
//
// ⚠️ LA MOITIÉ DU PIÈGE CI-DESSUS S'INVERSE DONC, ET L'AUTRE MOITIÉ RESTE :
//
//   • une affectation `vendredi_soir` reste IGNORÉE — le vendredi n'a toujours
//     pas de ligne, et c'est le mouvement du WEEK-END qui le porte ;
//   • mais un mouvement de WEEK-END pèse maintenant DEUX fois : une fois en
//     `we_*`, une fois en `sem_*` pour le vendredi qui le suit.
//
// Ne corriger que le SQL aurait donné « Antoine 27 » dans le tableau et « 25 »
// dans l'aperçu, sur le même écran — B-108, déjà payé une fois.
// ============================================================

import type { CompteursRow } from '@/hooks/useCompteurs'
import type { CalendrierResolu } from '@/engine/types'
import type { RelationStructure } from '@/engine/structure-config'
import { mapTypeGardeEnDb } from '@/data/ecrirePlanningV1'
import { coupleVendrediWeekend } from '@/engine/aval/resoudrePlanningAffichage'

/**
 * Une place qui change de main.
 *
 * `vetId` est qui ARRIVE (`null` = on vide la place), `avantVetId` qui PARTAIT
 * (`null` = la place était vide). Les deux voyagent ensemble : calculer l'un
 * sans l'autre obligerait à relire le planning, donc à le recompter.
 */
export interface AffectationProjetee {
  date: string
  /** Le type au vocabulaire du MOTEUR (`semaine_soir`, `weekend`, …). */
  type: string
  role: string
  vetId: string | null
  avantVetId: string | null
}

/** Les trois familles que la vue `compteurs_gardes` sait compter. */
type Famille = 'we' | 'sem' | 'feries'

function familleDe(typeDb: string): Famille | null {
  if (typeDb === 'weekend') return 'we'
  if (typeDb === 'semaine') return 'sem'
  if (typeDb === 'ferie') return 'feries'
  // Un créneau sur-mesure (P3b) est persisté tel quel et n'entre dans aucune
  // des trois familles de la vue. On ne projette rien plutôt que d'inventer
  // une colonne : un compteur muet se remarque, un compteur faux non.
  return null
}

/** Les deux colonnes d'une famille : le rôle, et le total de la famille. */
const COLONNES: Record<Famille, { premier: keyof CompteursRow; second: keyof CompteursRow; total: keyof CompteursRow }> = {
  we: { premier: 'we_premier', second: 'we_second', total: 'we_total' },
  sem: { premier: 'sem_premier', second: 'sem_second', total: 'sem_total' },
  feries: { premier: 'feries_premier', second: 'feries_second', total: 'feries_total' },
}

/**
 * Ce que les mouvements donneraient, sans rien écrire.
 *
 * Rend une NOUVELLE liste : les compteurs reçus ne sont jamais mutés. Sans
 * cela, fermer l'aperçu sans appliquer laisserait à l'écran des chiffres
 * projetés qu'aucune garde ne justifie.
 *
 * @param actuels  Les compteurs tels que la vue les donne aujourd'hui.
 * @param affectations Les places qui changeraient de main.
 * @param calendrier Le calendrier du cabinet — MÊME source que le moteur, sans
 *   quoi un jour férié serait rangé en nuit de semaine ici et en férié en base.
 */
export function projeterCompteurs(
  actuels: CompteursRow[],
  affectations: AffectationProjetee[],
  calendrier?: CalendrierResolu,
  relations?: readonly RelationStructure[],
): CompteursRow[] {
  // B-137 — l'état du couple, lu à la MÊME source que la vue SQL.
  const couple = coupleVendrediWeekend(relations)
  const projete = actuels.map((r) => ({ ...r }))
  const parId = new Map(projete.map((r) => [r.veterinaire_id, r]))

  /** Ajoute `signe` (+1 ou −1) sur les colonnes d'une personne. */
  const bouger = (vetId: string | null, famille: Famille, role: string, signe: 1 | -1) => {
    if (!vetId) return
    const ligne = parId.get(vetId)
    // Personne absente du tableau (vétérinaire désactivé, sorti de la vue) :
    // on l'ignore. Lui fabriquer une ligne le ferait réapparaître à l'écran
    // comme un membre de l'équipe, ce qu'il n'est plus.
    if (!ligne) return

    const cols = COLONNES[famille]
    const colRole = role === 'premier' ? cols.premier : cols.second

    ;(ligne[colRole] as number) += signe
    ;(ligne[cols.total] as number) += signe
    ;(ligne.total_gardes as number) += signe
  }

  for (const a of affectations) {
    // ⚠️ LE VENDREDI SOIR SORT ICI, et c'est tout l'objet de cette ligne : il
    // n'existe pas dans `gardes`, donc aucun mouvement ne le vise en propre.
    // C'est le mouvement du WEEK-END qui le porte (voir juste en dessous) ;
    // le compter ici ferait double emploi avec le samedi qui l'accompagne.
    if (a.type === 'vendredi_soir') continue

    const famille = familleDe(mapTypeGardeEnDb(a.type, a.date, calendrier))
    if (!famille) continue

    // Celui qui part perd la garde, celui qui arrive la prend. Si c'est la
    // même personne (changement de rôle seul), les deux se compensent sur le
    // total et seules les colonnes de rôle bougent — ce qui est exact.
    bouger(a.avantVetId, famille, a.role, -1)
    bouger(a.vetId, famille, a.role, 1)

    // B-137 — LE VENDREDI QUI SUIT LE WEEK-END. La vue le dérive et le range
    // en soir de semaine ; la projection doit faire le même geste, sinon
    // l'aperçu et le tableau affichent deux chiffres pour la même personne.
    //
    // Le rôle y est INVERSÉ quand le cabinet l'a réglé ainsi : le 2nd du
    // week-end est le 1er du vendredi. Sans cette permutation, `sem_total`
    // serait juste et le détail 1er/2nd faux — l'erreur la moins visible.
    if (famille === 'we' && couple.materialiser) {
      const roleVendredi = couple.inverser
        ? (a.role === 'premier' ? 'second' : a.role === 'second' ? 'premier' : a.role)
        : a.role
      bouger(a.avantVetId, 'sem', roleVendredi, -1)
      bouger(a.vetId, 'sem', roleVendredi, 1)
    }
  }

  return projete
}

/**
 * L'écart par personne, pour les libellés du genre « Antoine −2 · Fanny +2 ».
 *
 * Calculé depuis les DEUX listes plutôt que pendant la projection : une
 * seconde accumulation en parallèle pourrait diverger du résultat affiché, et
 * c'est précisément le genre d'écart que personne ne remarque.
 */
export function ecartsDeProjection(
  actuels: CompteursRow[],
  projetes: CompteursRow[],
): Map<string, number> {
  const avant = new Map(actuels.map((r) => [r.veterinaire_id, r.total_gardes]))
  const ecarts = new Map<string, number>()
  for (const r of projetes) {
    const d = r.total_gardes - (avant.get(r.veterinaire_id) ?? r.total_gardes)
    if (d !== 0) ecarts.set(r.veterinaire_id, d)
  }
  return ecarts
}
