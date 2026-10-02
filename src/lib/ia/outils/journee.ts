// ============================================================
// GUARDVETO — Outils de Filou : le planning de la journée
// ============================================================
// SERVER-ONLY. B-120 chantiers 2 et 3, ouverts à Filou le 02/10 sur décision de
// MiKL : « Filou doit savoir tout du projet, de A à Z ».
//
// Six capacités étaient déclarées `manque` dans `couverture-produit.ts` — les
// trois tranches horaires (chantier 2) et les trois présences récurrentes
// (chantier 3). Elles deviennent six outils ici.
//
// ── CE QUE LE MODÈLE MANIPULE, ET CE QU'IL NE VOIT JAMAIS ───────────────────
//
// AUCUN UUID. Il parle en NOMS de tranche (« Matin »), en PRÉNOMS, en jours et
// en horaires. La résolution nom → identifiant se fait ici, sur les données
// réelles du cabinet, et REFUSE NET dès qu'elle est ambiguë — même discipline
// que `resoudreVeto` (conges.ts) et `resoudreCreneau` (structure.ts).
//
// Faire manipuler un UUID à un modèle, c'est lui donner l'occasion d'en inventer
// un plausible. Le refus explicite est la seule façon de ne pas écrire chez le
// voisin de ligne.
//
// ── POURQUOI LES ÉCRITURES DÉLÈGUENT AUX ACTIONS DE L'ÉCRAN ─────────────────
//
// Chaque `executer` rappelle l'action serveur que le bouton de l'écran appelle
// (`creerBloc`, `modifierBloc`, `basculerBloc`, `creerTrame`…). Donc : mêmes
// gardes (module, admin, saisie), même RLS, mêmes messages de refus.
//
// Réécrire l'insertion ici aurait créé un TROISIÈME chemin d'écriture — et la
// leçon « trois chemins d'écriture, deux gardiens » (22/08) dit lequel finit
// par ne pas être gardé.
//
// ── LE MODULE PEUT ÊTRE ÉTEINT ──────────────────────────────────────────────
//
// `planning-journee` n'est allumé que sur le bac à sable (décision ⑨). Chaque
// outil le vérifie dans `resumer` / `executer` et refuse avec une phrase claire.
//
// ⚠️ LIMITE CONNUE, NON CORRIGÉE ICI : le registre (`outilsPour`) filtre le
//    catalogue par RÔLE, pas par MODULE — il ne reçoit que `estAdmin`. Ces six
//    outils restent donc dans le catalogue d'un admin dont le module est éteint,
//    et répondent « ce cabinet n'a pas cette capacité ». C'est exactement la
//    « coquille vide » que le registre dit vouloir éviter. Filtrer par module
//    demande de porter les modules dans le `ContexteOutil` — une modification du
//    cœur, hors périmètre de ce lot. Tracé au board.
// ============================================================

import { z } from 'zod'
import {
  creerBloc,
  modifierBloc,
  basculerBloc,
} from '@/app/(v2)/journee/actions'
import {
  creerTrame,
  modifierTrame,
  basculerTrame,
} from '@/app/(v2)/journee/trames-actions'
import { modulesDuCabinet } from '@/lib/produit/modules-serveur'
import { MODULE_JOURNEE } from '@/lib/journee/porte'
import { LIBELLE_CRENEAU, plageLisible, avertissementsBloc } from '@/lib/journee/blocs'
import { LIBELLE_JOUR, LIBELLE_PARITE, phraseTrame } from '@/lib/journee/trames'
import { lignesLues } from './lecture'
import type { ContexteOutil, OutilEcriture, OutilLecture } from './types'

// ── Lecture des données du module ───────────────────────────────────────────

interface BlocRow {
  id: string
  nom: string
  debut: string
  fin: string
  creneau: string
  ordre: number
  actif: boolean
}

interface TrameRow {
  id: string
  veterinaire_id: string
  bloc_id: string
  jour: string
  semaine: string
  actif: boolean
}

interface VetoRow {
  id: string
  prenom: string
  nom: string
}

async function chargerBlocs(ctx: ContexteOutil): Promise<BlocRow[]> {
  return lignesLues<BlocRow>(
    await ctx.supabase
      .from('blocs_journee')
      .select('id, nom, debut, fin, creneau, ordre, actif')
      .order('ordre', { ascending: true }),
    'les tranches horaires de la journée',
  )
}

async function chargerTrames(ctx: ContexteOutil): Promise<TrameRow[]> {
  return lignesLues<TrameRow>(
    await ctx.supabase
      .from('trames_journee')
      .select('id, veterinaire_id, bloc_id, jour, semaine, actif'),
    'les présences récurrentes de la journée',
  )
}

