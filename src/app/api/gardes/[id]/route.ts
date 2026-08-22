// ============================================================
// GUARDVETO — PATCH /api/gardes/[id]
// ============================================================
// Modification manuelle d'une garde (admin uniquement).
// Marque la garde comme modifie_manuellement=true.
// Si force=true : déverrouille la garde, logue dans audit_log
//                et recalcule les bonus/malus de la période.
//
// Le cycle d'application (update + audit + bilan + agenda + email) est
// factorisé dans `appliquerChangementGarde` (réutilisé aussi par la
// gestion de crise — POST /api/absences/[id]/reparer).
//
// GARDE-FOU MÉTIER (backlog n°12) — validation AU MOMENT DE L'ÉCRITURE :
// avant d'appliquer, on refuse (sauf confirmation explicite) d'affecter un
// vétérinaire INACTIF (compte désactivé) ou en CONGÉ VALIDÉ sur la date de la
// garde. Le helper `appliquerChangementGarde` ne fait volontairement AUCUN
// contrôle métier (contrat) : c'est la route appelante qui décide. La crise
// (POST /api/absences/[id]/reparer) valide de son côté via proposerReparation —
// ce garde-fou ne concerne donc QUE l'édition manuelle.
//
// GARDE-FOU RÈGLES DURES (lot 1) — LE trou par lequel le bug est passé :
// il existait TROIS chemins d'écriture d'une garde (solver, validateur,
// modification manuelle) et seulement DEUX gardiens. Cette route ne regardait
// que « véto inactif » et « congé validé » ; toutes les règles de rythme
// (espacement, fréquence des week-ends, séries…) passaient sans un mot. L'admin
// a ainsi pu se placer sur trois week-ends consécutifs contre une règle DURE.
//
// On rejoue donc le changement EN MÉMOIRE et on le confronte au MÊME juge que
// la publication — `validerPlanning`, jamais un contrôle réécrit ici — puis on
// ne remonte que le DELTA (ce que ce geste ajoute). Conformément à la doctrine
// « le système INFORME, il n'interdit pas », ça ne bloque rien : l'admin
// confirme et l'écriture se fait, avec sa trace dans `audit_log` si elle force.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { appliquerChangementGarde } from '@/lib/gardes/appliquer-changement'
import { appliquerExceptionJour } from '@/lib/gardes/appliquer-exception'
import { monterValidationPeriode } from '@/data/monterValidationPeriode'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import {
  simulerChangementGarde,
  violationsIntroduites,
  phraseAvertissement,
  planningDuJour,
  remplacerOccupantsDuJour,
} from '@/lib/gardes/controle-regles'

/**
 * Contrôle métier « ce véto est-il légalement affectable sur cette date ? » au
 * moment du geste. Retourne la liste d'avertissements (vide = tout va bien) :
 *   • véto INACTIF (compte désactivé) ;
 *   • véto en CONGÉ VALIDÉ couvrant la date de la garde.
 *
 * On ne valide QUE les vétos réellement affectés (premier_id / second_id du
 * corps, non nuls et dédupliqués). Lecture RLS-aware (bornée au cabinet).
 */
async function avertissementsAffectation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  gardeDate: string,
  premier_id: string | null,
  second_id: string | null,
): Promise<string[]> {
  const cibles = [...new Set([premier_id, second_id].filter((v): v is string => Boolean(v)))]
  if (cibles.length === 0) return []

  const warnings: string[] = []

  // 1. Statut actif + identité des vétos affectés.
  const { data: vetsDb } = await supabase
    .from('veterinaires')
    .select('id, prenom, nom, actif')
    .in('id', cibles)

  type VetRow = { id: string; prenom: string; nom: string; actif: boolean }
  const vets = (vetsDb as VetRow[] | null) ?? []
  const nomDe = (id: string) => {
    const v = vets.find((x) => x.id === id)
    return v ? `${v.prenom} ${v.nom}`.trim() : 'Ce vétérinaire'
  }

  for (const v of vets) {
    if (!v.actif) {
      warnings.push(`${v.prenom} ${v.nom}`.trim() + ' a un compte désactivé (inactif) : il/elle ne devrait plus être de garde.')
    }
  }

  // 2. Congés VALIDÉS couvrant la date de la garde (indisponibilité incluse).
  const { data: congesDb } = await supabase
    .from('conges')
    .select('veterinaire_id, type')
    .eq('statut', 'valide')
    .in('veterinaire_id', cibles)
    .lte('date_debut', gardeDate)
    .gte('date_fin', gardeDate)

  type CongeRow = { veterinaire_id: string; type: string }
  for (const c of (congesDb as CongeRow[] | null) ?? []) {
    const motif = c.type === 'indisponibilite' ? 'indisponible' : 'en congé validé'
    warnings.push(`${nomDe(c.veterinaire_id)} est ${motif} le ${gardeDate}.`)
  }

  return warnings
}

