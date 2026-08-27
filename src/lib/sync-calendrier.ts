// ============================================================
// GUARDVETO — Service de synchronisation Google Agenda
// ============================================================
// Appelé après publication d'une période ou modification d'une garde.
// Crée / met à jour les événements Google Agenda pour chaque garde.
// ============================================================

import { SupabaseClient } from '@supabase/supabase-js'
import {
  deleteGardeEvent,
  isGoogleCalendarConfigured,
  agendaDeRepliPour,
  creerEvenementPlanifie,
  majEvenementPlanifie,
  planifierEvenementsGarde,
  type EvenementPlanifie,
  type GardeAPlanifier,
  type OccupantPlace,
} from './google-calendar'
import { chargerStructureProfilPeriode } from '@/data/chargerStructureCabinet'
import type { StructureCreneauxResolue } from '@/engine/structure-creneaux'
import { chargerRelationsAffichagePeriode } from '@/data/chargerRelationsAffichage'
import type { RelationStructure } from '@/engine/structure-config'
import type { BilanAgenda } from '@/lib/planning/retrait-planning'
import { initialesUniques } from '@/lib/agenda/initiales'
import { estColorIdValide } from '@/lib/agenda/couleurs-google'

// ── Résolution du calendarId PAR CABINET (#10b) ──────────────
// Le calendarId Google est désormais porté par le cabinet
// (cabinets.google_calendar_id). On le résout ici depuis un cabinet_id ; la
// couche google-calendar retombe sur l'env GOOGLE_CALENDAR_ID si le résultat
// est vide (cabinet pilote = colonne nulle → comportement inchangé).

/**
 * calendarId du cabinet, ou l'agenda de repli s'il lui est NOMINATIVEMENT
 * accordé (T-001). Null sinon : un cabinet dont on ne sait pas où écrire
 * n'écrit nulle part, plutôt que dans l'agenda du voisin.
 */
async function calendarIdDuCabinet(
  supabase: SupabaseClient,
  cabinetId: string | null | undefined,
): Promise<string | null> {
  if (!cabinetId) return null
  const { data, error } = await supabase
    .from('cabinets')
    .select('google_calendar_id')
    .eq('id', cabinetId)
    .single()
  // L'erreur est lue : une base muette ne doit pas ressembler à « ce cabinet
  // n'a pas d'agenda », sinon on replierait sur l'agenda global par accident —
  // exactement ce que ce correctif supprime.
  if (error) {
    console.error(
      '[sync-calendrier] lecture de l’agenda du cabinet impossible, aucune synchronisation :',
      error.message,
    )
    return null
  }
  const val = (data as { google_calendar_id?: string | null } | null)?.google_calendar_id
  return (val ?? '').trim() || agendaDeRepliPour(cabinetId)
}

/** cabinet_id d'une période (pour scoper l'agenda). */
async function cabinetIdDePeriode(
  supabase: SupabaseClient,
  periodeId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('periodes')
    .select('cabinet_id')
    .eq('id', periodeId)
    .single()
  return (data as { cabinet_id?: string | null } | null)?.cabinet_id ?? null
}

// ── Types ────────────────────────────────────────────────────

/** Une garde telle que la base la rend, en IDENTIFIANTS (B-079). */
interface GardeBrute {
  id: string
  date: string
  /** Type V1 ('semaine'/'weekend'/'ferie') ou code sur-mesure (P3b). */
  type: string
  /** Ancien chemin : UN événement pour toute la garde. Vidé par la bascule. */
  google_event_id: string | null
  periode_id?: string | null
  cabinet_id?: string | null
  premier_id: string | null
  second_id: string | null
  /** Miroir des places 3 et 4 — absentes des colonnes de `gardes`. */
  garde_placements?: { place_index: number; veterinaire_id: string | null }[] | null
}

/** Les colonnes de `gardes` que la planification exige, en un seul endroit. */
const CHAMPS_GARDE = `
  id,
  date,
  type,
  google_event_id,
  periode_id,
  cabinet_id,
  premier_id,
  second_id,
  garde_placements ( place_index, veterinaire_id )
`

/**
 * Tout ce que la planification a besoin de savoir du cabinet, chargé UNE fois.
 *
 * Le rassembler ici évite ce que faisait l'ancienne boucle : une requête par
 * garde pour un résultat presque toujours identique, sur un chemin déjà
 * contraint par le rate-limit Google.
 */
