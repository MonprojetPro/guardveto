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
// ── DEUX FAÇONS DE DÉSIGNER LA PLACE, ET POURQUOI ──────────────────────────
//
//   • par `gardeId` + `veterinaireId` — « la place que TIENT cette personne ».
//     C'est ce que l'écran envoie quand il cadenasse quelqu'un déjà en place.
//   • par `periodeId` + `date` + `type` + `role` — « cette place-là ».
//     C'est le pré-remplissage : la garde n'existe pas encore, personne ne la
//     tient, il n'y a que des coordonnées.
//
// ⚠️ LE PREMIER MODE N'EST PAS UN CONFORT, IL ÉVITE UN DÉFAUT CERTAIN.
//
// La vue `planning_semaine` matérialise un week-end sur trois jours et INVERSE
// les rôles sur la ligne du vendredi : le « 1er » affiché ce jour-là est le 2nd
// de la garde. Un écran qui renverrait le rôle AFFICHÉ cadenasserait donc
// l'autre place une fois sur trois.
//
// Il aurait pu refaire l'inversion de son côté — mais elle dépend de la
// configuration du cabinet (relation `inversion_role`), que la vue connaît et
// que l'écran ignore. Ce raisonnement dupliqué aurait tenu jusqu'au premier
// cabinet qui découple son vendredi, puis se serait trompé en silence.
//
// En désignant la personne, il n'y a plus rien à convertir : on cherche la
// place qu'elle occupe dans la garde RÉELLE. Et c'est aussi ce que l'admin a en
// tête — « ce week-end-là, c'est Fanny », jamais « la place 2 du créneau ».
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
  let gardeId: string | null
  let periodeId: string
  let date: string
  let type: string
  let role: string
  let geste: Geste
  let veterinaireId: string | null

  try {
    const body = await req.json()
    gardeId = body?.gardeId ? String(body.gardeId) : null
    periodeId = String(body?.periodeId ?? '')
    date = String(body?.date ?? '')
    type = String(body?.type ?? '')
    role = String(body?.role ?? '')
    geste = body?.geste as Geste
    veterinaireId = body?.veterinaireId ?? null
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 })
  }

  if (geste !== 'poser' && geste !== 'liberer' && geste !== 'vider') {
    return NextResponse.json({ error: 'Geste inconnu.' }, { status: 400 })
  }

  // Mode « place occupée » : la garde et la personne suffisent, on retrouve la
  // place qu'elle tient. Mode « coordonnées » : il faut tout, la garde n'existe
  // peut-être pas encore.
  const parPersonne = Boolean(gardeId && veterinaireId)

  if (!parPersonne && (!periodeId || !date || !type || !role)) {
    return NextResponse.json(
      { error: 'Il manque la période, la date, le créneau ou la place.' },
      { status: 400 },
    )
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
  // ── Mode « place occupée » : on part de la garde ────────
  //
  // On lit la garde RÉELLE (celle de la table, pas la ligne affichée) et on
  // cherche la place que la personne y tient. Plus rien à convertir : la ligne
  // du vendredi peut bien inverser ses rôles, la personne, elle, ne bouge pas.
  let gardeExistante: {
    id: string
    premier_id: string | null
    second_id: string | null
    places_figees: string[] | null
    periode_id: string
  } | null = null

  if (parPersonne) {
    const { data: g, error: gErr } = await supabase
      .from('gardes')
      .select('id, premier_id, second_id, places_figees, periode_id')
      .eq('id', gardeId!)
      .maybeSingle()

    if (gErr) {
      return NextResponse.json(
        { error: `Lecture de la garde impossible : ${gErr.message}` },
        { status: 500 },
      )
    }
    if (!g) {
      return NextResponse.json(
        { error: 'Cette garde n\'existe plus. Rafraîchissez le planning.' },
        { status: 404 },
      )
    }

    gardeExistante = g
    periodeId = g.periode_id

    if (g.premier_id === veterinaireId) role = 'premier'
    else if (g.second_id === veterinaireId) role = 'second'
    else {
      // L'écran désigne quelqu'un que la garde ne porte pas : il a une vue
      // périmée, ou c'est une place au-delà de la 2e (miroir non géré ici).
      return NextResponse.json(
        {
          error:
            'Cette personne ne tient pas cette garde. Rafraîchissez le planning ' +
            'et réessayez.',
        },
        { status: 409 },
      )
    }
  }

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

  // ── Mode « coordonnées » : on retrouve la garde, ou on la créera ──
  let existante = gardeExistante

  if (!parPersonne) {
    const { data: trouvee, error: lectureErr } = await supabase
      .from('gardes')
      .select('id, premier_id, second_id, places_figees, periode_id')
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
    existante = trouvee
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

  gardeId = existante?.id ?? null
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