/**
 * Confronte le changement demandé aux RÈGLES DURES du cabinet, sans rien écrire.
 *
 * Le montage (`monterValidationPeriode`) et le juge (`validerPlanning`) sont
 * EXACTEMENT ceux de la re-validation continue : aucune règle n'est
 * réimplémentée ici — c'est la faute qui a créé ce bug, on ne la refait pas.
 *
 * Best-effort ASSUMÉ : période introuvable, contexte illisible, exception
 * inattendue → tableau vide, l'édition passe. Un contrôle informatif qui
 * empêcherait l'admin de travailler quand il tombe en panne serait pire que son
 * absence — et la re-validation continue rattrapera l'écart de toute façon.
 */
async function avertissementsReglesDures(
  supabase: Awaited<ReturnType<typeof createClient>>,
  gardeId: string,
  periodeId: string,
  cabinetId: string,
  premier_id: string | null,
  second_id: string | null,
): Promise<string[]> {
  try {
    const montage = await monterValidationPeriode(supabase, periodeId, cabinetId)
    if (!montage) return []

    // La garde touchée n'a plus le miroir `garde_placements` à jour (il porte
    // encore l'ANCIENNE paire) : on la reconstruit depuis premier_id/second_id.
    const avant = validerPlanning(
      montage.construirePlanning(montage.gardes, [gardeId]),
      montage.input,
    )
    const apres = validerPlanning(
      montage.construirePlanning(
        simulerChangementGarde(montage.gardes, gardeId, premier_id, second_id),
        [gardeId],
      ),
      montage.input,
    )

    return violationsIntroduites(avant, apres).map(phraseAvertissement)
  } catch (e) {
    console.error(
      '[PATCH garde] contrôle des règles dures indisponible (édition laissée passer):',
      e instanceof Error ? e.message : String(e),
    )
    return []
  }
}

/**
 * Même garde-fou, mais pour l'AUTRE mécanisme d'écriture de cette route : le
 * remplacement d'UN SEUL JOUR (`appliquerExceptionJour`).
 *
 * L'exception s'écrit dans `gardes_exceptions` ; la table `gardes` ne bouge pas,
 * donc le validateur ne verrait rien si on lui donnait la période telle quelle.
 * On lui soumet donc une période RÉDUITE À CE JOUR : les règles qui jugent
 * l'occupant d'un créneau répondent exactement, les règles de rythme se taisent
 * d'elles-mêmes (un seul créneau ne forme ni paire ni série) — ce qui est le
 * comportement VOULU, un jour exceptionnel n'étant pas une garde au sens de
 * l'équité. Raisonnement complet dans `lib/gardes/controle-regles.ts`.
 *
 * L'état « avant » est lu sur la VUE, pas sur `gardes` : elle applique déjà les
 * exceptions posées précédemment, donc corriger deux fois le même jour compare
 * bien au remplaçant en place, et non au titulaire d'origine.
 */