interface ContexteAgenda {
  calendarId: string
  structure?: StructureCreneauxResolue
  relations?: readonly RelationStructure[]
  /** Par id de véto — libellé affiché et couleur. */
  occupants: Map<string, OccupantPlace>
  /** Par code de créneau — base du titre (`libelle_agenda` ?? `nom`). */
  basesTitre: Map<string, string>
  /** Par code de créneau — rôles nommés par le cabinet, dans l'ordre des places. */
  rolesParCreneau: Map<string, readonly string[]>
  journeeEntiere: boolean
  afficherHoraires: boolean
}

/**
 * Réglages d'agenda DU CABINET. Aucun défaut codé ici : les colonnes sont
 * `NOT NULL DEFAULT` en base, et c'est la base qui doit dire ce que vaut un
 * cabinet qui n'a rien choisi. Un défaut recopié dans le code finit toujours
 * par diverger de celui de la base, sans que rien ne le signale.
 *
 * Le repli n'intervient donc que si la LECTURE échoue (colonnes pas encore
 * déployées, base muette) — cas où il vaut mieux un agenda lisible qu'aucune
 * synchronisation.
 */
async function reglagesAgenda(
  supabase: SupabaseClient,
  cabinetId: string,
): Promise<{ journeeEntiere: boolean; afficherHoraires: boolean }> {
  const { data, error } = await supabase
    .from('cabinets')
    .select('agenda_journee_entiere, agenda_afficher_horaires')
    .eq('id', cabinetId)
    .maybeSingle()

  if (error || !data) {
    return { journeeEntiere: true, afficherHoraires: false }
  }
  const c = data as { agenda_journee_entiere?: boolean | null; agenda_afficher_horaires?: boolean | null }
  return {
    journeeEntiere: c.agenda_journee_entiere ?? true,
    afficherHoraires: c.agenda_afficher_horaires ?? false,
  }
}

/**
 * Comment chaque vétérinaire du cabinet apparaît dans l'agenda.
 *
 * ⚠️ TOUT LE CABINET, jamais les seuls vétos de la période. Les initiales se
 * départagent les unes PAR RAPPORT AUX AUTRES : calculées sur un sous-ensemble,
 * « AB » pourrait désigner Anne Bernard cette semaine et Antoine Blanc la
 * suivante. Une étiquette d'identité doit être stable dans le temps, sinon elle
 * n'identifie plus personne.
 */
async function occupantsDuCabinet(
  supabase: SupabaseClient,
  cabinetId: string,
): Promise<Map<string, OccupantPlace>> {
  const { data } = await supabase
    .from('veterinaires')
    .select('id, prenom, nom, libelle_agenda, couleur_google')
    .eq('cabinet_id', cabinetId)

  type Ligne = {
    id: string
    prenom: string | null
    nom: string | null
    libelle_agenda: string | null
    couleur_google: string | null
  }
  const lignes = ((data as unknown as Ligne[] | null) ?? [])
  const initiales = initialesUniques(
    lignes.map((v) => ({ id: v.id, prenom: v.prenom ?? '', nom: v.nom ?? '' })),
  )

  const map = new Map<string, OccupantPlace>()
  for (const v of lignes) {
    const perso = (v.libelle_agenda ?? '').trim()
    map.set(v.id, {
      vetId: v.id,
      // Le libellé choisi par le véto prime ; à défaut ses initiales ; en tout
      // dernier recours son prénom — un titre sans nom ne désigne personne.
      libelle: perso || initiales.get(v.id) || (v.prenom ?? '').trim(),
      // Le portier écarte une valeur hors palette : Google refuserait l'appel
      // entier, et une garde ne doit pas disparaître de l'agenda pour une
      // couleur mal saisie.
      couleurGoogle: estColorIdValide(v.couleur_google) ? v.couleur_google : null,
    })
  }
  return map
}

/**
 * La base du titre, par code de créneau : ce que le cabinet a nommé.
 *
 * `creneau_modele.libelle_agenda` d'abord (le nom pensé POUR l'agenda), sinon
 * le nom du créneau. Les lignes à `code` nul sont ignorées : `gardes.type` ne
 * peut jamais les désigner, elles ne seraient rattachées à rien.
 */
async function catalogueParCode(
  supabase: SupabaseClient,
  cabinetId: string,
): Promise<{ bases: Map<string, string>; roles: Map<string, readonly string[]> }> {
  const { data } = await supabase
    .from('creneau_modele')
    .select('code, nom, libelle_agenda, roles')
    .eq('cabinet_id', cabinetId)

  type Ligne = {
    code: string | null
    nom: string | null
    libelle_agenda: string | null
    roles: string[] | null
  }
  const bases = new Map<string, string>()
  const roles = new Map<string, readonly string[]>()
  for (const c of ((data as unknown as Ligne[] | null) ?? [])) {
    if (!c.code) continue
    const base = (c.libelle_agenda ?? '').trim() || (c.nom ?? '').trim()
    if (base) bases.set(c.code, base)
    if (c.roles?.length) roles.set(c.code, c.roles)
  }
  return { bases, roles }
}

