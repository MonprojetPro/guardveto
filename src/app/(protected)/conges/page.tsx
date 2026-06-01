import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CongesList } from '@/components/conges/CongesList'
import type { Conge, Veterinaire } from '@/types'

export default async function CongesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentVeto } = await supabase
    .from('veterinaires')
    .select('id, role_app')
    .eq('user_id', user.id)
    .single()

  if (!currentVeto) redirect('/planning')

  const [{ data: vets }, { data: conges }] = await Promise.all([
    supabase.from('veterinaires').select('*').order('nom'),
    supabase.from('conges').select('*').order('date_debut'),
  ])

  return (
    <div className="space-y-6">
      <CongesList
        conges={(conges as Conge[]) ?? []}
        vets={(vets as Veterinaire[]) ?? []}
        currentUserId={currentVeto.id}
        isAdmin={currentVeto.role_app === 'admin'}
      />
    </div>
  )
}