async function avertissementsReglesDuresJour(
  supabase: Awaited<ReturnType<typeof createClient>>,
  gardeId: string,
  jour: string,
  periodeId: string,
  cabinetId: string,
  premier_id: string | null,
  second_id: string | null,
): Promise<string[]> {
  try {
    const montage = await monterValidationPeriode(supabase, periodeId, cabinetId)
    if (!montage) return []

    // Le créneau de ce jour, seul. Vide (cas du DIMANCHE d'un week-end, qui n'a
    // pas de créneau propre — le bloc est daté du samedi) → rien à confronter.
    const duJour = planningDuJour(montage.construirePlanning(montage.gardes), jour)
    if (duJour.attributions.length === 0) return []

    const { data: vue } = await supabase
      .from('planning_semaine')
      .select('premier_id, second_id')
      .eq('id', gardeId)
      .eq('date', jour)
      .maybeSingle()
    const occupants = vue as { premier_id: string | null; second_id: string | null } | null

    const input = {
      ...montage.input,
      dateDebut: jour,
      dateFin: jour,
      // Pas de lookback : on ne juge pas le rythme sur un jour isolé.
      contexteAnterieur: undefined,
    }

    const avant = validerPlanning(
      occupants
        ? remplacerOccupantsDuJour(duJour, jour, occupants.premier_id, occupants.second_id)
        : duJour,
      input,
    )
    const apres = validerPlanning(
      remplacerOccupantsDuJour(duJour, jour, premier_id, second_id),
      input,
    )

    return violationsIntroduites(avant, apres).map(phraseAvertissement)
  } catch (e) {
    console.error(
      '[PATCH garde] contrôle des règles dures (jour) indisponible (édition laissée passer):',
      e instanceof Error ? e.message : String(e),
    )
    return []
  }
}