/**
 * Assemble le contexte d'un cabinet — quatre lectures, une seule fois.
 *
 * `null` si le cabinet n'a pas d'agenda joignable : c'est le seul comportement
 * sûr quand on ne sait pas où écrire (T-001), et il doit être constaté AVANT
 * de charger le reste.
 */
async function contexteAgenda(
  supabase: SupabaseClient,
  cabinetId: string | null,
  periodeId: string | null | undefined,
): Promise<ContexteAgenda | null> {
  if (!cabinetId) return null
  const calendarId = await calendarIdDuCabinet(supabase, cabinetId)
  if (!isGoogleCalendarConfigured(calendarId) || !calendarId) return null

  const [reglages, occupants, catalogue, structure, relations] = await Promise.all([
    reglagesAgenda(supabase, cabinetId),
    occupantsDuCabinet(supabase, cabinetId),
    catalogueParCode(supabase, cabinetId),
    periodeId ? structurePourPeriode(supabase, periodeId) : Promise.resolve(undefined),
    periodeId ? chargerRelationsAffichagePeriode(supabase, periodeId) : Promise.resolve(undefined),
  ])

  return {
    calendarId,
    structure,
    relations,
    occupants,
    basesTitre: catalogue.bases,
    rolesParCreneau: catalogue.roles,
    journeeEntiere: reglages.journeeEntiere,
    afficherHoraires: reglages.afficherHoraires,
  }
}

/** Les places d'une garde, par index, en OCCUPANTS prêts pour l'agenda. */
function placesDeGardeBrute(
  garde: GardeBrute,
  occupants: Map<string, OccupantPlace>,
): Array<OccupantPlace | null> {
  const parIndex: Array<OccupantPlace | null> = [
    garde.premier_id ? occupants.get(garde.premier_id) ?? null : null,
    garde.second_id ? occupants.get(garde.second_id) ?? null : null,
  ]
  // Les places 3 et 4 ne vivent que dans le miroir. Les oublier ferait
  // disparaître un vétérinaire de garde de son propre agenda — en silence,
  // ce qui est le pire des cas.
  for (const p of (garde.garde_placements ?? [])) {
    if (p.place_index < 2) continue
    parIndex[p.place_index] = p.veterinaire_id ? occupants.get(p.veterinaire_id) ?? null : null
  }
  for (let i = 0; i < parIndex.length; i++) if (parIndex[i] === undefined) parIndex[i] = null
  return parIndex
}

/** Traduit une garde brute + ses exceptions en objet planifiable (pur). */
function versGardeAPlanifier(
  garde: GardeBrute,
  exceptions: ExceptionBrute[],
  ctx: ContexteAgenda,
): GardeAPlanifier {
  return {
    date: garde.date,
    type: garde.type,
    places: placesDeGardeBrute(garde, ctx.occupants),
    exceptions: exceptions.map((e) => ({
      date: e.date,
      role: e.role,
      // Remplaçant inconnu du cabinet → place traitée comme VACANTE, donc
      // aucun événement. Mieux vaut un trou visible qu'un titre au nom du
      // titulaire sur un jour qui ne lui appartient plus.
      occupant: e.veterinaire_id ? ctx.occupants.get(e.veterinaire_id) ?? null : null,
    })),
    base: garde.type,
  }
}

/** Une ligne de `gardes_exceptions`, telle que la base la rend. */
interface ExceptionBrute {
  garde_id: string
  date: string
  role: 'premier' | 'second'
  veterinaire_id: string | null
}

/** Les exceptions de plusieurs gardes, en UNE requête, indexées par garde. */
async function exceptionsParGarde(
  supabase: SupabaseClient,
  gardeIds: string[],
): Promise<Map<string, ExceptionBrute[]>> {
  const map = new Map<string, ExceptionBrute[]>()
  if (gardeIds.length === 0) return map

  const { data } = await supabase
    .from('gardes_exceptions')
    .select('garde_id, date, role, veterinaire_id')
    .in('garde_id', gardeIds)

  for (const e of ((data as unknown as ExceptionBrute[] | null) ?? [])) {
    const liste = map.get(e.garde_id) ?? []
    liste.push(e)
    map.set(e.garde_id, liste)
  }
  return map
}

