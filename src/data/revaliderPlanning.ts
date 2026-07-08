'use server'

// ============================================================
// GUARDVETO — Re-validation continue d'un planning PUBLIÉ (Chantier B)
// ============================================================
// Le validateur indépendant `validerPlanning` prouve, à la génération, que le
// planning respecte toutes les contraintes DURES. Mais une fois publié, plus
// rien ne le re-vérifiait : un congé validé a posteriori, une règle modifiée,
// une édition manuelle ou une réparation de crise pouvaient introduire une
// violation invisible. Ce module BRANCHE le validateur en prod : il recharge
// l'état réel (gardes publiées + règles + calendrier) et re-confronte le tout.
//
// SOURCE DE VÉRITÉ : la table `gardes` (V1) — c'est elle que voient les écrans
// (vue `planning_semaine`) et qu'écrivent les éditions manuelles + la crise
// (`appliquerChangementGarde`). On reconstruit donc le PlanningPartiel À PARTIR
// de `gardes`, en synthétisant le créneau `vendredi_soir` (absent de `gardes` :
// le vendredi est porté par la garde de week-end) avec les RÔLES INVERSÉS,
// EXACTEMENT comme la vue (migration 014). Sinon : violations fantômes chaque
// vendredi.
//
// ACCÈS : admin uniquement. La re-validation a besoin de TOUTES les données
// (congés de tous les vétos, etc.) ; seule la session admin a la RLS complète.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { resoudreContexte } from '@/data/resoudreContexte'
import { validerPlanning, type ValidationInput } from '@/engine/validation/validerPlanning'
import {
  gardesVersPlanningPartiel,
  type GardeRow,
} from '@/engine/validation/gardesVersPlanning'
import {
  comparerAttributionsV1V2,
  type AttributionLue,
} from '@/data/attributionRows'
import { signalerIncidentTechnique } from '@/lib/notifications-inapp'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlanningPartiel } from '@/engine/types'
import type { ViolationRevalidation } from '@/components/planning/types-revalidation'

// ── Server Action : re-valider les périodes publiées affichées ──

/**
 * Re-valide une ou plusieurs périodes publiées et retourne TOUTES les
 * violations de contraintes dures détectées (tableau vide = planning fiable).
 *
 * Appelée par le composant client `RevalidationRealtime` :
 *   - une fois au montage (cohérence avec le SSR),
 *   - à chaque event Realtime (gardes/conges/periodes/veterinaires/regles).
 *
 * @param periodeIds  périodes à re-valider (typiquement la/les période(s)
 *                    publiée(s) visible(s) sur le mois affiché).
 */
