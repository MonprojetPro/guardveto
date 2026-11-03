// ============================================================
// GUARDVETO — POST /api/gardes/[id]/prendre-place   (B-179c, 02/11)
// ============================================================
// Un vétérinaire prend LUI-MÊME une place vide d'une garde publiée.
// Corps : { placeIndex: number, confirmerAvertissements?: boolean }
// La personne placée est TOUJOURS la session connectée — jamais un autre.
//
// Calqué sur le volontariat (`api/absences/[id]/volontaire`), avec ses verrous,
// et la décision de MiKL : les règles N'INTERDISENT PAS, elles AVERTISSENT.
//
// ── CE QUI BLOQUE (le geste n'aurait pas de sens) ──────────────────────────
//   1. Session + fiche vétérinaire active ; cabinet lu dans le JETON
//      (`app_metadata.cabinet_id`), jamais du client.
//   2. La garde appartient à ce cabinet (RLS + filtre explicite).
//   3. `controlerPrisePlace` : planning diffusé, garde à partir de demain, place
//      PRÉVUE par le cabinet (catalogue + effectif), encore vide, et la personne
//      n'est pas déjà sur ce créneau.
//   4. Juste avant d'écrire, relecture au client SERVICE : si la place a été
//      prise entre-temps → 409 (la contrainte unique fait le reste en place ≥ 3).
//
// ── CE QUI AVERTIT (la personne tranche, une trace reste) ──────────────────
//   • le moteur ne l'aurait pas placée là (`proposerReparation`, le juge de la
//     génération) — places 1 et 2 ;
//   • le validateur de publication y voit une règle dure enfreinte
//     (`avertissementsReglesDures`) — places 1 et 2 ;
//   • un remplacement d'un jour déjà posé sur ce rôle ;
//   • places 3 et 4 : AUCUN juge ne sait encore les évaluer (le moteur ne
//     connaît que premier/second). On le DIT plutôt que de laisser croire à un
//     contrôle complet.
//
// ── ÉCRITURE ───────────────────────────────────────────────────────────────
//   La RLS de `gardes` réserve l'écriture aux admins. Comme le volontariat :
//   TOUTES les lectures de contrôle au client du vétérinaire (filet RLS), puis
//   UNE écriture bornée au client service, via `appliquerChangementGarde`
//   (compteurs, copie technique, agenda, e-mail — le cycle de tout le monde).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { appliquerChangementGarde } from '@/lib/gardes/appliquer-changement'
import {
  avertissementsReglesDures,
  tracerConfirmationMalgreAvertissement,
} from '@/lib/gardes/avertissements-regles'
import {
  avertissementRemplacementPonctuel,
  chargerExceptionsDesGardes,
} from '@/lib/gardes/exceptions-jour'
import { besoinSecondCreneau, chargerContextePourPeriode, mapDbTypeToEngine } from '@/lib/crise/contexte'
import { proposerReparation } from '@/engine/crise/reparer'
import { construireCatalogue, placesAttendues } from '@/lib/planning/placesAttendues'
import { labelDonneeDePlace, roleParDefaut } from '@/lib/gardes/places'
import { controlerPrisePlace, phraseMoteur } from '@/lib/gardes/prendrePlace'
import { libelleRaisonVet } from '@/engine/diagnostic'
import { creerNotification } from '@/lib/notifications-inapp'
import { libelleTypeGardeDb } from '@/lib/libelles-gardes'

export const maxDuration = 60

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('Variables Supabase service manquantes.')
  return createServiceClient(url, key)
}

interface Corps {
  placeIndex: number
  confirmerAvertissements?: boolean
}

function estCorps(v: unknown): v is Corps {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return typeof c.placeIndex === 'number' && Number.isInteger(c.placeIndex)
}

const aujourdhuiParis = () =>
  new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date())

