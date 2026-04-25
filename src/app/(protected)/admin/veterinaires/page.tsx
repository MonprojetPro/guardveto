import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { VeterinairesClient } from '@/components/admin/VeterinairesClient'
import type { ContrainteVeto, Veterinaire } from '@/types'

export default async function AdminVeterinairesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentVeto } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()

  if (currentVeto?.role_app !== 'admin') redirect('/planning')

  const [{ data: veterinaires }, { data: contraintes }] = await Promise.all([
    supabase.from('veterinaires').select('*').order('nom'),
    supabase.from('contraintes_veto').select('*').order('created_at'),
  ])

  return (
    <div className="space-y-6">
      <VeterinairesClient
        veterinaires={(veterinaires as Veterinaire[]) ?? []}
        contraintes={(contraintes as ContrainteVeto[]) ?? []}
      />
    </div>
  )
}