/**
 * Structure des créneaux (horaires) du PROFIL de la période (P5 slice 4b).
 * Best-effort : période / cabinet introuvable → horaires par défaut. Sert à ce
 * que l'agenda affiche les MÊMES horaires que ceux écrits en base — désormais
 * portés par le profil (creneau_modele), non plus par le cabinet.
 */
async function structurePourPeriode(
  supabase: SupabaseClient,
  periodeId: string,
): Promise<StructureCreneauxResolue | undefined> {
  return chargerStructureProfilPeriode(supabase, periodeId)
}

export interface SyncResult {
  synced: number
  errors: string[]
  skipped: boolean  // true si Google non configuré, ou planning non publié
  /**
   * Pourquoi rien n'a été envoyé. Sans elle, l'écran affichait « 0 garde
   * synchronisée » sans dire si c'était une panne, une absence de réglage ou
   * un refus volontaire — trois situations qui n'appellent pas du tout la
   * même réaction.
   */
  raison?: string
}

// ── Synchronisation d'une période complète ───────────────────

/**
 * Synchronise toutes les gardes d'une période vers Google Agenda.
 * Crée les événements manquants, met à jour les existants.
 * Retourne un bilan (nombre synchronisés + erreurs éventuelles).
 */
// ── Helpers anti rate-limit Google ───────────────────────────
// Google Calendar bride les créations/suppressions en rafale. On traite
// par petits lots espacés, avec reprise automatique en cas d'échec.
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function avecReprise<T>(fn: () => Promise<T>, essais = 4): Promise<T> {
  let derniere: unknown
  for (let i = 0; i < essais; i++) {
    try {
      return await fn()
    } catch (e) {
      derniere = e
      if (i < essais - 1) await sleep(500 * (i + 1))
    }
  }
  throw derniere
}

// ============================================================
// LE RAPPROCHEMENT (B-079) — un événement par personne et par jour
// ============================================================
// La synchronisation ne « crée » plus : elle RAPPROCHE ce que Google porte de
// ce que le planning dit. C'est ce qui la rend rejouable. Relancée deux fois,
// elle doit produire exactement le même agenda — sinon la cliente se retrouve
// avec deux fois la même garde, et personne ne saura laquelle est la bonne.
//
// Trois opérations, dans cet ordre :
//   ① BASCULE  — l'ancien événement de bloc est supprimé et son id effacé ;
//   ② MISE À JOUR / CRÉATION — une ligne `garde_evenements` par (garde, jour, place) ;
//   ③ RETRAIT  — ce que Google porte encore et que le planning ne dit plus.

/** La clé d'unicité, la même qu'en base : UNIQUE (garde_id, jour, place_index). */
function cleEvenement(gardeId: string, jour: string, placeIndex: number): string {
  return `${gardeId}|${jour}|${placeIndex}`
}

interface LigneEvenement {
  garde_id: string
  jour: string
  place_index: number
  google_event_id: string
}

/** Les événements déjà connus pour ces gardes, indexés par clé. */
async function evenementsConnus(
  supabase: SupabaseClient,
  gardeIds: string[],
): Promise<Map<string, LigneEvenement>> {
  const map = new Map<string, LigneEvenement>()
  if (gardeIds.length === 0) return map

  const { data } = await supabase
    .from('garde_evenements')
    .select('garde_id, jour, place_index, google_event_id')
    .in('garde_id', gardeIds)

  for (const l of ((data as unknown as LigneEvenement[] | null) ?? [])) {
    map.set(cleEvenement(l.garde_id, l.jour, l.place_index), l)
  }
  return map
}

/** Une opération à exécuter côté Google, avec de quoi la tracer en base. */
type Operation =
  | { genre: 'creer'; gardeId: string; ev: EvenementPlanifie }
  | { genre: 'majer'; gardeId: string; ev: EvenementPlanifie; eventId: string }
  | { genre: 'retirer'; ligne: LigneEvenement }

/**
 * ⚠️ LE LOTISSEMENT COMPTE LES APPELS GOOGLE, PLUS LES GARDES.
 *
 * L'ancienne boucle lotissait par garde, à une écriture chacune. Une garde en
 * produit désormais jusqu'à six (3 jours × 2 places) : lotir par garde
 * lâcherait dix-huit appels d'un coup là où on en voulait trois, et Google
 * jette silencieusement une partie d'une rafale. On aplatit donc d'abord.
 */
const BATCH = 3
const PAUSE_MS = 250