async function chargerEquipe(ctx: ContexteOutil): Promise<VetoRow[]> {
  return lignesLues<VetoRow>(
    await ctx.supabase
      .from('veterinaires')
      .select('id, prenom, nom')
      .eq('actif', true)
      .order('prenom', { ascending: true }),
    "la liste de l'équipe",
  )
}

/**
 * Le module est-il allumé pour ce cabinet ?
 *
 * ⚠️ Vérifié dans `resumer` ET dans `executer`. Pas par excès de prudence : un
 *    aperçu peut rester affiché pendant que MiKL éteint le module depuis un
 *    autre onglet, et le clic arriverait après. L'action serveur refuserait de
 *    toute façon — ce contrôle-ci sert à rendre un message lisible plutôt
 *    qu'un refus de garde.
 */
async function moduleAllume(ctx: ContexteOutil): Promise<boolean> {
  const modules = await modulesDuCabinet(ctx.supabase)
  return modules.includes(MODULE_JOURNEE)
}

const REFUS_MODULE =
  "Ce cabinet n'a pas le planning de la journée. Il s'active dans les réglages, module par module."

/** Comparaison de noms indulgente : accents, casse et ponctuation ignorés.
 *  Repris mot pour mot de `conges.ts` — un troisième dialecte de comparaison
 *  aurait produit des résolutions différentes selon l'outil appelé. */
