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

/**
 * Le banc de relecture lance quatre relectures complètes ; la plus lente est
 * celle qui tourne aujourd'hui, et c'est précisément ce qu'on mesure. Le
 * plafond par défaut la couperait avant la fin — et un banc qui meurt en
 * chemin ne rend aucun chiffre, pas même le mauvais.
 *
 * ⚠️ Vercel rabote cette valeur au maximum du plan. Si la mesure s'arrête net
 * autour de 60 s, c'est le plan qui parle, pas le code.
 */
export const maxDuration = 300

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
