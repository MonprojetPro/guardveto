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
import { EquiteCabinetClient, EQUITE_DEFAUTS } from '@/components/regles/EquiteCabinetClient'
import type { EquiteCabinetPayload } from '@/app/(protected)/regles/actions'

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

  const [{ data: regles }, { data: vets }, { data: equite }] = await Promise.all([
    supabase
      .from('regles_cabinet')
      .select('id, brique_id, params_json, force, actif')
      .order('brique_id')
      .order('id'),
    supabase.from('veterinaires').select('id, prenom, nom, couleur').order('nom'),
    // Poids d'équité du cabinet. BEST-EFFORT : table absente (avant migration)
    // ou aucune config → on affiche les défauts (= repli moteur). La RLS
    // restrictive borne déjà la lecture au cabinet de l'utilisateur.
    supabase
      .from('equite_cabinet')
      .select('we_garde, we_premier_role, feries, semaine_premier, semaine_second, grands_we')
      .maybeSingle(),
  ])

  const isAdmin = currentVeto.role_app === 'admin'
  const poidsEquite: EquiteCabinetPayload = equite
    ? {
        we_garde: Number(equite.we_garde),
        we_premier_role: Number(equite.we_premier_role),
        feries: Number(equite.feries),
        semaine_premier: Number(equite.semaine_premier),
        semaine_second: Number(equite.semaine_second),
        grands_we: Number(equite.grands_we),
      }
    : EQUITE_DEFAUTS

  return (
    <div className="space-y-10">
      <ReglesClient
        regles={(regles as RegleRow[]) ?? []}
        vets={(vets as VetoMini[]) ?? []}
        isAdmin={isAdmin}
      />
      <EquiteCabinetClient poids={poidsEquite} isAdmin={isAdmin} />
    </div>
  )
}
