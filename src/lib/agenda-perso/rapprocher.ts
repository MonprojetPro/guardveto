// ============================================================
// GUARDVETO — B-173 : le RAPPROCHEMENT des agendas personnels
// ============================================================
// Comme pour l'agenda du cabinet (B-079), on ne « crée » pas : on RAPPROCHE ce
// que Google porte de ce que le planning dit. Relancée deux fois, la synchro
// produit le même agenda. C'est ce qui permet de l'appeler après CHAQUE
// changement (publication, journée posée, garde échangée, réglage modifié…)
// sans calculer ce qui a changé : on recalcule tout, on n'écrit que l'écart.
//
// Tourne avec la clé de service : il lit les plannings de tout le cabinet et
// écrit dans des tables fermées au navigateur. Les appelants vérifient QUI
// demande avant de le déclencher.
// ============================================================

import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { agendaDuCabinet, gardesPlanifieesDuCabinet, libellesDuCabinet } from '@/lib/sync-calendrier'
import {
  contenuEffectif,
  operationsAgenda,
  planifierAgendaPerso,
  type ChoixJournees,
  type EvenementConnu,
  type GardeAPlacer,
  type GenreMembre,
  type OperationAgenda,
  type Placement,
  type PresenceAPlacer,
  type ReglagesAgendaPerso,
  reglagesParDefaut,
} from './planifier'
import * as G from './google'

export function clientService(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('Variables Supabase manquantes.')
  return createServiceClient(url, key)
}

/** Une ligne de `agendas_perso`. */
export interface LigneAgendaPerso {
  id: string
  cabinet_id: string
  veterinaire_id: string | null
  secretaire_id: string | null
  actif: boolean
  personnalise: boolean
  journees: ChoixJournees
  placement: Placement
  mes_gardes: boolean
  gardes_autres: boolean
  google_calendar_id: string | null
  partage_email: string | null
  invitation_envoyee_le: string | null
  partage_cabinet: 'non_concerne' | 'retire' | 'absent' | 'impossible'
  role_cabinet_retire: string | null
  sync_depuis: string | null
  a_refaire: boolean
  progression_faite: number
  progression_total: number
  derniere_sync_le: string | null
  derniere_erreur: string | null
}

export function reglagesDeLigne(l: LigneAgendaPerso): ReglagesAgendaPerso {
  return {
    actif: l.actif,
    personnalise: l.personnalise,
    journees: l.journees,
    placement: l.placement,
    mesGardes: l.mes_gardes,
    gardesAutres: l.gardes_autres,
  }
}

/** Un membre de l'équipe qui peut avoir un agenda perso. */
interface Membre {
  genre: GenreMembre
  id: string
  prenom: string
  email: string | null
  actif: boolean
}

/** Tout ce qui ne dépend pas de la personne — chargé UNE fois par cabinet. */
interface ContexteCabinet {
  cabinetId: string
  depuis: string
  agendaCabinet: string | null
  presences: PresenceAPlacer[]
  gardes: GardeAPlacer[]
  libelles: Map<string, string>
}

/** Fenêtre : on ne réécrit pas le passé lointain. Sept jours de recul. */
function depuisAujourdhui(): string {
  const auj = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
  const [a, m, j] = auj.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, j - 7)).toISOString().slice(0, 10)
}

const VERROU_MINUTES = 10
const LOT = 3
const PAUSE_MS = 250
const PAGE = 1000

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function avecReprise<T>(fn: () => Promise<T>, essais = 4): Promise<T> {
  let derniere: unknown
  for (let i = 0; i < essais; i++) {
    try {
      return await fn()
    } catch (e) {
      derniere = e
      const code = G.codeErreur(e)
      // 4xx autre que quota : réessayer ne changera rien.
      if (code && code >= 400 && code < 500 && code !== 403 && code !== 429) throw e
      if (i < essais - 1) await sleep(600 * (i + 1))
    }
  }
  throw derniere
}

// ── Lectures ─────────────────────────────────────────────────

/**
 * Les présences des plannings PUBLIÉS, à partir de `depuis`. Paginé : une
 * lecture Supabase s'arrête à 1 000 lignes sans le dire, et un agenda
 * rapproché d'une liste tronquée perdrait des journées en silence.
 */
