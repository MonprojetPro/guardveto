'use server'

import { createClient } from '@/lib/supabase/server'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { revalidatePath } from 'next/cache'

// Détection automatique de la saison depuis la date de début
// Mai (5) → Août (8) = été, le reste = hiver
function detecterSaison(dateDebut: string): 'ete' | 'hiver' {
  const mois = new Date(dateDebut + 'T12:00:00Z').getUTCMonth() + 1
  return mois >= 5 && mois <= 8 ? 'ete' : 'hiver'
}

export async function creerPeriode(formData: FormData) {
  const supabase = await createClient()

  const libelle   = (formData.get('libelle') as string | null)?.trim() || null
  const dateDebut = formData.get('date_debut') as string
  const dateFin   = formData.get('date_fin') as string

  if (!libelle) return { error: 'Le titre est obligatoire.' }
  if (!dateDebut || !dateFin) return { error: 'Les dates de début et de fin sont requises.' }

  // Vérification : date_debut doit être un lundi
  const jour = new Date(dateDebut + 'T12:00:00Z').getUTCDay()
  if (jour !== 1) {
    return { error: 'La date de début doit être un lundi.' }
  }

  // Vérification : chevauchement avec une période existante
  const { data: chevauchements } = await supabase
    .from('periodes')
    .select('id, libelle, saison, numero, date_debut, date_fin')
    .lte('date_debut', dateFin)
    .gte('date_fin', dateDebut)

  if (chevauchements && chevauchements.length > 0) {
    const c = chevauchements[0]
    const label = c.libelle ?? (c.saison === 'ete' ? 'Été' : `Hiver P${c.numero ?? ''}`)
    return { error: `Les dates chevauchent la période "${label}" (${c.date_debut} → ${c.date_fin}).` }
  }

  const saison = detecterSaison(dateDebut)

  // cabinet_id dérivé côté serveur (jamais du client) — sinon la période
  // est insérée avec cabinet_id NULL et reste invisible sous RLS stricte.
  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  const { error } = await supabase.from('periodes').insert({
    cabinet_id: cabinetId,
    saison,
    numero:     null,
    libelle,
    date_debut: dateDebut,
    date_fin:   dateFin,
    statut:     'brouillon',
  })

  if (error) return { error: error.message }

  revalidatePath('/admin/periodes')
  return { success: true }
}

export async function supprimerPeriode(periodeId: string) {
  const supabase = await createClient()

  // Sécurité : seulement les brouillons sans gardes peuvent être supprimés
  const { count } = await supabase
    .from('gardes')
    .select('*', { count: 'exact', head: true })
    .eq('periode_id', periodeId)

  if (count && count > 0) {
    return { error: 'Cette période a des gardes générées. Impossible de la supprimer.' }
  }

  const { error } = await supabase
    .from('periodes')
    .delete()
    .eq('id', periodeId)
    .eq('statut', 'brouillon')

  if (error) return { error: error.message }

  revalidatePath('/admin/periodes')
  return { success: true }
}
