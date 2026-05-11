import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DemandesClient } from '@/components/admin/DemandesClient'
import type { Conge, Veterinaire } from '@/types'

export default async function AdminDemandesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentVeto } = await supabase
    .from('veterinaires')
    .select('role_app, id')
    .eq('user_id', user.id)
    .single()

  if (currentVeto?.role_app !== 'admin') redirect('/planning')

  const [{ data: conges }, { data: vets }] = await Promise.all([
    supabase
      .from('conges')
      .select('*')
      .eq('statut', 'souhait')
      .order('created_at', { ascending: true }),
    supabase.from('veterinaires').select('*').order('nom'),
  ])

  return (
    <DemandesClient
      demandes={(conges as Conge[]) ?? []}
      vets={(vets as Veterinaire[]) ?? []}
      currentVetoId={currentVeto.id}
    />
  )
}
