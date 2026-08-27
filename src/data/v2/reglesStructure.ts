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
// ⚠️ La règle « combien de places une période type utilise vraiment » vit dans
// UN seul endroit, celui que le moteur lit. Cet écran ne la recopie pas : il
// annoncerait sinon des gardes que la génération ne pose pas.
import { placesEffectives } from '@/data/chargerCreneauModele'
// Le sens de la dépendance est imposé : ce module-ci est serveur, `libelle` est
// une feuille sans dépendance. C'est donc lui qui importe, jamais l'inverse.
import { ROLES_COURTS } from '@/lib/agenda/libelle'
import type {
  CreneauUI, ProfilUI, RelationUI, GenreRelationUI, StructureCabinetUI,
} from '@/components/v2/regles/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** Les 4 codes du seed : insupprimables, et jours figés. */
const CODES_SEED = new Set(['semaine_soir', 'vendredi_soir', 'weekend', 'ferie'])

/**
 * Jours en clair (0 = dimanche … 6 = samedi).
 *
 * EN TOUTES LETTRES, pas en abrégé. « Lun, Mar, Mer, Jeu » économisait des
 * caractères dans une carte qui en a des centaines à perdre : on abrège quand
 * la place manque, et elle ne manque pas ici.
 */
const JOURS_LONGS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

/** Jour de fin en clair — miroir des libellés figés du reste du produit. */
const OFFSET_CLAIR: Record<number, string> = {
  0: '',
  1: ', le lendemain',
  2: ', le surlendemain',
  3: ', trois jours après',
}

/**
 * Rôle en clair : premier → 1er, second → 2nd… sinon le libellé brut.
 *
 * B-081 (2026-08-27) — la table vit désormais dans `@/lib/agenda/libelle`, où
 * l'agenda en a besoin lui aussi. Deux tables pour un même vocabulaire finissent
 * toujours par diverger : c'est une seule table, et deux lectures.
 *
 * ⚠️ LA RECHERCHE RESTE À L'IDENTIQUE, sans normalisation ni repli — c'est ce
 * qui distingue cette fonction de `roleCourt`, et ce n'est pas un oubli. Ici on
 * rend le libellé du cabinet TEL QU'IL L'A ÉCRIT : « Premier » avec sa
 * majuscule reste « Premier ». `roleCourt`, lui, normalise, parce qu'un titre
 * d'agenda doit toujours porter un rôle abrégé. Les aligner ferait basculer
 * l'affichage de cet écran sans que personne ne l'ait demandé.
 * Filet de non-régression : `tests/lib/regles-structure-role-clair.test.ts`.
 */
export function roleClair(role: string): string {
  return ROLES_COURTS[role] ?? role
}

/**
 * Une énumération française : « lundi, mardi et jeudi ». Le « et » avant le
 * dernier terme, pas une virgule — c'est ce qui distingue une phrase d'une
 * liste de codes.
 */
function enumerer(termes: string[]): string {
  if (termes.length <= 1) return termes[0] ?? ''
  return `${termes.slice(0, -1).join(', ')} et ${termes[termes.length - 1]}`
}

