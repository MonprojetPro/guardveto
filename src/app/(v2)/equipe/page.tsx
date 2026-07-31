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
import { chargerOptionsRegles } from '@/data/optionsRegles'
import type { RegleRow } from '@/components/regles/ReglesClient'
import type { Veterinaire } from '@/types'

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

  // Les contraintes affichées sur les fiches viennent de `regles_cabinet` — LA
  // source du moteur depuis P1A-004. L'ancienne table `contraintes_veto` n'est
  // plus lue nulle part : c'était une copie figée dont l'édition ne changeait
  // rien au planning (constat du 2026-07-31).
  const [vetsRes, reglesRes, options] = await Promise.all([
    // Les fiches désactivées comptent aussi : c'est de là qu'on réactive.
    supabase.from('veterinaires').select('*').order('actif', { ascending: false }).order('prenom'),
    supabase
      .from('regles_cabinet')
      .select('id, brique_id, params_json, force, actif, periode_id')
      .order('brique_id')
      .order('id'),
    chargerOptionsRegles(supabase),
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
          regles={(reglesRes?.data ?? []) as RegleRow[]}
          periodes={options.periodes}
          typesCreneaux={options.typesCreneaux}
          moiId={vet.id}
        />
      </div>
    </>
  )
}
