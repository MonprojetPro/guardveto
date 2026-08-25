// ============================================================
// GUARDVETO V2 — L'accueil « épicentre »
// ============================================================
// Le premier écran refait selon la maquette M6. Il ne montre rien qu'il n'ait
// vérifié : chaque chiffre du dock et chaque fiche du coup d'œil vient de la
// base ou du validateur (docs/v2/11-filou-actionneur-et-bascule-produit.md).
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { exigerVeterinaire } from '@/lib/identite'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { Epicentre } from '@/components/v2/Epicentre'
import { AccueilRealtime } from '@/components/v2/AccueilRealtime'
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

  // L'accueil est le bureau de FILOU, et Filou n'est pas ouvert au
  // secrétariat (arbitrage MiKL du 25/08). `exigerVeterinaire` le renvoie donc
  // vers le planning — son écran d'arrivée — au lieu de le déconnecter.
  // Le refus est ici, côté serveur : masquer l'entrée dans la barre ne ferme
  // aucune porte à qui tape l'adresse.
  const { veto: veterinaire } = await exigerVeterinaire(supabase)

  const data = await chargerAccueil(supabase, veterinaire as Veterinaire)

  return (
    <>
      <Satin />
      {/* Le tableau se met à jour sans qu'on ait à recharger : une demande
          déposée pendant qu'on le regarde s'y affiche d'elle-même. */}
      <AccueilRealtime />
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