/** « Lundi, mardi, mercredi et jeudi » · « Les jours fériés ». */
function joursClair(jours: number[], surFeries: boolean): string {
  const noms = [...jours].sort((a, b) => a - b).map((j) => JOURS_LONGS[j])
  const parts: string[] = []
  if (noms.length > 0) parts.push(enumerer(noms))
  if (surFeries) parts.push('les jours fériés')
  if (parts.length === 0) return '—'
  const phrase = enumerer(parts)
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

/** « 2 places : 1er, 2nd ». */
function placesClair(nbPlaces: number, roles: string[]): string {
  const noms = roles.map(roleClair).join(', ')
  const mot = nbPlaces > 1 ? 'places' : 'place'
  return noms ? `${nbPlaces} ${mot} : ${noms}` : `${nbPlaces} ${mot}`
}

/**
 * Ce que les périodes types font réellement des places d'un créneau du socle.
 *
 * Le socle porte un MAXIMUM ; chaque période type dit combien elle en veut, et
 * le moteur applique `min(voulu, maximum)` — absence de choix = le maximum,
 * 0 = le créneau disparaît de cette période-là. La même règle exactement que
 * `appliquerAffinage` (`data/chargerCreneauModele.ts`), et que la construction
 * des créneaux par profil un peu plus bas dans ce fichier.
 *
 * Rend `null` quand toutes les périodes types prennent le maximum : il n'y a
 * alors rien à signaler, et une phrase qui se répète sur chaque carte est du
 * bruit. Rend `null` aussi s'il n'existe aucune période type — le socle est
 * alors ce qui sera généré, sans nuance à apporter.
 */
function emploiParPeriodes(
  creneau: CreneauRow,
  profils: ProfilRow[],
  affinages: AffinageRow[],
): string | null {
  if (profils.length === 0) return null

  const parts: string[] = []
  let uneDifference = false

  for (const p of [...profils].sort((a, b) => a.ordre - b.ordre)) {
    const voulu = affinages.find((a) => a.profil_id === p.id && a.creneau_id === creneau.id)?.nb_vetos
    const effectif = placesEffectives(creneau.nb_places, voulu)
    if (effectif !== creneau.nb_places) uneDifference = true
    parts.push(
      effectif === null
        ? `${p.nom} : aucune garde`
        : `${p.nom} : ${effectif} ${effectif > 1 ? 'places' : 'place'}`,
    )
  }

  return uneDifference ? parts.join(' · ') : null
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

/** Une ligne d'affinage : ce qu'une période type veut sur un créneau du socle. */
interface AffinageRow {
  profil_id: string
  creneau_id: string
  nb_vetos: number
}

/**
 * Tous les profils du cabinet, chacun avec son catalogue et ses liaisons,
 * déjà mis en clair. Liste vide si le cabinet n'est pas résolu.
 */
export async function chargerProfilsStructure(
  supabase: SupabaseServerClient,
): Promise<StructureCabinetUI> {
  const vide: StructureCabinetUI = { socle: [], relations: [], profils: [] }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch {
    return vide
  }

  const [profilsRes, creneauxRes, relationsRes, affinagesRes] = await Promise.all([
    supabase
      .from('profils_planning')
      .select('id, nom, est_defaut, saison_suggeree, nb_vetos_semaine_soir, ordre')
      .eq('cabinet_id', cabinetId)
      .eq('actif', true)
      .order('ordre'),
    // LE SOCLE seul (`profil_id IS NULL`) : les créneaux ne sont plus dupliqués
    // par période type depuis le 2026-08-04.
    supabase
      .from('creneau_modele')
      .select(
        'id, profil_id, code, nom, jours_semaine, sur_feries, heure_debut, heure_fin, offset_jours_fin, nb_places, roles, actif, ordre',
      )
      .eq('cabinet_id', cabinetId)
      .is('profil_id', null)
      .order('ordre'),
    supabase
      .from('relation_creneau')
      .select('id, profil_id, source_id, cible_id, genre, actif')
      .eq('cabinet_id', cabinetId)
      .is('profil_id', null)
      .order('cree_le'),
    supabase
      .from('periode_type_creneau')
      .select('profil_id, creneau_id, nb_vetos')
      .eq('cabinet_id', cabinetId),
  ])

  const profilsRows = ((profilsRes as { data?: ProfilRow[] | null }).data ?? []) as ProfilRow[]
  const creneauxRows = ((creneauxRes as { data?: CreneauRow[] | null }).data ?? []) as CreneauRow[]
  const relationsRows = ((relationsRes as { data?: RelationRow[] | null }).data ??
    []) as RelationRow[]
  const affinagesRows = ((affinagesRes as { data?: AffinageRow[] | null }).data ??
    []) as AffinageRow[]

  const enClair = (c: CreneauRow, nbPlaces: number, emploiReel: string | null = null): CreneauUI => {
    const jours = c.jours_semaine ?? []
    const roles = (c.roles ?? []).slice(0, nbPlaces)
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
      nbPlaces,
      roles,
      actif: c.actif,
      ordre: c.ordre,
      estSeed: c.code !== null && CODES_SEED.has(c.code),
      joursClair: joursClair(jours, c.sur_feries),
      placesClair: placesClair(nbPlaces, roles),
      horairesClair: horairesClair(debut, fin, c.offset_jours_fin),
      emploiReel,
    }
  }

  const socle = creneauxRows
    .slice()
    .sort((a, b) => a.ordre - b.ordre)
    .map((c) => enClair(c, c.nb_places, emploiParPeriodes(c, profilsRows, affinagesRows)))

  const nomParCreneau = new Map(creneauxRows.map((r) => [r.id, r.nom]))

  const relations = relationsRows
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

  const profils = profilsRows.map((p): ProfilUI => {
    const affinage: Record<string, number> = {}
    for (const a of affinagesRows) {
      if (a.profil_id === p.id) affinage[a.creneau_id] = a.nb_vetos
    }

    // Le socle affiné — par la MÊME fonction que le moteur, pas par une copie
    // de sa règle : `placesEffectives` est la source unique (absence de choix =
    // le créneau tel quel, 0 = il disparaît, jamais plus que le socle).
    const creneaux = creneauxRows
      .slice()
      .sort((a, b) => a.ordre - b.ordre)
      .flatMap((c): CreneauUI[] => {
        const n = placesEffectives(c.nb_places, affinage[c.id])
        return n === null ? [] : [enClair(c, n)]
      })

    const gardes = new Set(creneaux.map((c) => c.id))
    return {
      id: p.id,
      nom: p.nom,
      estDefaut: p.est_defaut,
      affinage,
      creneaux,
      // Une liaison dont un bout a été retiré ne s'applique pas ici.
      relations: relations.filter((r) => gardes.has(r.sourceId) && gardes.has(r.cibleId)),
    }
  })

  return { socle, relations, profils }
}
