// ============================================================
// GUARDVETO V2 — Ce que l'écran « Règles & structure » a besoin de lire
// ============================================================
// Un seul chargeur pour les quatre onglets, et une seule mise en clair des
// jours / places / horaires. En V1, ces phrases étaient construites dans la
// page ET dans deux composants : le même créneau s'y annonçait de trois
// façons. Ici, le serveur met en clair une fois, les onglets affichent.
//
// On charge TOUS les profils avec leur catalogue et leurs liaisons, pas
// seulement le profil courant : le sélecteur de profil en tête de page bascule
// alors sans aller-retour serveur, et surtout il ne peut plus mentir. En V1 le
// catalogue était codé en dur sur le profil DÉFAUT pendant que les liaisons et
// les horaires laissaient choisir : un admin qui regardait son profil « Été »
// voyait en réalité les créneaux de « Hiver ».
//
// Best-effort partout : pas de cabinet, table vide, erreur → listes vides.
// Un écran de configuration qui tombe empêche de réparer la configuration.
// ============================================================

import type { createClient } from '@/lib/supabase/server'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import type { CreneauUI, ProfilUI, RelationUI, GenreRelationUI } from '@/components/v2/regles/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** Les 4 codes du seed : insupprimables, et jours figés. */
const CODES_SEED = new Set(['semaine_soir', 'vendredi_soir', 'weekend', 'ferie'])

/** Jours en clair (0 = dimanche … 6 = samedi). */
const JOURS_COURTS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

/** Jour de fin en clair — miroir des libellés figés du reste du produit. */
const OFFSET_CLAIR: Record<number, string> = {
  0: '',
  1: ', le lendemain',
  2: ', le surlendemain',
  3: ', trois jours après',
}

/** Rôle en clair : premier → 1er, second → 2nd… sinon le libellé brut. */
export function roleClair(role: string): string {
  const map: Record<string, string> = {
    premier: '1er',
    second: '2nd',
    troisieme: '3e',
    quatrieme: '4e',
    cinquieme: '5e',
  }
  return map[role] ?? role
}

/** « Lun, Mar, Mer + jours fériés ». */
function joursClair(jours: number[], surFeries: boolean): string {
  const noms = [...jours].sort((a, b) => a - b).map((j) => JOURS_COURTS[j])
  const parts: string[] = []
  if (noms.length > 0) parts.push(noms.join(', '))
  if (surFeries) parts.push('jours fériés')
  return parts.length > 0 ? parts.join(' + ') : '—'
}

/** « 2 places : 1er, 2nd ». */
function placesClair(nbPlaces: number, roles: string[]): string {
  const noms = roles.map(roleClair).join(', ')
  const mot = nbPlaces > 1 ? 'places' : 'place'
  return noms ? `${nbPlaces} ${mot} : ${noms}` : `${nbPlaces} ${mot}`
}

/** « De 19:00 à 08:00, le lendemain ». */
function horairesClair(debut: string, fin: string, offset: number): string {
  return `De ${debut} à ${fin}${OFFSET_CLAIR[offset] ?? ''}`
}

/** Postgres TIME 'HH:MM:SS' → 'HH:MM'. */
function hhmm(t: string): string {
  return t.slice(0, 5)
}

interface ProfilRow {
  id: string
  nom: string
  est_defaut: boolean
  saison_suggeree: string | null
  nb_vetos_semaine_soir: number | null
  ordre: number
}

interface CreneauRow {
  id: string
  profil_id: string | null
  code: string | null
  nom: string
  jours_semaine: number[] | null
  sur_feries: boolean
  heure_debut: string
  heure_fin: string
  offset_jours_fin: number
  nb_places: number
  roles: string[] | null
  actif: boolean
  ordre: number
}

interface RelationRow {
  id: string
  profil_id: string | null
  source_id: string
  cible_id: string
  genre: string
  actif: boolean
}

/**
 * Tous les profils du cabinet, chacun avec son catalogue et ses liaisons,
 * déjà mis en clair. Liste vide si le cabinet n'est pas résolu.
 */
export async function chargerProfilsStructure(
  supabase: SupabaseServerClient,
): Promise<ProfilUI[]> {
  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch {
    return []
  }

  const [profilsRes, creneauxRes, relationsRes] = await Promise.all([
    supabase
      .from('profils_planning')
      .select('id, nom, est_defaut, saison_suggeree, nb_vetos_semaine_soir, ordre')
      .eq('cabinet_id', cabinetId)
      .eq('actif', true)
      .order('ordre'),
    supabase
      .from('creneau_modele')
      .select(
        'id, profil_id, code, nom, jours_semaine, sur_feries, heure_debut, heure_fin, offset_jours_fin, nb_places, roles, actif, ordre',
      )
      .eq('cabinet_id', cabinetId)
      .order('ordre'),
    supabase
      .from('relation_creneau')
      .select('id, profil_id, source_id, cible_id, genre, actif')
      .eq('cabinet_id', cabinetId)
      .order('cree_le'),
  ])

  const profilsRows = ((profilsRes as { data?: ProfilRow[] | null }).data ?? []) as ProfilRow[]
  const creneauxRows = ((creneauxRes as { data?: CreneauRow[] | null }).data ?? []) as CreneauRow[]
  const relationsRows = ((relationsRes as { data?: RelationRow[] | null }).data ??
    []) as RelationRow[]

  const nomParCreneau = new Map(creneauxRows.map((r) => [r.id, r.nom]))

  return profilsRows.map((p): ProfilUI => {
    const creneaux = creneauxRows
      .filter((c) => c.profil_id === p.id)
      .sort((a, b) => a.ordre - b.ordre)
      .map((c): CreneauUI => {
        const jours = c.jours_semaine ?? []
        const roles = c.roles ?? []
        const debut = hhmm(c.heure_debut)
        const fin = hhmm(c.heure_fin)
        return {
          id: c.id,
          code: c.code,
          nom: c.nom,
          joursSemaine: jours,
          surFeries: c.sur_feries,
          heureDebut: debut,
          heureFin: fin,
          offsetJoursFin: c.offset_jours_fin,
          nbPlaces: c.nb_places,
          roles,
          actif: c.actif,
          ordre: c.ordre,
          estSeed: c.code !== null && CODES_SEED.has(c.code),
          joursClair: joursClair(jours, c.sur_feries),
          placesClair: placesClair(c.nb_places, roles),
          horairesClair: horairesClair(debut, fin, c.offset_jours_fin),
        }
      })

    const relations = relationsRows
      .filter((r) => r.profil_id === p.id)
      .filter((r) => r.genre === 'meme_binome' || r.genre === 'inversion_role')
      .map(
        (r): RelationUI => ({
          id: r.id,
          sourceId: r.source_id,
          cibleId: r.cible_id,
          sourceNom: nomParCreneau.get(r.source_id) ?? '?',
          cibleNom: nomParCreneau.get(r.cible_id) ?? '?',
          genre: r.genre as GenreRelationUI,
          actif: r.actif,
        }),
      )

    return {
      id: p.id,
      nom: p.nom,
      estDefaut: p.est_defaut,
      saisonSuggeree: p.saison_suggeree,
      effectifSoirSemaine: p.nb_vetos_semaine_soir,
      creneaux,
      relations,
    }
  })
}
