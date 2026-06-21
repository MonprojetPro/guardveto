// ============================================================
// GUARDVETO — Page /admin/depannages (Gestion de crise — LOT 6)
// ============================================================
// Liste des compensations (« qui a dépanné qui ») et solde des dettes.

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DepannagesClient, type CompensationLigne } from '@/components/admin/DepannagesClient'

/** Forme brute renvoyée par Supabase avec les jointures imbriquées. */
interface CompensationRow {
  id: string
  absence_id: string
  garde_id: string
  remplacant_id: string
  remplace_id: string
  role: 'premier' | 'second' | null
  statut: 'a_compenser' | 'compensee' | 'annulee'
  created_at: string
  garde: { date: string; type: 'semaine' | 'weekend' | 'ferie' } | null
  remplacant: { prenom: string } | null
  remplace: { prenom: string } | null
  absence: { date_debut: string; motif: 'maladie' | 'urgence' | 'autre' } | null
}

export default async function DepannagesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: vet } = await supabase
    .from('veterinaires').select('role_app').eq('user_id', user.id).single()
  if (vet?.role_app !== 'admin') redirect('/planning')

  // Jointures explicites par alias (un même véto sert remplaçant ET remplacé).
  const { data } = await supabase
    .from('compensations')
    .select(`
      id, absence_id, garde_id, remplacant_id, remplace_id, role, statut, created_at,
      garde:gardes ( date, type ),
      remplacant:veterinaires!compensations_remplacant_id_fkey ( prenom ),
      remplace:veterinaires!compensations_remplace_id_fkey ( prenom ),
      absence:absences ( date_debut, motif )
    `)
    .order('created_at', { ascending: false })

  const rows = (data as CompensationRow[] | null) ?? []

  // Aplatissement + tri par date du créneau décroissante (à défaut created_at).
  const lignes: CompensationLigne[] = rows
    .map((r) => ({
      id: r.id,
      statut: r.statut,
      role: r.role,
      gardeDate: r.garde?.date ?? null,
      gardeType: r.garde?.type ?? null,
      remplacantPrenom: r.remplacant?.prenom ?? null,
      remplacePrenom: r.remplace?.prenom ?? null,
      absenceMotif: r.absence?.motif ?? null,
      absenceDateDebut: r.absence?.date_debut ?? null,
    }))
    .sort((a, b) => {
      const da = a.gardeDate ?? ''
      const db = b.gardeDate ?? ''
      return db.localeCompare(da)
    })

  const stats = {
    ouvertes: lignes.filter((l) => l.statut === 'a_compenser').length,
    compensees: lignes.filter((l) => l.statut === 'compensee').length,
  }

  return <DepannagesClient lignes={lignes} stats={stats} />
}
