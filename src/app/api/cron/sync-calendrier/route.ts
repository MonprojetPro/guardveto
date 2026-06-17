// ============================================================
// GUARDVETO — GET /api/cron/sync-calendrier
// ============================================================
// Cron Vercel exécuté le 1er de chaque mois à 03h00.
// Remplit automatiquement :
//   (a) Jours fériés  → via RPC Postgres sync_feries(p_annee_debut, p_annee_fin)
//   (b) Vacances scolaires zones A/B/C → via data.education.gouv.fr
//
// Couverture : anneeCourante-1 … anneeCourante+2
// Sécurité   : vérifie Authorization: Bearer <CRON_SECRET>
// Runtime    : nodejs (fetch natif)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// ── Client Supabase service_role (même pattern que les autres crons) ──────────
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Variables Supabase manquantes.')
  return createServiceClient(url, key)
}

// ── API officielle Éducation nationale ───────────────────────────────────────
const EDU_API_URL =
  'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records'

// Zone affichée par l'API → zone normalisée stockée en base
function normaliserZone(raw: string): 'A' | 'B' | 'C' | null {
  const s = raw.trim().toUpperCase()
  if (s.includes('ZONE A') || s === 'A') return 'A'
  if (s.includes('ZONE B') || s === 'B') return 'B'
  if (s.includes('ZONE C') || s === 'C') return 'C'
  return null
}

// Déduit annee_debut/annee_fin à partir de la chaîne "2025-2026"
function parseAnneeScolaire(annee: string): { annee_debut: number; annee_fin: number } | null {
  const match = annee.match(/^(\d{4})-(\d{4})$/)
  if (!match) return null
  return { annee_debut: parseInt(match[1], 10), annee_fin: parseInt(match[2], 10) }
}

interface EduRecord {
  description: string
  population: string
  start_date: string   // ISO date, ex: "2025-10-18"
  end_date: string
  location: string
  zones: string        // ex: "Zone A", "Zone B", "Zone C"
  annee_scolaire: string // ex: "2025-2026"
}

interface VacancesRow {
  annee_debut: number
  annee_fin: number
  zone: 'A' | 'B' | 'C'
  label: string
  debut: string   // date ISO YYYY-MM-DD
  fin: string
}

// ── Récupère TOUTES les vacances pour les années scolaires souhaitées ─────────
async function fetchVacances(anneeCourante: number): Promise<VacancesRow[]> {
  // Couvre anneeCourante-1 à anneeCourante+2 (4 années scolaires)
  const anneesScolaires = [
    `${anneeCourante - 2}-${anneeCourante - 1}`,
    `${anneeCourante - 1}-${anneeCourante}`,
    `${anneeCourante}-${anneeCourante + 1}`,
    `${anneeCourante + 1}-${anneeCourante + 2}`,
    `${anneeCourante + 2}-${anneeCourante + 3}`,
  ]

  const rows: VacancesRow[] = []

  // L'API gère max 100 records/page ; on pagine si nécessaire
  const PAGE_SIZE = 100
  let offset = 0
  let total = Infinity

  while (offset < total) {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      // Filtre sur les zones A, B, C uniquement (pas les DOM-TOM)
      where: `zones in ("Zone A","Zone B","Zone C")`,
      // Sélection des champs utiles uniquement
      select: 'description,population,start_date,end_date,location,zones,annee_scolaire',
    })

    const res = await fetch(`${EDU_API_URL}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      // next.js cache : pas de cache (cron = donnée fraîche)
      cache: 'no-store',
    })

    if (!res.ok) {
      throw new Error(
        `API Éducation nationale : HTTP ${res.status} — ${await res.text().catch(() => '')}`
      )
    }

    const json = (await res.json()) as { total_count: number; results: EduRecord[] }
    total = json.total_count

    for (const rec of json.results) {
      // Filtrer uniquement les années scolaires qui nous concernent
      if (!anneesScolaires.includes(rec.annee_scolaire)) continue

      const zone = normaliserZone(rec.zones)
      if (!zone) continue

      // Certains records couvrent plusieurs populations (ex: "Élèves" ou "Enseignants")
      // On ne garde que "Élèves" pour éviter les doublons
      if (rec.population && !rec.population.toLowerCase().includes('élève')) continue

      const anneeParsed = parseAnneeScolaire(rec.annee_scolaire)
      if (!anneeParsed) continue

      // Les dates de l'API sont au format ISO mais parfois avec heure ("2025-10-18T00:00:00+00:00")
      const debut = rec.start_date?.substring(0, 10)
      const fin = rec.end_date?.substring(0, 10)
      if (!debut || !fin) continue

      rows.push({
        annee_debut: anneeParsed.annee_debut,
        annee_fin: anneeParsed.annee_fin,
        zone,
        label: rec.description?.trim() ?? 'Vacances scolaires',
        debut,
        fin,
      })
    }

    offset += PAGE_SIZE
    if (json.results.length < PAGE_SIZE) break // dernière page
  }

  return rows
}

// ── Handler principal ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // ── Vérification du secret cron (même pattern que /api/cron/rappels) ──────
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 })
  }

  const supabase = getServiceClient()
  const anneeCourante = new Date().getFullYear()
  const anneeDebut = anneeCourante - 1
  const anneeFin = anneeCourante + 2

  // ── (a) Fériés via RPC Postgres ───────────────────────────────────────────
  let feriesInserted = 0
  const { data: feriesData, error: feriesError } = await supabase.rpc('sync_feries', {
    p_annee_debut: anneeDebut,
    p_annee_fin: anneeFin,
  })

  if (feriesError) {
    return NextResponse.json(
      { error: `Erreur sync fériés : ${feriesError.message}` },
      { status: 500 }
    )
  }

  // La fonction RPC retourne le nombre de jours insérés (ou un objet — on normalise)
  if (typeof feriesData === 'number') {
    feriesInserted = feriesData
  } else if (feriesData && typeof feriesData === 'object' && 'inserted' in feriesData) {
    feriesInserted = (feriesData as { inserted: number }).inserted
  }

  // ── (b) Vacances scolaires via API ouverte ────────────────────────────────
  let vacancesRows: VacancesRow[]
  try {
    vacancesRows = await fetchVacances(anneeCourante)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Erreur fetch vacances : ${msg}` },
      { status: 502 }
    )
  }

  let vacancesUpserted = 0

  if (vacancesRows.length > 0) {
    // Upsert par lots de 50 pour rester dans les limites Supabase
    const BATCH_SIZE = 50
    for (let i = 0; i < vacancesRows.length; i += BATCH_SIZE) {
      const batch = vacancesRows.slice(i, i + BATCH_SIZE)
      const { error: upsertError, count } = await supabase
        .from('vacances_scolaires')
        .upsert(batch, {
          onConflict: 'zone,debut,fin',   // index unique (zone, debut, fin)
          ignoreDuplicates: true,          // ON CONFLICT DO NOTHING
          count: 'exact',
        })

      if (upsertError) {
        return NextResponse.json(
          { error: `Erreur upsert vacances (batch ${i}) : ${upsertError.message}` },
          { status: 500 }
        )
      }

      vacancesUpserted += count ?? 0
    }
  }

  return NextResponse.json({
    success: true,
    annee_courante: anneeCourante,
    periode_couverte: `${anneeDebut}–${anneeFin}`,
    feries_inserted: feriesInserted,
    vacances_upserted: vacancesUpserted,
    vacances_fetched: vacancesRows.length,
    synced_at: new Date().toISOString(),
  })
}
