// ============================================================
// GUARDVETO — POST /api/planning/places-figees (B-111)
// ============================================================
// LE GESTE DE L'ADMIN : « cette place-là, c'est moi qui la décide ».
//
// MiKL, le 04/09 : « l'admin doit pouvoir pré-remplir certaines dates […] ces
// dates seront d'office cadenassées […] et si ça va à l'encontre de certaines
// règles juste l'indiquer sans bloquer, puisque c'est l'admin qui aura décidé ».
//
// ── TROIS GESTES, ET PAS UN DE PLUS ────────────────────────────────────────
//
//   poser   — mettre quelqu'un sur cette place ET la cadenasser. C'est le geste
//             du pré-remplissage (période encore vide) comme celui du brouillon
//             (« celle-ci, je la garde »).
//   liberer — retirer le cadenas SANS retirer la personne : elle reste, mais la
//             prochaine génération peut la rebattre.
//   vider   — retirer la personne ET son cadenas.
//
// `liberer` et `vider` sont bien deux gestes distincts, et les confondre serait
// coûteux : MiKL a demandé « sauf si l'admin supprime ou enlève le cadenas ».
// Enlever le cadenas d'une garde qu'on veut garder telle quelle est un geste
// courant ; perdre la personne au passage ne serait compris par personne.
//
// ── CE QUI EST CRÉÉ AU BESOIN ──────────────────────────────────────────────
//
// Avant génération, une période n'a AUCUNE ligne dans `gardes` : il n'y a rien
// à modifier. `poser` crée donc la garde si elle n'existe pas — c'est ce qui
// manquait au produit (`appliquerChangementGarde` ne sait que modifier une
// garde existante, par son id).
//
// Effet de bord VOULU et demandé par MiKL : la garde ainsi créée alimente
// immédiatement les compteurs, parce que `compteurs_gardes` est une vue sans
// filtre de statut. Rien à coder pour ça, mais il fallait le vérifier.
//
// ── ON INFORME, ON NE BLOQUE PAS ───────────────────────────────────────────
//
// Le contrôle des règles dures est le MÊME juge que la publication
// (`avertissementsReglesDures` → `validerPlanning`) : aucune règle n'est
// réécrite ici. Il ne renvoie que le DELTA (ce que ce geste ajoute), et il
// n'empêche jamais l'écriture — c'est la doctrine « le système INFORME, il
// n'interdit pas », et c'est exactement ce que MiKL a demandé pour ce chantier.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { avertissementsReglesDures } from '@/lib/gardes/avertissements-regles'

type Geste = 'poser' | 'liberer' | 'vider'

