import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CongesList } from '@/components/conges/CongesList'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { detecterConflitPlanningPublie } from '@/lib/conges/detection-conflit'
import type { CreneauImpacte } from '@/lib/crise/contexte'
import type { Conge, Veterinaire } from '@/types'

export default async function CongesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentVeto } = await supabase
    .from('veterinaires')
    .select('id, role_app')
    .eq('user_id', user.id)
    .single()

  if (!currentVeto) redirect('/planning')

  const [{ data: vets }, { data: conges }] = await Promise.all([
    supabase.from('veterinaires').select('*').order('nom'),
    supabase.from('conges').select('*').order('date_debut'),
  ])

  const isAdmin = currentVeto.role_app === 'admin'
  const congesList = (conges as Conge[]) ?? []

  // ── LOT A5-lite : conflits planning publié pour l'encart « souhaits en attente » ──
  // Calcul réservé à l'admin (seul à voir l'encart) et limité aux souhaits en
  // attente : c'est là que le badge sert. Parallélisé (Promise.all), volume faible.
  // Détecteur fail-open → jamais bloquant pour l'affichage.
  const conflitsParConge: Record<string, CreneauImpacte[]> = {}
  if (isAdmin) {
    const souhaits = congesList.filter((c) => c.statut === 'souhait')
    if (souhaits.length > 0) {
      let cabinetId: string | null = null
      try {
        cabinetId = await resoudreCabinetId(supabase)
      } catch {
        cabinetId = null
      }
      if (cabinetId) {
        const cid = cabinetId
        const resultats = await Promise.all(
          souhaits.map(async (c) => {
            const { aConflit, creneauxImpactes } = await detecterConflitPlanningPublie({
              supabase,
              cabinetId: cid,
              veterinaireId: c.veterinaire_id,
              dateDebut: c.date_debut,
              dateFin: c.date_fin,
            })
            return { id: c.id, aConflit, creneauxImpactes }
          }),
        )
        for (const r of resultats) {
          if (r.aConflit) conflitsParConge[r.id] = r.creneauxImpactes
        }
      }
    }
  }

  return (
    <div className="space-y-6">
      <CongesList
        conges={congesList}
        vets={(vets as Veterinaire[]) ?? []}
        currentUserId={currentVeto.id}
        isAdmin={isAdmin}
        conflitsParConge={conflitsParConge}
      />
    </div>
  )
}
