// ============================================================
// GUARDVETO — Les options que réclame le formulaire de règle (source UNIQUE)
// ============================================================
// `RegleFormDialog` a besoin de trois listes pour se dessiner : les périodes
// auxquelles on peut limiter une règle, les types de créneaux du cabinet
// (filtre de `au_plus_n`) et les rôles (« premier », « second »… — n°22).
//
// Ces trois listes se construisaient dans `app/(protected)/regles/page.tsx`.
// Elles en sortent parce que l'écran Équipe ouvre MAINTENANT le même
// formulaire, depuis la fiche d'un véto. Deux constructions séparées auraient
// divergé au premier profil de planning ajouté : le formulaire aurait proposé
// des créneaux différents selon la porte par laquelle on l'ouvre.
//
// Module neutre (ni 'use server' ni 'use client') : appelé par les deux pages.
// ============================================================

import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { chargerCreneauModele } from '@/data/chargerCreneauModele'
import { periodeLabelCourt, type PeriodeMini } from '@/lib/periodes'
import type { PeriodeOption, TypeCreneauOption } from '@/components/regles/ReglesClient'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Repli quand le cabinet n'a pas (encore) de catalogue de créneaux. */
const TYPES_HISTORIQUES: TypeCreneauOption[] = [
  { code: 'semaine_soir', nom: 'Nuits de semaine' },
  { code: 'vendredi_soir', nom: 'Vendredi soir' },
  { code: 'weekend', nom: 'Week-end' },
]

const ROLES_HISTORIQUES = ['premier', 'second']

export interface OptionsRegles {
  periodes: PeriodeOption[]
  typesCreneaux: TypeCreneauOption[]
  rolesCabinet: string[]
}

/**
 * Charge les trois listes d'options du formulaire de règle.
 *
 * Best-effort par construction : si le catalogue de créneaux est illisible
 * (cabinet non résolu, table vide), on retombe sur les valeurs historiques
 * plutôt que de faire échouer la page. Un formulaire avec des créneaux par
 * défaut reste utilisable ; une page en erreur, non.
 */
export async function chargerOptionsRegles(
  // Le client Supabase serveur, dont le typage générique varie selon l'appelant
  // (même signature que `resoudreCabinetId`, qu'on lui repasse tel quel).
  supabase: SupabaseClient<any, any, any>,
): Promise<OptionsRegles> {
  const { data: periodesDb } = await supabase
    .from('periodes')
    .select('id, saison, numero, libelle, date_debut, date_fin')
    // Une période verrouillée ne sera plus régénérée : inutile d'y scoper une règle.
    .neq('statut', 'verrouille')
    .order('date_debut', { ascending: false })

  const periodes = ((periodesDb as PeriodeMini[] | null) ?? []).map((p) => ({
    id: p.id,
    label: periodeLabelCourt(p),
  }))

  let typesCreneaux: TypeCreneauOption[] = []
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
    // Repli ci-dessous.
  }

  return {
    periodes,
    typesCreneaux: typesCreneaux.length > 0 ? typesCreneaux : TYPES_HISTORIQUES,
    rolesCabinet: rolesCabinet.length > 0 ? rolesCabinet : ROLES_HISTORIQUES,
  }
}
