// ============================================================
// GUARDVETO — /admin/banc-ia (écran JETABLE)
// ============================================================
// Mesure le coût et la qualité de chaque palier de modèle pour Filou, sur le
// déploiement — parce que la clé API est « sensible » sur Vercel et ne descend
// pas sur un poste de travail.
//
// À SUPPRIMER une fois le choix de modèle tranché : cet écran n'a aucune valeur
// pour le cabinet, et il dépense de l'argent à chaque clic.
// ============================================================

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { modeleIA } from '@/lib/ia/proposerRegle'
import { BancIAClient } from './BancIAClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'GuardVeto — Banc d’essai IA' }

export default async function BancIAPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Double garde : ici pour ne pas afficher l'écran, et dans l'action serveur
  // pour que la mesure elle-même soit refusée. C'est la seconde qui protège.
  const { data: moi } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .eq('actif', true)
    .maybeSingle()

  if (moi?.role_app !== 'admin') redirect('/accueil')

  return <BancIAClient modeleActuel={modeleIA()} />
}