async function presencesPubliees(admin: SupabaseClient, cabinetId: string, depuis: string): Promise<PresenceAPlacer[]> {
  type Ligne = {
    date: string
    veterinaire_id: string
    bloc_id: string
    blocs_journee: { nom: string; debut: string; fin: string; ordre: number } | null
  }
  const sortie: PresenceAPlacer[] = []
  for (let de = 0; ; de += PAGE) {
    const { data, error } = await admin
      .from('presences_journee')
      .select('date, veterinaire_id, bloc_id, blocs_journee ( nom, debut, fin, ordre ), periodes!inner ( publie_at )')
      .eq('cabinet_id', cabinetId)
      .gte('date', depuis)
      .not('periodes.publie_at', 'is', null)
      .order('date')
      .order('id')
      .range(de, de + PAGE - 1)
    if (error) throw new Error(`Lecture des journées impossible : ${error.message}`)
    const lignes = (data as unknown as Ligne[] | null) ?? []
    for (const l of lignes) {
      if (!l.blocs_journee) continue
      sortie.push({
        date: l.date,
        vetId: l.veterinaire_id,
        blocId: l.bloc_id,
        blocNom: l.blocs_journee.nom,
        debut: l.blocs_journee.debut,
        fin: l.blocs_journee.fin,
        ordre: l.blocs_journee.ordre,
      })
    }
    if (lignes.length < PAGE) break
  }
  return sortie
}

async function contexteCabinet(admin: SupabaseClient, cabinetId: string): Promise<ContexteCabinet> {
  const depuis = depuisAujourdhui()
  const [agendaCabinet, presences, gardes, libelles] = await Promise.all([
    agendaDuCabinet(admin, cabinetId),
    presencesPubliees(admin, cabinetId, depuis),
    gardesPlanifieesDuCabinet(admin, cabinetId, depuis),
    libellesDuCabinet(admin, cabinetId),
  ])
  return { cabinetId, depuis, agendaCabinet, presences, gardes, libelles }
}

async function membreDeLigne(admin: SupabaseClient, l: LigneAgendaPerso): Promise<Membre | null> {
  if (l.veterinaire_id) {
    const { data, error } = await admin
      .from('veterinaires').select('id, prenom, email, actif').eq('id', l.veterinaire_id).maybeSingle()
    if (error) throw new Error(`Lecture de la fiche impossible : ${error.message}`)
    if (!data) return null
    const v = data as { id: string; prenom: string | null; email: string | null; actif: boolean }
    return { genre: 'veto', id: v.id, prenom: (v.prenom ?? '').trim(), email: v.email, actif: v.actif }
  }
  const { data, error } = await admin
    .from('secretaires').select('id, nom, email, actif').eq('id', l.secretaire_id as string).maybeSingle()
  if (error) throw new Error(`Lecture de la fiche impossible : ${error.message}`)
  if (!data) return null
  const s = data as { id: string; nom: string | null; email: string | null; actif: boolean }
  return { genre: 'secretaire', id: s.id, prenom: (s.nom ?? '').trim(), email: s.email, actif: s.actif }
}

export function emailPropre(e: string | null | undefined): string | null {
  const v = (e ?? '').trim().toLowerCase()
  return v.includes('@') ? v : null
}

// ── Le verrou ────────────────────────────────────────────────
// Deux synchros simultanées du même agenda créeraient chacune les événements
// manquants : doublons garantis. On pose un verrou par compare-and-set sur la
// valeur LUE (jamais de `.or()` sur un `.update()` — leçon 0e7d341). Une
// synchro qui trouve le verrou pris note « à refaire » : celle qui tourne
// repassera avant de rendre la main.

async function prendreVerrou(admin: SupabaseClient, l: LigneAgendaPerso): Promise<boolean> {
  const maintenant = new Date()
  const libre = !l.sync_depuis || maintenant.getTime() - new Date(l.sync_depuis).getTime() > VERROU_MINUTES * 60_000
  if (!libre) {
    await admin.from('agendas_perso').update({ a_refaire: true }).eq('id', l.id)
    return false
  }
  let q = admin
    .from('agendas_perso')
    .update({ sync_depuis: maintenant.toISOString(), a_refaire: false })
    .eq('id', l.id)
  q = l.sync_depuis ? q.eq('sync_depuis', l.sync_depuis) : q.is('sync_depuis', null)
  const { data, error } = await q.select('id')
  return !error && (data?.length ?? 0) === 1
}

