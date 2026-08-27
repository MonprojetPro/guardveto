'use server'

import { createClient } from '@/lib/supabase/server'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { revalidatePath } from 'next/cache'
import { refusSiBloquant } from '@/data/controleImpact'
import { periodeFr, dateFrSansJour } from '@/lib/dates-fr'
import {
  retirerEvenementsAvecBilan,
  idsEvenementsDePeriode,
  idsEvenementsDeGardes,
} from '@/lib/sync-calendrier'
import { isGoogleCalendarConfigured, agendaDeRepliPour } from '@/lib/google-calendar'
import { creerNotification, contenuPlanningRetire } from '@/lib/notifications-inapp'
import { executerRetraitPlanning } from '@/lib/planning/retrait-planning'
import type {
  BilanAgenda,
  BilanPlanningARetirer,
} from '@/lib/planning/retrait-planning'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Rafraîchit TOUS les écrans qui lisent la table `periodes`.
 *
 * Longtemps limité à `/historique`, le seul qui les listait. Depuis que la
 * création d'un planning se fait depuis « Générer » (2026-08-02), l'inventaire
 * des lecteurs a été refait :
 *
 *   • `/planning`  — la pilule de période ET l'assistant de génération.
 *                    Couvert aussi par `RealtimeRefresh` (il écoute `periodes`),
 *                    mais on ne s'en remet pas au seul Realtime : il ne tourne
 *                    que sur l'écran ouvert.
 *   • `/historique` — la liste des plannings et leurs réglages.
 *   • `/accueil`    — l'épicentre (`data/v2/accueilEpicentre.ts`) y lit la
 *                    période courante ; sans ça il restait figé sur l'ancienne.
 *   • `/regles`     — `data/optionsRegles.ts` propose les périodes quand on
 *                    limite une règle à l'une d'elles.
 *
 * Le dock de la barre V2 (`data/v2/dock.ts`) lit lui aussi les périodes, mais
 * il est rendu à l'intérieur de ces routes : les revalider le couvre.
 */
function revaliderPeriodes() {
  revalidatePath('/historique')
  revalidatePath('/planning')
  revalidatePath('/accueil')
  revalidatePath('/regles')
}

// ── Garde admin (même pattern que /regles et /admin/structure) ──
// La RLS periodes (write admin-only) protège déjà l'écriture ; cette garde
// ajoute un refus explicite en français au lieu d'une erreur Postgres brute.
async function assertAdmin(
  supabase: SupabaseClient<any, any, any>,
): Promise<{ error: string } | { veto: { id: string; role_app: string } }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }
  const { data: vet } = await supabase
    .from('veterinaires')
    .select('id, role_app')
    .eq('user_id', user.id)
    .single()
  if (!vet) return { error: 'Non authentifié.' }
  if (vet.role_app !== 'admin') {
    return { error: "Action réservée à l'administrateur du cabinet." }
  }
  return { veto: vet }
}