async function executerOperations(
  supabase: SupabaseClient,
  operations: Operation[],
  ctx: ContexteAgenda,
  cabinetId: string,
): Promise<{ ok: number; errors: string[] }> {
  const errors: string[] = []
  let ok = 0

  for (let i = 0; i < operations.length; i += BATCH) {
    const lot = operations.slice(i, i + BATCH)
    const resultats = await Promise.all(lot.map(async (op) => {
      try {
        await avecReprise(async () => {
          if (op.genre === 'majer') {
            await majEvenementPlanifie(op.eventId, op.ev, ctx.calendarId)
            return
          }
          if (op.genre === 'creer') {
            const eventId = await creerEvenementPlanifie(op.ev, ctx.calendarId)
            if (!eventId) return
            // `upsert` sur la clé d'unicité : une reprise après échec partiel
            // met à jour la ligne au lieu de buter sur un conflit.
            await supabase.from('garde_evenements').upsert({
              cabinet_id: cabinetId,
              garde_id: op.gardeId,
              jour: op.ev.jour,
              place_index: op.ev.placeIndex,
              google_event_id: eventId,
              mis_a_jour_le: new Date().toISOString(),
            }, { onConflict: 'garde_id,jour,place_index' })
            return
          }
          // Retrait : l'événement d'abord, la ligne ENSUITE. Dans l'autre sens,
          // un échec Google laisserait un événement que plus rien ne référence —
          // un orphelin dans l'agenda de la cliente, invisible du logiciel.
          const bilan = await retirerEvenementsAvecBilan([op.ligne.google_event_id], ctx.calendarId)
          if (bilan.echecs.length > 0) throw new Error(bilan.echecs[0].message)
          await supabase
            .from('garde_evenements')
            .delete()
            .eq('garde_id', op.ligne.garde_id)
            .eq('jour', op.ligne.jour)
            .eq('place_index', op.ligne.place_index)
        })
        return null
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const ou = op.genre === 'retirer' ? op.ligne.jour : op.ev.jour
        return `${ou} : ${msg}`
      }
    }))

    for (const r of resultats) {
      if (r === null) ok++
      else errors.push(r)
    }
    if (i + BATCH < operations.length) await sleep(PAUSE_MS)
  }

  return { ok, errors }
}

/**
 * ⚠️ LA BASCULE DES ÉVÉNEMENTS DE BLOC — un événement ne peut pas « devenir » six.
 *
 * Val d'Allier porte une vingtaine d'événements de l'ancien format, un par
 * garde, dont l'identifiant vit dans `gardes.google_event_id`. On les supprime,
 * puis on efface l'identifiant. Dans cet ordre : si le processus s'arrête entre
 * les deux, la relance retrouve l'identifiant et retente — Google répond 404,
 * `retirerEvenementsAvecBilan` le compte en « déjà absent », et l'effacement
 * se fait au second passage. Effacer l'identifiant d'abord, à l'inverse, aurait
 * abandonné l'événement dans l'agenda sans plus aucun moyen de le retrouver.
 */
async function basculerAnciensEvenements(
  supabase: SupabaseClient,
  gardes: GardeBrute[],
  ctx: ContexteAgenda,
): Promise<string[]> {
  const aBasculer = gardes.filter((g) => g.google_event_id)
  if (aBasculer.length === 0) return []

  const bilan = await retirerEvenementsAvecBilan(
    aBasculer.map((g) => g.google_event_id as string),
    ctx.calendarId,
  )

  // Seules les gardes dont l'ancien événement n'existe plus (effacé ou déjà
  // absent) perdent leur identifiant. Celles qui ont résisté le gardent, pour
  // que la prochaine synchronisation retente au lieu d'oublier.
  const enEchec = new Set(bilan.echecs.map((e) => e.eventId))
  const liberees = aBasculer.filter((g) => !enEchec.has(g.google_event_id as string))
  if (liberees.length > 0) {
    await supabase
      .from('gardes')
      .update({ google_event_id: null })
      .in('id', liberees.map((g) => g.id))
  }

  return bilan.echecs.map((e) => `Ancien événement ${e.eventId} : ${e.message}`)
}

/**
 * Rapproche l'agenda du planning pour un lot de gardes. Cœur commun de la
 * synchronisation d'une période et de celle d'une garde isolée — les deux
 * chemins doivent produire le même agenda, donc partager le même code.
 */
