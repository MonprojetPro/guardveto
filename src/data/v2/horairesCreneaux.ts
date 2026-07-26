// ============================================================
// GUARDVETO V2 — Les VRAIS horaires des créneaux, lus en base
// ============================================================
// L'accueil écrivait ses horaires en dur (« 19 h 00 → 8 h 00 »). C'était faux :
// la « Configuration standard » du cabinet dit 18 h 30 → 8 h 30, et le profil
// « hiver periode 1 » dit 19 h 30. Un seul texte figé ne PEUT pas être juste,
// puisque l'horaire dépend du profil de planning de la période.
//
// Source : `creneau_modele`, qui porte pour chaque code de créneau et pour
// chaque profil l'heure de début, l'heure de fin et le nombre de jours enjambés
// (`offset_jours_fin` — 2 pour un week-end samedi → lundi).
//
// ⚠️ DEUX VOCABULAIRES À NE PAS CONFONDRE. La vue d'affichage
// `planning_semaine` type ses lignes `semaine | weekend | ferie`, tandis que le
// catalogue du cabinet parle `semaine_soir | vendredi_soir | weekend | ferie`.
// Ce ne sont pas les mêmes mots, et surtout pas la même granularité :
//   • le VENDREDI est rangé sous `weekend` par la vue, alors que c'est un
//     créneau distinct avec sa propre attribution (vérifié en base : le
//     vendredi 24/07/2026 a Antoine 1er, le samedi a Fanny 1re) ;
//   • samedi ET dimanche sont DEUX lignes d'affichage pour UNE SEULE garde,
//     celle qui court du samedi matin au lundi matin.
// D'où `codeCreneau(type, date)` ci-dessous, qui tranche sur le jour réel, et
// l'ancrage au samedi pour le libellé du week-end — sinon le dimanche
// annoncerait « du dimanche au mardi ».
//
// RÈGLE DE PRUDENCE : horaire introuvable → `null`, et l'écran n'affiche RIEN.
// Un horaire absent est un manque visible ; un horaire inventé est un mensonge
// qu'on ne voit pas — et sur une garde vétérinaire, une demi-heure d'écart,
// c'est quelqu'un qui n'est pas là quand on l'appelle.
// ============================================================

import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** Horaires d'un créneau, tels que le cabinet les a réglés. */
export interface HoraireCreneau {
  /** 'HH:MM:SS' en base. */
  heureDebut: string
  heureFin: string
  /** Jours enjambés jusqu'à l'heure de fin (1 = le lendemain, 2 = surlendemain). */
  offsetJoursFin: number
}

/** Les horaires d'UN profil : code de créneau → ses horaires. */
export type CatalogueHoraires = Record<string, HoraireCreneau>

/**
 * Tous les profils d'un coup, plus celui qui sert de repli.
 *
 * Pourquoi tout charger : `demain` peut tomber dans une AUTRE période que
 * `ce soir` (deux fois par an, aux bords), donc sous un autre profil, donc avec
 * d'autres horaires. Une seule requête évite d'avoir à choisir entre une
 * deuxième requête et un horaire faux ces jours-là.
 */
export interface HorairesDuCabinet {
  /** profil_id (ou '' pour les lignes sans profil) → catalogue. */
  parProfil: Record<string, CatalogueHoraires>
  /** Profil par défaut du cabinet : ce qu'utilise une période sans profil. */
  profilDefaut: string | null
}

interface LigneCreneauModele {
  code: string | null
  heure_debut: string | null
  heure_fin: string | null
  offset_jours_fin: number | null
  profil_id: string | null
  actif: boolean | null
}

/**
 * Charge le catalogue d'horaires de TOUS les profils du cabinet, en une passe.
 *
 * BEST-EFFORT comme le reste de l'accueil : table absente, RLS, catalogue vide
 * → aucun horaire, et les écrans n'en afficheront aucun.
 */
export async function chargerHorairesCabinet(
  supabase: SupabaseServerClient,
): Promise<HorairesDuCabinet> {
  const [creneauxRes, profilDefautRes] = await Promise.all([
    supabase
      .from('creneau_modele')
      .select('code, heure_debut, heure_fin, offset_jours_fin, profil_id, actif')
      .eq('actif', true),
    supabase
      .from('profils_planning')
      .select('id')
      .eq('est_defaut', true)
      .eq('actif', true)
      .limit(1)
      .maybeSingle(),
  ])

  const lignes = ((creneauxRes as { data?: LigneCreneauModele[] | null })?.data ??
    []) as LigneCreneauModele[]
  const profilDefaut =
    (profilDefautRes as { data?: { id: string } | null })?.data?.id ?? null

  const parProfil: Record<string, CatalogueHoraires> = {}
  for (const l of lignes) {
    if (!l.code || !l.heure_debut || !l.heure_fin) continue
    const cle = l.profil_id ?? ''
    parProfil[cle] ??= {}
    parProfil[cle][l.code] = {
      heureDebut: l.heure_debut,
      heureFin: l.heure_fin,
      offsetJoursFin: l.offset_jours_fin ?? 1,
    }
  }
  return { parProfil, profilDefaut }
}

