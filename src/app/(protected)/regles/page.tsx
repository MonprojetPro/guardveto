// ============================================================
// GUARDVETO — Page « Règles du cabinet » (P1A-006)
// ============================================================
// Liste les regles_cabinet en LANGAGE NATUREL (catalogue P1A-005),
// groupées par force. L'admin gère (activer/désactiver/supprimer +
// créer/éditer en P1A-007) ; le véto consulte en lecture seule.
//
// Les règles d'ÉQUITÉ (famille `equilibrer`) sont sorties de la liste
// principale et affichées dans leur propre section « Équilibrage des
// charges » : même page, même vocabulaire d'importance, forme adaptée
// (elles ciblent un compteur, pas un véto).
//
// La RLS restrictive (F5-003) scope automatiquement la lecture au
// cabinet de l'utilisateur — aucun cabinet_id à passer ici.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ReglesClient, type RegleRow, type VetoMini } from '@/components/regles/ReglesClient'
import { EquilibrageClient } from '@/components/regles/EquilibrageClient'
import {
  EQUITY_DIMENSIONS,
  DEFAULT_IMPORTANCE,
  IMPORTANCE_LEVELS,
  type EquityDimension,
  type ImportanceLevel,
} from '@/engine/equity-weights'

const BRIQUE_EQUILIBRER = 'equilibrer'
const IMPORTANCES = new Set<string>(IMPORTANCE_LEVELS)

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

  const isAdmin = currentVeto.role_app === 'admin'
  const toutesRegles = (regles as RegleRow[]) ?? []

  // Les règles d'équité (equilibrer) sont gérées à part (section Équilibrage) :
  // on les retire de la liste principale pour éviter le doublon.
  const reglesClassiques = toutesRegles.filter((r) => r.brique_id !== BRIQUE_EQUILIBRER)
  const reglesEquilibrer = toutesRegles.filter((r) => r.brique_id === BRIQUE_EQUILIBRER)

  // Importance courante par dimension : règle posée si elle existe, sinon défaut.
  const importances = Object.fromEntries(
    EQUITY_DIMENSIONS.map((dim) => {
      const regle = reglesEquilibrer.find(
        (r) => (r.params_json as { params?: { dimension?: string } })?.params?.dimension === dim,
      )
      const imp = (regle?.params_json as { params?: { importance?: string } })?.params?.importance
      const valide = typeof imp === 'string' && IMPORTANCES.has(imp)
      return [dim, valide ? (imp as ImportanceLevel) : DEFAULT_IMPORTANCE[dim]]
    }),
  ) as Record<EquityDimension, ImportanceLevel>

  return (
    <div className="space-y-10">
      <ReglesClient
        regles={reglesClassiques}
        vets={(vets as VetoMini[]) ?? []}
        isAdmin={isAdmin}
      />
      <EquilibrageClient importances={importances} isAdmin={isAdmin} />
    </div>
  )
}
