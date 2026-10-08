// ============================================================
// GUARDVETO — Historique des fêtes : lecture (moteur) + alimentation (publication)
// ============================================================
// Backlog n°14 — équité inter-annuelle des fêtes (§6/§7 doc métier).
//
// DEUX responsabilités, UNE table (`historique_fete`) :
//   1. chargerHistoriqueFetes    — lue par le loader moteur : lignes des
//      années N-1 des fêtes couvertes par la période → forme NORMALISÉE
//      (resoudreHistoriqueFetes) consommée par le scoring.
//   2. enregistrerHistoriqueFetes — appelée à la PUBLICATION d'une période
//      couvrant une fête : enregistre QUI a tenu chaque fête. IDEMPOTENTE :
//      delete ciblé par (cabinet, fete, annee) couverts puis insert — une
//      re-publication réécrit exactement le même état (pas de doublon, et
//      un planning modifié entre-temps remplace proprement les anciennes
//      lignes de CES instances de fête).
//
// BEST-EFFORT ABSOLU : aucune de ces fonctions ne lève. Table absente
// (migration pas encore appliquée) ou erreur → lecture `undefined` (aucune
// pénalité, byte-identique) / écriture { ok: false } (la publication n'est
// jamais bloquée).
//
// Le CALCUL des entrées depuis les gardes V1 est une fonction PURE exportée
// (calculerEntreesHistoriqueFete) — testée sans base.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { datesCouvertesParGardeV1 } from '@/engine/utils'
import {
  feteDeDate,
  fetesCouvertesParGardeV1,
  resoudreHistoriqueFetes,
  type CodeFete,
  type HistoriqueFetesResolu,
  type HistoriqueFeteRow,
} from '@/engine/historique-fete'
import {
  chargerExceptionsDesGardes,
  indexerExceptions,
  occupantReel,
  type ExceptionJour,
} from '@/lib/gardes/exceptions-jour'

// ── 1. Lecture (loader moteur) ───────────────────────────────

/**
 * chargerHistoriqueFetes — lignes d'historique du cabinet pour les années
 * demandées (les années N-1 des fêtes couvertes par la période), normalisées
 * à la source. `undefined` si la lecture échoue (table absente, erreur) —
 * le moteur n'applique alors aucune pénalité (comportement historique).
 */
export async function chargerHistoriqueFetes(
  supabase: SupabaseClient,
  cabinetId: string,
  annees: number[],
): Promise<HistoriqueFetesResolu | undefined> {
  if (annees.length === 0) return undefined
  try {
    const { data, error } = await supabase
      .from('historique_fete')
      .select('veterinaire_id, fete, annee')
      .eq('cabinet_id', cabinetId)
      .in('annee', annees)

    if (error) {
      // Table pas encore migrée ou lecture impossible → pas d'historique
      // (aucune pénalité). On trace sans bruit bloquant.
      console.warn(`[historique-fete] Lecture impossible (${error.message}) — équité inter-annuelle des fêtes non appliquée.`)
      return undefined
    }
    return resoudreHistoriqueFetes((data ?? []) as HistoriqueFeteRow[])
  } catch (e) {
    console.warn(`[historique-fete] Lecture impossible (${e instanceof Error ? e.message : String(e)}).`)
    return undefined
  }
}

// ── 2. Alimentation (publication) ────────────────────────────

/** Ligne V1 minimale de `gardes` nécessaire au calcul. */
export interface GardeFeteRow {
  /** Nécessaire depuis B-156 : c'est la clé des remplacements du jour. */
  id?: string
  date: string
  type: string
  premier_id: string | null
  second_id: string | null
}

/** Entrée d'historique prête à insérer. */
export interface EntreeHistoriqueFete {
  cabinet_id: string
  veterinaire_id: string
  fete: CodeFete
  annee: number
  role: string | null
  garde_date: string
  periode_id: string
}

/**
 * calculerEntreesHistoriqueFete — PURE. Depuis les gardes V1 d'une période,
 * calcule qui a tenu chaque fête couverte.
 *
 * Sémantique V1 (cf. fetesCouvertesParGardeV1) : un week-end (daté du samedi)
 * couvre AUSSI le vendredi soir (équipe dérivée). Un même véto couvrant
 * plusieurs dates d'une même instance (ex. 24 ET 25 déc) → UNE entrée
 * (la première chronologiquement — déterministe). Rôle enregistré depuis
 * premier_id/second_id (les places 3+ des créneaux sur-mesure ne sont pas
 * couvertes — limite documentée, cas inexistant sur les fêtes à ce jour).
 *
 * ── B-156 — ON ENREGISTRE QUI A TENU LA FÊTE, PAS QUI DEVAIT LA TENIR ───────
 *
 * 🔴 LE DÉFAUT LE PLUS SOURNOIS DE L'AUDIT DU 08/10, parce qu'il est MUET ET À
 *    RETARDEMENT. Cette fonction lisait les titulaires. Un Noël remplacé au
 *    pied levé (B-061) inscrivait donc le titulaire au registre : celui qui
 *    n'avait pas fait Noël en portait la pénalité l'année suivante, et celui
 *    qui l'avait fait était resservi. Aucun écran ne l'aurait montré, aucun
 *    test ne l'aurait dit — on l'aurait découvert UN AN PLUS TARD, sous la
 *    forme d'un planning que personne ne comprend.
 *
 * 🔑 LE JOUR COMPTE, pas la ligne. Un remplacement du 25 ne dit rien du 24 :
 *    on demande donc l'occupant réel date par date, et non une fois pour la
 *    garde entière.
 */
