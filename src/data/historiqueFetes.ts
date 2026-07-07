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
import {
  fetesCouvertesParGardeV1,
  resoudreHistoriqueFetes,
  type CodeFete,
  type HistoriqueFetesResolu,
  type HistoriqueFeteRow,
} from '@/engine/historique-fete'

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
 */
export function calculerEntreesHistoriqueFete(
  gardes: GardeFeteRow[],
  cabinetId: string,
  periodeId: string,
): EntreeHistoriqueFete[] {
  // Tri chronologique (puis type) → dédoublonnage déterministe.
  const triees = [...gardes].sort((a, b) =>
    a.date === b.date ? a.type.localeCompare(b.type) : a.date.localeCompare(b.date),
  )

  const vues = new Set<string>() // `${vetId}|${fete}|${annee}`
  const out: EntreeHistoriqueFete[] = []

  for (const g of triees) {
    const instances = fetesCouvertesParGardeV1(g.date, g.type)
    if (instances.length === 0) continue

    const tenants: Array<{ vetId: string; role: string }> = []
    if (g.premier_id) tenants.push({ vetId: g.premier_id, role: 'premier' })
    if (g.second_id) tenants.push({ vetId: g.second_id, role: 'second' })

    for (const inst of instances) {
      for (const t of tenants) {
        const cle = `${t.vetId}|${inst.fete}|${inst.annee}`
        if (vues.has(cle)) continue
        vues.add(cle)
        out.push({
          cabinet_id: cabinetId,
          veterinaire_id: t.vetId,
          fete: inst.fete,
          annee: inst.annee,
          role: t.role,
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
      .select('date, type, premier_id, second_id')
      .eq('periode_id', periodeId)

    if (gardesErr) {
      return { ok: false, nb: 0, erreur: `lecture gardes : ${gardesErr.message}` }
    }

    const entrees = calculerEntreesHistoriqueFete(
      (gardesData ?? []) as GardeFeteRow[],
      cabinetId,
      periodeId,
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