/** Colonne titulaire d'un label historique — null pour les places au-delà de la 2ᵉ. */
function colonneDuRole(role: string): 'premier_id' | 'second_id' | null {
  if (role === 'premier') return 'premier_id'
  if (role === 'second') return 'second_id'
  return null
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  // ── Auth + rôle admin ───────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('id, role_app, cabinet_id')
    .eq('user_id', user.id)
    .single()

  if (vet?.role_app !== 'admin') {
    return NextResponse.json({ error: 'Accès réservé aux administrateurs.' }, { status: 403 })
  }

  // ── Corps ───────────────────────────────────────────────
  let periodeId: string
  let date: string
  let type: string
  let role: string
  let geste: Geste
  let veterinaireId: string | null

  try {
    const body = await req.json()
    periodeId = String(body?.periodeId ?? '')
    date = String(body?.date ?? '')
    type = String(body?.type ?? '')
    role = String(body?.role ?? '')
    geste = body?.geste as Geste
    veterinaireId = body?.veterinaireId ?? null
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 })
  }

  if (!periodeId || !date || !type || !role) {
    return NextResponse.json(
      { error: 'Il manque la période, la date, le créneau ou la place.' },
      { status: 400 },
    )
  }
  if (geste !== 'poser' && geste !== 'liberer' && geste !== 'vider') {
    return NextResponse.json({ error: 'Geste inconnu.' }, { status: 400 })
  }
  if (geste === 'poser' && !veterinaireId) {
    return NextResponse.json(
      { error: 'Indiquez qui prend cette place.' },
      { status: 422 },
    )
  }

  // ── La période doit être un brouillon ───────────────────
  //
  // Les cadenas TOMBENT à la publication (arbitrage du 04/09) : ils n'ont de
  // sens que tant qu'une génération peut encore rebattre les cartes. En
  // autoriser la pose sur un planning publié laisserait croire à une protection
  // qui, elle, n'existerait plus au prochain geste.
  const { data: periode } = await supabase
    .from('periodes')
    .select('id, statut, cabinet_id')
    .eq('id', periodeId)
    .single()

  if (!periode) {
    return NextResponse.json({ error: 'Période introuvable.' }, { status: 404 })
  }
  if (periode.statut !== 'brouillon') {
    return NextResponse.json(
      {
        error:
          'Ce planning n\'est plus un brouillon : les cadenas ne servent qu\'avant ' +
          'publication. Pour modifier une garde publiée, passez par la garde elle-même.',
      },
      { status: 422 },
    )
  }

  const cabinetId = periode.cabinet_id ?? vet.cabinet_id ?? null

  // ── La garde : on la retrouve, ou on la crée ────────────
  const { data: existante, error: lectureErr } = await supabase
    .from('gardes')
    .select('id, premier_id, second_id, places_figees, verrouille')
    .eq('periode_id', periodeId)
    .eq('date', date)
    .eq('type', type)
    .maybeSingle()

  if (lectureErr) {
    return NextResponse.json(
      { error: `Lecture de la garde impossible : ${lectureErr.message}` },
      { status: 500 },
    )
  }

  if (!existante && geste !== 'poser') {
    // Rien à libérer ni à vider — mais ce n'est pas une erreur de l'admin, c'est
    // un écran en retard sur la base. On le dit sans dramatiser.
    return NextResponse.json(
      { error: 'Cette garde n\'existe plus. Rafraîchissez le planning.' },
      { status: 404 },
    )
  }

  const colonne = colonneDuRole(role)
  if (!colonne && geste === 'poser') {
    // Les places au-delà de la 2ᵉ vivent dans `garde_placements`, qui n'est
    // aujourd'hui qu'un miroir alimenté par la génération. Les y poser à la main
    // demanderait d'en faire une source de vérité — hors de ce chantier. On
    // refuse explicitement plutôt que d'écrire dans le vide.
    return NextResponse.json(
      {
        error:
          `La place « ${role} » ne peut pas encore être fixée à la main. ` +
          'Seules la 1re et la 2e place le peuvent pour le moment.',
      },
      { status: 422 },
    )
  }

  let gardeId = existante?.id ?? null
  const cadenasActuels: string[] = existante?.places_figees ?? []
  let premierApres = existante?.premier_id ?? null
  let secondApres = existante?.second_id ?? null

  // ── Application du geste ────────────────────────────────
  let cadenasApres: string[]

  if (geste === 'poser') {
    if (colonne === 'premier_id') premierApres = veterinaireId
    else secondApres = veterinaireId
    cadenasApres = [...new Set([...cadenasActuels, role])]
  } else if (geste === 'liberer') {
    cadenasApres = cadenasActuels.filter((r) => r !== role)
  } else {
    if (colonne === 'premier_id') premierApres = null
    else if (colonne === 'second_id') secondApres = null
    cadenasApres = cadenasActuels.filter((r) => r !== role)
  }

  // Refus net : la même personne ne peut pas tenir deux places de la même garde.
  if (premierApres && secondApres && premierApres === secondApres) {
    return NextResponse.json(
      {
        error:
          'Le même vétérinaire ne peut pas être à la fois 1er et 2nd de garde. ' +
          'Choisissez deux personnes différentes.',
      },
      { status: 422 },
    )
  }

  if (gardeId) {
    const { error: updateErr } = await supabase
      .from('gardes')
      .update({
        premier_id: premierApres,
        second_id: secondApres,
        places_figees: cadenasApres,
        modifie_manuellement: true,
      })
      .eq('id', gardeId)

    if (updateErr) {
      return NextResponse.json(
        { error: `Enregistrement impossible : ${updateErr.message}` },
        { status: 500 },
      )
    }
  } else {
    const { data: creee, error: insertErr } = await supabase
      .from('gardes')
      .insert({
        periode_id: periodeId,
        cabinet_id: cabinetId,
        date,
        type,
        premier_id: premierApres,
        second_id: secondApres,
        places_figees: cadenasApres,
        verrouille: false,
        modifie_manuellement: true,
      })
      .select('id')
      .single()

    if (insertErr) {
      return NextResponse.json(
        { error: `Création de la garde impossible : ${insertErr.message}` },
        { status: 500 },
      )
    }
    gardeId = creee.id
  }

  // ── On INFORME : ce que ce geste enfreint, sans rien bloquer ──
  //
  // Volontairement APRÈS l'écriture. L'admin a décidé ; le rôle du produit est
  // de lui dire ce que sa décision implique, pas de lui demander la permission
  // de l'enregistrer. C'est ce que MiKL a explicitement demandé pour ce
  // chantier, et c'est cohérent avec « le système informe, il n'interdit pas ».
  let avertissements: string[] = []
  if (cabinetId && gardeId) {
    avertissements = await avertissementsReglesDures(
      supabase,
      [{ gardeId, premier_id: premierApres, second_id: secondApres }],
      periodeId,
      cabinetId,
    )
  }

  return NextResponse.json({
    ok: true,
    gardeId,
    placesFigees: cadenasApres,
    premier_id: premierApres,
    second_id: secondApres,
    avertissements,
  })
}
