// ============================================================
// GUARDVETO — Ce qu'on surveille sur un planning, et ce qu'on en dit
// ============================================================
// B-130a (2026-09-30). Extrait de `data/revaliderPlanning.ts`, qui porte
// `'use server'` et ne peut donc rien exporter d'autre que des fonctions async
// — la règle métier y était intestable autrement qu'en montant une base.
//
// ── LE TROU QUE CE FICHIER BOUCHE ──────────────────────────────────────────
//
// Le contrôle de cohérence ne tournait que sur les plannings PUBLIÉS. Le 25/09,
// MiKL durcit `espacement_min` APRÈS avoir généré Hiver P2 : son planning déjà
// enregistré devient non conforme à cette seconde, et rien ne le dit — la
// période était en brouillon. Il l'a vu à l'œil nu et a conclu à un bug du
// moteur qui n'existait pas (B-130).
//
// ── LA CONVENTION QUI REND CE FICHIER SÛR ──────────────────────────────────
//
// La décision est une table EXHAUSTIVE sur `StatutPeriode`. Ajouter un statut
// sans décider ce qu'on en surveille ne compile pas — on ne peut donc pas créer
// un état de planning silencieux par omission. Même principe que
// `lib/produit/attentes.ts` : la seule chose interdite est le silence.
// ============================================================

import type { StatutPeriode } from '@/types'

/**
 * Le code que `validerPlanning` émet pour une place non pourvue.
 * Cf. `engine/validation/validerPlanning.ts`.
 */
export const REGLE_CASE_VIDE = 'COUVERTURE'

/** Ce qu'on remonte à l'admin pour un statut de période donné. */
export interface RegimeSurveillance {
  /** Faux = on ne juge pas cette période du tout. */
  surveillee: boolean
  /**
   * Faux = les places non pourvues ne sont PAS remontées. Réservé aux
   * brouillons : une case vide y est un état normal du travail en cours.
   */
  remonterLesCasesVides: boolean
  /** Pourquoi ce régime — lu par les humains, pas par le code. */
  pourquoi: string
}

/**
 * Le régime de surveillance de chaque statut. Table exhaustive : un statut
 * ajouté sans décision fait échouer la compilation.
 */
export const REGIME_PAR_STATUT: Record<StatutPeriode, RegimeSurveillance> = {
  brouillon: {
    surveillee: true,
    remonterLesCasesVides: false,
    pourquoi:
      "Le planning se construit encore, et c'est le moment où l'admin peut corriger : " +
      'une règle enfreinte doit se voir. Mais ses cases vides sont un état normal du ' +
      'travail en cours, déjà comptées ailleurs (« N cases restent à pourvoir ») — les ' +
      'répéter ici ferait crier le bandeau à chaque génération partielle, et un bandeau ' +
      'qui crie toujours ne se lit plus. Décision de MiKL, 30/09.',
  },
  publie: {
    surveillee: true,
    remonterLesCasesVides: true,
    pourquoi:
      "Le planning est diffusé : l'équipe s'organise dessus. Une case non pourvue n'y " +
      "est plus un travail en cours, c'est un trou de garde que personne ne couvre.",
  },
  verrouille: {
    surveillee: false,
    remonterLesCasesVides: false,
    pourquoi:
      'Période close : plus aucune modification possible (`api/generate` la refuse, ' +
      "chaque garde est verrouillée). Signaler n'y ouvre aucune décision — ce serait du " +
      "bruit devant une porte fermée. Le cas se voit dès qu'on reprend l'historique d'un " +
      'cabinet : un extrait de passé n\'a jamais tous ses créneaux couverts, et la page ' +
      'criait « 32 créneaux non couverts » sur un planning d\'archive.',
  },
}

/**
 * Le statut d'une période décide-t-il qu'on la juge ?
 *
 * Un statut inconnu (période introuvable, valeur inattendue en base) est
 * traité comme NON surveillé — le repli le plus étroit. Prétendre juger une
 * période dont on ne connaît pas l'état produirait un verdict sans valeur.
 */
export function estSurveillee(statut: StatutPeriode | undefined): boolean {
  return statut ? (REGIME_PAR_STATUT[statut]?.surveillee ?? false) : false
}

/** Les places non pourvues sont-elles remontées pour ce statut ? */
export function remonteLesCasesVides(statut: StatutPeriode | undefined): boolean {
  return statut ? (REGIME_PAR_STATUT[statut]?.remonterLesCasesVides ?? false) : false
}

/**
 * Applique le régime d'un statut à un lot de violations déjà calculées.
 *
 * Générique : un filtre qui raboterait le type de ce qu'il laisse passer
 * rendrait les champs des violations invisibles aux appelants.
 */
export function filtrerSelonStatut<T extends { regle: string }>(
  violations: readonly T[],
  statut: StatutPeriode | undefined,
): T[] {
  if (!estSurveillee(statut)) return []
  if (remonteLesCasesVides(statut)) return [...violations]
  return violations.filter((v) => v.regle !== REGLE_CASE_VIDE)
}
