// ============================================================
// GUARDVETO — Page « Règles du cabinet » (P1A-006)
// ============================================================
// Liste les regles_cabinet en LANGAGE NATUREL (catalogue P1A-005),
// groupées par force. L'admin gère (activer/désactiver/supprimer +
// créer/éditer en P1A-007) ; le véto consulte en lecture seule.
//
// La RLS restrictive (F5-003) scope automatiquement la lecture au
// cabinet de l'utilisateur — aucun cabinet_id à passer ici.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ReglesClient, type RegleRow, type VetoMini } from '@/components/regles/ReglesClient'

export default async function ReglesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentVeto } = await supabase
    .from('veterinaires')
    .select('role_app, id')
    .eq('user_id', user.id)
    .single()

  if (!currentVeto) redirect('/login')

  const [{ data: regles }, { data: vets }] = await Promise.all([
    supabase
      .from('regles_cabinet')
      .select('id, brique_id, params_json, force, actif')
      .order('brique_id')
      .order('id'),
    supabase.from('veterinaires').select('id, prenom, nom, couleur').order('nom'),
  ])

  return (
    <ReglesClient
      regles={(regles as RegleRow[]) ?? []}
      vets={(vets as VetoMini[]) ?? []}
      isAdmin={currentVeto.role_app === 'admin'}
    />
  )
}
