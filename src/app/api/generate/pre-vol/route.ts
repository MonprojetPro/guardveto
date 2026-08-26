// ============================================================
// GUARDVETO — API Route GET /api/generate/pre-vol (backlog n°23 + n°24)
// ============================================================
// Pré-vol de cohérence AVANT génération. Appelé par l'écran de génération
// (ActionBar) dès qu'une période est sélectionnée. Renvoie :
//   • `avertissements` — incohérences de règles détectables AVANT de générer
//     (fonction pure preVolRegles : règles fantômes de vétos sortis,
//     contradictions arithmétiques certaines). NON bloquant.
//   • `souhaitsEnAttente` — demandes de congé en attente qui chevauchent la
//     période (MÊME source que le gate de publication — signal plus précoce).
//
// BEST-EFFORT ABSOLU : ce pré-vol ne doit JAMAIS empêcher de générer. Toute
// erreur interne renvoie une réponse vide (aucun avertissement) — la
// génération elle-même produira son propre message d'erreur, plus précis.
//
// Accès : admin uniquement (mêmes contrôles que POST /api/generate).
// Query : ?periodeId=<uuid>
// Réponse : { avertissements: AvertissementPreVol[], souhaitsEnAttente: number }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resoudreContexte } from '@/data/resoudreContexte'
import { compterSouhaitsCongesEnAttente } from '@/data/souhaitsCongesEnAttente'
import { mapperReglesCabinet, type RegleCabinetRow } from '@/data/mapReglesCabinet'
import { preVolRegles, type AvertissementPreVol, type VetAnnuaire } from '@/engine/pre-vol'
import type { ContrainteEngine } from '@/engine/types'

/** Réponse « rien à signaler » — le pré-vol silencieux n'affiche RIEN. */
const REPONSE_VIDE = { avertissements: [] as AvertissementPreVol[], souhaitsEnAttente: 0 }

/**
 * Charge ce qu'il faut pour la détection des règles FANTÔMES : les lignes
 * `regles_cabinet` mappées PAR VÉTO (avant filtrage actifs) + l'annuaire
 * complet des vétos (actifs et sortis).
 *
 * ⚠️ Requête MIROIR de chargerReglesCabinet (engine/loader.ts) — mêmes colonnes,
 * même scope (cabinet + périodiques/permanentes), même mapping partagé
 * (mapperReglesCabinet). Le loader ne peut pas être réutilisé tel quel ici :
 * il jette silencieusement les règles des vétos inactifs (aucun véto actif ne
 * les ramasse) — c'est PRÉCISÉMENT ce silence que le pré-vol lève.
 */
async function chargerDonneesFantomes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cabinetId: string,
  periodeId: string,
): Promise<{ contraintesParVet: Map<string, ContrainteEngine[]>; annuaire: VetAnnuaire[] }> {
  const [{ data: briquesDb }, { data: reglesDb }, { data: vetsDb }] = await Promise.all([
    supabase.from('briques_regles').select('id'),
    supabase
      .from('regles_cabinet')
      .select('id, cabinet_id, periode_id, brique_id, params_json, force, validite_json, version, actif')
      .eq('cabinet_id', cabinetId)
      .or(`periode_id.is.null,periode_id.eq.${periodeId}`)
      .order('id'),
    supabase.from('veterinaires').select('id, prenom, nom, actif'),
  ])

  const briquesConnues = new Set<string>(
    ((briquesDb as { id: string }[] | null) ?? []).map((b) => b.id),
  )
  const annuaire = ((vetsDb as VetAnnuaire[] | null) ?? [])
  // Dépliage « tous les vétérinaires » sur les seuls vétos ACTIFS : ce chargeur
  // lit volontairement AUSSI les inactifs (c'est son rôle : débusquer les règles
  // fantômes). Déplier une règle collective sur un véto inactif inventerait un
  // fantôme qui n'existe pas — le pré-vol crierait pour rien.
  const idsVetosActifs = annuaire.filter((v) => v.actif).map((v) => v.id)
  const { contraintesParVet } = mapperReglesCabinet(
    (reglesDb as RegleCabinetRow[] | null) ?? [],
    briquesConnues,
    idsVetosActifs,
  )
  return { contraintesParVet, annuaire }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()

  // ── Authentification + rôle admin (mêmes contrôles que /api/generate) ──
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()

  if (vet?.role_app !== 'admin') {
    return NextResponse.json({ error: 'Accès réservé aux administrateurs.' }, { status: 403 })
  }

  // Cabinet depuis app_metadata uniquement (règle C1 — jamais user_metadata).
  const cabinetId = user.app_metadata?.cabinet_id as string | undefined
  if (!cabinetId) {
    return NextResponse.json({ error: 'Cabinet non configuré.' }, { status: 403 })
  }

  const periodeId = req.nextUrl.searchParams.get('periodeId')
  if (!periodeId) {
    return NextResponse.json({ error: 'periodeId manquant.' }, { status: 400 })
  }

  // ── Contexte de la période (même chargement que la génération) ──
  // Échec (période introuvable, verrouillée…) → pré-vol silencieux : la
  // génération produira son propre message, plus précis.
  let contexte
  try {
    // B-046 — le pré-vol annonce ce que la génération VA faire : il doit donc
    // raisonner sur le MÊME effectif qu'elle, dernier recours exclu. Sinon il
    // rassurerait (« la charge est couverte ») sur des bras que le moteur
    // n'utilisera pas.
    contexte = await resoudreContexte(periodeId, cabinetId, { pourGeneration: true })
  } catch {
    return NextResponse.json(REPONSE_VIDE)
  }

  // ── n°24 — souhaits de congé en attente (source unique du gate publish) ──
  let souhaitsEnAttente = 0
  try {
    souhaitsEnAttente = await compterSouhaitsCongesEnAttente(
      supabase, contexte.dateDebut, contexte.dateFin,
    )
  } catch (e) {
    console.warn('[pre-vol] comptage des souhaits de congé échoué (best-effort):', e)
  }

  // ── n°23 — pré-vol de cohérence des règles (fonction pure) ──
  let avertissements: AvertissementPreVol[] = []
  try {
    const { contraintesParVet, annuaire } = await chargerDonneesFantomes(
      supabase, cabinetId, periodeId,
    )
    avertissements = preVolRegles({
      vets: contexte.vets,
      dateDebut: contexte.dateDebut,
      dateFin: contexte.dateFin,
      saison: contexte.saison,
      calendrier: contexte.calendrier,
      structureConfig: contexte.structureConfig,
      creneaux: contexte.creneaux,
      nbVetosSemaineSoir: contexte.nbVetosSemaineSoir,
      annuaire,
      contraintesParVet,
      // #21 — cohortes d'équité (voyagent dans equityWeights) : signale un tag
      // sans porteur (léger, non bloquant).
      cohortesEquite: contexte.equityWeights?.cohortes,
      // B-046 — encore dans l'équipe, hors du moteur : sans cette liste, leurs
      // règles seraient annoncées comme « sans effet, tu peux les supprimer ».
      idsHorsGeneration: (contexte.exclusDernierRecours ?? []).map((v) => v.id),
    })
  } catch (e) {
    console.warn('[pre-vol] analyse de cohérence échouée (best-effort):', e)
  }

  return NextResponse.json({ avertissements, souhaitsEnAttente })
}
