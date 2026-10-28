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

// ── B-175i — UNE LIGNE PAR GROUPE, PAS PAR PAIRE ────────────────────────────
//
// MiKL, capture du 28/10 : trois absences de Jean le 26/10 produisaient trois
// lignes presque identiques (« une absence et une absence se recouvrent… »).
// `chevauchements` raisonne par PAIRE, c'est juste pour détecter ; pour le
// DIRE, on regroupe les lignes d'une personne qui se recouvrent de proche en
// proche, et on fait une seule phrase par groupe.

/** Un groupe d'indisponibilités d'une même personne qui se recouvrent. */
export interface GroupeChevauchement {
  veterinaire_id: string
  /** Toutes les lignes du groupe, dans l'ordre d'arrivée. */
  ids: string[]
  /** Du premier au dernier jour réellement en double dans le groupe. */
  date_debut: string
  date_fin: string
  perimetresDifferents: boolean
  /** Déjà en français, affichable tel quel. */
  phrase: string
}

function compter(n: number, un: string, plusieurs: string): string {
  return n === 1 ? un : `${n} ${plusieurs}`
}

export function regrouperChevauchements(
  lignes: readonly IndisponibilitePourChevauchement[],
): GroupeChevauchement[] {
  const paires = chevauchements(lignes)
  if (paires.length === 0) return []

  const parId = new Map(lignes.map((l) => [l.id, l]))
  // Union-find minimal : chaque paire relie ses deux lignes.
  const parent = new Map<string, string>()
  const racine = (id: string): string => {
    let r = id
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  for (const p of paires) {
    for (const id of p.ids) if (!parent.has(id)) parent.set(id, id)
    const [a, b] = p.ids.map(racine)
    if (a !== b) parent.set(b, a)
  }

  const groupes = new Map<string, { ids: string[]; debut: string; fin: string }>()
  for (const p of paires) {
    const r = racine(p.ids[0])
    const g = groupes.get(r) ?? { ids: [], debut: p.date_debut, fin: p.date_fin }
    if (p.date_debut < g.debut) g.debut = p.date_debut
    if (p.date_fin > g.fin) g.fin = p.date_fin
    groupes.set(r, g)
  }
  // Les identifiants, dans l'ordre d'arrivée des lignes.
  for (const l of lignes) {
    if (!parent.has(l.id)) continue
    groupes.get(racine(l.id))?.ids.push(l.id)
  }

  return [...groupes.values()].map((g) => {
    const membres = g.ids.map((id) => parId.get(id)!)
    const nbConges = membres.filter((m) => m.origine === 'conge').length
    const nbAbsences = membres.length - nbConges
    const qui = [
      nbConges > 0 ? compter(nbConges, 'un congé', 'congés') : null,
      nbAbsences > 0 ? compter(nbAbsences, 'une absence', 'absences') : null,
    ]
      .filter(Boolean)
      .join(' et ')
    const perimetres = [...new Set(membres.map((m) => lirePerimetre(m.perimetre)))]
    const base = `${qui} se recouvrent ${periodeFr(g.debut, g.fin)}`
    const phrase =
      perimetres.length > 1
        ? `${base}, avec des périmètres différents : ${perimetres
            .map((p) => `« ${LIBELLE_PERIMETRE[p]} »`)
            .join(', ')}.`
        : `${base}.`
    return {
      veterinaire_id: membres[0].veterinaire_id,
      ids: g.ids,
      date_debut: g.debut,
      date_fin: g.fin,
      perimetresDifferents: perimetres.length > 1,
      phrase,
    }
  })
}
