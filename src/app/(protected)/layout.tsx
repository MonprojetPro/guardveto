import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileNav } from '@/components/layout/MobileNav'
import { getNotifications } from '@/data/notifications'
import type { Veterinaire } from '@/types'

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: veterinaire } = await supabase
    .from('veterinaires')
    .select('*')
    .eq('user_id', user.id)
    .eq('actif', true)
    .single()

  if (!veterinaire) {
    await supabase.auth.signOut()
    redirect('/login')
  }

  // Compteur souhaits en attente (admin uniquement)
  let nbSouhaits = 0
  if (veterinaire.role_app === 'admin') {
    const { count } = await supabase
      .from('conges')
      .select('*', { count: 'exact', head: true })
      .eq('statut', 'souhait')
    nbSouhaits = count ?? 0
  }

  // Compteur échanges : actions attendues de MOI.
  // Véto : propositions qui me sont adressées + propositions ouvertes des
  // confrères. Admin : + les échanges acceptés en attente de MA validation.
  let nbEchanges = 0
  {
    const { count: nbRecues } = await supabase
      .from('echanges_gardes')
      .select('*', { count: 'exact', head: true })
      .eq('statut', 'proposee')
      .or(`cible_id.eq.${veterinaire.id},and(cible_id.is.null,demandeur_id.neq.${veterinaire.id})`)
    nbEchanges = nbRecues ?? 0
    if (veterinaire.role_app === 'admin') {
      const { count: nbAValider } = await supabase
        .from('echanges_gardes')
        .select('*', { count: 'exact', head: true })
        .eq('statut', 'acceptee')
      nbEchanges += nbAValider ?? 0
    }
  }

  // Notifications in-app (cloche) — état initial pour un 1er rendu sans flash.
  const initialNotifications = await getNotifications()

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar desktop */}
      <Sidebar veterinaire={veterinaire as Veterinaire} nbSouhaits={nbSouhaits} nbEchanges={nbEchanges} />

      {/* Zone principale */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header veterinaire={veterinaire as Veterinaire} initialNotifications={initialNotifications} />

        <main className="flex-1 overflow-y-auto p-4 pb-20 md:pb-4">
          {children}
        </main>
      </div>

      {/* Bottom nav mobile */}
      <MobileNav veterinaire={veterinaire as Veterinaire} nbEchanges={nbEchanges} />
    </div>
  )
}
