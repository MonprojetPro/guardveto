// ============================================================
// GUARDVETO — Outils de Filou : échanges de gardes
// ============================================================
// SERVER-ONLY. Filou peut désormais voir et manœuvrer le cycle complet d'un
// échange (proposer → accepter/refuser → valider/refuser admin), avec les
// MÊMES règles que la page /echanges : la RLS de `echanges_gardes` borne déjà
// ce que chacun voit (demandeur, cible, ou admin du cabinet), et toute
// écriture repasse par les actions serveur existantes — aucune règle métier
// n'est réécrite ici (anti-doublon, congé, garde verrouillée, compare-and-
// swap sur les propositions ouvertes…).
//
// Comme pour l'équipe (equipe.ts), le modèle ne manipule ni UUID de garde ni
// UUID d'échange : il parle en PRÉNOM + DATE ISO. La résolution vers les
// bons identifiants se fait ici, sur les données réelles, et refuse net dès
// qu'elle est ambiguë (ex. deux gardes le même jour, ou deux échanges qui
// concernent la même date) — mieux vaut redemander une précision que choisir
// à la place de quelqu'un.
//
// PÉRIMÈTRE PAR RÔLE : un vétérinaire n'agit que sur SES échanges — proposer,
// répondre à ce qu'on lui propose, annuler ce qu'il a lui-même proposé. Les
// filtres ci-dessous forcent `ctx.vetoId` comme demandeur ou cible selon
// l'action ; seuls les deux outils admin (`adminSeulement: true`) touchent
// aux échanges des autres.
// ============================================================

import { z } from 'zod'
import {
  proposerEchange,
  accepterEchange,
  refuserEchange,
  annulerEchange,
  validerEchangeAdmin,
  refuserEchangeAdmin,
  type ProposerEchangePayload,
} from '@/app/(protected)/echanges/actions'
import { libelleTypeGardeDb } from '@/lib/libelles-gardes'
import { SANS_PARAMETRE, type ContexteOutil, type OutilEcriture, type OutilLecture } from './types'
import { perimetrePeriodes } from './perimetre'

type Role = 'premier' | 'second'

// ── Helpers de lecture brute ───────────────────────────────

interface GardeJoin {
  id: string
  date: string
  type: string
}
interface VetJoin {
  id: string
  prenom: string
  nom: string
}
interface EchangeBrut {
  id: string
  statut: string
  message: string | null
  motif_refus: string | null
  role_demandeur: Role
  role_contrepartie: Role | null
  demandeur_id: string
  cible_id: string | null
  garde: GardeJoin | GardeJoin[] | null
  gardeContrepartie: GardeJoin | GardeJoin[] | null
  demandeur: VetJoin | VetJoin[] | null
  cible: VetJoin | VetJoin[] | null
}

/** Les relations Supabase renvoient un objet OU un tableau à un seul élément
 *  selon le contexte — jamais garanti à l'avance. */
