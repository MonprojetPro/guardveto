import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DemandesClient } from '@/components/admin/DemandesClient'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { detecterConflitPlanningPublie } from '@/lib/conges/detection-conflit'
import type { CreneauImpacte } from '@/lib/crise/contexte'
import type { Conge, Veterinaire } from '@/types'

export default async function AdminDemandesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentVeto } = await supabase
    .from('veterinaires')
    .select('role_app, id')
    .eq('user_id', user.id)
    .single()

  if (currentVeto?.role_app !== 'admin') redirect('/planning')

  const [{ data: conges }, { data: vets }] = await Promise.all([
    supabase
      .from('conges')
      .select('*')
      .eq('statut', 'souhait')
      .order('created_at', { ascending: true }),
    supabase.from('veterinaires').select('*').order('nom'),
  ])

  const demandes = (conges as Conge[]) ?? []

  // ── LOT A5-lite : pré-calcul des conflits planning publié (lecture seule) ──
  // Pour chaque demande en attente, on demande au détecteur A3/A4 si elle
  // chevauche une garde DÉJÀ publiée. On parallélise (Promise.all) — le volume
  // de souhaits en attente est faible. Le détecteur est fail-open : il ne plante
  // jamais, donc une sonde en erreur retombe en « pas de conflit » sans casser
  // l'affichage des demandes.
  const conflitsParConge: Record<string, CreneauImpacte[]> = {}
  if (demandes.length > 0) {
    let cabinetId: string | null = null
    try {
      cabinetId = await resoudreCabinetId(supabase)
    } catch {
      cabinetId = null
    }
    if (cabinetId) {
      const cid = cabinetId
      const resultats = await Promise.all(
        demandes.map(async (d) => {
          const { aConflit, creneauxImpactes } = await detecterConflitPlanningPublie({
            supabase,
            cabinetId: cid,
            veterinaireId: d.veterinaire_id,
            dateDebut: d.date_debut,
            dateFin: d.date_fin,
          })
          return { id: d.id, aConflit, creneauxImpactes }
        }),
      )
      for (const r of resultats) {
        if (r.aConflit) conflitsParConge[r.id] = r.creneauxImpactes
      }
    }
  }

  return (
    <DemandesClient
      demandes={demandes}
      vets={(vets as Veterinaire[]) ?? []}
      currentVetoId={currentVeto.id}
      conflitsParConge={conflitsParConge}
    />
  )
}
