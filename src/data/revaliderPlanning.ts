'use server'

// ============================================================
// GUARDVETO — Re-validation continue d'un planning (Chantier B, élargi B-130a)
// ============================================================
// Le validateur indépendant `validerPlanning` prouve, à la génération, que le
// planning respecte toutes les contraintes DURES. Mais une fois écrit, plus
// rien ne le re-vérifiait : un congé validé a posteriori, une règle modifiée,
// une édition manuelle ou une réparation de crise pouvaient introduire une
// violation invisible. Ce module BRANCHE le validateur en prod : il recharge
// l'état réel (gardes + règles + calendrier) et re-confronte le tout.
//
// ── B-130a (2026-09-30) : LES BROUILLONS AUSSI ─────────────────────────────
//
// Ce contrôle ne tournait QUE sur les périodes publiées. C'est ce qui a coûté
// B-130 : le 25/09, MiKL fait passer `espacement_min` de « évitée » à
// « jamais » APRÈS avoir généré Hiver P2. À cette seconde, son planning déjà
// enregistré devient non conforme — et rien ne le dit, la période étant en
// BROUILLON. Il l'a vu à l'œil nu sur la grille, et a conclu à un bug du
// moteur qui n'existait pas. Un correcteur qui ne s'allume que sur les
// documents déjà imprimés.
//
// Un brouillon est précisément le moment où l'admin peut encore corriger.
// C'est donc là que le signal vaut le plus cher, pas seulement après coup.
//
// ⚠️ MAIS PAS LE MÊME SIGNAL. Sur un brouillon, les cases encore vides sont un
// ÉTAT NORMAL — on est en train de le construire, et elles sont déjà comptées
// ailleurs (« 9 cases restent à pourvoir »). Les remonter ici ferait crier le
// bandeau à chaque génération partielle, et un bandeau qui crie toujours ne se
// lit plus. Décision de MiKL, 30/09 : sur un brouillon, **seulement les règles
// enfreintes, pas les cases vides**. Les violations `COUVERTURE` sont donc
// écartées pour les brouillons — et pour eux seuls.
//
// ⚠️ LE FILTRE VIT ICI, PAS CHEZ LES APPELANTS. Six écrans appellent cette
// fonction. Si chacun décidait quelles périodes surveiller et quoi taire, ils
// divergeraient — c'est le défaut « trois chemins d'écriture, deux gardiens »
// déjà payé sur ce projet le 22/08. Un appelant demande des périodes ; c'est
// ce module qui lit leur statut et décide. Une période VERROUILLÉE reste
// écartée : elle ne se modifie plus, signaler n'y ouvre aucune décision.
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
import type { StatutPeriode } from '@/types'
import {
  estSurveillee,
  remonteLesCasesVides,
  REGLE_CASE_VIDE,
} from '@/lib/produit/surveillancePlanning'
import type { ViolationRevalidation } from '@/components/planning/types-revalidation'

// ── Server Action : re-valider les périodes publiées affichées ──

/**
 * Re-valide une ou plusieurs périodes et retourne les violations de contraintes
 * dures détectées (tableau vide = planning fiable).
 *
 * L'appelant demande des périodes ; CE MODULE décide lesquelles sont
 * surveillables et ce qui est remonté pour chacune (cf. l'en-tête) :
 *   - `publie`     → toutes les violations, cases vides comprises ;
 *   - `brouillon`  → les règles enfreintes SEULEMENT, jamais les cases vides ;
 *   - `verrouille` → rien : la période ne se modifie plus.
 *
 * Appelée par le composant client `RevalidationRealtime` :
 *   - une fois au montage (cohérence avec le SSR),
 *   - à chaque event Realtime (gardes/conges/periodes/veterinaires/regles).
 *
 * @param periodeIds  périodes à re-valider (typiquement celle(s) visible(s) sur
 *                    le mois affiché). Les non-surveillables sont ignorées.
 */
export async function revaliderPlanning(
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

  const ids = [...new Set(periodeIds)]

  // ── B-130a — quelles périodes, et quel signal pour chacune ──────────────
  //
  // Lu EN BASE, jamais reçu de l'appelant : un écran qui se tromperait de
  // statut ferait taire le contrôle sans que ça se voie nulle part. La base
  // est la seule source qui ne peut pas mentir sur l'état d'une période.
  //
  // Une lecture qui échoue ne doit pas éteindre le contrôle en silence : on
  // retombe alors sur le comportement d'avant B-130a (publié seulement), qui
  // est le repli le plus étroit — jamais sur « on surveille tout ».
  const { data: statutsDb, error: statutsErr } = await supabase
    .from('periodes')
    .select('id, statut')
    .in('id', ids)
    .eq('cabinet_id', cabinetId)

  if (statutsErr) {
    console.error('[revalidation] lecture des statuts impossible :', statutsErr.message)
    return []
  }

  const statutParId = new Map(
    ((statutsDb ?? []) as { id: string; statut: StatutPeriode }[]).map((p) => [p.id, p.statut]),
  )

  const out: ViolationRevalidation[] = []
  const vues = new Set<string>() // dédoublonnage inter-périodes

  for (const periodeId of ids) {
    const statut = statutParId.get(periodeId)

    // Le régime (surveillée ? cases vides remontées ?) vit dans
    // `lib/produit/surveillancePlanning.ts`, en table exhaustive par statut :
    // un statut ajouté sans décision ne compile pas. Une période inconnue —
    // introuvable, ou d'un autre cabinet que la RLS a déjà écartée — n'est pas
    // surveillée : juger sans connaître l'état produirait un verdict sans valeur.
    if (!estSurveillee(statut)) continue
    const taireLesCasesVides = !remonteLesCasesVides(statut)

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
    //
    //     ⚠️ B-156 — ON LUI DONNE LES TITULAIRES, PAS LE PLANNING VÉCU. La table
    //     `attributions` ne porte pas les remplacements ponctuels : ni la
    //     synchro V2 ni la pose d'un remplacement ne les y recopient. Comparer
    //     le planning vécu à cette copie-là ferait sonner la cloche de l'admin à
    //     chaque remplacement — une alerte fausse FABRIQUÉE par le correctif de
    //     ce matin (B-155a). ➜ B-156a : faire porter les remplacements à la V2
    //     est le vrai correctif, et c'est un chantier d'écriture, pas une
    //     comparaison à ajuster.
    await detecterDeriveV1V2(
      supabase,
      periodeId,
      cabinetId,
      montage.construirePlanning(montage.gardesTitulaires),
    )

    // 3. Re-validation indépendante.
    for (const v of validerPlanning(planning, montage.input)) {
      if (taireLesCasesVides && v.regle === REGLE_CASE_VIDE) continue
      // (filtre place par place plutôt qu'en bloc : le dédoublonnage
      //  inter-périodes ci-dessous travaille sur le flux, pas sur un tableau)
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