export function calculerEntreesHistoriqueFete(
  gardes: GardeFeteRow[],
  cabinetId: string,
  periodeId: string,
  exceptions: readonly ExceptionJour[] = [],
): EntreeHistoriqueFete[] {
  // Tri chronologique (puis type) → dédoublonnage déterministe.
  const triees = [...gardes].sort((a, b) =>
    a.date === b.date ? a.type.localeCompare(b.type) : a.date.localeCompare(b.date),
  )

  const index = indexerExceptions(exceptions)
  const vues = new Set<string>() // `${vetId}|${fete}|${annee}`
  const out: EntreeHistoriqueFete[] = []

  for (const g of triees) {
    if (fetesCouvertesParGardeV1(g.date, g.type).length === 0) continue

    // Jour par jour : c'est la seule maille à laquelle un remplacement existe.
    for (const jour of datesCouvertesParGardeV1(g.date, g.type)) {
      const inst = feteDeDate(jour)
      if (!inst) continue

      for (const role of ['premier', 'second'] as const) {
        const vetId = occupantReel(g, index, jour, role)
        if (!vetId) continue
        const cle = `${vetId}|${inst.fete}|${inst.annee}`
        if (vues.has(cle)) continue
        vues.add(cle)
        out.push({
          cabinet_id: cabinetId,
          veterinaire_id: vetId,
          fete: inst.fete,
          annee: inst.annee,
          role,
          // La date de la LIGNE reste la référence du registre (un week-end se
          // nomme par son samedi) : `jour` sert à savoir QUI, pas à dater.
          garde_date: g.date,
          periode_id: periodeId,
        })
      }
    }
  }
  return out
}

export interface EnregistrerHistoriqueResultat {
  ok: boolean
  /** Nombre d'entrées écrites (0 si la période ne couvre aucune fête). */
  nb: number
  erreur?: string
}

/**
 * enregistrerHistoriqueFetes — à la publication d'une période : enregistre
 * qui a tenu les fêtes couvertes. IDEMPOTENTE (delete ciblé + insert) et
 * best-effort (ne lève JAMAIS — la publication n'est pas bloquée).
 */
export async function enregistrerHistoriqueFetes(
  supabase: SupabaseClient,
  params: { periodeId: string; cabinetId: string },
): Promise<EnregistrerHistoriqueResultat> {
  try {
    const { periodeId, cabinetId } = params

    // Gardes V1 de la période (source de vérité du planning publié).
    const { data: gardesData, error: gardesErr } = await supabase
      .from('gardes')
      .select('id, date, type, premier_id, second_id')
      .eq('periode_id', periodeId)

    if (gardesErr) {
      return { ok: false, nb: 0, erreur: `lecture gardes : ${gardesErr.message}` }
    }

    const gardes = (gardesData ?? []) as GardeFeteRow[]
    const entrees = calculerEntreesHistoriqueFete(
      gardes,
      cabinetId,
      periodeId,
      // B-156 : qui a RÉELLEMENT tenu la fête. Sans cette ligne, le registre
      // inscrit le titulaire d'un Noël qu'il n'a pas fait.
      await chargerExceptionsDesGardes(supabase, gardes.map((g) => g.id)),
    )
    // Instances (fete, annee) couvertes par la période — périmètre du delete.
    const instances = [...new Set(entrees.map((e) => `${e.fete}|${e.annee}`))]
    if (instances.length === 0) return { ok: true, nb: 0 }

    // Idempotence : purge ciblée PAR INSTANCE (jamais au-delà des fêtes que
    // cette période couvre), puis insertion de l'état courant.
    for (const inst of instances) {
      const [fete, annee] = inst.split('|')
      const { error: delErr } = await supabase
        .from('historique_fete')
        .delete()
        .eq('cabinet_id', cabinetId)
        .eq('fete', fete)
        .eq('annee', Number(annee))
      if (delErr) {
        return { ok: false, nb: 0, erreur: `purge ${inst} : ${delErr.message}` }
      }
    }

    const { error: insErr } = await supabase.from('historique_fete').insert(entrees)
    if (insErr) {
      return { ok: false, nb: 0, erreur: `insertion : ${insErr.message}` }
    }

    return { ok: true, nb: entrees.length }
  } catch (e) {
    return { ok: false, nb: 0, erreur: e instanceof Error ? e.message : String(e) }
  }
}