async function rapprocher(
  supabase: SupabaseClient,
  gardes: GardeBrute[],
  ctx: ContexteAgenda,
  cabinetId: string,
): Promise<{ synced: number; errors: string[] }> {
  const gardeIds = gardes.map((g) => g.id)
  const [exceptions, connus] = await Promise.all([
    exceptionsParGarde(supabase, gardeIds),
    evenementsConnus(supabase, gardeIds),
  ])

  const errors = await basculerAnciensEvenements(supabase, gardes, ctx)

  const operations: Operation[] = []
  const clesVoulues = new Set<string>()

  for (const garde of gardes) {
    const planifies = planifierEvenementsGarde(
      versGardeAPlanifier(garde, exceptions.get(garde.id) ?? [], ctx),
      {
        mode: ctx.journeeEntiere ? 'journee' : 'horaire',
        afficherHoraires: ctx.afficherHoraires,
        relations: ctx.relations,
        structure: ctx.structure,
        baseParCode: (code) => ctx.basesTitre.get(code),
        rolesParCode: (code) => ctx.rolesParCreneau.get(code),
      },
    )

    for (const ev of planifies) {
      const cle = cleEvenement(garde.id, ev.jour, ev.placeIndex)
      clesVoulues.add(cle)
      const dejaLa = connus.get(cle)
      operations.push(dejaLa
        ? { genre: 'majer', gardeId: garde.id, ev, eventId: dejaLa.google_event_id }
        : { genre: 'creer', gardeId: garde.id, ev })
    }
  }

  // Ce que Google porte encore et que le planning ne dit plus : une place
  // devenue vacante, un jour retiré, une garde raccourcie. Sans ce retrait,
  // l'agenda garderait indéfiniment le nom de quelqu'un qui n'est plus de garde.
  for (const [cle, ligne] of connus) {
    if (!clesVoulues.has(cle)) operations.push({ genre: 'retirer', ligne })
  }

  const resultat = await executerOperations(supabase, operations, ctx, cabinetId)
  return { synced: resultat.ok, errors: [...errors, ...resultat.errors] }
}

export async function syncCalendrier(
  supabase: SupabaseClient,
  periodeId: string
): Promise<SyncResult> {
  // ⚠️ UN BROUILLON NE SORT PAS DU LOGICIEL.
  //
  // L'agenda du cabinet est un canal de DIFFUSION : ce qui s'y écrit est lu
  // par toute l'équipe, et par des gens qui n'ouvriront jamais GuardVeto. Rien
  // n'empêchait jusqu'ici d'y déverser un planning non publié — et c'est
  // exactement ce qui s'est produit chez Val d'Allier : 38 événements de
  // brouillon dans l'agenda du client, pour zéro planning publié. Chaque
  // retouche manuelle en ajoutait un.
  //
  // Le critère est `publie_at`, pas le statut : une période peut être
  // « verrouillée » sans avoir jamais été diffusée (c'est le cas d'un
  // historique amorcé en base), et son passé n'a rien à faire dans l'agenda.
  const { data: per } = await supabase
    .from('periodes')
    .select('publie_at')
    .eq('id', periodeId)
    .maybeSingle()

  if (!(per as { publie_at: string | null } | null)?.publie_at) {
    return {
      synced: 0,
      errors: [],
      skipped: true,
      raison: "Ce planning n'a pas encore été publié : rien n'est envoyé vers l'agenda.",
    }
  }

  // calendarId scopé au cabinet de la période (fallback env en aval).
  const cabinetId = await cabinetIdDePeriode(supabase, periodeId)
  const ctx = await contexteAgenda(supabase, cabinetId, periodeId)

  if (!ctx || !cabinetId) {
    return { synced: 0, errors: [], skipped: true, raison: "Aucun agenda Google n'est configuré." }
  }

  const { data: gardes, error } = await supabase
    .from('gardes')
    .select(CHAMPS_GARDE)
    .eq('periode_id', periodeId)
    .order('date')

  if (error || !gardes) {
    return { synced: 0, errors: [`Impossible de récupérer les gardes : ${error?.message}`], skipped: false }
  }

  const { synced, errors } = await rapprocher(
    supabase,
    gardes as unknown as GardeBrute[],
    ctx,
    cabinetId,
  )
  return { synced, errors, skipped: false }
}

// ── Mise à jour d'une garde individuelle ─────────────────────

/**
 * Met à jour l'événement Google Agenda d'une garde modifiée.
 * Crée l'événement s'il n'existe pas encore.
 * No-op si Google n'est pas configuré.
 */
