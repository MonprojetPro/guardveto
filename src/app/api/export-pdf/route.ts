// ============================================================
// GUARDVETO — GET /api/export-pdf
// ============================================================
// Génère et streame un PDF du planning de la période demandée.
//
// Accès : admin (toutes périodes) + véto (périodes publiées uniquement)
// Params : ?periodeId=<uuid>
// Réponse : application/pdf (téléchargement direct)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { genererPdfPlanning } from '@/lib/pdf'
import type { GardePdf, VetoPdf, ExceptionPdf } from '@/lib/pdf'
import { chargerRelationsAffichagePeriode } from '@/data/chargerRelationsAffichage'
import { resoudreIdentite } from '@/lib/identite'

export async function GET(req: NextRequest) {
  const supabase = await createClient()

  // ── Auth ────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  // L'identité passe par la source unique : depuis le 2026-08-25, un compte
  // peut être un secrétariat, qui n'a pas de fiche vétérinaire. La lecture
  // directe de `veterinaires` renvoyait un 403 — donc le bouton PDF affiché
  // dans son espace ne fonctionnait pas, alors que MiKL avait explicitement
  // choisi de le lui laisser. Un bouton qui échoue vaut moins qu'un bouton
  // absent.
  const identite = await resoudreIdentite(supabase)
  if (!identite.ok) {
    return NextResponse.json(
      {
        error:
          identite.raison === 'base-muette'
            ? 'Base indisponible, réessaie dans un instant.'
            : 'Accès non autorisé.',
      },
      { status: identite.raison === 'base-muette' ? 503 : 403 },
    )
  }
  const estAdmin = identite.identite.role === 'admin'

  // ── Paramètres ──────────────────────────────────────────────
  const periodeId = req.nextUrl.searchParams.get('periodeId')
  if (!periodeId) {
    return NextResponse.json({ error: 'Paramètre periodeId requis.' }, { status: 400 })
  }

  // ── Récupération des données ────────────────────────────────
  const [{ data: periode }, { data: gardesDb }, { data: vetsDb }, { data: feriesDb }] =
    await Promise.all([
      supabase
        .from('periodes')
        .select('saison, numero, date_debut, date_fin, publie_at, statut')
        .eq('id', periodeId)
        .single(),

      supabase
        .from('gardes')
        .select(`
          id, date, type,
          premier:premier_id(id, prenom, nom, couleur),
          second:second_id(id, prenom, nom, couleur),
          garde_placements(place_index, veterinaire_id, veterinaires(prenom, nom, couleur))
        `)
        .eq('periode_id', periodeId)
        .order('date'),

      supabase
        .from('veterinaires')
        .select('id, prenom, nom, couleur')
        .eq('actif', true)
        .order('nom'),

      // Schéma V2 : la colonne `nom` a été renommée `libelle` et la table est
      // désormais multi-région (référentiel partagé). On ne récupère que les
      // fériés métropole (comportement attendu pour le cabinet pilote).
      supabase
        .from('jours_feries')
        .select('date, libelle')
        .eq('region', 'metropole'),
    ])

  if (!periode) {
    return NextResponse.json({ error: 'Période introuvable.' }, { status: 404 })
  }

  // Personne d'autre que l'administratrice n'exporte un planning non DIFFUSÉ.
  //
  // ⚠️ Le critère est `publie_at`, pas le statut. Une période « verrouillée »
  // peut n'avoir jamais été diffusée — c'est le cas de tout historique amorcé
  // en base, et c'est précisément la distinction posée le 2026-08-20 dans
  // `lib/planning/diffusion.ts`. Avec l'ancien test sur le statut, un
  // vétérinaire pouvait exporter en PDF un planning que son propre écran ne
  // lui montrait pas : un canal sortant plus permissif que l'écran, donc une
  // fuite de brouillon par la porte de derrière.
  if (!estAdmin && periode.publie_at === null) {
    return NextResponse.json({ error: "Ce planning n'est pas encore publié." }, { status: 403 })
  }

  if (!gardesDb || gardesDb.length === 0) {
    return NextResponse.json(
      { error: 'Aucune garde générée pour cette période.' },
      { status: 422 }
    )
  }

  // ── Transformation des données ──────────────────────────────
  type RawGarde = {
    id: string
    date: string
    type: string
    premier: { id: string; prenom: string; nom: string; couleur: string } | null
    second:  { id: string; prenom: string; nom: string; couleur: string } | null
    garde_placements?: {
      place_index: number
      veterinaires: { prenom: string; nom: string; couleur: string | null } | null
    }[] | null
  }

  const gardes: GardePdf[] = (gardesDb as unknown as RawGarde[]).map((g) => ({
    id:             g.id,
    date:           g.date,
    type:           g.type,
    premier_prenom: g.premier?.prenom ?? null,
    premier_nom:    g.premier?.nom    ?? null,
    premier_couleur: g.premier?.couleur ?? null,
    second_prenom:  g.second?.prenom  ?? null,
    second_nom:     g.second?.nom     ?? null,
    second_couleur: g.second?.couleur ?? null,
    // Places 3 et 4 (créneaux sur-mesure) : elles ne vivent que dans le
    // miroir, les colonnes de `gardes` n'en portent que deux.
    places_sup: (g.garde_placements ?? [])
      .filter((p) => p.place_index >= 2 && p.veterinaires)
      .map((p) => ({
        place_index: p.place_index,
        prenom: p.veterinaires!.prenom,
        nom: p.veterinaires!.nom,
        couleur: p.veterinaires!.couleur ?? '#6b7280',
      })),
  }))

  // ── Backlog 8 bis : les remplacements d'UN jour ──────────
  //
  // Chargés à part et APRÈS les gardes : la requête est bornée aux gardes de
  // la période qu'on vient de lire, donc elle ne coûte rien quand il n'y a
  // aucune exception — le cas de l'immense majorité des périodes. Le papier
  // est le seul support qu'on ne peut pas rafraîchir : une exception qu'il
  // n'imprimerait pas serait invisible pour tout le cabinet.
  const { data: exceptionsDb } = await supabase
    .from('gardes_exceptions')
    .select('garde_id, date, role, veterinaires:veterinaire_id(prenom, nom, couleur)')
    .in('garde_id', gardes.map((g) => g.id))

  interface RawException {
    garde_id: string
    date: string
    role: 'premier' | 'second'
    veterinaires: { prenom: string; nom: string; couleur: string | null } | null
  }

  const exceptions: ExceptionPdf[] = ((exceptionsDb as unknown as RawException[] | null) ?? []).map((e) => ({
    garde_id: e.garde_id,
    date:     e.date,
    role:     e.role,
    // Pas de vétérinaire = place laissée vacante : elle s'imprime VIDE. La
    // remplir avec le titulaire enverrait quelqu'un qui ne viendra pas.
    prenom:   e.veterinaires?.prenom ?? null,
    nom:      e.veterinaires?.nom ?? null,
    couleur:  e.veterinaires?.couleur ?? null,
  }))


  const vets: VetoPdf[] = (vetsDb ?? []).map((v: any) => ({
    id:     v.id,
    prenom: v.prenom,
    nom:    v.nom,
    couleur: v.couleur ?? '#6b7280',
  }))

  // La table V2 expose `libelle` ; l'interface du PDF (lib/pdf) attend `nom`.
  // On lit `libelle` en entrée et on remappe vers `nom` en sortie.
  const jours_feries: Array<{ date: string; nom: string }> = (feriesDb ?? []).map(
    (f: { date: string; libelle: string }) => ({ date: f.date, nom: f.libelle })
  )

  // Relations du profil (P6 verrou n°3) — pilotent la dérivation du vendredi.
  // undefined (pas de catalogue) → couple historique, byte-identique.
  const relations = await chargerRelationsAffichagePeriode(supabase, periodeId)

  // ── Génération PDF ──────────────────────────────────────────
  let pdfBuffer: Buffer
  try {
    pdfBuffer = await genererPdfPlanning({
      periode: {
        saison:     periode.saison,
        numero:     periode.numero,
        date_debut: periode.date_debut,
        date_fin:   periode.date_fin,
        publie_at:  periode.publie_at,
      },
      gardes,
      exceptions,
      vets,
      jours_feries,
      relations,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[export-pdf] Erreur génération PDF:', msg)
    return NextResponse.json({ error: 'Erreur lors de la génération du PDF.' }, { status: 500 })
  }

  // ── Nom du fichier ──────────────────────────────────────────
  const periodeLabel = periode.saison === 'ete'
    ? 'ete'
    : `hiver-p${periode.numero ?? '1'}`
  const debut = periode.date_debut.replaceAll('-', '')
  const filename = `guardveto-planning-${periodeLabel}-${debut}.pdf`

  // ── Réponse ─────────────────────────────────────────────────
  return new NextResponse(pdfBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      String(pdfBuffer.length),
      'Cache-Control':       'no-store',
    },
  })
}
