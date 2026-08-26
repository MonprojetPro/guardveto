// ============================================================
// GUARDVETO — Le contexte que l'IA doit connaître pour proposer une règle
// ============================================================
// SERVER-ONLY. Rassemble les référentiels DYNAMIQUES du cabinet — vétérinaires
// actifs, étiquettes d'équipe réellement portées, codes de créneaux, rôles de
// place — qui sont injectés dans le prompt de l'assistant.
//
// Extrait de `regles/actions.ts` pour que le banc d'essai des modèles mesure
// avec le VRAI contexte du cabinet, et pas des données inventées : la taille de
// ce contexte est une part du coût de chaque appel, et une comparaison de
// modèles faite sur un prompt factice ne dirait rien de la facture réelle.
//
// BEST-EFFORT sur le catalogue : sans cabinet résolu ni table de créneaux, on
// retombe sur les types historiques — c'est le comportement d'origine, conservé.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { VetoResolu } from './regleSchema'
import type { TypeCreneauIA } from './proposerRegle'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { chargerCreneauModele } from '@/data/chargerCreneauModele'
import { lignesLues } from './outils/lecture'

export interface ContexteIA {
  vets: VetoResolu[]
  /** Étiquettes réellement portées par l'équipe (minuscules, dédoublonnées). */
  tagsEquipe: string[]
  /** Codes de créneaux du cabinet — jamais un enum figé (verrou 8). */
  typesCreneaux: TypeCreneauIA[]
  /** Rôles de place existants (« premier », « second »…). */
  rolesCabinet: string[]
}

/** Types de créneaux de repli quand le catalogue du cabinet est muet. */
const CRENEAUX_REPLI: TypeCreneauIA[] = [
  { code: 'semaine_soir', nom: 'Nuits de semaine' },
  { code: 'vendredi_soir', nom: 'Vendredi soir' },
  { code: 'weekend', nom: 'Week-end' },
]

export async function chargerContexteIA(
  supabase: SupabaseClient,
): Promise<ContexteIA> {
  // ⚠️ Le catalogue de créneaux plus bas est BEST-EFFORT et retombe sur des
  // replis — l'équipe, elle, ne peut pas l'être : un contexte sans le moindre
  // vétérinaire part dans le prompt et le modèle propose alors une règle qui ne
  // vise personne, ou invente un prénom. Une équipe vide n'existe pas ; c'est
  // toujours une panne, et elle doit se voir.
  const vetsRows = lignesLues<VetoResolu & { tags?: string[] | null }>(
    await supabase
      .from('veterinaires')
      .select('id, prenom, tags')
      .eq('actif', true)
      .order('prenom'),
    "la liste de l'équipe",
  )
  const vets: VetoResolu[] = vetsRows.map(({ id, prenom }) => ({ id, prenom }))

  const tagsEquipe = [
    ...new Set(
      vetsRows
        .flatMap((v) => v.tags ?? [])
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t !== ''),
    ),
  ].sort()

  let typesCreneaux: TypeCreneauIA[] = []
  let rolesCabinet: string[] = []
  try {
    const cabinetId = await resoudreCabinetId(supabase)
    const modeles = await chargerCreneauModele(supabase, cabinetId)
    typesCreneaux = modeles
      .filter((m) => m.actif && m.code !== null && m.code !== 'ferie')
      .map((m) => ({ code: m.code as string, nom: m.nom }))
    rolesCabinet = [
      ...new Set(modeles.filter((m) => m.actif).flatMap((m) => m.roles ?? [])),
    ].filter((r) => typeof r === 'string' && r.trim() !== '')
  } catch {
    // silencieux : replis ci-dessous
  }
  if (typesCreneaux.length === 0) typesCreneaux = CRENEAUX_REPLI
  if (rolesCabinet.length === 0) rolesCabinet = ['premier', 'second']

  return { vets, tagsEquipe, typesCreneaux, rolesCabinet }
}