/**
 * Le catalogue applicable à une période donnée. Une période sans profil suit le
 * profil par défaut du cabinet ; à défaut, les lignes sans profil du tout.
 */
export function catalogueDuProfil(
  horaires: HorairesDuCabinet,
  profilId: string | null,
): CatalogueHoraires {
  const vise = profilId ?? horaires.profilDefaut
  return (vise ? horaires.parProfil[vise] : undefined) ?? horaires.parProfil[''] ?? {}
}

/** Jour ISO de la semaine : 1 = lundi … 6 = samedi, 7 = dimanche. */
function jourISO(dateISO: string): number {
  const d = new Date(dateISO + 'T12:00:00Z').getUTCDay()
  return d === 0 ? 7 : d
}

/**
 * Le code de créneau du cabinet qui correspond à une ligne d'affichage.
 * Traduit le vocabulaire de la vue vers celui du catalogue (cf. l'avertissement
 * en tête de fichier).
 */
export function codeCreneau(type: string, dateISO: string): string {
  if (type === 'ferie') return 'ferie'
  if (type === 'weekend') {
    // Le vendredi est rangé sous « weekend » par la vue mais c'est le créneau
    // du vendredi soir, avec ses horaires et son attribution propres.
    return jourISO(dateISO) === 5 ? 'vendredi_soir' : 'weekend'
  }
  if (type === 'vendredi_soir') return 'vendredi_soir'
  return 'semaine_soir'
}

/** « 18:30:00 » → « 18 h 30 » ; « 08:00:00 » → « 8 h ». */
export function heureLisible(hhmmss: string): string {
  const [h, m] = hhmmss.split(':')
  const heures = Number(h)
  const minutes = Number(m ?? '0')
  return minutes === 0 ? `${heures} h` : `${heures} h ${String(minutes).padStart(2, '0')}`
}

const JOUR_SEUL = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' })

function jourDecale(dateISO: string, plus: number): string {
  const d = new Date(dateISO + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + plus)
  return JOUR_SEUL.format(d)
}

/**
 * Rend l'horaire d'une garde en français, à partir de sa date réelle.
 *
 * - Nuit qui se termine le lendemain à une autre heure : « 18 h 30 → 8 h 30 ».
 *   Le lendemain est implicite — personne n'a besoin qu'on le précise.
 * - Créneau qui enjambe des jours entiers (week-end, férié qui boucle sur la
 *   même heure) : « du samedi 8 h 30 au lundi 8 h 30 », car là les jours
 *   comptent vraiment. Le week-end est ANCRÉ SUR SON SAMEDI : sans ça, la
 *   ligne du dimanche annoncerait « du dimanche au mardi ».
 *
 * Renvoie `null` si le créneau n'est pas au catalogue : l'appelant n'affiche
 * alors pas d'horaire, plutôt qu'un horaire faux.
 */
export function horaireLisible(
  catalogue: CatalogueHoraires,
  type: string,
  dateGarde: string,
): string | null {
  const code = codeCreneau(type, dateGarde)
  const h = catalogue[code]
  if (!h) return null

  const debut = heureLisible(h.heureDebut)
  const fin = heureLisible(h.heureFin)

  // Un créneau dont le début et la fin tombent à la même heure ne se lit pas
  // « 8 h 30 → 8 h 30 » : il faut nommer les jours pour qu'il veuille dire
  // quelque chose.
  const enjambe = h.offsetJoursFin >= 2 || h.heureDebut === h.heureFin
  if (!enjambe) return `${debut} → ${fin}`

  // Recule jusqu'au premier jour du créneau (samedi pour un week-end).
  const recul = code === 'weekend' ? jourISO(dateGarde) - 6 : 0
  const depuis = recul > 0 ? -recul : 0
  return `du ${jourDecale(dateGarde, depuis)} ${debut} au ${jourDecale(
    dateGarde,
    depuis + h.offsetJoursFin,
  )} ${fin}`
}

/**
 * Nom du créneau en français, tiré du même arbitrage que l'horaire — le
 * vendredi soir cesse ainsi d'être annoncé comme un « week-end ».
 */
export function natureCreneau(type: string, dateISO: string): string {
  switch (codeCreneau(type, dateISO)) {
    case 'ferie':
      return 'jour férié'
    case 'vendredi_soir':
      return 'vendredi soir'
    case 'weekend':
      return 'week-end'
    default:
      return 'nuit de semaine'
  }
}
