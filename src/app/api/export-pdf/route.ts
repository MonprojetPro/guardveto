// ============================================================
// GUARDVETO — GET /api/export-pdf
// ============================================================
// Génère et streame un PDF du planning de la période demandée.
//
// Accès : admin + secrétaire
// Params : ?periodeId=<uuid>
// Réponse : application/pdf (téléchargement direct)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { genererPdfPlanning } from '@/lib/pdf'
import type { GardePdf, VetoPdf } from '@/lib/pdf'

export async function GET(req: NextRequest) {
  const supabase = await createClient()

  // ── Auth ────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()

  if (!vet || (vet.role_app !== 'admin' && vet.role_app !== 'secretaire')) {
    return NextResponse.json({ error: 'Accès réservé aux admins et secrétaires.' }, { status: 403 })
  }

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
          second:second_id(id, prenom, nom, couleur)
        `)
        .eq('periode_id', periodeId)
        .order('date'),

      supabase
        .from('veterinaires')
        .select('id, prenom, nom, couleur')
        .eq('actif', true)
        .order('nom'),

      supabase
        .from('jours_feries')
        .select('date, nom'),
    ])

  if (!periode) {
    return NextResponse.json({ error: 'Période introuvable.' }, { status: 404 })
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
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vets: VetoPdf[] = (vetsDb ?? []).map((v: any) => ({
    id:     v.id,
    prenom: v.prenom,
    nom:    v.nom,
    couleur: v.couleur ?? '#6b7280',
  }))

  const jours_feries: Array<{ date: string; nom: string }> = (feriesDb ?? []).map(
    (f: { date: string; nom: string }) => ({ date: f.date, nom: f.nom })
  )

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
      vets,
      jours_feries,
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