// La route attend la synchro agenda + l'envoi email avant de répondre
export const maxDuration = 60

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: gardeId } = await params
  const supabase = await createClient()

  // ── Auth + rôle admin ───────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('id, role_app')
    .eq('user_id', user.id)
    .single()

  if (vet?.role_app !== 'admin') {
    return NextResponse.json({ error: 'Accès réservé aux administrateurs.' }, { status: 403 })
  }

  // ── Validation du corps ─────────────────────────────────
  let premier_id: string | null
  let second_id: string | null
  let force: boolean
  let confirmerAvertissements: boolean
  // Backlog 8 bis — périmètre du changement. Une garde de week-end occupe
  // trois jours ; l'admin dit s'il touche le bloc entier (comportement
  // historique, défaut) ou ce SEUL jour. Le défaut est volontairement le
  // bloc : un client qui n'envoie pas le champ garde exactement l'ancien
  // comportement.
  let perimetre: 'bloc' | 'jour'
  let jour: string | null
  let compte1erWe: boolean

  try {
    const body = await req.json()
    premier_id = body?.premier_id ?? null
    second_id = body?.second_id ?? null
    force = body?.force === true
    // Confirmation explicite « affecter quand même » malgré un avertissement métier.
    confirmerAvertissements = body?.confirmerAvertissements === true
    perimetre = body?.perimetre === 'jour' ? 'jour' : 'bloc'
    jour = typeof body?.jour === 'string' ? body.jour : null
    compte1erWe = body?.compte1erWe === true
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 })
  }

  if (perimetre === 'jour' && !jour) {
    return NextResponse.json(
      { error: 'Impossible de savoir quel jour modifier.' },
      { status: 400 },
    )
  }

  // ── Garde-fou métier : véto inactif / en congé validé (backlog n°12) ──
  // On charge la date de la garde puis on vérifie les vétos affectés. Sans
  // confirmation explicite, on RENVOIE les avertissements (409) au lieu
  // d'appliquer en silence — l'UI d'édition les affiche et propose de forcer.
  // L'état AVANT sert deux fois : aux contrôles ci-dessous, et — si l'admin
  // confirme malgré un avertissement — à la trace dans `audit_log`.
  const { data: gardeAvant } = await supabase
    .from('gardes')
    .select('date, periode_id, cabinet_id, premier_id, second_id, verrouille, modifie_manuellement')
    .eq('id', gardeId)
    .single()

  if (!confirmerAvertissements) {
    // En périmètre JOUR, on contrôle la disponibilité sur LE JOUR touché, pas
    // sur la date de la ligne. Un remplaçant peut être en congé le samedi et
    // parfaitement libre le dimanche : vérifier le samedi refuserait à tort.
    const dateControlee = perimetre === 'jour' ? jour : (gardeAvant?.date ?? null)

    const warnings: string[] = []

    if (dateControlee) {
      warnings.push(
        ...(await avertissementsAffectation(
          supabase, dateControlee, premier_id, second_id,
        )),
      )
    }

    // Règles dures (lot 1) — LES DEUX mécanismes d'écriture de cette route.
    // Le bloc réécrit `gardes` : on rejoue la période entière, rythme compris.
    // Le jour pose une exception par-dessus : on juge le créneau de ce jour
    // seul, ce qui répond exactement sur l'occupant sans inventer un week-end
    // que le remplaçant n'a pas fait.
    if (gardeAvant?.periode_id && gardeAvant?.cabinet_id) {
      const periodeId = gardeAvant.periode_id as string
      const cabinetIdGarde = gardeAvant.cabinet_id as string
      warnings.push(
        ...(perimetre === 'jour' && jour
          ? await avertissementsReglesDuresJour(
              supabase, gardeId, jour, periodeId, cabinetIdGarde, premier_id, second_id,
            )
          : await avertissementsReglesDures(
              supabase, gardeId, periodeId, cabinetIdGarde, premier_id, second_id,
            )),
      )
    }

    if (warnings.length > 0) {
      return NextResponse.json(
        {
          error: warnings.length === 1
            ? warnings[0]
            : `${warnings.length} points de vigilance sur cette affectation.`,
          warnings,
          needsConfirmation: true,
        },
        { status: 409 },
      )
    }
  }

  // ── Application ──────────────────────────────────────────
  //
  // Deux mailles, deux helpers. Le bloc écrit dans `gardes` et fait bouger
  // l'équité ; le jour pose une exception par-dessus, sans y toucher — c'est
  // toute la différence entre « ce week-end est réattribué » et « untel ne
  // peut pas ce dimanche-là ».
  const res = perimetre === 'jour' && jour
    ? await appliquerExceptionJour({
        supabase,
        gardeId,
        jour,
        premier_id,
        second_id,
        compte1erWe,
        motif: 'exception',
        force,
        auteurVetId: vet.id,
      })
    : await appliquerChangementGarde({
        supabase,
        gardeId,
        premier_id,
        second_id,
        force,
        auteurVetId: vet.id,
      })

  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.status })
  }

  // ── Trace d'une confirmation MALGRÉ un avertissement ─────
  //
  // `force` n'est PAS le véhicule de « je confirme quand même » : il déverrouille
  // la garde au passage (`verrouille = false`). S'en servir pour tracer une simple
  // confirmation déverrouillerait des gardes en silence — un effet de bord au
  // mauvais endroit. Quand `force` est déjà vrai, `appliquerChangementGarde` a
  // écrit sa propre ligne ; on ne double pas. Sinon, on pose ICI la trace : un
  // avertissement qu'on décide d'ignorer doit rester retrouvable, sinon
  // « informer sans interdire » revient à ne rien dire du tout.
  //
  // Best-effort : la garde est déjà écrite, un échec d'audit ne doit pas faire
  // croire à l'admin que son geste a échoué.
  if (confirmerAvertissements && !force) {
    const { error: auditErr } = await supabase.from('audit_log').insert({
      table_name: 'gardes',
      record_id: gardeId,
      action: 'update',
      old_data: {
        premier_id: gardeAvant?.premier_id ?? null,
        second_id: gardeAvant?.second_id ?? null,
        modifie_manuellement: gardeAvant?.modifie_manuellement ?? null,
        confirmation_malgre_avertissement: true,
        perimetre,
        jour,
      },
      new_data: { premier_id, second_id, modifie_manuellement: true },
      user_id: vet.id,
    })
    if (auditErr) {
      console.error(
        '[PATCH garde] trace de confirmation non écrite dans audit_log:',
        auditErr.message,
      )
    }
  }

  return NextResponse.json({ success: true })
}