const dateLisible = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${iso}T12:00:00Z`))

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: gardeId } = await params
  const corps: unknown = await request.json().catch(() => null)
  if (!estCorps(corps)) {
    return NextResponse.json({ error: 'Requête invalide : placeIndex attendu.' }, { status: 400 })
  }

  const supabase = await createClient()

  // ── 1. Qui agit ──────────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const cabinetId = user.app_metadata?.cabinet_id as string | undefined
  if (!cabinetId) {
    return NextResponse.json({ error: 'Cabinet non configuré pour cet utilisateur.' }, { status: 403 })
  }

  const { data: moi } = await supabase
    .from('veterinaires')
    .select('id, prenom, cabinet_id, actif')
    .eq('user_id', user.id)
    .maybeSingle()
  // Pas de fiche vétérinaire (secrétariat) : personne à placer.
  if (!moi || moi.actif === false) {
    return NextResponse.json({ error: 'Seul un vétérinaire actif peut prendre une place de garde.' }, { status: 403 })
  }
  if (moi.cabinet_id !== cabinetId) {
    return NextResponse.json({ error: 'Incohérence de cabinet.' }, { status: 403 })
  }

  // ── 2. La garde, lue avec le client du vétérinaire ──────────────────────
  const { data: garde } = await supabase
    .from('gardes')
    .select('id, date, type, periode_id, cabinet_id, premier_id, second_id, periode:periode_id(id, date_debut, date_fin, saison, nb_vetos_semaine_soir, profil_id, publie_at)')
    .eq('id', gardeId)
    .eq('cabinet_id', cabinetId)
    .maybeSingle()
  if (!garde) return NextResponse.json({ error: 'Garde introuvable dans ce cabinet.' }, { status: 404 })

  const periodeBrute = (garde as Record<string, unknown>).periode
  const periode = (Array.isArray(periodeBrute) ? periodeBrute[0] : periodeBrute) as {
    id: string; date_debut: string; date_fin: string; saison: 'ete' | 'hiver'
    nb_vetos_semaine_soir: number | null; profil_id: string | null; publie_at: string | null
  } | null
  if (!periode) return NextResponse.json({ error: 'Période de la garde introuvable.' }, { status: 404 })

  // ── 3. La place existe-t-elle, est-elle libre ? ─────────────────────────
  const [catalogueRes, profilsRes, placementsRes] = await Promise.all([
    supabase.from('creneau_modele').select('code, nb_places').not('code', 'is', null),
    supabase.from('profils_planning').select('id, nb_vetos_semaine_soir'),
    supabase.from('garde_placements').select('place_index, veterinaire_id').eq('garde_id', gardeId).gte('place_index', 2),
  ])
  // Une lecture en échec ne doit pas se lire « aucune place » ni « place libre ».
  const erreurLecture = catalogueRes.error ?? profilsRes.error ?? placementsRes.error
  if (erreurLecture) {
    return NextResponse.json({ error: `Lecture impossible : ${erreurLecture.message}` }, { status: 500 })
  }

  const attendues = placesAttendues({
    typePlanning: garde.type as string,
    date: garde.date as string,
    catalogue: construireCatalogue((catalogueRes.data ?? []) as { code: string | null; nb_places: number | null }[]),
    periodes: [periode],
    profils: new Map(((profilsRes.data ?? []) as { id: string; nb_vetos_semaine_soir: number | null }[]).map((p) => [p.id, p])),
  })

  const occupants = new Map<number, string>()
  if (garde.premier_id) occupants.set(0, garde.premier_id as string)
  if (garde.second_id) occupants.set(1, garde.second_id as string)
  for (const p of (placementsRes.data ?? []) as { place_index: number; veterinaire_id: string }[]) {
    occupants.set(p.place_index, p.veterinaire_id)
  }

  const refus = controlerPrisePlace({
    aujourdhui: aujourdhuiParis(),
    date: garde.date as string,
    periodePubliee: Boolean(periode.publie_at),
    placeIndex: corps.placeIndex,
    attendues,
    occupants,
    moiVetId: moi.id,
  })
  if (refus) return NextResponse.json({ error: refus.error }, { status: refus.status })

  const index = corps.placeIndex
  const premier_id = index === 0 ? moi.id : ((garde.premier_id as string | null) ?? null)
  const second_id = index === 1 ? moi.id : ((garde.second_id as string | null) ?? null)

  // ── 4. Les AVERTISSEMENTS — rien ici n'interdit ─────────────────────────
  const avertissements: string[] = []
  if (index <= 1) {
    const role = index === 0 ? 'premier' : 'second'
    try {
      const ctx = await chargerContextePourPeriode(supabase, periode.id, cabinetId)
      const typeEngine = mapDbTypeToEngine(garde.type as string)
      const resultat = proposerReparation({
        creneau: {
          date: garde.date as string,
          type: typeEngine,
          role,
          saison: periode.saison,
          besoinSecond: besoinSecondCreneau(typeEngine, periode.saison, ctx.nbVetosSemaineSoir, ctx.placesNuitSemaine),
        },
        // Personne n'est remplacé : la place est vide.
        absentId: '',
        vets: ctx.vets,
        planningComplet: ctx.planningComplet,
        calendrier: ctx.calendrier,
        structure: ctx.structure,
        equityWeights: ctx.equityWeights,
        roleAvantageFinancier: ctx.roleAvantageFinancier,
        contexteAnterieur: ctx.contexteAnterieur,
        // B-179e — SA raison à elle, pas le diagnostic de toute l'équipe.
        expliquerPour: moi.id,
      })
      if (!resultat.candidats.some((c) => c.vetId === moi.id)) {
        // ⚠️ Jamais `resultat.diagnostic` ici : il agrège les règles de TOUS les
        //    vétos (et d'autres créneaux) — Fanny lisait celles d'Anne-Sophie,
        //    de Victor et d'Antoine (03/11).
        const vetMoi = ctx.vets.find((v) => v.id === moi.id)
        const libelle = resultat.raisonPour && vetMoi
          ? libelleRaisonVet(resultat.raisonPour, vetMoi, ctx.vets)
          : null
        avertissements.push(phraseMoteur(libelle))
      }
    } catch (err) {
      // Un juge qui ne répond pas ne vaut pas « tout va bien » : on le dit.
      console.error('[prendre-place] moteur indisponible :', err instanceof Error ? err.message : String(err))
      avertissements.push('Les règles du planning n’ont pas pu être vérifiées pour cette place.')
    }

    avertissements.push(
      ...(await avertissementsReglesDures(supabase, [{ gardeId, premier_id, second_id }], periode.id, cabinetId)),
    )
  } else {
    avertissements.push(
      'Les règles du planning ne savent pas encore vérifier la 3e place et au-delà : vérifiez vous-même votre rythme avant d’accepter.',
    )
  }

  let service
  try {
    service = getServiceClient()
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  if (index <= 1) {
    const phrase = avertissementRemplacementPonctuel(
      { id: gardeId, date: garde.date as string, premier_id: null, second_id: null },
      await chargerExceptionsDesGardes(service, [gardeId]),
      index === 0 ? 'premier' : 'second',
    )
    if (phrase) avertissements.unshift(phrase)
  }

  if (avertissements.length > 0 && corps.confirmerAvertissements !== true) {
    return NextResponse.json(
      {
        error: avertissements.length === 1 ? avertissements[0] : `${avertissements.length} points à vérifier avant de prendre cette place.`,
        warnings: avertissements,
        needsConfirmation: true,
      },
      { status: 409 },
    )
  }

  // ── 5. Dernier contrôle, au plus frais, puis l'écriture ─────────────────
  const { data: fraiche } = await service
    .from('gardes')
    .select('id, cabinet_id, premier_id, second_id')
    .eq('id', gardeId)
    .single()
  if (!fraiche || fraiche.cabinet_id !== cabinetId) {
    return NextResponse.json({ error: 'Garde introuvable.' }, { status: 404 })
  }
  if ((index === 0 && fraiche.premier_id) || (index === 1 && fraiche.second_id)) {
    return NextResponse.json({ error: 'Cette place vient d’être prise par quelqu’un d’autre.' }, { status: 409 })
  }
  if (fraiche.premier_id === moi.id || fraiche.second_id === moi.id) {
    return NextResponse.json({ error: 'Vous êtes déjà de garde sur ce créneau.' }, { status: 409 })
  }

  const app = await appliquerChangementGarde({
    supabase: service,
    gardeId,
    premier_id: index === 0 ? moi.id : (fraiche.premier_id as string | null),
    second_id: index === 1 ? moi.id : (fraiche.second_id as string | null),
    force: true,
    auteurVetId: moi.id,
    cabinetId,
    placeSup: index >= 2
      ? { index, role: labelDonneeDePlace(index) ?? roleParDefaut(index), vetId: moi.id }
      : undefined,
    // La place n'est écrite que si elle est ENCORE vide à l'instant de
    // l'écriture (places 1 et 2 ; au-delà, la contrainte unique s'en charge).
    siVide: index === 0 ? 'premier_id' : index === 1 ? 'second_id' : undefined,
  })
  if (!app.ok) return NextResponse.json({ error: app.error }, { status: app.status })

  // ── 6. Les traces ───────────────────────────────────────────────────────
  if (avertissements.length > 0) {
    await tracerConfirmationMalgreAvertissement(service, {
      gardeId,
      chemin: 'prise-place-libre',
      auteurVetId: moi.id,
      avertissements,
      avant: { premier_id: fraiche.premier_id as string | null, second_id: fraiche.second_id as string | null },
      apres: { premier_id, second_id },
      contexte: { place_index: index },
    })
  }

  // L'administratrice est prévenue dans sa cloche. Service : on borne au
  // cabinet EXPLICITEMENT, la RLS ne le fait plus pour nous.
  const { data: admins } = await service
    .from('veterinaires')
    .select('id')
    .eq('cabinet_id', cabinetId)
    .eq('role_app', 'admin')
    .eq('actif', true)
  const libelle = libelleTypeGardeDb(garde.type as string)
  for (const a of (admins ?? []) as { id: string }[]) {
    if (a.id === moi.id) continue
    await creerNotification(service, {
      veterinaireId: a.id,
      type: 'garde_modifiee',
      titre: `${moi.prenom} a pris une place libre`,
      message: `${moi.prenom} s’est placé·e en ${roleParDefaut(index)} sur « ${libelle} », ${dateLisible(garde.date as string)}.${avertissements.length > 0 ? ` Malgré ${avertissements.length > 1 ? `${avertissements.length} avertissements` : 'un avertissement'} : ${avertissements.join(' ')}` : ''}`,
      lien: `/planning?mois=${(garde.date as string).slice(0, 7)}`,
      cabinetId,
    })
  }

  return NextResponse.json({ success: true, gardeId, placeIndex: index })
}