async function relireLigne(admin: SupabaseClient, id: string): Promise<LigneAgendaPerso | null> {
  const { data, error } = await admin.from('agendas_perso').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Lecture de l’agenda perso impossible : ${error.message}`)
  return (data as LigneAgendaPerso | null) ?? null
}

// ── Une personne ─────────────────────────────────────────────

async function majLigne(admin: SupabaseClient, id: string, champs: Partial<LigneAgendaPerso>): Promise<void> {
  const { error } = await admin
    .from('agendas_perso')
    .update({ ...champs, mis_a_jour_le: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`Écriture de l’agenda perso impossible : ${error.message}`)
}

/**
 * Le partage de l'agenda du CABINET pour cette personne.
 * Retiré quand elle personnalise (ses gardes arrivent alors par son agenda
 * perso, sinon elle les verrait deux fois), rendu sinon.
 */
async function rapprocherPartageCabinet(
  admin: SupabaseClient,
  l: LigneAgendaPerso,
  email: string | null,
  ctx: ContexteCabinet,
  veutRetire: boolean,
): Promise<string | null> {
  if (!ctx.agendaCabinet || !email) return null
  try {
    if (veutRetire && l.partage_cabinet === 'non_concerne') {
      const role = await G.roleDe(ctx.agendaCabinet, email)
      // Jamais retirer un PROPRIÉTAIRE : ce serait lui ôter la main sur l'agenda
      // du cabinet. On lui demande de le masquer lui-même.
      if (!role || role === 'owner') {
        await majLigne(admin, l.id, { partage_cabinet: role === 'owner' ? 'impossible' : 'absent' })
        return null
      }
      await G.retirerPartage(ctx.agendaCabinet, email)
      await majLigne(admin, l.id, { partage_cabinet: 'retire', role_cabinet_retire: role })
      return null
    }
    if (!veutRetire && l.partage_cabinet === 'retire') {
      // Rendu SANS e-mail : la personne l'avait déjà, elle le retrouve.
      await G.partager(ctx.agendaCabinet, email, l.role_cabinet_retire ?? 'reader', false)
      await majLigne(admin, l.id, { partage_cabinet: 'non_concerne', role_cabinet_retire: null })
      return null
    }
    if (!veutRetire && l.partage_cabinet !== 'non_concerne') {
      await majLigne(admin, l.id, { partage_cabinet: 'non_concerne' })
    }
    return null
  } catch (e) {
    if (G.codeErreur(e) === 403 || G.codeErreur(e) === 404) {
      // GuardVeto n'a pas le droit de gérer les partages de l'agenda du cabinet.
      if (veutRetire) await majLigne(admin, l.id, { partage_cabinet: 'impossible' })
      return null
    }
    return `Agenda du cabinet : ${G.messageErreur(e)}`
  }
}

async function evenementsConnus(admin: SupabaseClient, agendaId: string): Promise<EvenementConnu[]> {
  const sortie: EvenementConnu[] = []
  for (let de = 0; ; de += PAGE) {
    const { data, error } = await admin
      .from('agenda_perso_evenements')
      .select('cle, google_event_id, empreinte')
      .eq('agenda_id', agendaId)
      .order('cle')
      .range(de, de + PAGE - 1)
    if (error) throw new Error(`Lecture des événements connus impossible : ${error.message}`)
    const lignes = (data as { cle: string; google_event_id: string; empreinte: string }[] | null) ?? []
    sortie.push(...lignes.map((x) => ({ cle: x.cle, googleEventId: x.google_event_id, empreinte: x.empreinte })))
    if (lignes.length < PAGE) break
  }
  return sortie
}

async function executer(
  admin: SupabaseClient,
  l: LigneAgendaPerso,
  calendarId: string,
  ops: OperationAgenda[],
): Promise<string[]> {
  const erreurs: string[] = []
  await majLigne(admin, l.id, { progression_faite: 0, progression_total: ops.length })
  for (let i = 0; i < ops.length; i += LOT) {
    const lot = ops.slice(i, i + LOT)
    await Promise.all(lot.map(async (op) => {
      try {
        await avecReprise(async () => {
          if (op.genre === 'creer') {
            const id = await G.creerEvenement(calendarId, op.voulu)
            // La mémoire est écrite TOUT DE SUITE : une synchro coupée en
            // route reprendra là où elle en était, sans doublon.
            const { error } = await admin.from('agenda_perso_evenements').upsert({
              agenda_id: l.id, cle: op.voulu.cle, google_event_id: id, empreinte: op.voulu.empreinte,
              mis_a_jour_le: new Date().toISOString(),
            }, { onConflict: 'agenda_id,cle' })
            if (error) throw new Error(error.message)
            return
          }
          if (op.genre === 'majer') {
            try {
              await G.majEvenement(calendarId, op.googleEventId, op.voulu)
            } catch (e) {
              // Effacé à la main côté Google : on le recrée plutôt que d'échouer.
              if (G.codeErreur(e) !== 404 && G.codeErreur(e) !== 410) throw e
              op.googleEventId = await G.creerEvenement(calendarId, op.voulu)
            }
            const { error } = await admin.from('agenda_perso_evenements')
              .update({ google_event_id: op.googleEventId, empreinte: op.voulu.empreinte, mis_a_jour_le: new Date().toISOString() })
              .eq('agenda_id', l.id).eq('cle', op.voulu.cle)
            if (error) throw new Error(error.message)
            return
          }
          // L'événement d'abord, la ligne ENSUITE : dans l'autre sens, un échec
          // Google laisserait un événement que plus rien ne référence.
          await G.retirerEvenement(calendarId, op.connu.googleEventId)
          const { error } = await admin.from('agenda_perso_evenements')
            .delete().eq('agenda_id', l.id).eq('cle', op.connu.cle)
          if (error) throw new Error(error.message)
        })
      } catch (e) {
        erreurs.push(G.messageErreur(e))
      }
    }))
    await majLigne(admin, l.id, { progression_faite: Math.min(i + LOT, ops.length) })
    if (i + LOT < ops.length) await sleep(PAUSE_MS)
  }
  return erreurs
}

/** Un passage complet pour une personne. Renvoie la première erreur, ou null. */
async function unPassage(admin: SupabaseClient, l: LigneAgendaPerso, ctx: ContexteCabinet): Promise<string | null> {
  const membre = await membreDeLigne(admin, l)
  const email = emailPropre(membre?.email)
  const reglages = reglagesDeLigne(l)
  const enService = !!membre && membre.actif && reglages.actif && !!email
  const genre: GenreMembre = membre?.genre ?? (l.veterinaire_id ? 'veto' : 'secretaire')
  const erreurs: string[] = []

  // ① Le partage de l'agenda du cabinet.
  const errCab = await rapprocherPartageCabinet(admin, l, email, ctx, enService && reglages.personnalise)
  if (errCab) erreurs.push(errCab)

  // ② Fonction coupée (ou personne partie) : on vide l'agenda, on le garde.
  if (!enService) {
    if (l.google_calendar_id) {
      const ops = operationsAgenda([], await evenementsConnus(admin, l.id), ctx.depuis, true)
      erreurs.push(...await executer(admin, l, l.google_calendar_id, ops))
    }
    return erreurs[0] ?? null
  }

  // ③ L'agenda existe, et il est partagé à la bonne adresse.
  let calendarId = l.google_calendar_id
  if (calendarId && !(await avecReprise(() => G.agendaExiste(calendarId as string)))) {
    // Supprimé côté Google : on repart d'un agenda neuf, sans mémoire.
    await admin.from('agenda_perso_evenements').delete().eq('agenda_id', l.id)
    calendarId = null
  }
  if (!calendarId) {
    calendarId = await avecReprise(() => G.creerAgenda(`GuardVeto — ${membre!.prenom || 'mon planning'}`))
    await majLigne(admin, l.id, { google_calendar_id: calendarId, partage_email: null, invitation_envoyee_le: null })
    l.partage_email = null
  }
  if (l.partage_email !== email) {
    if (l.partage_email) await G.retirerPartage(calendarId, l.partage_email)
    await avecReprise(() => G.partager(calendarId as string, email!, 'reader', true))
    await majLigne(admin, l.id, { partage_email: email, invitation_envoyee_le: new Date().toISOString() })
  }

  // ④ Les événements.
  const voulus = planifierAgendaPerso({
    contenu: contenuEffectif(reglages, genre),
    vetId: genre === 'veto' ? membre!.id : null,
    presences: ctx.presences,
    libelles: ctx.libelles,
    gardes: ctx.gardes,
  })
  const ops = operationsAgenda(voulus, await evenementsConnus(admin, l.id), ctx.depuis)
  erreurs.push(...await executer(admin, l, calendarId, ops))
  return erreurs[0] ?? null
}

/**
 * Rapproche UN agenda perso, sous verrou. Repasse tant qu'un autre changement
 * est arrivé pendant qu'il tournait (au plus trois fois).
 */
export async function rapprocherAgenda(admin: SupabaseClient, agendaId: string, ctxConnu?: ContexteCabinet): Promise<void> {
  let ligne = await relireLigne(admin, agendaId)
  if (!ligne || !(await prendreVerrou(admin, ligne))) return

  try {
    for (let tour = 0; tour < 3; tour++) {
      ligne = await relireLigne(admin, agendaId)
      if (!ligne) return
      const ctx = tour === 0 && ctxConnu ? ctxConnu : await contexteCabinet(admin, ligne.cabinet_id)
      let erreur: string | null
      try {
        erreur = await unPassage(admin, ligne, ctx)
      } catch (e) {
        erreur = G.messageErreur(e)
      }
      await majLigne(admin, agendaId, { derniere_sync_le: new Date().toISOString(), derniere_erreur: erreur })
      const apres = await relireLigne(admin, agendaId)
      if (!apres?.a_refaire) break
      await majLigne(admin, agendaId, { a_refaire: false })
    }
  } finally {
    await admin.from('agendas_perso').update({ sync_depuis: null }).eq('id', agendaId)
  }
}

/**
 * La ligne d'agenda perso d'un membre, créée avec les réglages par défaut si
 * elle n'existe pas encore.
 */
export async function ligneDuMembre(
  admin: SupabaseClient,
  cabinetId: string,
  membre: { genre: GenreMembre; id: string },
): Promise<LigneAgendaPerso> {
  const col = membre.genre === 'veto' ? 'veterinaire_id' : 'secretaire_id'
  const { data, error } = await admin.from('agendas_perso').select('*').eq(col, membre.id).maybeSingle()
  if (error) throw new Error(`Lecture de l’agenda perso impossible : ${error.message}`)
  if (data) return data as LigneAgendaPerso

  const d = reglagesParDefaut(membre.genre)
  // `insert` et non `upsert` : l'unicité repose sur un index PARTIEL
  // (`WHERE veterinaire_id IS NOT NULL`), que `ON CONFLICT (col)` ne sait pas
  // désigner — Postgres refuserait chaque création. Le doublon concurrent est
  // rattrapé juste en dessous, en relisant.
  const { data: cree, error: errC } = await admin.from('agendas_perso').insert({
    cabinet_id: cabinetId,
    [col]: membre.id,
    actif: d.actif,
    personnalise: d.personnalise,
    journees: d.journees,
    placement: d.placement,
    mes_gardes: d.mesGardes,
    gardes_autres: d.gardesAutres,
  }).select('*').single()
  if (errC) {
    // Créée entre-temps par une autre synchro : on la relit.
    const { data: relue } = await admin.from('agendas_perso').select('*').eq(col, membre.id).maybeSingle()
    if (relue) return relue as LigneAgendaPerso
    throw new Error(`Création de l’agenda perso impossible : ${errC.message}`)
  }
  return cree as LigneAgendaPerso
}

/** La fonction est-elle ouverte à ce cabinet, et le cabinet a-t-il un agenda ? */
export async function agendaPersoOuvert(admin: SupabaseClient, cabinetId: string): Promise<boolean> {
  const { data, error } = await admin.from('cabinets').select('agenda_perso_ouvert').eq('id', cabinetId).maybeSingle()
  if (error || !(data as { agenda_perso_ouvert?: boolean } | null)?.agenda_perso_ouvert) return false
  return G.googleConfigure() && !!(await agendaDuCabinet(admin, cabinetId))
}

/**
 * Rapproche TOUS les agendas perso d'un cabinet : appelé après chaque
 * changement de planning. Sans effet si la fonction n'y est pas ouverte.
 */
export async function rapprocherCabinet(admin: SupabaseClient, cabinetId: string): Promise<void> {
  if (!(await agendaPersoOuvert(admin, cabinetId))) return

  const [vetos, secretaires] = await Promise.all([
    admin.from('veterinaires').select('id').eq('cabinet_id', cabinetId).eq('actif', true),
    admin.from('secretaires').select('id').eq('cabinet_id', cabinetId).eq('actif', true),
  ])
  if (vetos.error) throw new Error(vetos.error.message)
  if (secretaires.error) throw new Error(secretaires.error.message)

  // Chaque membre actif a sa ligne (le mode par défaut s'applique sans qu'il
  // ait rien réglé)…
  for (const v of (vetos.data as { id: string }[]) ?? []) await ligneDuMembre(admin, cabinetId, { genre: 'veto', id: v.id })
  for (const s of (secretaires.data as { id: string }[]) ?? []) await ligneDuMembre(admin, cabinetId, { genre: 'secretaire', id: s.id })

  // … et TOUTES les lignes passent, y compris celles des membres partis : leur
  // agenda doit être vidé, pas abandonné avec un planning qui n'est plus le leur.
  const { data: lignes, error } = await admin.from('agendas_perso').select('id').eq('cabinet_id', cabinetId)
  if (error) throw new Error(error.message)

  const ctx = await contexteCabinet(admin, cabinetId)
  for (const l of (lignes as { id: string }[]) ?? []) {
    try {
      await rapprocherAgenda(admin, l.id, ctx)
    } catch (e) {
      console.error('[agenda-perso] rapprochement impossible pour', l.id, G.messageErreur(e))
    }
  }
}

/**
 * AVANT de supprimer la fiche d'un membre : son agenda perso disparaît avec
 * lui, et l'agenda du cabinet lui est rendu s'il lui avait été retiré (une
 * fiche supprimée par erreur et recréée ne doit pas avoir perdu ses gardes).
 * Sans ce geste, la cascade effacerait la ligne en base et laisserait chez
 * Google un agenda partagé, figé, que plus rien ne met à jour.
 *
 * Best-effort : une panne Google ne bloque pas la suppression, elle est tracée.
 */
export async function supprimerAgendaPersoDe(
  admin: SupabaseClient,
  membre: { genre: GenreMembre; id: string },
): Promise<void> {
  const col = membre.genre === 'veto' ? 'veterinaire_id' : 'secretaire_id'
  const { data } = await admin.from('agendas_perso').select('*').eq(col, membre.id).maybeSingle()
  const l = data as LigneAgendaPerso | null
  if (!l) return
  try {
    if (l.partage_cabinet === 'retire' && l.partage_email) {
      const cab = await agendaDuCabinet(admin, l.cabinet_id)
      if (cab) await G.partager(cab, l.partage_email, l.role_cabinet_retire ?? 'reader', false)
    }
    if (l.google_calendar_id) await G.supprimerAgenda(l.google_calendar_id)
  } catch (e) {
    console.error('[agenda-perso] agenda non supprimé avant la fiche :', G.messageErreur(e))
  }
}

/** Le verrou est-il libre (aucune synchro, ou une synchro coupée depuis plus de 10 min) ? */
export function verrouLibre(l: Pick<LigneAgendaPerso, 'sync_depuis'>): boolean {
  return !l.sync_depuis || Date.now() - new Date(l.sync_depuis).getTime() > VERROU_MINUTES * 60_000
}

/**
 * L'invitation Google date-t-elle de moins de 7 jours ? Google ne dit pas si
 * elle a été acceptée : passé ce délai, on cesse d'insister à l'écran.
 */
export function invitationRecente(l: Pick<LigneAgendaPerso, 'invitation_envoyee_le'>): boolean {
  return !!l.invitation_envoyee_le && Date.now() - new Date(l.invitation_envoyee_le).getTime() < 7 * 86_400_000
}
