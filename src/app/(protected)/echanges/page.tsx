// ============================================================
// GUARDVETO — Page /echanges (échanges de gardes self-service)
// ============================================================
// Véto : proposer un échange, répondre aux propositions reçues, suivre
// ses demandes. Admin : valider/refuser les échanges acceptés (+ tout voir).
// La RLS de `echanges_gardes` borne la visibilité (demandeur / cible / admin).
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { EchangesClient, type EchangeRow, type GardeLite, type VetLite } from '@/components/echanges/EchangesClient'

export const dynamic = 'force-dynamic'

export default async function EchangesPage({
  searchParams,
}: {
  searchParams: Promise<{ proposer?: string }>
}) {
  const supabase = await createClient()
  const { proposer } = await searchParams

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: moi } = await supabase
    .from('veterinaires')
    .select('id, prenom, nom, role_app')
    .eq('user_id', user.id)
    .single()
  if (!moi) redirect('/login')

  // Échanges visibles (RLS : les miens en tant que partie + tout si admin).
  const { data: echanges } = await supabase
    .from('echanges_gardes')
    .select(`
      id, statut, message, motif_refus, role_demandeur, role_contrepartie,
      demandeur_id, cible_id, created_at,
      garde:garde_id(id, date, type),
      gardeContrepartie:garde_contrepartie_id(id, date, type)
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  // Gardes futures des plannings publiés (non verrouillées) : matière du
  // formulaire (mes gardes à céder + gardes du confrère à reprendre).
  const aujourdHui = new Date().toISOString().slice(0, 10)
  const { data: gardesFutures } = await supabase
    .from('gardes')
    .select('id, date, type, premier_id, second_id, periodes!inner(statut)')
    .gt('date', aujourdHui)
    .eq('periodes.statut', 'publie')
    .eq('verrouille', false)
    .order('date')

  const { data: vets } = await supabase
    .from('veterinaires')
    .select('id, prenom, nom, couleur')
    .eq('actif', true)
    .order('prenom')

  return (
    <EchangesClient
      moiId={moi.id}
      isAdmin={moi.role_app === 'admin'}
      echanges={(echanges ?? []) as unknown as EchangeRow[]}
      gardesFutures={(gardesFutures ?? []) as unknown as GardeLite[]}
      vets={(vets ?? []) as VetLite[]}
      gardePreselectionnee={proposer ?? null}
    />
  )
}