export async function revaliderPlanningPublie(
  periodeIds: string[]
): Promise<ViolationRevalidation[]> {
  if (!periodeIds || periodeIds.length === 0) return []

  const supabase = await createClient()

  // ── Auth + rôle admin (la re-validation exige la RLS complète) ──
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()
  if (vet?.role_app !== 'admin') return []

  const cabinetId = user.app_metadata?.cabinet_id as string | undefined
  if (!cabinetId) return []

  const out: ViolationRevalidation[] = []
  const vues = new Set<string>() // dédoublonnage inter-périodes

  for (const periodeId of [...new Set(periodeIds)]) {
    // 1. Contexte (vets + contraintes + congés + calendrier + structure + effectif).
    //    autoriserVerrouille : une période publiée peut aussi être verrouillée.
    let ctx
    try {
      ctx = await resoudreContexte(periodeId, cabinetId, { autoriserVerrouille: true })
    } catch {
      continue // période introuvable / inaccessible → on ignore (best-effort)
    }

    // 2. Gardes publiées de la période (source de vérité V1).
    const { data: gardes, error } = await supabase
      .from('gardes')
      .select('id, date, type, premier_id, second_id')
      .eq('periode_id', periodeId)
      .eq('cabinet_id', cabinetId)
    if (error || !gardes || gardes.length === 0) continue

    // 2b. Reconstruction SUR-MESURE (P3b) : rôles du catalogue + miroir
    //     garde_placements (les colonnes V1 ne portent que 2 places, et des
    //     labels premier/second — la couverture attend les rôles réels).
    const rolesParCode: Record<string, string[]> = {}
    for (const c of ctx.creneaux ?? []) {
      if (c.code) rolesParCode[c.code] = c.roles
    }
    const typesV1 = new Set(['semaine', 'weekend', 'ferie'])
    const idsSurMesure = (gardes as GardeRow[])
      .filter((g) => !typesV1.has(g.type))
      .map((g) => g.id)
      .filter((id): id is string => Boolean(id))
    const placementsParGarde: Record<string, { garde_id: string; place_index: number; role: string; veterinaire_id: string | null }[]> = {}
    if (idsSurMesure.length > 0) {
      const { data: placs } = await supabase
        .from('garde_placements')
        .select('garde_id, place_index, role, veterinaire_id')
        .in('garde_id', idsSurMesure)
      for (const p of ((placs ?? []) as { garde_id: string; place_index: number; role: string; veterinaire_id: string | null }[])) {
        (placementsParGarde[p.garde_id] ??= []).push(p)
      }
    }

    const planning = gardesVersPlanningPartiel(gardes as GardeRow[], {
      rolesParCode,
      placementsParGarde,
      // P6 (verrou n°3) : la synthèse du vendredi APPLIQUE les MÊMES relations
      // que le validateur ci-dessous (ctx.structureConfig.relations) — sinon la
      // reconstruction et le contrôle divergeraient pour un cabinet qui pilote
      // ses relations. undefined → couple historique (byte-identique).
      relations: ctx.structureConfig?.relations,
    })

    // 2c. DÉTECTEUR DE DÉRIVE V1 ↔ V2 (P6 verrou n°7, étape 3) — premier
    //     LECTEUR réel d'`attributions` : contrôle de cohérence EN COMPLÉMENT
    //     (jamais en remplacement) de la re-validation. Si la synchro V2 fuit
    //     quelque part en prod (chemin d'écriture oublié, échec silencieux),
    //     c'est ICI qu'on le voit : console + cloche admin (anti-spam 24 h).
    //     Best-effort : ne perturbe JAMAIS la re-validation elle-même.
    await detecterDeriveV1V2(supabase, periodeId, cabinetId, planning)

    // 3. Re-validation indépendante.
    const input: ValidationInput = {
      dateDebut: ctx.dateDebut,
      dateFin: ctx.dateFin,
      saison: ctx.saison,
      vets: ctx.vets,
      calendrier: ctx.calendrier,
      nbVetosSemaineSoir: ctx.nbVetosSemaineSoir,
      structureConfig: ctx.structureConfig,
      // Catalogue-aware (P0) : MÊME source que le moteur → validateur et solver
      // voient la même structure de gardes. Défaut (seed 4 types) = comportement
      // historique, prouvé équivalent par p0-validateur-catalogue-equivalence.
      creneaux: ctx.creneaux,
      // #17 — MÊME lookback inter-périodes que le solver a vu à la génération :
      // les deux gardiens jugent la jonction de périodes sur la même donnée.
      contexteAnterieur: ctx.contexteAnterieur,
    }

    for (const v of validerPlanning(planning, input)) {
      const cle = `${v.regle}|${v.date}|${v.type}|${v.role ?? ''}|${v.vetId ?? ''}`
      if (vues.has(cle)) continue
      vues.add(cle)
      out.push({
        regle: v.regle,
        date: v.date,
        type: v.type,
        role: v.role,
        vetId: v.vetId,
        detail: v.detail,
      })
    }
  }

  // Tri chronologique pour un affichage lisible.
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return out
}

// ── Détecteur de dérive V1 ↔ V2 (helper privé, best-effort) ──

/**
 * Confronte le planning reconstruit depuis la V1 (source de vérité des écrans)
 * aux lignes réelles de la table `attributions` (V2). Comparaison en MULTISET
 * (jour Paris × véto × rôle) — insensible aux horodatages exacts, mais le
 * vendredi V2 explicite est bien comparé au vendredi DÉRIVÉ de la V1 (les deux
 * tombent sur le même jour). Toute divergence = la synchro V2 a fui quelque
 * part → console.error + incident in-app (anti-spam 24 h par titre).
 */
async function detecterDeriveV1V2(
  supabase: SupabaseClient,
  periodeId: string,
  cabinetId: string,
  planningV1: PlanningPartiel,
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('attributions')
      .select('veterinaire_id, role, date_debut_reel')
      .eq('planning_id', periodeId)
      .eq('cabinet_id', cabinetId)

    if (error) return // lecture V2 impossible → on ne bloque pas la re-validation

    const divergences = comparerAttributionsV1V2(
      planningV1,
      (data ?? []) as AttributionLue[],
    )
    if (divergences.length === 0) return

    const extrait = divergences
      .slice(0, 10)
      .map((d) => `${d.date} ${d.role} ${d.nature === 'manquant' ? 'absent de V2' : 'orphelin en V2'} (vet ${d.veterinaireId})`)
      .join(' ; ')
    console.error(
      `[derive-V1V2] période ${periodeId} : ${divergences.length} divergence(s) gardes↔attributions — ${extrait}`,
    )

    await signalerIncidentTechnique(
      supabase, cabinetId,
      'Divergence détectée entre le planning et sa copie technique (V2)',
      `Le contrôle de cohérence a détecté ${divergences.length} différence(s) entre le planning affiché et sa copie technique (table attributions) sur la période. Le planning affiché reste la référence ; signale-le pour qu'on resynchronise.`,
    )
  } catch (e) {
    console.error('[derive-V1V2] contrôle de cohérence en échec:', e)
  }
}
