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
import { monterValidationPeriode } from '@/data/monterValidationPeriode'
import { validerPlanning } from '@/engine/validation/validerPlanning'
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
    // 1-2. Montage PARTAGÉ avec le garde-fou du chemin manuel (PATCH garde) :
    //      contexte + gardes réelles + reconstruction (vendredi synthétisé,
    //      places sur-mesure, lookback #17). Extrait ici pour que les deux
    //      appelants ne puissent pas juger sur une reconstruction différente.
    //      null = période introuvable / vide → on ignore (best-effort).
    const montage = await monterValidationPeriode(supabase, periodeId, cabinetId)
    if (!montage) continue

    const planning = montage.construirePlanning(montage.gardes)

    // 2c. DÉTECTEUR DE DÉRIVE V1 ↔ V2 (P6 verrou n°7, étape 3) — premier
    //     LECTEUR réel d'`attributions` : contrôle de cohérence EN COMPLÉMENT
    //     (jamais en remplacement) de la re-validation. Si la synchro V2 fuit
    //     quelque part en prod (chemin d'écriture oublié, échec silencieux),
    //     c'est ICI qu'on le voit : console + cloche admin (anti-spam 24 h).
    //     Best-effort : ne perturbe JAMAIS la re-validation elle-même.
    await detecterDeriveV1V2(supabase, periodeId, cabinetId, planning)

    // 3. Re-validation indépendante.
    for (const v of validerPlanning(planning, montage.input)) {
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
        // Lot 1 : l'origine traverse la Server Action telle quelle. Absente =
        // violation du planning affiché ; 'anterieure' = héritée de l'historique.
        origine: v.origine,
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