export async function syncGardeIndividuelle(
  supabase: SupabaseClient,
  gardeId: string
): Promise<void> {
  const { data: garde } = await supabase
    .from('gardes')
    .select(`${CHAMPS_GARDE}, periodes!inner ( publie_at )`)
    .eq('id', gardeId)
    .single()

  if (!garde) return

  // ⚠️ C'EST ICI QUE LE BROUILLON FUYAIT.
  //
  // Cette fonction est appelée à CHAQUE modification manuelle d'une garde.
  // Sans ce garde-fou, retoucher un planning non publié écrivait l'événement
  // dans l'agenda du cabinet : chez Val d'Allier, 38 événements s'y étaient
  // accumulés pour zéro planning publié. Le client voyait des gardes qui
  // n'engageaient personne, et personne ne pouvait deviner d'où elles
  // venaient.
  //
  // Tant qu'un planning n'est pas publié, il ne sort pas du logiciel.
  const perGarde = (garde as unknown as { periodes?: { publie_at: string | null } | Array<{ publie_at: string | null }> }).periodes
  const publieAt = Array.isArray(perGarde) ? perGarde[0]?.publie_at : perGarde?.publie_at
  if (!publieAt) return

  const g = garde as unknown as GardeBrute

  // Le même rapprochement que pour une période, sur une seule garde : les deux
  // chemins doivent produire le même agenda. C'est cette divergence-là qui,
  // ailleurs dans ce projet, a fait qu'un réglage corrigé sur un chemin restait
  // faux sur l'autre pendant deux mois.
  const ctx = await contexteAgenda(supabase, g.cabinet_id ?? null, g.periode_id)
  if (!ctx || !g.cabinet_id) return

  await rapprocher(supabase, [g], ctx, g.cabinet_id)
}

// ── Suppression des événements d'une période ─────────────────

/**
 * Supprime tous les événements Google Agenda d'une période.
 *
 * ⚠️ CE COMMENTAIRE A MENTI PENDANT DES MOIS. Il annonçait « appelé avant une
 * re-génération pour éviter les doublons » et l'action de suppression de
 * planning s'appuyait, à côté, sur l'idée qu'« un brouillon n'a aucun événement
 * d'agenda ». C'était vrai tant que seule la publication écrivait dans
 * l'agenda ; ça ne l'est plus depuis que le brouillon a fui chez Val d'Allier
 * (38 événements pour zéro planning publié, 2026-08-20). Une garde peut porter
 * un `google_event_id` quel que soit le statut de sa période.
 *
 * Best-effort : les échecs sont avalés. Pour un geste où l'état de l'agenda
 * COMMANDE la suite (suppression, dépublication), passer par
 * `retirerEvenementsAvecBilan` — qui, lui, dit ce qui a résisté.
 */
export async function supprimerEvenementsCalendrier(
  supabase: SupabaseClient,
  periodeId: string
): Promise<void> {
  const cabinetId = await cabinetIdDePeriode(supabase, periodeId)
  const calendarId = await calendarIdDuCabinet(supabase, cabinetId)
  if (!isGoogleCalendarConfigured(calendarId)) return

  await supprimerEvenementsParIds(
    await idsEvenementsDePeriode(supabase, periodeId),
    calendarId,
  )
}

/**
 * TOUS les identifiants d'événements d'une période — les DEUX sources.
 *
 * ⚠️ Depuis B-079 il y en a deux : `gardes.google_event_id` (ancien format, un
 * par garde, en voie d'extinction) et `garde_evenements` (un par personne et
 * par jour). N'en lire qu'une laisse des orphelins dans l'agenda de la
 * cliente : des gardes visibles que plus rien dans le logiciel ne référence, et
 * donc que plus rien ne pourra jamais retirer.
 *
 * ⚠️ À LIRE AVANT tout DELETE de gardes : `garde_evenements.garde_id` est en
 * `ON DELETE CASCADE`, les lignes disparaissent avec la garde. Même discipline
 * que celle déjà en place pour `gardes.google_event_id`.
 */
export async function idsEvenementsDePeriode(
  supabase: SupabaseClient,
  periodeId: string,
): Promise<string[]> {
  const { data: gardes } = await supabase
    .from('gardes')
    .select('id, google_event_id')
    .eq('periode_id', periodeId)

  const lignes = ((gardes ?? []) as { id: string; google_event_id: string | null }[])
  const anciens = lignes
    .map((g) => g.google_event_id)
    .filter((id): id is string => Boolean(id))

  const nouveaux = await idsEvenementsDeGardes(supabase, lignes.map((g) => g.id))
  return [...new Set([...anciens, ...nouveaux])]
}

