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

  // Profil de planning choisi (P5 slice 3c). Si l'admin en choisit un, on VÉRIFIE
  // qu'il appartient à son cabinet (garde tenant : la RLS restrictive borne déjà
  // la lecture, ce check rejette proprement un id étranger/inexistant). Sinon on
  // PROPOSE le profil dont saison_suggeree = saison détectée ; à défaut NULL
  // (= profil défaut du cabinet → byte-identique avec l'existant).
  const profilChoisi = (formData.get('profil_id') as string | null)?.trim() || null
  let profilId: string | null = null
  if (profilChoisi) {
    const { data: owned } = await supabase
      .from('profils_planning')
      .select('id')
      .eq('id', profilChoisi)
      .eq('cabinet_id', cabinetId)
      .maybeSingle()
    if (!owned) return { error: 'Profil invalide pour ce cabinet.' }
    profilId = profilChoisi
  } else {
    const { data: parSaison } = await supabase
      .from('profils_planning')
      .select('id')
      .eq('cabinet_id', cabinetId)
      .eq('saison_suggeree', saison)
      .eq('actif', true)
      .order('ordre')
      .limit(1)
      .maybeSingle()
    profilId = (parSaison as { id: string } | null)?.id ?? null
  }

  const { error } = await supabase.from('periodes').insert({
    cabinet_id: cabinetId,
    saison,
    numero:     null,
    libelle,
    date_debut: dateDebut,
    date_fin:   dateFin,
    statut:     'brouillon',
    profil_id:  profilId,
  })

  if (error) return { error: error.message }

  revalidatePath('/admin/periodes')
  return { success: true }
}

/**
 * Rattache une période à un profil de planning (ou NULL = profil défaut du
 * cabinet). S'applique à la PROCHAINE génération. RLS periodes (write admin-only,
 * cabinet-borné) sécurise l'écriture ; on vérifie en plus que le profil est bien
 * visible pour ce cabinet (garde tenant, cohérente avec creerPeriode).
 */
export async function setProfilPeriode(periodeId: string, profilId: string | null) {
  const supabase = await createClient()

  if (profilId) {
    const { data: owned } = await supabase
      .from('profils_planning')
      .select('id')
      .eq('id', profilId)
      .maybeSingle()
    if (!owned) return { error: 'Profil introuvable.' }
  }

  const { error } = await supabase
    .from('periodes')
    .update({ profil_id: profilId })
    .eq('id', periodeId)

  if (error) return { error: error.message }
  revalidatePath('/admin/periodes')
  return { success: true }
}

/**
 * Règle l'effectif de garde la nuit en semaine (1 ou 2 vétos) pour une période.
 * RLS periodes (write admin-only) sécurise l'écriture. S'applique à la PROCHAINE
 * génération du planning de la période.
 */
export async function setEffectifPeriode(periodeId: string, nb: number) {
  if (nb !== 1 && nb !== 2) return { error: 'Effectif invalide (1 ou 2).' }
  const supabase = await createClient()

  const { error } = await supabase
    .from('periodes')
    .update({ nb_vetos_semaine_soir: nb })
    .eq('id', periodeId)

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
