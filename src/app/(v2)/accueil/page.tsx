// ============================================================
// GUARDVETO V2 — L'accueil « épicentre »
// ============================================================
// Le premier écran refait selon la maquette M6. Il ne montre rien qu'il n'ait
// vérifié : chaque chiffre du dock et chaque fiche du coup d'œil vient de la
// base ou du validateur (docs/v2/11-filou-actionneur-et-bascule-produit.md).
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { Epicentre } from '@/components/v2/Epicentre'
import { chargerAccueil } from '@/data/v2/accueilEpicentre'
import type { Veterinaire } from '@/types'
// Fenêtre « Vérification du planning » d'Epicentre : consomme `CartesViolations`
// (`.gva-cause*`), défini dans v2-planning.css — importé ici pour que les
// cartes de violation aient le même rendu que dans le planning et la publication.
import '@/styles/v2-planning.css'

export const metadata = {
  title: 'GuardVeto — Accueil',
}

export default async function AccueilPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: veterinaire } = await supabase
    .from('veterinaires')
    .select('*')
    .eq('user_id', user.id)
    .eq('actif', true)
    .single()

  // Même garde que la coquille V1 : un compte sans fiche véto active n'a rien
  // à faire dans l'application.
  if (!veterinaire) {
    await supabase.auth.signOut()
    redirect('/login')
  }

  const data = await chargerAccueil(supabase, veterinaire as Veterinaire)

  return (
    <>
      <Satin />
      <div className="shell">
        <BarreV2
          prenom={data.veterinaire.prenom}
          estAdmin={data.estAdmin}
          dock={data.dock}
        />
        <Epicentre data={data} />
      </div>
    </>
  )
}