function unRel<T>(rel: T | T[] | null): T | null {
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

/** Vue simplifiée d'un échange : que des valeurs déjà lisibles, plus
 *  d'identifiants techniques que ceux strictement nécessaires à l'écriture. */
interface EchangeVM {
  id: string
  statut: string
  demandeurId: string
  demandeurPrenom: string
  demandeurNom: string
  cibleId: string | null
  ciblePrenom: string | null
  gardeDate: string
  gardeType: string
  roleDemandeur: Role
  contrepartieDate: string | null
  contrepartieType: string | null
  roleContrepartie: Role | null
  message: string | null
  motifRefus: string | null
}

function versVM(e: EchangeBrut): EchangeVM | null {
  const garde = unRel(e.garde)
  const demandeur = unRel(e.demandeur)
  // Une garde ou un demandeur introuvable signalerait une donnée corrompue :
  // on écarte plutôt que de faire planter la lecture pour tout le monde.
  if (!garde || !demandeur) return null
  const cible = unRel(e.cible)
  const contrepartie = unRel(e.gardeContrepartie)
  return {
    id: e.id,
    statut: e.statut,
    demandeurId: e.demandeur_id,
    demandeurPrenom: demandeur.prenom,
    demandeurNom: demandeur.nom,
    cibleId: e.cible_id,
    ciblePrenom: cible?.prenom ?? null,
    gardeDate: garde.date,
    gardeType: garde.type,
    roleDemandeur: e.role_demandeur,
    contrepartieDate: contrepartie?.date ?? null,
    contrepartieType: contrepartie?.type ?? null,
    roleContrepartie: e.role_contrepartie,
    message: e.message,
    motifRefus: e.motif_refus,
  }
}

/** Charge tout ce que la RLS laisse voir à cette personne (demandeur, cible,
 *  ou tout le cabinet si admin) — même requête que la page /echanges. */
async function chargerEchanges(ctx: ContexteOutil): Promise<EchangeVM[]> {
  const { data } = await ctx.supabase
    .from('echanges_gardes')
    .select(`
      id, statut, message, motif_refus, role_demandeur, role_contrepartie,
      demandeur_id, cible_id,
      garde:garde_id(id, date, type, periode_id),
      gardeContrepartie:garde_contrepartie_id(id, date, type),
      demandeur:demandeur_id(id, prenom, nom),
      cible:cible_id(id, prenom, nom)
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  // La RLS des échanges laisse passer toute proposition OUVERTE du cabinet
  // (`cible_id IS NULL`) : c'est voulu, un appel à volontaires s'adresse à
  // tout le monde. Mais elle expose alors la date, le type de garde et le nom
  // du demandeur.
  //
  // Aujourd'hui sans conséquence, parce qu'un échange ne peut naître que sur
  // une période publiée. C'est exactement la situation d'avant le correctif de
  // `gardesDuVetoCeJour` : la protection tenait à un invariant respecté
  // AILLEURS, pas à un filtre posé ici. Le jour où ce chemin change, personne
  // ne pense à revenir dans ce fichier. On ferme donc par un filtre explicite.
  const perimetre = await perimetrePeriodes(ctx)
  const autorisees = new Set(perimetre.ids)

  return ((data as EchangeBrut[] | null) ?? [])
    .filter((e) => {
      const garde = unRel(e.garde) as (GardeJoin & { periode_id?: string }) | null
      // Une garde sans période lisible : on écarte plutôt que de laisser
      // passer. Le doute profite à la discrétion, pas à l'affichage.
      return garde?.periode_id ? autorisees.has(garde.periode_id) : false
    })
    .map(versVM)
    .filter((v): v is EchangeVM => v !== null)
}

// ── Helpers de résolution prénom / date (jamais d'UUID côté modèle) ──

/** Signes diacritiques en échappement : la classe littérale est illisible et
 *  casse au moindre copier-coller — cf. equipe.ts. */
const DIACRITIQUES = /[̀-ͯ]/g

function normaliser(s: string): string {
  return s
    .normalize('NFD')
    .replace(DIACRITIQUES, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

interface FicheVeto {
  id: string
  prenom: string
  nom: string
  actif: boolean
}

async function chargerVeterinaires(ctx: ContexteOutil): Promise<FicheVeto[]> {
  const { data } = await ctx.supabase.from('veterinaires').select('id, prenom, nom, actif').order('prenom')
  return (data as FicheVeto[] | null) ?? []
}

/** Résout un prénom en fiche parmi TOUT le cabinet (actifs et inactifs — un
 *  inactif doit pouvoir être nommément écarté plutôt que déclaré inconnu). */
function resoudrePrenom(
  vets: FicheVeto[],
  prenom: string,
): { ok: true; veto: FicheVeto } | { ok: false; raison: string } {
  const exacts = vets.filter((v) => normaliser(v.prenom) === normaliser(prenom))
  if (exacts.length === 1) return { ok: true, veto: exacts[0] }
  if (exacts.length > 1) {
    return { ok: false, raison: `Plusieurs vétérinaires s'appellent ${prenom}. Précise avec le nom de famille.` }
  }
  const connus = vets.map((v) => v.prenom).join(', ')
  return { ok: false, raison: `Aucun vétérinaire ne s'appelle « ${prenom} ». Les vétérinaires du cabinet sont : ${connus}.` }
}

interface GardeCandidate {
  id: string
  type: string
  role: Role
}

/** Toutes les gardes d'un véto à une date donnée — un jour peut porter
 *  plusieurs créneaux (jour/nuit) sur un planning sur-mesure. */
async function gardesDuVetoCeJour(ctx: ContexteOutil, vetId: string, date: string): Promise<GardeCandidate[]> {
  // ⛔ SANS CETTE BORNE, ON RECONSTITUE UN PLANNING BROUILLON QUESTION PAR
  // QUESTION.
  //
  // Cette fonction est appelée sur soi PUIS sur un collègue. Ses trois réponses
  // possibles — « X n'a aucune garde ce jour-là », « X en a deux, de tel et tel
  // type », ou la proposition qui aboutit et nomme le rôle — sont autant de
  // fragments du planning. En répétant la demande date après date, un
  // vétérinaire redessinait le planning non diffusé de n'importe lequel de ses
  // confrères, alors que son écran ne lui en montre rien.
  //
  // La RLS ne rattrape rien : `gardes_veto_read` autorise tout vétérinaire à
  // lire toutes les gardes du cabinet, brouillons compris. Et le périmètre posé
  // au commit 55ea8ab ne couvrait pas ce chemin — il bornait les lectures de
  // VUES, celle-ci lit la TABLE.
  //
  // Métier : on ne cède pas une garde que personne ne connaît encore.
  const perimetre = await perimetrePeriodes(ctx)
  if (perimetre.vide) return []

  const { data } = await ctx.supabase
    .from('gardes')
    .select('id, type, premier_id, second_id')
    .in('periode_id', perimetre.ids)
    .eq('date', date)
    .or(`premier_id.eq.${vetId},second_id.eq.${vetId}`)
  return ((data as { id: string; type: string; premier_id: string | null; second_id: string | null }[] | null) ?? []).map(
    (g) => ({ id: g.id, type: g.type, role: (g.premier_id === vetId ? 'premier' : 'second') as Role }),
  )
}

/** Choisit LA garde visée parmi les candidates du jour, en s'appuyant sur une
 *  précision de type si elle est fournie et si elle lève l'ambiguïté. Refuse
 *  net sinon — jamais de choix arbitraire entre deux gardes du même jour. */
function resoudreGardeDuJour(
  candidats: GardeCandidate[],
  date: string,
  qui: string,
  precision?: string,
): { ok: true; garde: GardeCandidate } | { ok: false; raison: string } {
  if (candidats.length === 0) {
    return { ok: false, raison: `${qui === 'toi' ? 'Tu n’as' : `${qui} n’a`} aucune garde le ${formatDateFr(date)}.` }
  }
  let filtres = candidats
  if (precision) {
    const p = normaliser(precision)
    const matches = candidats.filter((c) => normaliser(libelleTypeGardeDb(c.type)).includes(p))
    if (matches.length > 0) filtres = matches
  }
  if (filtres.length === 1) return { ok: true, garde: filtres[0] }
  const types = filtres.map((c) => libelleTypeGardeDb(c.type)).join(', ')
  return {
    ok: false,
    raison: `${qui === 'toi' ? 'Tu as' : `${qui} a`} plusieurs gardes le ${formatDateFr(date)} (${types}). Précise laquelle.`,
  }
}

/** Isole LE seul échange qui correspond à une date + éventuelles précisions
 *  de prénom, parmi une liste déjà filtrée par statut/rôle. Sert aux 5 outils
 *  d'écriture qui portent sur un échange existant. */
function trouverEchangeUnique(
  echanges: EchangeVM[],
  date: string,
  filtre: (e: EchangeVM) => boolean,
  precisions: { demandeur?: string; cible?: string } = {},
): { ok: true; echange: EchangeVM } | { ok: false; raison: string } {
  let candidats = echanges.filter((e) => filtre(e) && e.gardeDate === date)
  if (precisions.demandeur) {
    candidats = candidats.filter((e) => normaliser(e.demandeurPrenom) === normaliser(precisions.demandeur!))
  }
  if (precisions.cible) {
    candidats = candidats.filter((e) => e.ciblePrenom !== null && normaliser(e.ciblePrenom) === normaliser(precisions.cible!))
  }
  if (candidats.length === 0) {
    return { ok: false, raison: `Aucun échange en attente ne correspond à la garde du ${formatDateFr(date)}.` }
  }
  if (candidats.length > 1) {
    const noms = candidats
      .map((e) => `${e.demandeurPrenom}${e.ciblePrenom ? ` ↔ ${e.ciblePrenom}` : ' (proposition ouverte)'}`)
      .join(', ')
    return {
      ok: false,
      raison: `Plusieurs échanges concernent le ${formatDateFr(date)} : ${noms}. Précise le prénom du confrère concerné.`,
    }
  }
  return { ok: true, echange: candidats[0] }
}

// ── Helpers d'affichage (mêmes libellés que la page /echanges) ──

function formatDateFr(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function roleLabel(role: Role): string {
  return role === 'premier' ? '1er de garde' : '2nd de garde'
}

const STATUT_LABEL: Record<string, string> = {
  proposee: 'en attente du confrère',
  acceptee: 'en attente de validation par l’administrateur',
  refusee: 'décliné par le confrère',
  refusee_admin: 'refusé par l’administrateur',
  annulee: 'annulé',
  validee: 'appliqué au planning',
}

function decrireGarde(date: string, type: string, role: Role): string {
  return `${formatDateFr(date)} (${libelleTypeGardeDb(type)}, ${roleLabel(role)})`
}

// ============================================================
// LECTURE
// ============================================================

export const lireEchanges: OutilLecture<typeof SANS_PARAMETRE> = {
  genre: 'lecture',
  nom: 'lire_echanges',
  description: `Donne l'état des échanges de gardes du cabinet : qui a proposé quoi à qui, sur quelle garde, avec quel statut, et le motif en cas de refus.

Appelle-le dès qu'une question porte sur les échanges de garde : « où en est mon échange avec X ? », « qui attend ma réponse ? », « y a-t-il des échanges à valider ? », « qu'est-ce que j'ai proposé récemment ? », ou avant de proposer/accepter/refuser/annuler/valider un échange (pour connaître les dates exactes en jeu).

Renvoie 4 groupes : ce qui attend une réponse de la personne connectée, ses propres propositions en cours, ce qui attend une validation admin (uniquement visible par un administrateur), et un court historique récent (refusés, annulés, appliqués).`,
  params: SANS_PARAMETRE,
  async executer(_params, ctx) {
    const echanges = await chargerEchanges(ctx)

    const pourAffichage = (e: EchangeVM) => ({
      demandeur: e.demandeurPrenom,
      cible: e.ciblePrenom ?? 'ouvert à tous les confrères',
      garde_proposee: decrireGarde(e.gardeDate, e.gardeType, e.roleDemandeur),
      garde_reprise_en_echange: e.contrepartieDate
        ? decrireGarde(e.contrepartieDate, e.contrepartieType!, e.roleContrepartie!)
        : null,
      statut: STATUT_LABEL[e.statut] ?? e.statut,
      message: e.message,
      motif_refus: e.motifRefus,
    })

    const aRepondre = echanges.filter(
      (e) => e.statut === 'proposee' && e.demandeurId !== ctx.vetoId && (e.cibleId === ctx.vetoId || e.cibleId === null),
    )
    const mesPropositions = echanges.filter(
      (e) => e.demandeurId === ctx.vetoId && (e.statut === 'proposee' || e.statut === 'acceptee'),
    )
    const historique = echanges
      .filter((e) => ['refusee', 'annulee', 'validee', 'refusee_admin'].includes(e.statut))
      .slice(0, 15)

    return {
      attend_ma_reponse: aRepondre.map(pourAffichage),
      mes_propositions_en_cours: mesPropositions.map(pourAffichage),
      // Absent (pas juste vide) pour un non-admin : lui faire croire qu'il n'y
      // a rien à valider serait mentir sur son périmètre, pas informer.
      ...(ctx.estAdmin
        ? { a_valider_par_admin: echanges.filter((e) => e.statut === 'acceptee').map(pourAffichage) }
        : {}),
      historique_recent: historique.map(pourAffichage),
    }
  },
}

// ============================================================
// ÉCRITURE — 1. Proposer
// ============================================================

const ParamsProposer = z.object({
  date: z.string().describe('Date ISO (AAAA-MM-JJ) de TA garde à céder.'),
  precision_type: z
    .string()
    .optional()
    .describe('Si tu as plusieurs gardes ce jour-là (ex. jour et nuit), précise laquelle en un mot (ex. "nuit").'),
  cible_prenom: z
    .string()
    .optional()
    .describe(
      'Prénom du confrère à qui proposer l’échange. Absent = proposition OUVERTE à tous les confrères actifs (le premier qui accepte la prend).',
    ),
  contrepartie_date: z
    .string()
    .optional()
    .describe(
      'Date ISO de la garde du confrère que tu veux reprendre en retour. Absent = simple cession, tu ne reprends rien. Impossible sans cible_prenom (une proposition ouverte est forcément une cession simple).',
    ),
  contrepartie_precision_type: z
    .string()
    .optional()
    .describe('Comme precision_type, mais pour désambiguïser la garde du confrère si besoin.'),
  message: z.string().optional().describe('Un mot d’explication à joindre à la proposition (facultatif).'),
})

/** Résolution complète des prénoms/dates → payload prêt pour l'action
 *  serveur. Partagée entre resumer() et executer() pour ne jamais afficher
 *  une chose et en écrire une autre. */
async function resoudreProposition(
  params: z.infer<typeof ParamsProposer>,
  ctx: ContexteOutil,
): Promise<
  | {
      ok: true
      payload: ProposerEchangePayload
      maGarde: GardeCandidate
      cible: FicheVeto | null
      contrepartie: GardeCandidate | null
    }
  | { ok: false; raison: string }
> {
  const candidatsMoi = await gardesDuVetoCeJour(ctx, ctx.vetoId, params.date)
  const resMaGarde = resoudreGardeDuJour(candidatsMoi, params.date, 'toi', params.precision_type)
  if (!resMaGarde.ok) return { ok: false, raison: resMaGarde.raison }

  if (params.contrepartie_date && !params.cible_prenom) {
    return { ok: false, raison: 'Une reprise en échange suppose un confrère précis — indique à qui tu proposes l’échange.' }
  }

  let cible: FicheVeto | null = null
  if (params.cible_prenom) {
    const vets = await chargerVeterinaires(ctx)
    const trouve = resoudrePrenom(vets, params.cible_prenom)
    if (!trouve.ok) return { ok: false, raison: trouve.raison }
    if (trouve.veto.id === ctx.vetoId) return { ok: false, raison: 'On ne s’échange pas une garde avec soi-même 🙂' }
    if (!trouve.veto.actif) return { ok: false, raison: `${trouve.veto.prenom} n’est plus actif dans le planning.` }
    cible = trouve.veto
  }

  let contrepartie: GardeCandidate | null = null
  if (params.contrepartie_date && cible) {
    const candidatsCible = await gardesDuVetoCeJour(ctx, cible.id, params.contrepartie_date)
    const resContre = resoudreGardeDuJour(candidatsCible, params.contrepartie_date, cible.prenom, params.contrepartie_precision_type)
    if (!resContre.ok) return { ok: false, raison: resContre.raison }
    contrepartie = resContre.garde
  }

  return {
    ok: true,
    maGarde: resMaGarde.garde,
    cible,
    contrepartie,
    payload: {
      gardeId: resMaGarde.garde.id,
      roleDemandeur: resMaGarde.garde.role,
      cibleId: cible?.id ?? null,
      gardeContrepartieId: contrepartie?.id ?? null,
      roleContrepartie: contrepartie?.role ?? null,
      message: params.message?.trim() || null,
    },
  }
}

export const proposerEchangeOutil: OutilEcriture<typeof ParamsProposer> = {
  genre: 'ecriture',
  nom: 'proposer_echange',
  description: `Prépare la proposition d'échange d'UNE de tes gardes, à un confrère précis ou ouverte à tous, avec ou sans garde reprise en retour.

Appelle-le quand la demande revient à céder ou échanger une garde — « propose ma garde du 15 à Camille », « je veux échanger ma garde de nuit du 3 contre la sienne du 10 », « ouvre ma garde du 20 à qui veut la reprendre ». Ne fait rien tant que la personne n'a pas validé la proposition affichée.`,
  params: ParamsProposer,

  async resumer(params, ctx) {
    const res = await resoudreProposition(params, ctx)
    if (!res.ok) return { ok: false, raison: res.raison }
    const { maGarde, cible, contrepartie } = res

    const lignes: string[] = [`Tu céderais ta garde du ${decrireGarde(params.date, maGarde.type, maGarde.role)}.`]
    lignes.push(
      cible
        ? `Proposée à ${cible.prenom} ${cible.nom}.`
        : 'Proposée ouverte à tous les confrères actifs — premier arrivé, premier servi.',
    )
    if (contrepartie && params.contrepartie_date) {
      lignes.push(`En échange, tu reprendrais sa garde du ${decrireGarde(params.contrepartie_date, contrepartie.type, contrepartie.role)}.`)
    }
    if (params.message?.trim()) lignes.push(`Message joint : « ${params.message.trim()} »`)

    return {
      ok: true,
      proposition: {
        titre: 'Proposer un échange de garde',
        phrase: 'Voici la proposition d’échange que j’enverrais.',
        lignes,
        action: 'Envoyer la proposition',
        avertissement: cible
          ? 'Rien ne change tant que le confrère n’a pas accepté ET que l’administrateur n’a pas validé : le planning publié ne bouge qu’à ce moment-là.'
          : 'Rien ne change tant qu’un confrère n’a pas repris la garde ET que l’administrateur n’a pas validé.',
      },
    }
  },

  async executer(params, ctx) {
    const res = await resoudreProposition(params, ctx)
    if (!res.ok) return { error: res.raison }
    return proposerEchange(res.payload)
  },
}

// ============================================================
// ÉCRITURE — 2. Accepter (confrère ciblé, ou 1er arrivé si ouverte)
// ============================================================

const ParamsAccepter = z.object({
  date: z.string().describe('Date ISO (AAAA-MM-JJ) de la garde proposée par le confrère — celle que tu reprendrais.'),
  prenom_demandeur: z
    .string()
    .optional()
    .describe('Prénom du confrère qui a fait la proposition, à préciser si plusieurs propositions te concernent ce jour-là.'),
})

export const accepterEchangeOutil: OutilEcriture<typeof ParamsAccepter> = {
  genre: 'ecriture',
  nom: 'accepter_echange',
  description: `Prépare l'acceptation d'une proposition d'échange reçue (adressée à toi, ou ouverte à tous les confrères).

Appelle-le quand la personne veut reprendre une garde qu'on lui a proposée — « j'accepte l'échange de Camille », « je prends la garde du 20 proposée en ouverte ». N'applique rien au planning : reste ensuite la validation de l'administrateur.`,
  params: ParamsAccepter,
  async resumer(params, ctx) {
    const echanges = await chargerEchanges(ctx)
    const filtre = (e: EchangeVM) =>
      e.statut === 'proposee' && e.demandeurId !== ctx.vetoId && (e.cibleId === ctx.vetoId || e.cibleId === null)
    const res = trouverEchangeUnique(echanges, params.date, filtre, { demandeur: params.prenom_demandeur })
    if (!res.ok) return { ok: false, raison: res.raison }
    const e = res.echange

    const lignes = [`Tu reprendrais la garde du ${decrireGarde(e.gardeDate, e.gardeType, e.roleDemandeur)}, proposée par ${e.demandeurPrenom}.`]
    if (e.contrepartieDate) {
      lignes.push(`En retour, ${e.demandeurPrenom} reprendrait ta garde du ${decrireGarde(e.contrepartieDate, e.contrepartieType!, e.roleContrepartie!)}.`)
    }

    return {
      ok: true,
      proposition: {
        titre: 'Accepter l’échange',
        phrase: 'Voici ce que tu accepterais.',
        lignes,
        action: 'Accepter',
        avertissement: 'Reste la validation de l’administrateur avant que le planning publié change réellement.',
      },
    }
  },
  async executer(params, ctx) {
    const echanges = await chargerEchanges(ctx)
    const filtre = (e: EchangeVM) =>
      e.statut === 'proposee' && e.demandeurId !== ctx.vetoId && (e.cibleId === ctx.vetoId || e.cibleId === null)
    const res = trouverEchangeUnique(echanges, params.date, filtre, { demandeur: params.prenom_demandeur })
    if (!res.ok) return { error: res.raison }
    return accepterEchange(res.echange.id)
  },
}

// ============================================================
// ÉCRITURE — 3. Refuser (confrère ciblé — une proposition ouverte s'ignore)
// ============================================================

const ParamsRefuser = z.object({
  date: z.string().describe('Date ISO (AAAA-MM-JJ) de la garde proposée par le confrère.'),
  prenom_demandeur: z
    .string()
    .optional()
    .describe('Prénom du confrère qui a fait la proposition, à préciser si plusieurs propositions te concernent ce jour-là.'),
  motif: z.string().optional().describe('Raison du refus, transmise au confrère (facultatif).'),
})

export const refuserEchangeOutil: OutilEcriture<typeof ParamsRefuser> = {
  genre: 'ecriture',
  nom: 'refuser_echange',
  description: `Prépare le refus d'une proposition d'échange qui T'est adressée nommément.

Appelle-le quand la personne ne veut pas reprendre une garde qu'on lui a proposée directement — « je refuse l'échange de Camille », « décline sa proposition du 15 ». Ne s'applique PAS à une proposition ouverte à tous : celle-ci s'ignore simplement, elle ne se refuse pas.`,
  params: ParamsRefuser,
  async resumer(params, ctx) {
    const echanges = await chargerEchanges(ctx)
    const filtre = (e: EchangeVM) => e.statut === 'proposee' && e.cibleId === ctx.vetoId
    const res = trouverEchangeUnique(echanges, params.date, filtre, { demandeur: params.prenom_demandeur })
    if (!res.ok) {
      // Nuance utile : si c'est une ouverte qui traîne à cette date, le dire.
      const ouverte = echanges.some(
        (e) => e.statut === 'proposee' && e.cibleId === null && e.gardeDate === params.date && e.demandeurId !== ctx.vetoId,
      )
      return {
        ok: false,
        raison: ouverte
          ? `La proposition du ${formatDateFr(params.date)} est ouverte à tous les confrères — elle ne se refuse pas, ignore-la simplement.`
          : res.raison,
      }
    }
    const e = res.echange
    return {
      ok: true,
      proposition: {
        titre: 'Refuser l’échange',
        phrase: `Tu déclinerais la garde du ${decrireGarde(e.gardeDate, e.gardeType, e.roleDemandeur)} proposée par ${e.demandeurPrenom}.`,
        lignes: params.motif?.trim() ? [`Motif transmis : « ${params.motif.trim()} »`] : [],
        action: 'Refuser',
        avertissement: `${e.demandeurPrenom} sera prévenu du refus.`,
      },
    }
  },
  async executer(params, ctx) {
    const echanges = await chargerEchanges(ctx)
    const filtre = (e: EchangeVM) => e.statut === 'proposee' && e.cibleId === ctx.vetoId
    const res = trouverEchangeUnique(echanges, params.date, filtre, { demandeur: params.prenom_demandeur })
    if (!res.ok) return { error: res.raison }
    return refuserEchange(res.echange.id, params.motif)
  },
}

// ============================================================
// ÉCRITURE — 4. Annuler (le demandeur, tant que non validé)
// ============================================================

const ParamsAnnuler = z.object({
  date: z.string().describe('Date ISO (AAAA-MM-JJ) de TA garde proposée en échange.'),
  cible_prenom: z
    .string()
    .optional()
    .describe('Prénom du confrère visé, à préciser si tu as plusieurs propositions en cours ce jour-là.'),
})

export const annulerEchangeOutil: OutilEcriture<typeof ParamsAnnuler> = {
  genre: 'ecriture',
  nom: 'annuler_echange',
  description: `Prépare l'annulation d'une proposition d'échange que TU as toi-même faite (encore en attente, ou déjà acceptée par le confrère mais pas encore validée par l'administrateur).

Appelle-le quand la personne veut retirer sa propre proposition — « annule mon échange du 15 », « je retire ma proposition à Camille ». Ne touche jamais une proposition faite par quelqu'un d'autre.`,
  params: ParamsAnnuler,
  async resumer(params, ctx) {
    const echanges = await chargerEchanges(ctx)
    const filtre = (e: EchangeVM) => e.demandeurId === ctx.vetoId && (e.statut === 'proposee' || e.statut === 'acceptee')
    const res = trouverEchangeUnique(echanges, params.date, filtre, { cible: params.cible_prenom })
    if (!res.ok) return { ok: false, raison: res.raison }
    const e = res.echange

    return {
      ok: true,
      proposition: {
        titre: 'Annuler l’échange',
        phrase: `Tu annulerais ta proposition sur la garde du ${decrireGarde(e.gardeDate, e.gardeType, e.roleDemandeur)}.`,
        lignes: [],
        action: 'Annuler',
        avertissement:
          e.statut === 'acceptee'
            ? `${e.ciblePrenom ?? 'Le confrère'} avait déjà accepté — il sera prévenu de l’annulation.`
            : undefined,
      },
    }
  },
  async executer(params, ctx) {
    const echanges = await chargerEchanges(ctx)
    const filtre = (e: EchangeVM) => e.demandeurId === ctx.vetoId && (e.statut === 'proposee' || e.statut === 'acceptee')
    const res = trouverEchangeUnique(echanges, params.date, filtre, { cible: params.cible_prenom })
    if (!res.ok) return { error: res.raison }
    return annulerEchange(res.echange.id)
  },
}

// ============================================================
// ÉCRITURE — 5. Valider (admin) — applique l'échange au planning publié
// ============================================================

const ParamsValiderAdmin = z.object({
  date: z.string().describe('Date ISO (AAAA-MM-JJ) de la garde cédée par le demandeur.'),
  prenom_demandeur: z.string().describe('Prénom du vétérinaire qui a proposé l’échange.'),
  prenom_cible: z.string().optional().describe('Prénom du confrère qui a accepté, à préciser si plusieurs échanges acceptés concernent cette date.'),
})

export const validerEchangeAdminOutil: OutilEcriture<typeof ParamsValiderAdmin> = {
  genre: 'ecriture',
  nom: 'valider_echange_admin',
  description: `Prépare la validation admin d'un échange déjà accepté par les deux vétérinaires : cette validation APPLIQUE immédiatement le changement au planning publié.

Appelle-le quand l'administrateur veut valider un échange en attente — « valide l'échange de Camille et Julien », « approuve l'échange du 15 ». Réservé à l'administrateur.`,
  params: ParamsValiderAdmin,
  adminSeulement: true,
  async resumer(params, ctx) {
    const echanges = await chargerEchanges(ctx)
    const filtre = (e: EchangeVM) => e.statut === 'acceptee'
    const res = trouverEchangeUnique(echanges, params.date, filtre, {
      demandeur: params.prenom_demandeur,
      cible: params.prenom_cible,
    })
    if (!res.ok) return { ok: false, raison: res.raison }
    const e = res.echange

    const lignes = [
      `${e.demandeurPrenom} cède sa garde du ${decrireGarde(e.gardeDate, e.gardeType, e.roleDemandeur)} à ${e.ciblePrenom}.`,
    ]
    if (e.contrepartieDate) {
      lignes.push(`En retour, ${e.demandeurPrenom} reprend la garde du ${decrireGarde(e.contrepartieDate, e.contrepartieType!, e.roleContrepartie!)}.`)
    }

    return {
      ok: true,
      proposition: {
        titre: 'Valider l’échange',
        phrase: 'Voici l’échange que tu validerais.',
        lignes,
        action: 'Valider',
        avertissement:
          'Le planning déjà publié est modifié tout de suite : emails et notifications partent automatiquement aux deux vétérinaires.',
      },
    }
  },
  async executer(params, ctx) {
    const echanges = await chargerEchanges(ctx)
    const filtre = (e: EchangeVM) => e.statut === 'acceptee'
    const res = trouverEchangeUnique(echanges, params.date, filtre, {
      demandeur: params.prenom_demandeur,
      cible: params.prenom_cible,
    })
    if (!res.ok) return { error: res.raison }
    return validerEchangeAdmin(res.echange.id)
  },
}

// ============================================================
// ÉCRITURE — 6. Refuser (admin) — n'applique rien au planning
// ============================================================

const ParamsRefuserAdmin = z.object({
  date: z.string().describe('Date ISO (AAAA-MM-JJ) de la garde cédée par le demandeur.'),
  prenom_demandeur: z.string().describe('Prénom du vétérinaire qui a proposé l’échange.'),
  prenom_cible: z.string().optional().describe('Prénom du confrère concerné, à préciser si plusieurs échanges concernent cette date.'),
  motif: z.string().optional().describe('Raison du refus, transmise aux deux vétérinaires (facultatif).'),
})

export const refuserEchangeAdminOutil: OutilEcriture<typeof ParamsRefuserAdmin> = {
  genre: 'ecriture',
  nom: 'refuser_echange_admin',
  description: `Prépare le refus admin d'un échange — encore en attente du confrère, ou déjà accepté par lui. N'applique AUCUN changement au planning.

Appelle-le quand l'administrateur veut bloquer un échange — « refuse l'échange de Camille », « n'autorise pas cet échange du 15 ». Réservé à l'administrateur.`,
  params: ParamsRefuserAdmin,
  adminSeulement: true,
  async resumer(params, ctx) {
    const echanges = await chargerEchanges(ctx)
    const filtre = (e: EchangeVM) => e.statut === 'proposee' || e.statut === 'acceptee'
    const res = trouverEchangeUnique(echanges, params.date, filtre, {
      demandeur: params.prenom_demandeur,
      cible: params.prenom_cible,
    })
    if (!res.ok) return { ok: false, raison: res.raison }
    const e = res.echange

    const lignes = [`Échange sur la garde du ${decrireGarde(e.gardeDate, e.gardeType, e.roleDemandeur)}, proposé par ${e.demandeurPrenom}.`]
    lignes.push(e.ciblePrenom ? `Déjà accepté par ${e.ciblePrenom}.` : 'Proposition ouverte, pas encore reprise.')
    if (params.motif?.trim()) lignes.push(`Motif transmis : « ${params.motif.trim()} »`)

    return {
      ok: true,
      proposition: {
        titre: 'Refuser l’échange',
        phrase: 'Voici l’échange que tu refuserais.',
        lignes,
        action: 'Refuser',
        avertissement: 'Le planning ne change pas ; les vétérinaires concernés seront prévenus du refus.',
      },
    }
  },
  async executer(params, ctx) {
    const echanges = await chargerEchanges(ctx)
    const filtre = (e: EchangeVM) => e.statut === 'proposee' || e.statut === 'acceptee'
    const res = trouverEchangeUnique(echanges, params.date, filtre, {
      demandeur: params.prenom_demandeur,
      cible: params.prenom_cible,
    })
    if (!res.ok) return { error: res.raison }
    return refuserEchangeAdmin(res.echange.id, params.motif)
  },
}