/** Une date ISO telle qu'on la lit à voix haute : « lundi 21 septembre 2026 ». */
function dateFr(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** Le lendemain — le premier jour redevenu libre après un planning. */
function jourSuivant(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// Détection automatique de la saison depuis la date de début
// Mai (5) → Août (8) = été, le reste = hiver
function detecterSaison(dateDebut: string): 'ete' | 'hiver' {
  const mois = new Date(dateDebut + 'T12:00:00Z').getUTCMonth() + 1
  return mois >= 5 && mois <= 8 ? 'ete' : 'hiver'
}

export async function creerPeriode(formData: FormData) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

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

  // Un planning qui finit avant de commencer passait jusqu'ici sans un mot :
  // le test de chevauchement ci-dessous (date_debut <= dateFin ET date_fin >=
  // dateDebut) ne peut PAS l'attraper, la fenêtre étant vide. On repartait donc
  // avec une période inerte que le moteur remplissait de zéro garde.
  if (dateFin < dateDebut) {
    return { error: 'La date de fin doit venir après la date de début.' }
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
    // Message lisible par le cabinet : des dates en français, pas des ISO, et
    // la sortie indiquée. Un refus qui montre le mur sans montrer la porte
    // oblige l'admin à aller chercher lui-même les dates du planning fautif.
    return {
      error:
        `Ces dates se chevauchent avec le planning « ${label} », `
        + `qui va du ${dateFr(c.date_debut)} au ${dateFr(c.date_fin)}. `
        + `Choisis un départ après le ${dateFr(jourSuivant(c.date_fin))}, `
        + `ou raccourcis la durée.`,
    }
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

  // ── LA PÉRIODE TYPE EST UN CHOIX, PLUS UN REPLI (MiKL, 2026-08-04) ──
  //
  // Ce qui existait avant : sans `profil_id`, on cherchait le premier profil
  // actif dont `saison_suggeree` correspondait au mois de départ, et à défaut
  // on insérait NULL — ce qui fait retomber le moteur sur le profil `est_defaut`
  // du cabinet. Deux replis successifs, tous les deux SILENCIEUX.
  //
  // Pourquoi c'est un problème et pas une commodité : la période type décide
  // des gardes à couvrir et de l'effectif. Un planning généré sur une structure
  // que personne n'a désignée est un planning dont on ne peut pas dire, après
  // coup, pourquoi il contient ce qu'il contient. MiKL : « je ne veux pas qu'il
  // y ait une période par défaut ». Le cabinet DOIT en programmer au moins une
  // et dire laquelle.
  //
  // `est_defaut` reste en base : c'est le filet du MOTEUR pour les plannings
  // créés avant cette règle (cf. `chargerCreneauModele`). Ce qui disparaît,
  // c'est le droit d'en créer un NOUVEAU sans avoir choisi.
  const profilChoisi = (formData.get('profil_id') as string | null)?.trim() || null
  if (!profilChoisi) {
    return {
      error: 'Choisis la période type de ce planning : c’est elle qui décide '
        + 'des gardes à couvrir et de l’effectif. Si tu n’en as aucune, '
        + 'crée-la d’abord dans Organisation › Périodes types.',
    }
  }
  // On VÉRIFIE qu'elle appartient au cabinet (garde tenant : la RLS restrictive
  // borne déjà la lecture, ce check rejette proprement un id étranger,
  // inexistant — ou désactivé, qu'on ne veut pas voir arriver par une URL ou un
  // écran resté ouvert pendant qu'on la retirait).
  const { data: owned } = await supabase
    .from('profils_planning')
    .select('id, actif')
    .eq('id', profilChoisi)
    .eq('cabinet_id', cabinetId)
    .maybeSingle()
  if (!owned) return { error: 'Cette période type n’existe pas pour ce cabinet.' }
  if ((owned as { actif?: boolean }).actif === false) {
    return { error: 'Cette période type est désactivée — réactive-la ou choisis-en une autre.' }
  }
  const profilId: string = profilChoisi

  // `select('id')` : l'assistant de l'écran Planning enchaîne la génération sur
  // le planning qu'il vient de créer — sans cet id il devrait le retrouver à
  // tâtons par ses dates, et générerait le mauvais en cas d'homonyme.
  const { data: creee, error } = await supabase
    .from('periodes')
    .insert({
      cabinet_id: cabinetId,
      saison,
      numero:     null,
      libelle,
      date_debut: dateDebut,
      date_fin:   dateFin,
      statut:     'brouillon',
      profil_id:  profilId,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revaliderPeriodes()
  return { success: true, id: (creee as { id: string }).id }
}

/**
 * Rattache une période à un profil de planning (ou NULL = profil défaut du
 * cabinet). S'applique à la PROCHAINE génération. RLS periodes (write admin-only,
 * cabinet-borné) sécurise l'écriture ; on vérifie en plus que le profil est bien
 * visible pour ce cabinet (garde tenant, cohérente avec creerPeriode).
 */
export async function setProfilPeriode(periodeId: string, profilId: string | null) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  // Depuis le 2026-08-04, on ne peut plus RETIRER la période type d'un planning
  // — même règle qu'à la création : plus de repli silencieux sur le profil par
  // défaut du cabinet. La signature garde `null` parce que d'anciens plannings
  // en portent encore un ; on peut les corriger, pas les remettre dans cet état.
  if (!profilId) {
    return {
      error: 'Choisis une période type — un planning ne peut pas rester sans. '
        + 'C’est elle qui décide des gardes à couvrir et de l’effectif.',
    }
  }

  {
    const { data: owned } = await supabase
      .from('profils_planning')
      .select('id')
      .eq('id', profilId)
      .maybeSingle()
    if (!owned) return { error: 'Période type introuvable.' }
  }

  const { error } = await supabase
    .from('periodes')
    .update({ profil_id: profilId })
    .eq('id', periodeId)

  if (error) return { error: error.message }
  revaliderPeriodes()
  return { success: true }
}

/**
 * Règle l'effectif de garde la nuit en semaine (1 ou 2 vétos) pour une période.
 * RLS periodes (write admin-only) sécurise l'écriture. S'applique à la PROCHAINE
 * génération du planning de la période.
 */
export async function setEffectifPeriode(
  periodeId: string,
  nb: number,
  /** L'admin a vu les conséquences et veut l'appliquer quand même. */
  confirmeImpact = false,
) {
  if (!Number.isInteger(nb) || nb < 1 || nb > 4) {
    return { error: 'Effectif invalide (entre 1 et 4 vétérinaires).' }
  }
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  // ── LE PASSAGE OBLIGÉ (palier 2 de l'audit du 2026-08-03) ──
  // Demander deux vétérinaires par nuit là où l'équipe ne peut en fournir
  // qu'un est le cas d'école : le réglage passe sans un mot, et l'échec
  // n'apparaît qu'à la génération, des jours plus tard.
  try {
    const cabinetId = await resoudreCabinetId(supabase)
    const refus = await refusSiBloquant(
      supabase,
      cabinetId,
      { genre: 'effectif_nuit', nb },
      confirmeImpact,
    )
    if (refus) return { error: refus.error, impact: refus.impact }
  } catch {
    // Cabinet irrésolu : on n'empêche pas un réglage légitime.
  }

  const { error } = await supabase
    .from('periodes')
    .update({ nb_vetos_semaine_soir: nb })
    .eq('id', periodeId)

  if (error) return { error: error.message }
  revaliderPeriodes()
  return { success: true }
}

// ============================================================
// RETIRER UN PLANNING — l'inventaire d'abord, le geste ensuite
// ============================================================

/** Le nom d'un planning tel qu'il s'affiche partout dans l'application. */
function nomPlanning(p: {
  libelle?: string | null
  saison?: string | null
  date_debut?: string | null
}): string {
  const l = (p.libelle ?? '').trim()
  if (l) return l
  const annee = (p.date_debut ?? '').slice(0, 4)
  return `${p.saison === 'ete' ? 'Été' : 'Hiver'} ${annee}`.trim()
}

/** Deux noms sont « le même » aux espaces et à la casse près, pas au reste. */
function memeNom(saisi: string, attendu: string): boolean {
  const normaliser = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR')
  return normaliser(saisi) === normaliser(attendu)
}

/**
 * Tout ce qu'un planning emporte avec lui — LU EN BASE, jamais supposé.
 *
 * Sert la première des deux confirmations. Le principe du projet est que « le
 * système INFORME, il n'interdit pas » : on ne va pas retenir la main de
 * l'admin, mais on ne la laisse pas non plus décider dans le noir. Un
 * « êtes-vous sûr ? » ne dit rien ; « 118 gardes, 7 vétérinaires, 118
 * rendez-vous dans l'agenda de tout le monde » dit tout.
 *
 * Lecture SEULE. Aucune écriture, aucun effet de bord — l'écran peut l'appeler
 * à l'ouverture de la fenêtre sans rien engager.
 */
export async function bilanRetraitPlanning(
  periodeId: string,
): Promise<{ error: string } | { bilan: BilanPlanningARetirer }> {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  const { data: per } = await supabase
    .from('periodes')
    .select('id, libelle, saison, date_debut, date_fin, statut, publie_at, cabinet_id')
    .eq('id', periodeId)
    .maybeSingle()
  if (!per) return { error: 'Planning introuvable.' }

  const p = per as {
    id: string
    libelle: string | null
    saison: string | null
    date_debut: string
    date_fin: string
    statut: string
    publie_at: string | null
    cabinet_id: string | null
  }

  // Les gardes, lues UNE fois : elles donnent le compte, les rendez-vous
  // d'agenda, les vétérinaires concernés et les clés des tables enfants.
  const { data: gardesData, error: gardesErr } = await supabase
    .from('gardes')
    .select('id, google_event_id, premier_id, second_id')
    .eq('periode_id', periodeId)
  if (gardesErr) return { error: gardesErr.message }

  const gardes = (gardesData ?? []) as {
    id: string
    google_event_id: string | null
    premier_id: string | null
    second_id: string | null
  }[]

  const gardeIds = gardes.map((g) => g.id)

  // ⚠️ LES DEUX SOURCES, et ce compteur-ci compte plus que les autres : il est
  // AFFICHÉ À L'ADMIN avant qu'elle ne confirme une suppression. Annoncer
  // « 20 rendez-vous » quand l'agenda en porte 56 n'est pas une imprécision,
  // c'est une fausse assurance sur un geste irréversible — pire qu'aucun
  // chiffre, parce qu'un chiffre faux ne se questionne pas.
  const nbEvenementsAgenda = new Set([
    ...gardes.map((g) => g.google_event_id).filter((id): id is string => Boolean(id)),
    ...(await idsEvenementsDeGardes(supabase as SupabaseClient, gardeIds)),
  ]).size
  const nbVetosConcernes = new Set(
    gardes.flatMap((g) => [g.premier_id, g.second_id]).filter(Boolean) as string[],
  ).size

  // Les tables enfants qui partiront EN CASCADE, sans que la base ne dise rien.
  // Elles ne bloquent pas — mais les taire reviendrait à effacer le travail de
  // l'équipe (un échange accepté, un dépannage confirmé) en silence.
  const compter = async (table: string, colonne: string): Promise<number> => {
    if (gardeIds.length === 0) return 0
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .in(colonne, gardeIds)
    if (error) {
      console.warn(`[bilanRetrait] comptage ${table} impossible :`, error.message)
      return 0
    }
    return count ?? 0
  }

  const [nbEchanges, nbDepannages, nbExceptions] = await Promise.all([
    compter('echanges_gardes', 'garde_id'),
    compter('compensations', 'garde_id'),
    compter('gardes_exceptions', 'garde_id'),
  ])

  // Ce qui empêcherait VRAIMENT le geste — la FK `regles_cabinet.periode_id`
  // est en NO ACTION : sans ce contrôle, Postgres renverrait une erreur de
  // contrainte illisible APRÈS que l'agenda ait été vidé.
  const { count: nbRegles } = await supabase
    .from('regles_cabinet')
    .select('id', { count: 'exact', head: true })
    .eq('periode_id', periodeId)

  const bloquant = nbRegles && nbRegles > 0
    ? `${nbRegles} règle${nbRegles > 1 ? 's sont limitées' : ' est limitée'} à ce planning. `
      + `Supprime-la${nbRegles > 1 ? 's' : ''} ou rends-la${nbRegles > 1 ? 's' : ''} `
      + `permanente${nbRegles > 1 ? 's' : ''} avant d’effacer le planning.`
    : null

  const calendarId = await calendarIdDuCabinet(supabase, p.cabinet_id)

  return {
    bilan: {
      id: p.id,
      nom: nomPlanning(p),
      quand: periodeFr(p.date_debut, p.date_fin),
      statut: p.statut,
      publie: Boolean(p.publie_at),
      publieLe: p.publie_at ? dateFrSansJour(p.publie_at.slice(0, 10)) : null,
      nbGardes: gardes.length,
      nbEvenementsAgenda,
      nbVetosConcernes,
      nbEchanges,
      nbDepannages,
      nbExceptions,
      agendaJoignable: isGoogleCalendarConfigured(calendarId),
      bloquant,
      // Le nom se recopie dès que quelqu'un d'autre que l'admin a vu passer
      // quelque chose : une diffusion, ou des rendez-vous posés dans l'agenda.
      exigeSaisieDuNom: Boolean(p.publie_at) || nbEvenementsAgenda > 0,
    },
  }
}

/**
 * Le calendarId du cabinet (colonne), sinon l'agenda de repli s'il lui est
 * NOMINATIVEMENT accordé (T-001). Null sinon : mieux vaut « aucun agenda
 * configuré » qu'écrire dans celui d'un autre cabinet.
 */
async function calendarIdDuCabinet(
  supabase: SupabaseClient<any, any, any>,
  cabinetId: string | null,
): Promise<string | null> {
  if (!cabinetId) return null
  const { data, error } = await supabase
    .from('cabinets')
    .select('google_calendar_id')
    .eq('id', cabinetId)
    .maybeSingle()
  if (error) {
    console.error(
      '[periodes] lecture de l’agenda du cabinet impossible, agenda considéré absent :',
      error.message,
    )
    return null
  }
  const val = (data as { google_calendar_id?: string | null } | null)?.google_calendar_id
  return (val ?? '').trim() || agendaDeRepliPour(cabinetId)
}

/**
 * Les identifiants de rendez-vous portés par les gardes d'un planning.
 *
 * ⚠️ Délègue à `idsEvenementsDePeriode`, qui lit les DEUX sources depuis B-079 :
 * `gardes.google_event_id` (ancien format, un événement par garde) ET
 * `garde_evenements` (un par personne et par jour). Cette fonction ne lisait que
 * la première ; elle serait devenue aveugle à l'immense majorité des événements,
 * et la dépublication aurait laissé dans l'agenda de sept personnes des gardes
 * que plus rien ne pouvait retirer — exactement l'incident Val d'Allier, mais
 * sans le moyen de le réparer.
 */
async function eventIdsDuPlanning(
  supabase: SupabaseClient<any, any, any>,
  periodeId: string,
): Promise<string[]> {
  return idsEvenementsDePeriode(supabase as SupabaseClient, periodeId)
}

/** La trace : qui, quand, quel planning, combien de gardes. */
async function tracerRetrait(
  supabase: SupabaseClient<any, any, any>,
  params: {
    periodeId: string
    action: 'delete' | 'update'
    auteurId: string
    detail: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await supabase.from('audit_log').insert({
    table_name: 'periodes',
    record_id: params.periodeId,
    action: params.action,
    old_data: params.detail,
    new_data: null,
    user_id: params.auteurId,
  })
  if (error) console.warn('[retrait-planning] audit_log non écrit :', error.message)
}

/**
 * Prévient l'équipe qu'un planning diffusé ne l'est plus.
 *
 * Sans ça, le geste serait invisible pour les six autres : ils ont vu le
 * planning, l'ont peut-être recopié, ont posé des congés autour. Best-effort —
 * une notification qui ne part pas n'annule pas un retrait déjà fait.
 */
async function prevenirEquipeDuRetrait(
  supabase: SupabaseClient<any, any, any>,
  params: { cabinetId: string | null; nom: string; quand: string; definitif: boolean },
): Promise<void> {
  if (!params.cabinetId) return
  try {
    const { data: vets } = await supabase
      .from('veterinaires')
      .select('id')
      .eq('cabinet_id', params.cabinetId)
      .eq('actif', true)

    const contenu = contenuPlanningRetire(params.nom, params.quand, params.definitif)
    for (const v of (vets ?? []) as { id: string }[]) {
      await creerNotification(supabase, {
        veterinaireId: v.id,
        type: 'planning_retire',
        titre: contenu.titre,
        message: contenu.message,
        lien: contenu.lien,
        cabinetId: params.cabinetId,
      })
    }
  } catch (e) {
    console.error('[retrait-planning] équipe non prévenue :', e)
  }
}

/**
 * Supprime un planning — **y compris publié**, depuis le 2026-08-22.
 *
 * CE QUI A CHANGÉ, ET POURQUOI. L'action refusait tout ce qui n'était pas un
 * brouillon, en renvoyant vers une dépublication… qui n'existait nulle part
 * dans l'application. Un planning publié était donc DÉFINITIVEMENT
 * insupprimable : il a fallu passer par un script à la main
 * (`scripts/nettoyer-periode-agenda.mjs`) le 2026-08-21. MiKL : « oui tu peux,
 * mais il faut encadrer fermement cette possibilité ».
 *
 * L'ENCADREMENT — deux confirmations distinctes, et la seconde n'est pas un
 * clic. `bilanRetraitPlanning` fournit à l'écran ce que le geste emporte
 * réellement ; ici, on exige que le nom du planning ait été RECOPIÉ dès qu'il
 * a été diffusé ou qu'il a posé des rendez-vous dans l'agenda. Ce contrôle
 * vit côté serveur : une garde qui ne tient que dans l'écran ne tient pas.
 *
 * L'ORDRE — agenda d'abord, base ensuite, et rien si l'agenda résiste. C'est
 * `executerRetraitPlanning` qui le tient, pas ce fichier.
 *
 * CE QUE LA SUPPRESSION EMPORTE — inventaire refait à la source (contraintes
 * FK réelles, pas de mémoire) :
 *   • `gardes`, `attributions`, `bonus_malus` → ON DELETE CASCADE, la base s'en
 *     charge ;
 *   • et derrière `gardes` : `echanges_gardes`, `compensations`,
 *     `garde_placements`, `gardes_exceptions` → CASCADE eux aussi. Ils sont
 *     COMPTÉS et annoncés avant, parce qu'ils portent du travail d'équipe ;
 *   • `email_log`, `historique_fete` → ON DELETE SET NULL, les traces restent ;
 *   • `compteurs_gardes`, `planning_semaine` → ce sont des VUES, elles suivent ;
 *   • `regles_cabinet.periode_id` → NO ACTION : une règle limitée à ce planning
 *     BLOQUERAIT le delete. On le détecte AVANT pour l'expliquer, au lieu de
 *     laisser remonter une erreur de contrainte Postgres.
 *
 * Renvoie le nombre de gardes effacées, pour que l'écran puisse le dire.
 */
export async function supprimerPeriode(periodeId: string, nomSaisi?: string) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }
  const auteurId = garde.veto.id

  const bilanRes = await bilanRetraitPlanning(periodeId)
  if ('error' in bilanRes) return { error: bilanRes.error }
  const bilan = bilanRes.bilan

  if (bilan.statut === 'verrouille') {
    return { error: 'Ce planning est verrouillé : il fait partie de l’historique du cabinet.' }
  }

  if (bilan.bloquant) return { error: bilan.bloquant }

  // La SECONDE confirmation, vérifiée là où elle compte.
  if (bilan.exigeSaisieDuNom && !memeNom(nomSaisi ?? '', bilan.nom)) {
    return {
      error: `Pour supprimer « ${bilan.nom} », recopie son nom exactement. `
        + `C’est volontairement un geste qui demande de s’arrêter : ce planning `
        + `a été vu par l’équipe.`,
    }
  }

  const { data: perCab } = await supabase
    .from('periodes')
    .select('cabinet_id')
    .eq('id', periodeId)
    .maybeSingle()
  const cabinetId = (perCab as { cabinet_id: string | null } | null)?.cabinet_id ?? null
  const calendarId = await calendarIdDuCabinet(supabase, cabinetId)

  const resultat = await executerRetraitPlanning({
    lireEventIds: () => eventIdsDuPlanning(supabase, periodeId),
    agendaJoignable: async () => isGoogleCalendarConfigured(calendarId),
    retirerDeLAgenda: (ids) => retirerEvenementsAvecBilan(ids, calendarId),
    ecrireEnBase: async () => {
      // `attributions.planning_id` cascade désormais, mais on garde ce nettoyage
      // explicite : une génération dont l'écriture V1 a échoué à mi-course peut
      // avoir laissé des lignes V2 rattachées à un planning qui, lui, n'existe
      // plus vraiment. Le faire AVANT coûte une requête et ne peut pas nuire.
      const { error: attribErr } = await supabase
        .from('attributions')
        .delete()
        .eq('planning_id', periodeId)
      if (attribErr) return { error: attribErr.message }

      // Plus de `.eq('statut', 'brouillon')` ici : le filet a changé de nature.
      // Ce n'est plus le statut qui protège, c'est le nom recopié — et on ne
      // veut pas d'un delete qui « réussit » en n'effaçant aucune ligne.
      const { error } = await supabase.from('periodes').delete().eq('id', periodeId)
      return { error: error?.message ?? null }
    },
    tracer: (agenda) =>
      tracerRetrait(supabase, {
        periodeId,
        action: 'delete',
        auteurId,
        detail: {
          geste: 'suppression',
          nom: bilan.nom,
          quand: bilan.quand,
          statut: bilan.statut,
          nbGardes: bilan.nbGardes,
          nbEchanges: bilan.nbEchanges,
          nbDepannages: bilan.nbDepannages,
          nbExceptions: bilan.nbExceptions,
          agenda,
        },
      }),
  })

  if (!resultat.ok) return { error: resultat.error }

  // L'équipe n'est prévenue que si elle avait quelque chose à savoir : un
  // brouillon d'essai supprimé ne concerne personne d'autre que l'admin.
  if (bilan.publie) {
    await prevenirEquipeDuRetrait(supabase, {
      cabinetId,
      nom: bilan.nom,
      quand: bilan.quand,
      definitif: true,
    })
  }

  revaliderPeriodes()
  return {
    success: true,
    nbGardes: bilan.nbGardes,
    agenda: resultat.agenda as BilanAgenda,
  }
}

/**
 * Dépublie un planning : il redevient un brouillon, modifiable, et sort de
 * l'agenda de l'équipe. **Rien n'est détruit.**
 *
 * POURQUOI CE GESTE EXISTE, alors que la suppression suffisait « techniquement »
 * — se tromper de publication doit être réparable sans tout perdre. Publier un
 * planning est aujourd'hui la seule décision de l'application qu'on ne peut
 * pas défaire : le message de refus de la suppression réclamait une
 * dépublication qui n'existait dans aucun écran. La capacité, elle, existait
 * déjà en base — `/api/generate` repasse une période en brouillon avant de la
 * régénérer. Elle n'était simplement offerte à personne, ce qui laissait
 * l'admin sans autre issue que la destruction complète.
 *
 * ELLE NETTOIE L'AGENDA, comme la suppression. Un planning qui n'est plus
 * diffusé mais dont les rendez-vous restent dans l'agenda de sept personnes
 * n'est pas dépublié : c'est le sens même de l'incident Val d'Allier, à
 * l'envers. Les `google_event_id` sont donc remis à zéro sur les gardes — sans
 * ça, une republication tenterait de mettre à jour des rendez-vous effacés.
 *
 * L'ENCADREMENT est plus léger que celui de la suppression : une explication
 * et une confirmation, sans recopier le nom. Le geste est RÉVERSIBLE — republier
 * refait tout, y compris l'agenda et les e-mails. La fermeté d'un garde-fou se
 * règle sur ce qu'on ne peut pas rattraper.
 */
export async function depublierPeriode(periodeId: string) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }
  const auteurId = garde.veto.id

  const bilanRes = await bilanRetraitPlanning(periodeId)
  if ('error' in bilanRes) return { error: bilanRes.error }
  const bilan = bilanRes.bilan

  if (bilan.statut === 'verrouille') {
    return {
      error: 'Ce planning est verrouillé : il fait partie de l’historique du cabinet '
        + 'et ne se remet plus en préparation.',
    }
  }
  if (bilan.statut !== 'publie') {
    return { error: 'Ce planning n’est pas publié — il est déjà en préparation.' }
  }

  const { data: perCab } = await supabase
    .from('periodes')
    .select('cabinet_id')
    .eq('id', periodeId)
    .maybeSingle()
  const cabinetId = (perCab as { cabinet_id: string | null } | null)?.cabinet_id ?? null
  const calendarId = await calendarIdDuCabinet(supabase, cabinetId)

  const resultat = await executerRetraitPlanning({
    lireEventIds: () => eventIdsDuPlanning(supabase, periodeId),
    agendaJoignable: async () => isGoogleCalendarConfigured(calendarId),
    retirerDeLAgenda: (ids) => retirerEvenementsAvecBilan(ids, calendarId),
    ecrireEnBase: async () => {
      // Les poignées d'abord : les rendez-vous n'existent plus, les garder
      // ferait échouer la prochaine synchronisation sur des identifiants morts.
      const { error: majGardes } = await supabase
        .from('gardes')
        .update({ google_event_id: null })
        .eq('periode_id', periodeId)
      if (majGardes) return { error: majGardes.message }

      // Et la seconde source (B-079), pour la même raison exactement. L'oublier
      // laisserait la republication tenter de mettre à jour 56 identifiants
      // morts — chacun renvoyant une erreur, sur un chemin déjà contraint par
      // le rate-limit Google.
      const { data: gardesPeriode } = await supabase
        .from('gardes')
        .select('id')
        .eq('periode_id', periodeId)
      const idsGardes = ((gardesPeriode ?? []) as { id: string }[]).map((g) => g.id)
      if (idsGardes.length > 0) {
        const { error: majEvenements } = await supabase
          .from('garde_evenements')
          .delete()
          .in('garde_id', idsGardes)
        if (majEvenements) return { error: majEvenements.message }
      }

      const { error } = await supabase
        .from('periodes')
        .update({ statut: 'brouillon', publie_at: null })
        .eq('id', periodeId)
      return { error: error?.message ?? null }
    },
    tracer: (agenda) =>
      tracerRetrait(supabase, {
        periodeId,
        action: 'update',
        auteurId,
        detail: {
          geste: 'depublication',
          nom: bilan.nom,
          quand: bilan.quand,
          nbGardes: bilan.nbGardes,
          agenda,
        },
      }),
  })

  if (!resultat.ok) return { error: resultat.error }

  await prevenirEquipeDuRetrait(supabase, {
    cabinetId,
    nom: bilan.nom,
    quand: bilan.quand,
    definitif: false,
  })

  revaliderPeriodes()
  return { success: true, nbGardes: bilan.nbGardes, agenda: resultat.agenda as BilanAgenda }
}
