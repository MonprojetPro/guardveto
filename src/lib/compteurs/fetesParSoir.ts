// ============================================================
// GUARDVETO — Qui a tenu chaque SOIR des fêtes de fin d'année (B-198)
// ============================================================
// MiKL, 10/11, devant le tableau des fêtes : « pourquoi il y a 2 noms notés
// pour 1er et 2nd par événement ? ». Chaque fête compte DEUX soirs (24 et 25
// décembre, 31 décembre et 1er janvier), et `historique_fete` ne porte pas la
// date : le tableau empilait les deux soirs sans dire lequel était lequel.
//
// La source est donc le PLANNING PUBLIÉ, qui connaît la date de chaque garde,
// lu à travers `occupantReel` — le remplaçant d'un jour s'il y en a un, le
// titulaire sinon. C'est la même brique que le mail « Nouveau planning »
// (B-197) : deux lectures des remplacements finiraient par diverger.
//
// ⚠️ Un week-end est daté du samedi et couvre aussi le vendredi et le
//    dimanche (`datesCouvertesParGardeV1`) : le 25 décembre 2026, un vendredi,
//    est tenu par la garde du week-end du 26.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { datesCouvertesParGardeV1, addDays } from '@/engine/utils'
import {
  chargerExceptionsDesGardes,
  indexerExceptions,
  occupantReel,
} from '@/lib/gardes/exceptions-jour'

export type FeteFinAnnee = 'noel' | 'nouvel_an'

/** Les quatre soirs d'une saison de fêtes (« saison 2026 » = Noël 2026 + Nouvel An 2026 → 2027). */
export function soirsDeLaSaison(annee: number): { fete: FeteFinAnnee; date: string }[] {
  return [
    { fete: 'noel', date: `${annee}-12-24` },
    { fete: 'noel', date: `${annee}-12-25` },
    { fete: 'nouvel_an', date: `${annee}-12-31` },
    { fete: 'nouvel_an', date: `${annee + 1}-01-01` },
  ]
}

export interface GardePubliee {
  id: string
  date: string
  type: string
  premier_id: string | null
  second_id: string | null
}

export interface SoirDeFete {
  fete: FeteFinAnnee
  /** Année de la saison (le Nouvel An 2026 → 2027 porte 2026). */
  annee: number
  date: string
  /** `false` = aucune garde publiée ne couvre ce soir. */
  publie: boolean
  premierId: string | null
  secondId: string | null
}

/** Pur : qui tient chaque soir, à partir des gardes publiées et de leurs remplacements. */
export function soirsDeFete(
  annees: readonly number[],
  gardes: readonly GardePubliee[],
  remplacements: Map<string, string | null>,
): SoirDeFete[] {
  const out: SoirDeFete[] = []
  for (const annee of [...new Set(annees)].sort((a, b) => b - a)) {
    for (const { fete, date } of soirsDeLaSaison(annee)) {
      const g = gardes.find((x) => datesCouvertesParGardeV1(x.date, x.type).includes(date))
      out.push({
        fete,
        annee,
        date,
        publie: Boolean(g),
        premierId: g ? occupantReel(g, remplacements, date, 'premier') : null,
        secondId: g ? occupantReel(g, remplacements, date, 'second') : null,
      })
    }
  }
  return out
}

/**
 * Charge les soirs de fête des saisons demandées, depuis les plannings PUBLIÉS
 * du cabinet (RLS). Une erreur de lecture remonte en `erreur` — jamais en
 * « personne n'était de garde » (règle de maison, cf. useCompteurs).
 */
export async function chargerSoirsDeFete(
  supabase: SupabaseClient,
  annees: readonly number[],
): Promise<{ soirs: SoirDeFete[]; noms: Record<string, string>; erreur: string | null }> {
  if (annees.length === 0) return { soirs: [], noms: {}, erreur: null }
  const min = Math.min(...annees)
  const max = Math.max(...annees)
  // ±1 jour : un week-end daté du samedi 26 couvre le vendredi 25 ; daté du
  // samedi 2 janvier, il couvre le vendredi 1er.
  const debut = addDays(`${min}-12-24`, -1)
  const fin = addDays(`${max + 1}-01-01`, 1)

  const { data, error } = await supabase
    .from('gardes')
    .select('id, date, type, premier_id, second_id, periodes!inner(statut)')
    .gte('date', debut)
    .lte('date', fin)
    .eq('periodes.statut', 'publie')
  if (error) return { soirs: [], noms: {}, erreur: error.message }

  const gardes = (data ?? []) as unknown as GardePubliee[]
  const remplacements = indexerExceptions(await chargerExceptionsDesGardes(supabase, gardes.map((g) => g.id)))
  const soirs = soirsDeFete(annees, gardes, remplacements)

  const ids = [...new Set(soirs.flatMap((s) => [s.premierId, s.secondId]).filter((x): x is string => Boolean(x)))]
  const noms: Record<string, string> = {}
  if (ids.length > 0) {
    const vets = await supabase.from('veterinaires').select('id, prenom, nom').in('id', ids)
    if (vets.error) return { soirs: [], noms: {}, erreur: vets.error.message }
    for (const v of (vets.data ?? []) as { id: string; prenom: string; nom: string }[]) {
      noms[v.id] = `${v.prenom} ${v.nom}`.trim()
    }
  }
  return { soirs, noms, erreur: null }
}