const DIACRITIQUES = /[̀-ͯ]/g
function memeNom(a: string, b: string): boolean {
  const nettoyer = (s: string) =>
    s
      .normalize('NFD')
      .replace(DIACRITIQUES, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
  return nettoyer(a) === nettoyer(b)
}

function resoudreBloc(
  blocs: BlocRow[],
  nom: string,
): { ok: true; bloc: BlocRow } | { ok: false; raison: string } {
  const exacts = blocs.filter((b) => memeNom(b.nom, nom))
  if (exacts.length === 1) return { ok: true, bloc: exacts[0] }
  if (exacts.length > 1) {
    return {
      ok: false,
      raison: `Plusieurs tranches s'appellent « ${nom} » dans ce cabinet. Il faut en renommer une avant d'aller plus loin.`,
    }
  }
  const connues = blocs.map((b) => b.nom).join(', ')
  return {
    ok: false,
    raison: connues
      ? `Aucune tranche ne s'appelle « ${nom} ». Les tranches du cabinet sont : ${connues}.`
      : `Ce cabinet n'a encore aucune tranche horaire définie.`,
  }
}

function resoudreVeto(
  equipe: VetoRow[],
  prenom: string,
): { ok: true; veto: VetoRow } | { ok: false; raison: string } {
  const exacts = equipe.filter((v) => memeNom(v.prenom, prenom))
  if (exacts.length === 1) return { ok: true, veto: exacts[0] }
  if (exacts.length > 1) {
    return {
      ok: false,
      raison: `Plusieurs vétérinaires s'appellent ${prenom}. Précise avec le nom de famille.`,
    }
  }
  const connus = equipe.map((v) => v.prenom).join(', ')
  return {
    ok: false,
    raison: `Aucun vétérinaire ne s'appelle « ${prenom} » dans ce cabinet. Les vétérinaires sont : ${connus}.`,
  }
}

/** « 08:00:00 » ou « 8h » ou « 8 » → « 08:00 ». `null` si ce n'est pas une heure.
 *
 *  Le modèle écrit « 8h30 » aussi souvent que « 08:30 » : refuser la première
 *  forme l'aurait fait buter sur un détail d'écriture, et il aurait réessayé en
 *  boucle sans comprendre. La validation stricte reste côté `validerBloc`. */
function heureSouple(brut: string): string | null {
  const t = (brut ?? '').trim().toLowerCase().replace(/\s/g, '')
  const m = t.match(/^(\d{1,2})(?:[h:.](\d{1,2}))?(?::\d{1,2})?$/)
  if (!m) return null
  const h = Number(m[1])
  const min = m[2] === undefined ? 0 : Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

// ════════════════════════════════════════════════════════════
// LECTURE
// ════════════════════════════════════════════════════════════

export const lireTranchesJournee: OutilLecture<z.ZodObject<Record<string, never>>> = {
  genre: 'lecture',
  nom: 'lire_tranches_journee',
  description: `Donne les tranches horaires de la journée du cabinet — leur nom, leurs horaires, le moment de la journée auquel elles se rattachent, et si elles sont encore proposées.

Appelle-le dès qu'il est question des horaires de la journée ouvrée : « quelles sont nos tranches ? », « à quelle heure finit le matin ? », « est-ce qu'on a une tranche pour les visites ? ».

⚠️ Appelle-le AUSSI avant de parler de présence en journée : une présence s'écrit toujours dans une de ces tranches, et leurs noms sont propres à ce cabinet.`,
  params: z.object({}),

  async executer(_params, ctx) {
    if (!(await moduleAllume(ctx))) return { module_eteint: true, message: REFUS_MODULE }
    const blocs = await chargerBlocs(ctx)
    return {
      tranches: blocs.map((b) => ({
        nom: b.nom,
        horaires: plageLisible(b.debut, b.fin),
        compte_comme: LIBELLE_CRENEAU[b.creneau as keyof typeof LIBELLE_CRENEAU] ?? b.creneau,
        encore_proposee: b.actif,
        // L'avertissement de B-144 voyage jusqu'à Filou : une tranche dont la
        // durée contredit son rattachement est un fait du cabinet, pas un détail
        // d'écran. S'il ne le voyait pas, il décrirait « Matin 8h-18h » comme
        // une matinée ordinaire.
        avertissements: avertissementsBloc(b, blocs, b.id).map((a) => a.texte),
      })),
    }
  },
}

export const lirePresencesRecurrentes: OutilLecture<z.ZodObject<{ prenom: z.ZodOptional<z.ZodString> }>> = {
  genre: 'lecture',
  nom: 'lire_presences_recurrentes',
  description: `Donne les présences récurrentes de la journée : qui est là d'habitude, quel jour, à quelle cadence, sur quelle tranche.

Appelle-le pour « qui travaille le mardi ? », « quels sont les jours d'Anne-Sophie ? », « qui est là le matin ? », « qui consulte cette semaine ? ».

⚠️ CE QUE CET OUTIL DIT, ET CE QU'IL NE DIT PAS. Ce sont les RÈGLES d'habitude, pas le planning réel : un congé validé n'y apparaît pas, et une retouche à la main sur une journée précise non plus. Quand on te demande qui est là à une DATE donnée, dis clairement que tu réponds d'après les habitudes et qu'il faut vérifier les congés — ne présente jamais ça comme le planning du jour.

Sans prénom, tu obtiens tout le cabinet.`,
  params: z.object({
    prenom: z.string().optional().describe("Pour n'avoir que les présences de cette personne."),
  }),

  async executer(params, ctx) {
    if (!(await moduleAllume(ctx))) return { module_eteint: true, message: REFUS_MODULE }

    const [blocs, trames, equipe] = await Promise.all([
      chargerBlocs(ctx),
      chargerTrames(ctx),
      chargerEquipe(ctx),
    ])

    let cible: VetoRow[] = equipe
    if (params.prenom) {
      const trouve = resoudreVeto(equipe, params.prenom)
      if (!trouve.ok) return { refus: trouve.raison }
      cible = [trouve.veto]
    }

    const nomBloc = (id: string) => blocs.find((b) => b.id === id)?.nom ?? 'tranche retirée'

    return {
      // ⚠️ La mise en garde voyage AVEC la donnée, pas seulement dans la
      //    description de l'outil. Un modèle qui a lu la description dix tours
      //    plus tôt l'a déjà oubliée au moment de conclure.
      ceci_sont_des_habitudes_pas_le_planning_reel: true,
      personnes: cible.map((v) => {
        const miennes = trames.filter((t) => t.veterinaire_id === v.id)
        return {
          prenom: v.prenom,
          nom: v.nom,
          presences: miennes
            .filter((t) => t.actif)
            .map((t) => phraseTrame(t as never, nomBloc(t.bloc_id))),
          presences_retirees: miennes
            .filter((t) => !t.actif)
            .map((t) => phraseTrame(t as never, nomBloc(t.bloc_id))),
        }
      }),
    }
  },
}

// ════════════════════════════════════════════════════════════
// ÉCRITURE — les tranches horaires (chantier 2)
// ════════════════════════════════════════════════════════════

const ParamsCreerTranche = z.object({
  nom: z.string().describe('Le nom de la tranche. Ex. « Matin », « Visites ».'),
  debut: z.string().describe('Heure de début, « 08:00 » ou « 8h ».'),
  fin: z.string().describe('Heure de fin, « 12:00 » ou « 12h ».'),
  compte_comme: z
    .enum(['matin', 'apres-midi', 'journee'])
    .describe(
      'Le moment de la journée auquel la tranche se rattache — c’est ce qu’un congé posé sur ce moment retirera.',
    ),
})

export const creerTrancheJournee: OutilEcriture<typeof ParamsCreerTranche> = {
  genre: 'ecriture',
  nom: 'creer_tranche_journee',
  description: `Prépare la création d'une tranche horaire de la journée.

Appelle-le pour « ajoute une tranche visites de 14h à 16h », « crée une garde de midi 12h-14h rattachée à l'après-midi ».

Le rattachement (matin / après-midi / journée entière) n'est PAS déduit des horaires : c'est l'administratrice qui choisit, parce qu'une tranche à cheval comme 12h-14h peut légitimement compter pour l'après-midi. Si la demande ne le précise pas, demande-le — ne devine pas.`,
  params: ParamsCreerTranche,
  adminSeulement: true,

  async resumer(params, ctx) {
    if (!(await moduleAllume(ctx))) return { ok: false, raison: REFUS_MODULE }

    const debut = heureSouple(params.debut)
    const fin = heureSouple(params.fin)
    if (!debut || !fin) {
      return { ok: false, raison: "Je n'ai pas compris les horaires. Donne-les sous la forme 8h ou 08:30." }
    }

    const blocs = await chargerBlocs(ctx)
    if (blocs.some((b) => memeNom(b.nom, params.nom))) {
      return { ok: false, raison: `Une tranche « ${params.nom} » existe déjà dans ce cabinet.` }
    }

    // L'avertissement de B-144 est repris TEL QUEL dans la proposition : si la
    // tranche demandée dit « Matin » en couvrant 8h-18h, l'admin doit le lire
    // AVANT de cliquer, pas le découvrir sur l'écran après.
    const avis = avertissementsBloc(
      { debut, fin, creneau: params.compte_comme },
      blocs.map((b) => ({ ...b, actif: b.actif })),
    )

    return {
      ok: true,
      proposition: {
        titre: 'Ajouter une tranche horaire',
        phrase: `Je vais ajouter « ${params.nom} », de ${plageLisible(debut, fin)}, comptée comme ${LIBELLE_CRENEAU[params.compte_comme]}.`,
        action: 'Ajouter cette tranche',
        avertissement: avis.length > 0 ? avis.map((a) => a.texte).join(' ') : undefined,
      },
      charge: { nom: params.nom.trim(), debut, fin, creneau: params.compte_comme },
    }
  },

  async executer(_params, ctx, charge) {
    if (!(await moduleAllume(ctx))) return { error: REFUS_MODULE }
    const c = charge as { nom?: string; debut?: string; fin?: string; creneau?: string } | undefined
    if (!c?.nom || !c.debut || !c.fin || !c.creneau) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    const r = await creerBloc({ nom: c.nom, debut: c.debut, fin: c.fin, creneau: c.creneau })
    return 'error' in r ? { error: r.error } : {}
  },
}

const ParamsModifierTranche = z.object({
  tranche: z.string().describe('Le nom de la tranche à modifier, tel qu’il est aujourd’hui.'),
  nouveau_nom: z.string().optional(),
  debut: z.string().optional(),
  fin: z.string().optional(),
  compte_comme: z.enum(['matin', 'apres-midi', 'journee']).optional(),
})

export const modifierTrancheJournee: OutilEcriture<typeof ParamsModifierTranche> = {
  genre: 'ecriture',
  nom: 'modifier_tranche_journee',
  description: `Prépare la modification d'une tranche horaire existante — son nom, ses horaires, ou son rattachement.

Appelle-le pour « le matin finit à 12h30 maintenant », « renomme Visites en Tournées », « Matin doit compter comme journée entière ».

⚠️ Changer le RATTACHEMENT d'une tranche change ce qu'un congé retirera. Dis-le quand tu le proposes.`,
  params: ParamsModifierTranche,
  adminSeulement: true,

  async resumer(params, ctx) {
    if (!(await moduleAllume(ctx))) return { ok: false, raison: REFUS_MODULE }

    const blocs = await chargerBlocs(ctx)
    const trouve = resoudreBloc(blocs, params.tranche)
    if (!trouve.ok) return { ok: false, raison: trouve.raison }
    const b = trouve.bloc

    const debut = params.debut === undefined ? b.debut.slice(0, 5) : heureSouple(params.debut)
    const fin = params.fin === undefined ? b.fin.slice(0, 5) : heureSouple(params.fin)
    if (!debut || !fin) {
      return { ok: false, raison: "Je n'ai pas compris les horaires. Donne-les sous la forme 8h ou 08:30." }
    }
    const nom = (params.nouveau_nom ?? b.nom).trim()
    const creneau = params.compte_comme ?? (b.creneau as 'matin' | 'apres-midi' | 'journee')

    const rienNeChange =
      nom === b.nom && debut === b.debut.slice(0, 5) && fin === b.fin.slice(0, 5) && creneau === b.creneau
    if (rienNeChange) {
      return { ok: false, raison: `« ${b.nom} » est déjà exactement dans cet état.` }
    }

    const lignes: string[] = []
    if (nom !== b.nom) lignes.push(`Nom : « ${b.nom} » → « ${nom} »`)
    if (debut !== b.debut.slice(0, 5) || fin !== b.fin.slice(0, 5)) {
      lignes.push(`Horaires : ${plageLisible(b.debut, b.fin)} → ${plageLisible(debut, fin)}`)
    }
    if (creneau !== b.creneau) {
      lignes.push(
        `Compte comme : ${LIBELLE_CRENEAU[b.creneau as keyof typeof LIBELLE_CRENEAU]} → ${LIBELLE_CRENEAU[creneau]}`,
      )
    }

    const avis = avertissementsBloc({ debut, fin, creneau }, blocs, b.id)
    const avertRattachement =
      creneau !== b.creneau
        ? ' Un congé ne retirera plus la même chose sur cette tranche.'
        : ''

    return {
      ok: true,
      proposition: {
        titre: 'Modifier une tranche horaire',
        phrase: `Je vais modifier « ${b.nom} ».`,
        lignes,
        action: 'Enregistrer les changements',
        avertissement:
          (avis.map((a) => a.texte).join(' ') + avertRattachement).trim() || undefined,
      },
      charge: { id: b.id, nom, debut, fin, creneau },
    }
  },

  async executer(_params, ctx, charge) {
    if (!(await moduleAllume(ctx))) return { error: REFUS_MODULE }
    const c = charge as
      | { id?: string; nom?: string; debut?: string; fin?: string; creneau?: string }
      | undefined
    if (!c?.id || !c.nom || !c.debut || !c.fin || !c.creneau) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    const r = await modifierBloc(c.id, {
      nom: c.nom,
      debut: c.debut,
      fin: c.fin,
      creneau: c.creneau,
    })
    return 'error' in r ? { error: r.error } : {}
  },
}

const ParamsAgirTranche = z.object({
  tranche: z.string().describe('Le nom de la tranche.'),
  action: z.enum(['retirer', 'remettre']),
})

export const agirSurTrancheJournee: OutilEcriture<typeof ParamsAgirTranche> = {
  genre: 'ecriture',
  nom: 'agir_sur_tranche_journee',
  description: `Prépare le retrait d'une tranche horaire des choix proposés, ou sa remise en service.

Appelle-le pour « on ne fait plus de visites le samedi, retire la tranche », « remets la tranche Visites ».

⚠️ RETIRER N'EST PAS SUPPRIMER, et il faut le dire : la tranche sort des choix futurs, mais tout ce qui a déjà été posé dessus reste en place. Il n'existe aucun moyen de supprimer une tranche pour de bon, et c'est voulu — ça effacerait du planning déjà vécu.`,
  params: ParamsAgirTranche,
  adminSeulement: true,

  async resumer(params, ctx) {
    if (!(await moduleAllume(ctx))) return { ok: false, raison: REFUS_MODULE }

    const blocs = await chargerBlocs(ctx)
    const trouve = resoudreBloc(blocs, params.tranche)
    if (!trouve.ok) return { ok: false, raison: trouve.raison }
    const b = trouve.bloc

    const versActif = params.action === 'remettre'
    if (b.actif === versActif) {
      return {
        ok: false,
        raison: versActif
          ? `« ${b.nom} » est déjà proposée.`
          : `« ${b.nom} » est déjà retirée des choix.`,
      }
    }

    // ⚠️ L'inspection du consumer, et elle n'est pas décorative : une trame bâtie
    //    sur cette tranche cesserait de poser quoi que ce soit. Le dire AVANT le
    //    clic, pas après — c'est le genre d'effet qu'on ne relie jamais à sa cause.
    let avert =
      'La tranche sort des choix proposés. Ce qui a déjà été posé dessus reste en place.'
    if (!versActif) {
      const trames = await chargerTrames(ctx)
      const concernees = trames.filter((t) => t.bloc_id === b.id && t.actif).length
      if (concernees > 0) {
        avert += ` Attention : ${concernees} présence(s) récurrente(s) s'appuient sur cette tranche et ne poseront plus rien.`
      }
    }

    return {
      ok: true,
      proposition: {
        titre: versActif ? 'Remettre une tranche horaire' : 'Retirer une tranche horaire',
        phrase: versActif
          ? `Je vais remettre « ${b.nom} » (${plageLisible(b.debut, b.fin)}) dans les choix.`
          : `Je vais retirer « ${b.nom} » (${plageLisible(b.debut, b.fin)}) des choix proposés.`,
        action: versActif ? 'Remettre' : 'Retirer',
        avertissement: versActif ? undefined : avert,
      },
      charge: { id: b.id, actif: versActif },
    }
  },

  async executer(_params, ctx, charge) {
    if (!(await moduleAllume(ctx))) return { error: REFUS_MODULE }
    const c = charge as { id?: string; actif?: boolean } | undefined
    if (!c?.id || typeof c.actif !== 'boolean') {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    const r = await basculerBloc(c.id, c.actif)
    return 'error' in r ? { error: r.error } : {}
  },
}

// ════════════════════════════════════════════════════════════
// ÉCRITURE — les présences récurrentes (chantier 3)
// ════════════════════════════════════════════════════════════

const ParamsCreerPresence = z.object({
  prenom: z.string().describe('Le prénom de la personne.'),
  tranche: z.string().describe('Le nom de la tranche horaire. Ex. « Matin ».'),
  jour: z.enum(['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']),
  cadence: z
    .enum(['toutes', 'paire', 'impaire'])
    .describe(
      'toutes = chaque semaine · paire / impaire = une semaine sur deux, selon le numéro de semaine du calendrier.',
    ),
})

export const creerPresenceRecurrente: OutilEcriture<typeof ParamsCreerPresence> = {
  genre: 'ecriture',
  nom: 'creer_presence_recurrente',
  description: `Prépare l'ajout d'une présence récurrente : telle personne, tel jour, telle cadence, telle tranche horaire.

Appelle-le pour « Anne-Sophie est là les lundis et mardis des semaines impaires », « Victor consulte tous les jeudis après-midi ».

Une demande qui cite PLUSIEURS jours ou PLUSIEURS tranches fait autant d'appels que de combinaisons : « lundi et mardi matin » = deux appels.

⚠️ CE QUE ÇA NE FAIT PAS, et il faut le dire à la personne : enregistrer une présence récurrente ne remplit PAS le planning. C'est la règle d'habitude ; l'appliquer sur une période est un geste séparé qui n'existe pas encore dans le produit.

Les semaines paires et impaires suivent le numéro de semaine du calendrier, exactement comme dans les règles de gardes.`,
  params: ParamsCreerPresence,
  adminSeulement: true,

  async resumer(params, ctx) {
    if (!(await moduleAllume(ctx))) return { ok: false, raison: REFUS_MODULE }

    const [blocs, equipe, trames] = await Promise.all([
      chargerBlocs(ctx),
      chargerEquipe(ctx),
      chargerTrames(ctx),
    ])

    const v = resoudreVeto(equipe, params.prenom)
    if (!v.ok) return { ok: false, raison: v.raison }
    const b = resoudreBloc(blocs, params.tranche)
    if (!b.ok) return { ok: false, raison: b.raison }

    if (!b.bloc.actif) {
      return {
        ok: false,
        raison: `La tranche « ${b.bloc.nom} » a été retirée des choix. Remets-la d'abord si tu veux bâtir une présence dessus.`,
      }
    }

    const jumelle = trames.find(
      (t) =>
        t.veterinaire_id === v.veto.id &&
        t.bloc_id === b.bloc.id &&
        t.jour === params.jour &&
        t.semaine === params.cadence,
    )
    if (jumelle) {
      return {
        ok: false,
        raison: jumelle.actif
          ? `${v.veto.prenom} a déjà cette présence dans sa trame.`
          : `${v.veto.prenom} a déjà cette présence, mais elle a été retirée. Remets-la plutôt que d'en créer une seconde.`,
      }
    }

    return {
      ok: true,
      proposition: {
        titre: 'Ajouter une présence récurrente',
        phrase: `Je vais noter que ${v.veto.prenom} est présent·e ${phraseTrame(
          { jour: params.jour, semaine: params.cadence },
          b.bloc.nom,
        )}.`,
        lignes: [
          `Tranche : ${b.bloc.nom} (${plageLisible(b.bloc.debut, b.bloc.fin)})`,
          `Jour : ${LIBELLE_JOUR[params.jour]}`,
          `Cadence : ${LIBELLE_PARITE[params.cadence]}`,
        ],
        action: 'Ajouter cette présence',
        avertissement:
          'Ceci est la règle d’habitude : le planning déjà prévu ne change pas.',
      },
      charge: {
        veterinaire_id: v.veto.id,
        bloc_id: b.bloc.id,
        jour: params.jour,
        semaine: params.cadence,
      },
    }
  },

  async executer(_params, ctx, charge) {
    if (!(await moduleAllume(ctx))) return { error: REFUS_MODULE }
    const c = charge as
      | { veterinaire_id?: string; bloc_id?: string; jour?: string; semaine?: string }
      | undefined
    if (!c?.veterinaire_id || !c.bloc_id || !c.jour || !c.semaine) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    const r = await creerTrame({
      veterinaire_id: c.veterinaire_id,
      bloc_id: c.bloc_id,
      jour: c.jour,
      semaine: c.semaine,
    })
    return 'error' in r ? { error: r.error } : {}
  },
}

const ParamsModifierPresence = z.object({
  prenom: z.string(),
  tranche: z.string().describe('La tranche de la présence ACTUELLE.'),
  jour: z
    .enum(['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'])
    .describe('Le jour de la présence ACTUELLE.'),
  cadence: z.enum(['toutes', 'paire', 'impaire']).describe('La cadence ACTUELLE.'),
  nouvelle_tranche: z.string().optional(),
  nouveau_jour: z
    .enum(['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'])
    .optional(),
  nouvelle_cadence: z.enum(['toutes', 'paire', 'impaire']).optional(),
})

export const modifierPresenceRecurrente: OutilEcriture<typeof ParamsModifierPresence> = {
  genre: 'ecriture',
  nom: 'modifier_presence_recurrente',
  description: `Prépare la modification d'une présence récurrente existante : changer sa tranche, son jour, ou sa cadence.

Appelle-le pour « Anne-Sophie passe du lundi au mardi », « Victor passe à toutes les semaines ».

⚠️ Une présence n'a pas de numéro affiché : elle se désigne par la personne + la tranche + le jour + la cadence ACTUELS. Si tu ne les connais pas, appelle d'abord lire_presences_recurrentes — ne devine pas.`,
  params: ParamsModifierPresence,
  adminSeulement: true,

  async resumer(params, ctx) {
    if (!(await moduleAllume(ctx))) return { ok: false, raison: REFUS_MODULE }

    const [blocs, equipe, trames] = await Promise.all([
      chargerBlocs(ctx),
      chargerEquipe(ctx),
      chargerTrames(ctx),
    ])

    const v = resoudreVeto(equipe, params.prenom)
    if (!v.ok) return { ok: false, raison: v.raison }
    const b = resoudreBloc(blocs, params.tranche)
    if (!b.ok) return { ok: false, raison: b.raison }

    const actuelle = trames.find(
      (t) =>
        t.veterinaire_id === v.veto.id &&
        t.bloc_id === b.bloc.id &&
        t.jour === params.jour &&
        t.semaine === params.cadence,
    )
    if (!actuelle) {
      return {
        ok: false,
        raison: `${v.veto.prenom} n'a pas de présence « ${LIBELLE_JOUR[params.jour]} / ${LIBELLE_PARITE[params.cadence]} / ${b.bloc.nom} ». Vérifie sa trame avant de la modifier.`,
      }
    }

    let blocCible = b.bloc
    if (params.nouvelle_tranche) {
      const nb = resoudreBloc(blocs, params.nouvelle_tranche)
      if (!nb.ok) return { ok: false, raison: nb.raison }
      if (!nb.bloc.actif) {
        return {
          ok: false,
          raison: `La tranche « ${nb.bloc.nom} » a été retirée des choix. Remets-la d'abord.`,
        }
      }
      blocCible = nb.bloc
    }
    const jourCible = params.nouveau_jour ?? params.jour
    const cadenceCible = params.nouvelle_cadence ?? params.cadence

    if (
      blocCible.id === b.bloc.id &&
      jourCible === params.jour &&
      cadenceCible === params.cadence
    ) {
      return { ok: false, raison: 'Cette présence est déjà exactement dans cet état.' }
    }

    return {
      ok: true,
      proposition: {
        titre: 'Modifier une présence récurrente',
        phrase: `Je vais modifier la présence de ${v.veto.prenom}.`,
        lignes: [
          `Avant : ${phraseTrame({ jour: params.jour, semaine: params.cadence }, b.bloc.nom)}`,
          `Après : ${phraseTrame({ jour: jourCible, semaine: cadenceCible }, blocCible.nom)}`,
        ],
        action: 'Enregistrer les changements',
        avertissement: 'Ceci est la règle d’habitude : le planning déjà prévu ne change pas.',
      },
      charge: {
        id: actuelle.id,
        veterinaire_id: v.veto.id,
        bloc_id: blocCible.id,
        jour: jourCible,
        semaine: cadenceCible,
      },
    }
  },

  async executer(_params, ctx, charge) {
    if (!(await moduleAllume(ctx))) return { error: REFUS_MODULE }
    const c = charge as
      | { id?: string; veterinaire_id?: string; bloc_id?: string; jour?: string; semaine?: string }
      | undefined
    if (!c?.id || !c.veterinaire_id || !c.bloc_id || !c.jour || !c.semaine) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    const r = await modifierTrame(c.id, {
      veterinaire_id: c.veterinaire_id,
      bloc_id: c.bloc_id,
      jour: c.jour,
      semaine: c.semaine,
    })
    return 'error' in r ? { error: r.error } : {}
  },
}

const ParamsAgirPresence = z.object({
  prenom: z.string(),
  tranche: z.string(),
  jour: z.enum(['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']),
  cadence: z.enum(['toutes', 'paire', 'impaire']),
  action: z.enum(['retirer', 'remettre']),
})

export const agirSurPresenceRecurrente: OutilEcriture<typeof ParamsAgirPresence> = {
  genre: 'ecriture',
  nom: 'agir_sur_presence_recurrente',
  description: `Prépare le retrait d'une présence récurrente, ou sa remise.

Appelle-le pour « Anne-Sophie ne vient plus le mercredi », « remets la présence du jeudi de Victor ».

⚠️ RETIRER N'EST PAS SUPPRIMER : la règle ne servira plus aux prochains remplissages, mais ce qui a déjà été posé par elle reste en place. Dis-le — sans ça, l'administratrice croira avoir défait le planning.`,
  params: ParamsAgirPresence,
  adminSeulement: true,

  async resumer(params, ctx) {
    if (!(await moduleAllume(ctx))) return { ok: false, raison: REFUS_MODULE }

    const [blocs, equipe, trames] = await Promise.all([
      chargerBlocs(ctx),
      chargerEquipe(ctx),
      chargerTrames(ctx),
    ])

    const v = resoudreVeto(equipe, params.prenom)
    if (!v.ok) return { ok: false, raison: v.raison }
    const b = resoudreBloc(blocs, params.tranche)
    if (!b.ok) return { ok: false, raison: b.raison }

    const actuelle = trames.find(
      (t) =>
        t.veterinaire_id === v.veto.id &&
        t.bloc_id === b.bloc.id &&
        t.jour === params.jour &&
        t.semaine === params.cadence,
    )
    if (!actuelle) {
      return {
        ok: false,
        raison: `${v.veto.prenom} n'a pas de présence « ${LIBELLE_JOUR[params.jour]} / ${LIBELLE_PARITE[params.cadence]} / ${b.bloc.nom} ».`,
      }
    }

    const versActif = params.action === 'remettre'
    if (actuelle.actif === versActif) {
      return {
        ok: false,
        raison: versActif ? 'Cette présence est déjà active.' : 'Cette présence est déjà retirée.',
      }
    }

    return {
      ok: true,
      proposition: {
        titre: versActif ? 'Remettre une présence récurrente' : 'Retirer une présence récurrente',
        phrase: `Je vais ${versActif ? 'remettre' : 'retirer'} la présence de ${v.veto.prenom} : ${phraseTrame(
          { jour: params.jour, semaine: params.cadence },
          b.bloc.nom,
        )}.`,
        action: versActif ? 'Remettre' : 'Retirer',
        avertissement: versActif
          ? undefined
          : 'La règle ne servira plus aux prochains remplissages. Ce qui a déjà été posé reste en place.',
      },
      charge: { id: actuelle.id, actif: versActif },
    }
  },

  async executer(_params, ctx, charge) {
    if (!(await moduleAllume(ctx))) return { error: REFUS_MODULE }
    const c = charge as { id?: string; actif?: boolean } | undefined
    if (!c?.id || typeof c.actif !== 'boolean') {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    const r = await basculerTrame(c.id, c.actif)
    return 'error' in r ? { error: r.error } : {}
  },
}

/** Garde-fou de rédaction : les listes de l'écran et celles du schéma Zod
 *  doivent rester les mêmes. Si quelqu'un ajoute un jour ou une cadence dans
 *  `trames.ts` sans l'ajouter ici, Filou ne saura pas le proposer — et rien ne
 *  le signalerait. Le test `journee-outils.test.ts` lit ces deux constantes. */
export const JOURS_EXPOSES_A_FILOU = ParamsCreerPresence.shape.jour.options
export const CADENCES_EXPOSEES_A_FILOU = ParamsCreerPresence.shape.cadence.options
export const CRENEAUX_EXPOSES_A_FILOU = ParamsCreerTranche.shape.compte_comme.options