/** Les identifiants portés par `garde_evenements` pour ces gardes. */
export async function idsEvenementsDeGardes(
  supabase: SupabaseClient,
  gardeIds: string[],
): Promise<string[]> {
  if (gardeIds.length === 0) return []
  const { data } = await supabase
    .from('garde_evenements')
    .select('google_event_id')
    .in('garde_id', gardeIds)

  return ((data ?? []) as { google_event_id: string | null }[])
    .map((l) => l.google_event_id)
    .filter((id): id is string => Boolean(id))
}

/**
 * Supprime une liste d'événements Google Agenda par leurs ids.
 *
 * Variante « ids pré-capturés » (audit 2026-07-03) : les `google_event_id`
 * vivent sur les lignes `gardes` — lors d'une régénération, il faut donc les
 * LIRE avant le DELETE des gardes, mais ne purger l'agenda qu'APRÈS le succès
 * de la réécriture en base (sinon un échec à mi-course laissait la base vide
 * ET l'agenda déjà purgé).
 */
export async function supprimerEvenementsParIds(
  eventIds: string[],
  calendarId?: string | null,
): Promise<void> {
  // Une seule mécanique de suppression pour toute l'application ; ici on
  // choisit simplement d'ignorer le bilan (régénération = best-effort).
  await retirerEvenementsAvecBilan(eventIds, calendarId)
}

/** Le code HTTP porté par une erreur googleapis, quelle que soit sa forme. */
function codeHttp(e: unknown): number | undefined {
  const err = e as { code?: unknown; status?: unknown; response?: { status?: unknown } }
  for (const brut of [err?.code, err?.status, err?.response?.status]) {
    const n = typeof brut === 'string' ? Number(brut) : brut
    if (typeof n === 'number' && Number.isFinite(n)) return n
  }
  return undefined
}

/**
 * Retire une liste d'événements et DIT ce qui a résisté.
 *
 * La différence avec `supprimerEvenementsParIds` tient en une ligne — le
 * `.catch(() => {})` qui existait ici avalait tout — mais elle change la nature
 * de l'opération. Tant que les échecs sont muets, l'appelant ne peut que
 * supposer que l'agenda est propre ; c'est cette supposition qui a laissé des
 * événements orphelins chez le client. Un geste destructeur doit pouvoir
 * s'arrêter sur la foi d'un CONSTAT.
 *
 * ⚠️ `404` / `410` ne sont PAS des échecs : Google ne connaît déjà plus
 * l'événement, l'état visé est atteint. Ils sont comptés à part, et ne
 * déclenchent aucune reprise (réessayer quatre fois d'effacer ce qui n'existe
 * pas ne coûterait que du temps).
 */
export async function retirerEvenementsAvecBilan(
  eventIds: string[],
  calendarId?: string | null,
): Promise<BilanAgenda> {
  const bilan: BilanAgenda = { effaces: 0, dejaAbsents: 0, echecs: [] }
  if (eventIds.length === 0) return bilan

  // L'appelant est censé avoir vérifié avant (l'ordre des opérations le lui
  // impose) ; sans ce garde-fou, `deleteGardeEvent` ne ferait rien EN SILENCE
  // et on annoncerait un agenda nettoyé qui ne l'a jamais été.
  if (!isGoogleCalendarConfigured(calendarId)) {
    return {
      ...bilan,
      echecs: eventIds.map((eventId) => ({
        eventId,
        message: 'Aucun agenda Google joignable.',
      })),
    }
  }

  // Suppression par petits lots espacés + reprise (anti rate-limit Google)
  const BATCH = 3
  const PAUSE_MS = 250

  for (let i = 0; i < eventIds.length; i += BATCH) {
    const lot = eventIds.slice(i, i + BATCH)
    await Promise.all(
      lot.map(async (eventId) => {
        try {
          const issue = await avecReprise<'efface' | 'deja-absent'>(async () => {
            try {
              await deleteGardeEvent(eventId, calendarId)
              return 'efface'
            } catch (e) {
              // Déjà absent : on ne réessaie pas, et ce n'est pas une erreur.
              const code = codeHttp(e)
              if (code === 404 || code === 410) return 'deja-absent'
              throw e
            }
          })
          if (issue === 'efface') bilan.effaces++
          else bilan.dejaAbsents++
        } catch (e) {
          const code = codeHttp(e)
          if (code === 404 || code === 410) {
            bilan.dejaAbsents++
            return
          }
          bilan.echecs.push({
            eventId,
            code,
            message: e instanceof Error ? e.message : String(e),
          })
        }
      })
    )
    if (i + BATCH < eventIds.length) await sleep(PAUSE_MS)
  }

  return bilan
}
