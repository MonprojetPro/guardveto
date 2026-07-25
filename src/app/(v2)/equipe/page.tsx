// ============================================================
// GUARDVETO V2 — Équipe
// ============================================================
// Quatrième écran de la bascule (maquette M4, section 2). Il remplace, côté
// look, la page V1 `/admin/veterinaires` — qui reste en place et fonctionnelle
// jusqu'à la recette de celui-ci.
//
// Réservé à l'admin, comme la V1 : c'est lui qui crée les fiches, invite les
// comptes et décide qui entre dans les générations.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import '@/styles/v2-equipe.css'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { EquipeV2 } from '@/components/v2/EquipeV2'
import { chargerDock } from '@/data/v2/dock'
import type { ContrainteVeto, Veterinaire } from '@/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'GuardVeto — Équipe' }

export default async function EquipePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: moi } = await supabase
    .from('veterinaires')
    .select('*')
    .eq('user_id', user.id)
    .eq('actif', true)
    .single()

  if (!moi) {
    await supabase.auth.signOut()
    redirect('/login')
  }

  const vet = moi as Veterinaire
  if (vet.role_app !== 'admin') redirect('/accueil')

  const [vetsRes, contraintesRes] = await Promise.all([
    // Les fiches désactivées comptent aussi : c'est de là qu'on réactive.
    supabase.from('veterinaires').select('*').order('actif', { ascending: false }).order('prenom'),
    supabase.from('contraintes_veto').select('*').order('created_at'),
  ])

  const vets = (vetsRes?.data ?? []) as Veterinaire[]
  const dock = await chargerDock(supabase, vet)

  return (
    <>
      <Satin />
      <div className="shell">
        <BarreV2 prenom={vet.prenom} estAdmin dock={dock} />
        <EquipeV2
          vets={vets}
          contraintes={(contraintesRes?.data ?? []) as ContrainteVeto[]}
          moiId={vet.id}
        />
      </div>
    </>
  )
}
