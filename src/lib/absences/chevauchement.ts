// ============================================================
// GUARDVETO — Deux absences sur les mêmes dates, et personne ne le dit
// ============================================================
// B-160a ③. Constat de MiKL, le 13/10 : il a déclaré une ABSENCE *et* un CONGÉ
// pour Anne-Catherine sur le même jour, et « tout va bien pour le système ».
//
// ── POURQUOI CE N'ÉTAIT PAS VU ──────────────────────────────────────────────
//
// `conges` et `absences` sont deux tables. Chacune contrôle son propre
// chevauchement avec les GARDES publiées (`detecterConflit`), aucune ne regarde
// l'autre. Deux lignes qui disent la même chose de la même personne au même
// moment passaient donc sans un mot — et avec des périmètres différents depuis
// B-163, elles peuvent même se contredire : « absent le matin » d'un côté,
// « journée et nuit » de l'autre.
//
// ── CE QUE ÇA FAIT, ET CE QUE ÇA NE FAIT PAS ────────────────────────────────
//
// ⚠️ ÇA SIGNALE, ÇA N'INTERDIT PAS. Doctrine du produit : « le système INFORME,
//    il n'interdit pas ». Un doublon est souvent légitime — un congé posé de
//    longue date, puis une maladie qui tombe dessus. Refuser l'écriture
//    obligerait l'administratrice à supprimer la première ligne pour saisir la
//    seconde, et on perdrait l'historique de la décision.
//
// ⚠️ ET SURTOUT : UN BANDEAU EST UN SIGNAL, PAS UN RAPPORT. On dit qu'il y a un
//    recouvrement et sur quelles dates. On ne tente pas de dire laquelle des
//    deux a raison : personne ne le sait, et c'est précisément pour ça qu'il
//    faut qu'un humain regarde.
// ============================================================

import { periodeFr } from '@/lib/dates-fr'
import {
  LIBELLE_PERIMETRE,
  lirePerimetre,
  type PerimetreAbsence,
} from '@/lib/absences/perimetre'

/** Une indisponibilité, quelle que soit la table d'où elle vient. */
export interface IndisponibilitePourChevauchement {
  id: string
  veterinaire_id: string
  date_debut: string
  date_fin: string
  /** `conge` ou `absence` — pour que le message dise d'où vient quoi. */
  origine: 'conge' | 'absence'
  perimetre?: unknown
}

export interface Chevauchement {
  veterinaire_id: string
  /** Les deux identifiants, dans l'ordre où ils ont été donnés. */
  ids: [string, string]
  /** Les dates réellement communes aux deux, bornes comprises. */
  date_debut: string
  date_fin: string
  /** Vrai quand les deux périmètres diffèrent — le cas le plus trompeur. */
  perimetresDifferents: boolean
  /** Déjà en français, affichable tel quel. */
  phrase: string
}

/**
 * Les recouvrements, pour UNE personne à la fois.
 *
 * Fonction PURE : elle se vérifie sans base, et c'est elle qui porte la
 * convention des bornes (comprises des deux côtés, comme partout ailleurs sur
 * ce produit).
 *
 * ⚠️ ON NE COMPARE QUE DES PAIRES DISTINCTES, et jamais une ligne avec
 *    elle-même : sans ce garde-fou, toute absence se signalerait comme son
 *    propre doublon, et le bandeau s'afficherait en permanence. Un message
 *    permanent cesse d'être lu — c'est le mécanisme par lequel une alerte
 *    utile meurt.
 */
export function chevauchements(
  lignes: readonly IndisponibilitePourChevauchement[],
): Chevauchement[] {
  const out: Chevauchement[] = []

  for (let i = 0; i < lignes.length; i++) {
    for (let j = i + 1; j < lignes.length; j++) {
      const a = lignes[i]
      const b = lignes[j]
      if (a.veterinaire_id !== b.veterinaire_id) continue

      // L'intersection de deux intervalles, en chaînes `AAAA-MM-JJ` : l'ordre
      // lexicographique y est l'ordre chronologique, et aucune conversion en
      // `Date` ne vient décaler un jour selon le fuseau.
      const debut = a.date_debut > b.date_debut ? a.date_debut : b.date_debut
      const fin = a.date_fin < b.date_fin ? a.date_fin : b.date_fin
      if (debut > fin) continue

      const pa = lirePerimetre(a.perimetre)
      const pb = lirePerimetre(b.perimetre)

      out.push({
        veterinaire_id: a.veterinaire_id,
        ids: [a.id, b.id],
        date_debut: debut,
        date_fin: fin,
        perimetresDifferents: pa !== pb,
        phrase: phraseChevauchement(a.origine, b.origine, debut, fin, pa, pb),
      })
    }
  }

  return out
}

const NOM_ORIGINE: Record<'conge' | 'absence', string> = {
  conge: 'un congé',
  absence: 'une absence',
}

/**
 * La phrase du bandeau.
 *
 * Elle NOMME les deux origines et les dates communes, et ajoute les périmètres
 * UNIQUEMENT quand ils diffèrent : c'est le cas trompeur. Deux lignes qui
 * disent toutes les deux « journée et nuit » sont un doublon bénin ; une qui
 * dit « le matin » et l'autre « journée et nuit » laissent l'équipe devant deux
 * vérités, et c'est la plus optimiste qui sera lue.
 */
function phraseChevauchement(
  oa: 'conge' | 'absence',
  ob: 'conge' | 'absence',
  debut: string,
  fin: string,
  pa: PerimetreAbsence,
  pb: PerimetreAbsence,
): string {
  // B-163d ④ — même correction que `doublon.ts` : une date ISO dans une phrase
  // française est un défaut, pas un détail. `periodeFr` est la seule façon de
  // l'écrire. Corrigé ici AVANT que MiKL ne le voie : ce bandeau vit sur
  // l'écran Absences, et il aurait affiché « le 2026-10-26 » lui aussi.
  const quand = periodeFr(debut, fin)
  const base = `${NOM_ORIGINE[oa]} et ${NOM_ORIGINE[ob]} se recouvrent ${quand}`
  if (pa === pb) return `${base}.`
  return `${base}, avec deux périmètres différents : « ${LIBELLE_PERIMETRE[pa]} » et « ${LIBELLE_PERIMETRE[pb]} ».`
}
