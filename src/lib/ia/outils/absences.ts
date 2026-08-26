// ============================================================
// GUARDVETO — Outils de Filou : absences & gestion de crise
// ============================================================
// SERVER-ONLY. Une absence imprévue après publication est un cas à part : le
// planning publié ne bouge pas tout seul, et TROIS parcours coexistent une
// fois l'absence déclarée — imposer un remplaçant (réparer), demander des
// volontaires (appel), ou laisser une dette de dépannage se solder plus tard
// (compensations). Filou doit pouvoir lire les trois et déclencher les deux
// premiers ; le troisième passe par la vraie action serveur de l'écran
// Dépannages, pas par une réécriture maison.
//
// PIÈGE ÉVITÉ ICI : les routes /api/absences/... sont des handlers HTTP (POST),
// pas des fonctions qu'on peut importer. On ne les rappelle donc PAS en HTTP
// depuis le serveur (cookies, URL absolue, boucle inutile) : on rejoue
// exactement la même orchestration qu'elles, en import direct des MÊMES
// briques partagées qu'elles utilisent déjà —
//   • recenserCreneauxImpactes / chargerContextePourPeriode / proposerReparation
//     (aucune I/O d'écriture — c'est la logique de légalité, identique)
//   • appliquerChangementGarde (le cycle partagé PATCH garde ↔ crise)
//   • sendAppelVolontaires (l'envoi d'email partagé)
// Les deux seuls endroits où il n'existe PAS de fonction partagée exportée
// (l'INSERT de `absences`, l'INSERT de `compensations` dans /reparer) sont de
// simples écritures scopées cabinet : on les reproduit à l'identique des
// routes. Le vrai bon endroit serait d'extraire ces deux routes vers un
// helper partagé (comme appliquer-changement.ts) — à faire dans un prochain
// lot, signalé dans le rapport de cette story.
//
// Comme equipe.ts : le modèle ne manipule que des PRÉNOMS et des DATES ISO,
// jamais d'identifiants. La résolution se fait ici, refuse l'ambigu, et
// revalide TOUT côté serveur au moment d'écrire (jamais confiance en la
// `charge` pour la légalité d'un remplacement — seulement pour retrouver quoi
// rejouer).
// ============================================================

import { z } from 'zod'
import { changerStatutCompensation as changerStatutCompensationAction } from '@/app/(protected)/admin/depannages/actions'
import { appliquerChangementGarde } from '@/lib/gardes/appliquer-changement'
import {
  avertissementsReglesDuresMultiPeriodes,
  tracerConfirmationMalgreAvertissement,
} from '@/lib/gardes/avertissements-regles'
import { changementsPourDecisions } from '@/lib/crise/changements'
import { sendAppelVolontaires } from '@/lib/notifications'
import { proposerReparation, type CreneauCrise } from '@/engine/crise/reparer'
import {
  recenserCreneauxImpactes,
  chargerContextePourPeriode,
  besoinSecondCreneau,
  type ContexteCrisePeriode,
} from '@/lib/crise/contexte'
import type { RoleGarde } from '@/engine/types'
import { lignesLues } from './lecture'
import type { MotifAbsence, StatutAbsence, StatutCompensation } from '@/types'
import { SANS_PARAMETRE, type ContexteOutil, type OutilEcriture, type OutilLecture } from './types'

// ── Résolution prénom → fiche (même logique que equipe.ts, dupliquée : les
//    deux fichiers ne s'importent pas l'un l'autre, et la fonction est trop
//    petite pour justifier un partagé) ─────────────────────

interface FicheVetoLegere {
  id: string
  prenom: string
  nom: string
}

async function chargerEquipeLegere(ctx: ContexteOutil): Promise<FicheVetoLegere[]> {
  return lignesLues<FicheVetoLegere>(
    await ctx.supabase.from('veterinaires').select('id, prenom, nom').order('prenom'),
    "la liste de l'équipe",
  )
}

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

function resoudrePrenom(
  equipe: FicheVetoLegere[],
  prenom: string,
): { ok: true; veto: FicheVetoLegere } | { ok: false; raison: string } {
  const exacts = equipe.filter((v) => memeNom(v.prenom, prenom))
  if (exacts.length === 1) return { ok: true, veto: exacts[0] }
  if (exacts.length > 1) {
    return { ok: false, raison: `Plusieurs vétérinaires s'appellent ${prenom}. Précise avec le nom de famille.` }
  }
  const connus = equipe.map((v) => v.prenom).join(', ')
  return {
    ok: false,
    raison: `Aucun vétérinaire ne s'appelle « ${prenom} » dans ce cabinet. Les vétérinaires sont : ${connus}.`,
  }
}

function estDateISO(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v)
}

const MOTIFS_VALIDES: MotifAbsence[] = ['maladie', 'urgence', 'autre']

const LIBELLES_STATUT_COMPENSATION: Record<StatutCompensation, string> = {
  a_compenser: 'à compenser',
  compensee: 'compensée',
  annulee: 'annulée',
}

/** Retrouve l'absence ACTIVE la plus récente d'un vétérinaire dans le cabinet.
 *  Une seule absence active à la fois est le cas normal ; s'il y en avait
 *  plusieurs, on prend la plus récente plutôt que d'échouer — le modèle vise
 *  toujours « l'absence en cours », jamais une historique. */
async function trouverAbsenceActive(
  ctx: ContexteOutil,
  vetoId: string,
): Promise<{ id: string; date_debut: string; date_fin: string } | null> {
  const lignes = lignesLues<{ id: string; date_debut: string; date_fin: string }>(
    await ctx.supabase
      .from('absences')
      .select('id, date_debut, date_fin')
      .eq('veterinaire_id', vetoId)
      .eq('statut', 'active')
      .order('date_debut', { ascending: false })
      .limit(1),
    "l'absence en cours de cette personne",
  )
  return lignes[0] ?? null
}

/** Le contexte moteur d'une période, avec cache : plusieurs créneaux d'une
 *  même absence retombent souvent sur la même période. */
async function ctxPeriode(
  ctx: ContexteOutil,
  cache: Map<string, ContexteCrisePeriode>,
  periodeId: string,
): Promise<ContexteCrisePeriode> {
  let c = cache.get(periodeId)
  if (!c) {
    c = await chargerContextePourPeriode(ctx.supabase, periodeId, ctx.cabinetId)
    cache.set(periodeId, c)
  }
  return c
}

// ── Lecture ─────────────────────────────────────────────────

interface AbsenceRow {
  id: string
  veterinaire_id: string
  date_debut: string
  date_fin: string
  motif: MotifAbsence
  commentaire: string | null
  statut: StatutAbsence
  created_at: string
  veto: { prenom: string; nom: string } | null
}

const ParamsLireAbsences = z.object({
  prenom: z
    .string()
    .optional()
    .describe('Filtre sur le prénom du vétérinaire absent. Omis = toutes les absences du cabinet.'),
  statut: z
    .enum(['active', 'resolue', 'annulee'])
    .optional()
    .describe('Filtre sur le statut de l’absence. Omis = tous les statuts.'),
})

export const lireAbsences: OutilLecture<typeof ParamsLireAbsences> = {
  genre: 'lecture',
  nom: 'lire_absences',
  description: `Liste les absences imprévues déclarées après publication du planning (maladie, urgence…) — à ne pas confondre avec les congés posés à l'avance. Donne pour chacune : qui, du combien au combien, le motif, un éventuel commentaire, et le statut (active = pas encore entièrement réparée, résolue = tous les créneaux ont un remplaçant, annulée).

Appelle-le pour toute question sur qui est absent, depuis quand, ou si une absence est déjà réglée — « qui est absent en ce moment », « l'absence de Camille est-elle réglée », « pourquoi Fanny n'apparaît plus sur le planning cette semaine ».

LE MOTIF DES AUTRES N'EST PAS VISIBLE si tu parles à un vétérinaire : il vaut alors simplement « absence », et le commentaire est vide. C'est voulu — la raison d'une absence est une donnée personnelle. N'essaie pas de la deviner ni de la reconstituer : dis que la personne est absente, sans plus.`,
  params: ParamsLireAbsences,
  async executer(params, ctx) {
    let requete = ctx.supabase
      .from('absences')
      .select('id, veterinaire_id, date_debut, date_fin, motif, commentaire, statut, created_at, veto:veterinaire_id(prenom, nom)')
      .order('date_debut', { ascending: false })

    if (params.statut) requete = requete.eq('statut', params.statut)

    let lignes = lignesLues<AbsenceRow>(await requete, 'les absences du cabinet')

    if (params.prenom) {
      const equipe = await chargerEquipeLegere(ctx)
      const trouve = resoudrePrenom(equipe, params.prenom)
      if (!trouve.ok) return { erreur: trouve.raison }
      lignes = lignes.filter((l) => l.veterinaire_id === trouve.veto.id)
    }

    // ⛔ LE MOTIF ET LE COMMENTAIRE NE SONT PAS PUBLICS.
    //
    // Savoir qu'un confrere est absent est legitime — on s'organise autour.
    // Savoir POURQUOI ne l'est pas : « maladie » est une donnee de sante, et le
    // commentaire libre peut contenir n'importe quelle precision.
    //
    // L'outil `declarer_absence` decrit d'ailleurs ce champ, dans ce meme
    // fichier, comme « visible par l'administrateur » : l'administratrice
    // l'ecrit en le croyant. Le distribuer a toute l'equipe par le chat
    // trahissait cette promesse.
    //
    // Chacun garde acces a SES propres absences, motif compris.
    const peutVoirLeDetail = (vetId: string) => ctx.estAdmin || vetId === ctx.vetoId

    return lignes.map((l) => ({
      veterinaire: l.veto ? `${l.veto.prenom} ${l.veto.nom}` : 'inconnu',
      date_debut: l.date_debut,
      date_fin: l.date_fin,
      motif: peutVoirLeDetail(l.veterinaire_id) ? l.motif : 'absence',
      commentaire: peutVoirLeDetail(l.veterinaire_id) ? l.commentaire : null,
      statut: l.statut,
    }))
  },
}

interface CompensationRow {
  id: string
  role: RoleGarde | null
  statut: StatutCompensation
  created_at: string
  garde: { date: string; type: string } | null
  remplacant: { prenom: string; nom: string } | null
  remplace: { prenom: string; nom: string } | null
  absence: { date_debut: string; motif: MotifAbsence } | null
}

const ParamsLireCompensations = z.object({
  statut: z
    .enum(['a_compenser', 'compensee', 'annulee'])
    .optional()
    .describe('Filtre sur le statut de la dette de dépannage. Omis = tous les statuts.'),
})

export const lireCompensations: OutilLecture<typeof ParamsLireCompensations> = {
  genre: 'lecture',
  nom: 'lire_compensations',
  description: `Liste les dépannages : qui a remplacé qui, sur quelle garde, suite à quelle absence, et où en est la dette (à compenser, compensée, ou annulée). C'est le suivi de « qui doit une garde à qui » après une absence.

Appelle-le pour « qui a dépanné qui récemment », « est-ce que la garde que Camille a couverte pour Fanny a été rendue », ou pour préparer un changement de statut de dépannage.`,
  params: ParamsLireCompensations,
  adminSeulement: true,
  async executer(params, ctx) {
    let requete = ctx.supabase
      .from('compensations')
      .select(
        `id, role, statut, created_at,
         garde:gardes ( date, type ),
         remplacant:veterinaires!compensations_remplacant_id_fkey ( prenom, nom ),
         remplace:veterinaires!compensations_remplace_id_fkey ( prenom, nom ),
         absence:absences ( date_debut, motif )`,
      )
      .order('created_at', { ascending: false })

    if (params.statut) requete = requete.eq('statut', params.statut)

    return lignesLues<CompensationRow>(await requete, 'les dépannages du cabinet').map((c) => ({
      remplacant: c.remplacant ? `${c.remplacant.prenom} ${c.remplacant.nom}` : 'inconnu',
      remplace: c.remplace ? `${c.remplace.prenom} ${c.remplace.nom}` : 'inconnu',
      date_garde: c.garde?.date ?? null,
      role: c.role,
      motif_absence: c.absence?.motif ?? null,
      statut: c.statut,
    }))
  },
}

const ParamsCreneauxTouches = z.object({
  prenom: z.string().describe('Le prénom du vétérinaire absent.'),
})

export const lireCreneauxTouches: OutilLecture<typeof ParamsCreneauxTouches> = {
  genre: 'lecture',
  nom: 'lire_creneaux_touches',
  description: `Pour l'absence ACTIVE d'un vétérinaire, liste les gardes futures encore à couvrir : la date, le rôle libéré, et qui pourrait légalement le remplacer (les mêmes règles que la génération du planning — pas de proposition qu'un admin devrait ensuite rejeter).

Appelle-le pour préparer une réparation ou un appel aux volontaires : « quelles gardes de Fanny restent à réparer », « qui peut prendre la place de Camille sur ses gardes ». N'exige rien de plus qu'un prénom.`,
  params: ParamsCreneauxTouches,
  adminSeulement: true,
  async executer(params, ctx) {
    const equipe = await chargerEquipeLegere(ctx)
    const trouve = resoudrePrenom(equipe, params.prenom)
    if (!trouve.ok) return { erreur: trouve.raison }

    const absence = await trouverAbsenceActive(ctx, trouve.veto.id)
    if (!absence) return { erreur: `${trouve.veto.prenom} n'a pas d'absence active en ce moment.` }

    const impactes = await recenserCreneauxImpactes(
      ctx.supabase,
      ctx.cabinetId,
      trouve.veto.id,
      absence.date_debut,
      absence.date_fin,
    )
    if (impactes.length === 0) {
      return { message: 'Toutes les gardes de cette absence sont déjà couvertes.' }
    }

    const cache = new Map<string, ContexteCrisePeriode>()
    const resultat = []
    for (const imp of impactes) {
      const periodeCtx = await ctxPeriode(ctx, cache, imp.periodeId)
      const creneau: CreneauCrise = {
        date: imp.date,
        type: imp.typeEngine,
        role: imp.role,
        saison: imp.saison,
        besoinSecond: besoinSecondCreneau(imp.typeEngine, imp.saison, periodeCtx.nbVetosSemaineSoir, periodeCtx.placesNuitSemaine),
      }
      const rep = proposerReparation({
        creneau,
        absentId: trouve.veto.id,
        vets: periodeCtx.vets,
        planningComplet: periodeCtx.planningComplet,
        calendrier: periodeCtx.calendrier,
        structure: periodeCtx.structure,
        equityWeights: periodeCtx.equityWeights,
        roleAvantageFinancier: periodeCtx.roleAvantageFinancier,
        contexteAnterieur: periodeCtx.contexteAnterieur,
      })
      resultat.push({
        date: imp.date,
        role: imp.role,
        remplacants_legaux: rep.candidats.map((c) => equipe.find((v) => v.id === c.vetId)?.prenom ?? c.vetId),
        aucun_remplacant_legal: rep.candidats.length === 0,
      })
    }
    return resultat
  },
}

// ── Écriture ────────────────────────────────────────────────

const ParamsDeclarer = z.object({
  prenom: z.string().describe('Le prénom du vétérinaire absent.'),
  date_debut: z.string().describe('Date ISO (AAAA-MM-JJ) du premier jour d’absence.'),
  date_fin: z.string().describe('Date ISO (AAAA-MM-JJ) du dernier jour d’absence.'),
  motif: z.enum(['maladie', 'urgence', 'autre']).describe('Le motif de l’absence.'),
  commentaire: z.string().optional().describe('Un détail libre, visible par l’administrateur.'),
})

export const declarerAbsence: OutilEcriture<typeof ParamsDeclarer> = {
  genre: 'ecriture',
  nom: 'declarer_absence',
  description: `Prépare la déclaration d'une absence imprévue APRÈS publication du planning (maladie, urgence…) — pas un congé posé à l'avance, qui suit un autre circuit.

Appelle-le quand l'admin annonce qu'un vétérinaire ne peut plus assurer une garde déjà publiée : « Fanny est malade jusqu'à vendredi », « Camille a un empêchement ce week-end ».

Ne modifie AUCUNE garde : elle ne fait qu'ouvrir le dossier de crise. Les gardes déjà publiées touchées devront ensuite être réparées (outil réparer_absence) ou faire l'objet d'un appel aux volontaires (outil appeler_volontaires).`,
  params: ParamsDeclarer,
  adminSeulement: true,

  async resumer(params, ctx) {
    if (!estDateISO(params.date_debut) || !estDateISO(params.date_fin)) {
      return { ok: false, raison: 'Les dates doivent être au format AAAA-MM-JJ.' }
    }
    if (params.date_fin < params.date_debut) {
      return { ok: false, raison: 'La date de fin doit être postérieure ou égale à la date de début.' }
    }
    if (!MOTIFS_VALIDES.includes(params.motif)) {
      return { ok: false, raison: `Motif invalide (attendu : ${MOTIFS_VALIDES.join(', ')}).` }
    }

    const equipe = await chargerEquipeLegere(ctx)
    const trouve = resoudrePrenom(equipe, params.prenom)
    if (!trouve.ok) return { ok: false, raison: trouve.raison }

    // Aperçu du volume de gardes touchées — informatif seulement, la légalité
    // des remplacements se calcule outil par outil au moment de réparer.
    let impactes: unknown[] = []
    try {
      impactes = await recenserCreneauxImpactes(
        ctx.supabase,
        ctx.cabinetId,
        trouve.veto.id,
        params.date_debut,
        params.date_fin,
      )
    } catch {
      // Best-effort : un souci de lecture ici ne doit pas bloquer la déclaration.
    }

    const lignes = [
      `Motif : ${params.motif}${params.commentaire ? ` — ${params.commentaire}` : ''}`,
      `Du ${params.date_debut} au ${params.date_fin}.`,
      impactes.length > 0
        ? `${impactes.length} créneau(x) de garde déjà publié(s) seront à réparer ensuite.`
        : `Aucune garde publiée n'est touchée pour l'instant.`,
    ]

    return {
      ok: true,
      proposition: {
        titre: `Déclarer l'absence de ${trouve.veto.prenom}`,
        phrase: `Voici l'absence que je déclarerais pour ${trouve.veto.prenom} ${trouve.veto.nom}.`,
        lignes,
        action: 'Déclarer l’absence',
        avertissement:
          'Le planning n’est pas modifié par cette action. Les gardes déjà publiées touchées resteront affichées telles quelles tant que tu n’auras pas choisi un remplaçant ou lancé un appel aux volontaires.',
      },
      charge: {
        veterinaire_id: trouve.veto.id,
        date_debut: params.date_debut,
        date_fin: params.date_fin,
        motif: params.motif,
        commentaire: params.commentaire ?? null,
      },
    }
  },

  async executer(_params, ctx, charge) {
    const c = charge as
      | { veterinaire_id: string; date_debut: string; date_fin: string; motif: MotifAbsence; commentaire: string | null }
      | undefined
    if (!c) return { error: 'Rien à déclarer.' }

    const { error } = await ctx.supabase.from('absences').insert({
      cabinet_id: ctx.cabinetId,
      veterinaire_id: c.veterinaire_id,
      date_debut: c.date_debut,
      date_fin: c.date_fin,
      motif: c.motif,
      commentaire: c.commentaire,
      statut: 'active',
      declaree_par: ctx.vetoId,
    })

    return error ? { error: `Erreur lors de la déclaration de l'absence : ${error.message}` } : {}
  },
}

const ParamsAppelVolontaires = z.object({
  prenom: z.string().describe('Le prénom du vétérinaire absent.'),
  date: z
    .string()
    .optional()
    .describe('Date ISO (AAAA-MM-JJ) de la garde ciblée. Omis = tous les créneaux encore à pourvoir de l’absence.'),
  role: z
    .enum(['premier', 'second'])
    .optional()
    .describe('Le rôle à pourvoir sur cette date (utile seulement si `date` est fourni).'),
})

export const appelerVolontaires: OutilEcriture<typeof ParamsAppelVolontaires> = {
  genre: 'ecriture',
  nom: 'appeler_volontaires',
  description: `Prépare l'envoi d'un email d'appel à volontaires : plutôt que d'imposer un remplaçant, on DEMANDE aux vétérinaires légaux d'un créneau libéré par une absence de se proposer.

Appelle-le quand l'admin veut solliciter l'équipe plutôt que trancher lui-même : « lance un appel aux volontaires pour la garde de vendredi de Fanny », « demande qui peut prendre les gardes restantes de Camille ».

⚠️ Envoie de vrais emails aux vétérinaires concernés — dis-le clairement dans l'avertissement.`,
  params: ParamsAppelVolontaires,
  adminSeulement: true,

  async resumer(params, ctx) {
    const equipe = await chargerEquipeLegere(ctx)
    const trouve = resoudrePrenom(equipe, params.prenom)
    if (!trouve.ok) return { ok: false, raison: trouve.raison }
    if (params.role && !params.date) {
      return { ok: false, raison: 'Précise une date si tu donnes un rôle — sinon je ne sais pas quelle garde viser.' }
    }

    const absence = await trouverAbsenceActive(ctx, trouve.veto.id)
    if (!absence) return { ok: false, raison: `${trouve.veto.prenom} n'a pas d'absence active en ce moment.` }

    const impactesTous = await recenserCreneauxImpactes(
      ctx.supabase,
      ctx.cabinetId,
      trouve.veto.id,
      absence.date_debut,
      absence.date_fin,
    )
    const cibles = impactesTous.filter(
      (i) => (!params.date || i.date === params.date) && (!params.role || i.role === params.role),
    )
    if (cibles.length === 0) {
      return {
        ok: false,
        raison:
          params.date
            ? `Aucune garde du ${params.date} n'est encore à pourvoir pour l'absence de ${trouve.veto.prenom} — elle est peut-être déjà couverte.`
            : `Il n'y a plus aucune garde à pourvoir pour l'absence de ${trouve.veto.prenom}.`,
      }
    }

    const cache = new Map<string, ContexteCrisePeriode>()
    const lignes: string[] = []
    const cibleAEnvoyer: Array<{ gardeId: string; role: 'premier' | 'second' }> = []

    for (const imp of cibles) {
      const periodeCtx = await ctxPeriode(ctx, cache, imp.periodeId)
      const creneau: CreneauCrise = {
        date: imp.date,
        type: imp.typeEngine,
        role: imp.role,
        saison: imp.saison,
        besoinSecond: besoinSecondCreneau(imp.typeEngine, imp.saison, periodeCtx.nbVetosSemaineSoir, periodeCtx.placesNuitSemaine),
      }
      const rep = proposerReparation({
        creneau,
        absentId: trouve.veto.id,
        vets: periodeCtx.vets,
        planningComplet: periodeCtx.planningComplet,
        calendrier: periodeCtx.calendrier,
        structure: periodeCtx.structure,
        equityWeights: periodeCtx.equityWeights,
        roleAvantageFinancier: periodeCtx.roleAvantageFinancier,
        contexteAnterieur: periodeCtx.contexteAnterieur,
      })
      if (rep.candidats.length === 0) {
        lignes.push(`${imp.date} (${imp.role === 'premier' ? '1er' : '2nd'}) : personne à appeler légalement — à traiter à la main.`)
        continue
      }
      const noms = rep.candidats.map((c) => equipe.find((v) => v.id === c.vetId)?.prenom ?? c.vetId).join(', ')
      lignes.push(`${imp.date} (${imp.role === 'premier' ? '1er' : '2nd'}) : appel envoyé à ${noms}.`)
      // imp.role est de type moteur RoleGarde (= string) mais recenserCreneauxImpactes
      // ne le remplit jamais qu'avec 'premier' ou 'second' (cf. contexte.ts) — cast sûr.
      cibleAEnvoyer.push({ gardeId: imp.gardeId, role: imp.role as 'premier' | 'second' })
    }

    if (cibleAEnvoyer.length === 0) {
      return { ok: false, raison: 'Aucun vétérinaire ne peut légalement couvrir ces créneaux — rien à envoyer.' }
    }

    return {
      ok: true,
      proposition: {
        titre: `Appel aux volontaires — absence de ${trouve.veto.prenom}`,
        phrase: `Voici l'appel que j'enverrais pour les gardes de ${trouve.veto.prenom}.`,
        lignes,
        action: 'Envoyer l’appel',
        avertissement:
          'Un email part immédiatement vers chaque vétérinaire nommé ci-dessus, avec un lien pour prendre le créneau. Cette action ne peut pas être annulée une fois envoyée.',
      },
      charge: { prenomAbsent: trouve.veto.prenom, cibles: cibleAEnvoyer },
    }
  },

  async executer(_params, ctx, charge) {
    const c = charge as { prenomAbsent: string; cibles: Array<{ gardeId: string; role: 'premier' | 'second' }> } | undefined
    if (!c || c.cibles.length === 0) return { error: 'Rien à envoyer.' }

    const equipe = await chargerEquipeLegere(ctx)
    const trouve = resoudrePrenom(equipe, c.prenomAbsent)
    if (!trouve.ok) return { error: trouve.raison }

    const absence = await trouverAbsenceActive(ctx, trouve.veto.id)
    if (!absence) return { error: `${trouve.veto.prenom} n'a plus d'absence active.` }

    // Recensement FRAIS : entre le résumé et le clic, une garde a pu être
    // réparée par ailleurs — on ne renvoie jamais un appel pour une garde déjà
    // couverte (même logique que POST /api/absences/[id]/appel-volontaires).
    const impactes = await recenserCreneauxImpactes(
      ctx.supabase,
      ctx.cabinetId,
      trouve.veto.id,
      absence.date_debut,
      absence.date_fin,
    )

    const cache = new Map<string, ContexteCrisePeriode>()
    let envoyes = 0
    let erreurs = 0

    for (const cible of c.cibles) {
      const imp = impactes.find((i) => i.gardeId === cible.gardeId && i.role === cible.role)
      if (!imp) continue // déjà pourvue entre-temps

      const periodeCtx = await ctxPeriode(ctx, cache, imp.periodeId)
      const creneau: CreneauCrise = {
        date: imp.date,
        type: imp.typeEngine,
        role: imp.role,
        saison: imp.saison,
        besoinSecond: besoinSecondCreneau(imp.typeEngine, imp.saison, periodeCtx.nbVetosSemaineSoir, periodeCtx.placesNuitSemaine),
      }
      const rep = proposerReparation({
        creneau,
        absentId: trouve.veto.id,
        vets: periodeCtx.vets,
        planningComplet: periodeCtx.planningComplet,
        calendrier: periodeCtx.calendrier,
        structure: periodeCtx.structure,
        equityWeights: periodeCtx.equityWeights,
        roleAvantageFinancier: periodeCtx.roleAvantageFinancier,
        contexteAnterieur: periodeCtx.contexteAnterieur,
      })
      const candidatIds = rep.candidats.map((cand) => cand.vetId)
      if (candidatIds.length === 0) continue

      const { sent, errors } = await sendAppelVolontaires(
        ctx.supabase,
        candidatIds,
        // role vient de `cible` (déjà 'premier' | 'second' littéral), pas de imp.role
        // (RoleGarde = string côté moteur) — même choix que la route HTTP.
        { gardeId: imp.gardeId, date: imp.date, type: imp.type, role: cible.role },
        { id: absence.id, veterinaire_id: trouve.veto.id },
      )
      envoyes += sent
      erreurs += errors
    }

    if (envoyes === 0) {
      return { error: 'Aucun email envoyé : les créneaux visés sont déjà couverts ou sans candidat légal.' }
    }
    return erreurs > 0 ? { error: `${envoyes} email(s) envoyé(s), ${erreurs} en échec (voir le journal des e-mails).` } : {}
  },
}

/** Une décision de remplacement, telle que l'aperçu et l'exécution la portent. */
interface DecisionReparation {
  gardeId: string
  role: RoleGarde
  remplacant_id: string
}

// La traduction « décisions → changements de garde » vit désormais dans
// `lib/crise/changements.ts` : l'écran de crise en avait besoin lui aussi
// (T-006), et recopier un contrôle plutôt que le partager est précisément ce
// qui avait produit les gardiens divergents du 22/08.

const ParamsReparer = z.object({
  prenom: z.string().describe('Le prénom du vétérinaire absent dont on répare le planning.'),
  decisions: z
    .array(
      z.object({
        date: z.string().describe('Date ISO (AAAA-MM-JJ) de la garde à réparer.'),
        role: z.enum(['premier', 'second']).describe('Le rôle libéré sur cette garde.'),
        prenom_remplacant: z.string().describe('Le prénom du vétérinaire qui prend le relais.'),
      }),
    )
    .min(1)
    .describe('Une ou plusieurs décisions de remplacement pour les gardes touchées par l’absence.'),
})

export const reparerAbsence: OutilEcriture<typeof ParamsReparer> = {
  genre: 'ecriture',
  nom: 'reparer_absence',
  description: `Prépare l'application de remplacements CHOISIS par l'admin pour réparer le planning suite à une absence — par opposition à un appel aux volontaires, ici l'admin IMPOSE qui remplace qui.

Appelle-le quand l'admin nomme directement un remplaçant : « mets Camille à la place de Fanny vendredi », « pour l'absence de Fanny, fais remplacer par Julien mercredi et par Camille jeudi ».

Chaque remplacement est revérifié LÉGAL (mêmes règles que la génération du planning) avant d'être proposé — si ce n'est pas légal, l'outil refuse et explique pourquoi plutôt que de proposer un bouton qui échouerait.`,
  params: ParamsReparer,
  adminSeulement: true,

  async resumer(params, ctx) {
    const equipe = await chargerEquipeLegere(ctx)
    const absent = resoudrePrenom(equipe, params.prenom)
    if (!absent.ok) return { ok: false, raison: absent.raison }

    const absence = await trouverAbsenceActive(ctx, absent.veto.id)
    if (!absence) return { ok: false, raison: `${absent.veto.prenom} n'a pas d'absence active à réparer.` }

    const impactes = await recenserCreneauxImpactes(
      ctx.supabase,
      ctx.cabinetId,
      absent.veto.id,
      absence.date_debut,
      absence.date_fin,
    )

    const cache = new Map<string, ContexteCrisePeriode>()
    const resolues: Array<{ gardeId: string; role: RoleGarde; remplacant_id: string }> = []
    const lignes: string[] = []

    for (const dec of params.decisions) {
      const imp = impactes.find((i) => i.date === dec.date && i.role === dec.role)
      if (!imp) {
        return {
          ok: false,
          raison: `Aucune garde du ${dec.date} (${dec.role}) n'est à réparer pour l'absence de ${absent.veto.prenom} — elle est peut-être déjà couverte, ou hors période d'absence.`,
        }
      }

      const remplacant = resoudrePrenom(equipe, dec.prenom_remplacant)
      if (!remplacant.ok) return { ok: false, raison: remplacant.raison }
      if (remplacant.veto.id === absent.veto.id) {
        return {
          ok: false,
          raison: `${remplacant.veto.prenom} est le vétérinaire absent : il ne peut pas se remplacer lui-même.`,
        }
      }

      const periodeCtx = await ctxPeriode(ctx, cache, imp.periodeId)
      const creneau: CreneauCrise = {
        date: imp.date,
        type: imp.typeEngine,
        role: imp.role,
        saison: imp.saison,
        besoinSecond: besoinSecondCreneau(imp.typeEngine, imp.saison, periodeCtx.nbVetosSemaineSoir, periodeCtx.placesNuitSemaine),
      }
      const resultat = proposerReparation({
        creneau,
        absentId: absent.veto.id,
        vets: periodeCtx.vets,
        planningComplet: periodeCtx.planningComplet,
        calendrier: periodeCtx.calendrier,
        structure: periodeCtx.structure,
        equityWeights: periodeCtx.equityWeights,
        roleAvantageFinancier: periodeCtx.roleAvantageFinancier,
        contexteAnterieur: periodeCtx.contexteAnterieur,
      })
      const legal = resultat.candidats.some((c) => c.vetId === remplacant.veto.id)
      if (!legal) {
        const regles = resultat.diagnostic?.reglesEnCause?.map((r) => r.libelle).filter(Boolean).join(', ')
        return {
          ok: false,
          raison: `${remplacant.veto.prenom} ne peut pas légalement prendre la garde du ${dec.date} (${dec.role})${regles ? ` : ${regles}` : ''}.`,
        }
      }

      resolues.push({ gardeId: imp.gardeId, role: dec.role, remplacant_id: remplacant.veto.id })
      lignes.push(
        `${dec.date} (${dec.role === 'premier' ? '1er' : '2nd'}) : ${remplacant.veto.prenom} remplace ${absent.veto.prenom}.`,
      )
    }

    // ── Garde-fou RÈGLES DURES — le MÊME que l'édition manuelle ──
    //
    // `proposerReparation` ci-dessus n'interroge qu'UN des deux juges du projet :
    // `isValid`, celui du solver. L'autre — `validerPlanning`, celui de la
    // publication — n'avait jamais été consulté sur ce chemin, alors que ces
    // deux-là ont déjà divergé (c'est l'incident fondateur). On le consulte donc
    // ici, et on ne remonte que le DELTA introduit par CES remplacements.
    //
    // FILOU ANNONCE, IL NE CONTOURNE NI NE DÉCIDE. Principe fondamental du
    // projet : le moteur et les garde-fous décident, Filou est le porte-parole.
    // Les règles enfreintes partent donc dans la PROPOSITION, en français, sous
    // les yeux de l'admin AVANT son clic — jamais dans un silence poli, jamais
    // en refusant à la place du moteur (le validateur, lui, n'interdit pas).
    const changements = await changementsPourDecisions(ctx.supabase, ctx.cabinetId, resolues)
    const avertissements = await avertissementsReglesDuresMultiPeriodes(
      ctx.supabase,
      ctx.cabinetId,
      changements,
    )

    const avertissementBase =
      'Chaque vétérinaire remplaçant reçoit un email de confirmation. Si toutes les gardes de l’absence sont couvertes après cette action, l’absence passera au statut « résolue ».'

    return {
      ok: true,
      proposition: {
        titre: `Réparer le planning de ${absent.veto.prenom}`,
        phrase: `Voici les remplacements que j'appliquerais pour l'absence de ${absent.veto.prenom}.`,
        lignes: avertissements.length > 0
          ? [...lignes, '', 'Ce que ces remplacements enfreignent :', ...avertissements]
          : lignes,
        action: 'Appliquer les remplacements',
        avertissement: avertissements.length > 0
          ? `Ces remplacements enfreignent ${avertissements.length === 1 ? 'une règle du cabinet' : `${avertissements.length} règles du cabinet`} (détail ci-dessus). Ils restent applicables — c'est toi qui tranches. ${avertissementBase}`
          : avertissementBase,
      },
      charge: {
        absenceId: absence.id,
        absentId: absent.veto.id,
        decisions: resolues,
        // Ce qui a été MONTRÉ. L'exécution recalcule et compare : si le planning
        // a bougé entre-temps et qu'une règle de plus serait enfreinte, on
        // n'écrit pas en douce quelque chose que l'admin n'a pas vu.
        avertissements,
      },
    }
  },

  async executer(_params, ctx, charge) {
    const c = charge as
      | {
          absenceId: string
          absentId: string
          decisions: DecisionReparation[]
          avertissements?: string[]
        }
      | undefined
    if (!c || c.decisions.length === 0) return { error: 'Rien à appliquer.' }
    const dejaMontres = new Set(c.avertissements ?? [])

    // Tout est revalidé ici, à froid — jamais confiance en la légalité déjà
    // vue au résumé : le planning a pu changer entre les deux (autre décision
    // appliquée, garde reprise par ailleurs).
    const { data: absenceRow, error: absErr } = await ctx.supabase
      .from('absences')
      .select('id, date_debut, date_fin, statut')
      .eq('id', c.absenceId)
      .single()
    // On distingue « elle n'existe plus » (la base a répondu) de « la base n'a
    // pas répondu » : la première phrase est un fait, la seconde une panne, et
    // les confondre enverrait l'admin chercher une absence supprimée par
    // quelqu'un d'autre.
    if (absErr && absErr.code !== 'PGRST116') {
      return { error: `Je n'ai pas pu relire cette absence : la base de données n'a pas répondu (${absErr.message}). Rien n'a été modifié — réessaie dans un instant.` }
    }
    if (!absenceRow) return { error: "Cette absence n'existe plus." }
    if (absenceRow.statut === 'annulee') return { error: 'Cette absence est annulée.' }

    const impactes = await recenserCreneauxImpactes(
      ctx.supabase,
      ctx.cabinetId,
      c.absentId,
      absenceRow.date_debut,
      absenceRow.date_fin,
    )
    // ── Garde-fou RÈGLES DURES, rejoué À FROID ──
    //
    // L'admin a cliqué sur une proposition qui affichait N règles enfreintes. Le
    // planning a pu bouger depuis. On recalcule donc, et on refuse d'écrire si
    // le geste enfreint désormais quelque chose qui n'était PAS sous ses yeux :
    // afficher A et écrire B est précisément ce que la `charge` existe pour
    // empêcher. Une règle qui a DISPARU entre-temps, elle, ne bloque rien.
    //
    // Filou annonce et se range derrière le moteur ; il ne décide ni de passer
    // outre, ni d'interdire — il renvoie la main à l'admin.
    const changementsAFroid = await changementsPourDecisions(
      ctx.supabase,
      ctx.cabinetId,
      c.decisions,
    )
    const avertissementsAFroid = await avertissementsReglesDuresMultiPeriodes(
      ctx.supabase,
      ctx.cabinetId,
      changementsAFroid,
    )
    const nouveaux = avertissementsAFroid.filter((a) => !dejaMontres.has(a))
    if (nouveaux.length > 0) {
      return {
        error:
          `Le planning a changé depuis ma proposition : ces remplacements enfreindraient maintenant ${nouveaux.length === 1 ? 'une règle' : `${nouveaux.length} règles`} que je ne t'avais pas montrée${nouveaux.length === 1 ? '' : 's'} — ${nouveaux.join(' ')} Redemande-moi la réparation pour que je te la${nouveaux.length === 1 ? '' : 'les'} présente avant d'appliquer.`,
      }
    }

    const cache = new Map<string, ContexteCrisePeriode>()

    for (const dec of c.decisions) {
      const imp = impactes.find((i) => i.gardeId === dec.gardeId && i.role === dec.role)
      if (!imp) return { error: `La garde du ${dec.gardeId} n'est plus à réparer (déjà couverte entre-temps).` }

      const periodeCtx = await ctxPeriode(ctx, cache, imp.periodeId)
      const creneau: CreneauCrise = {
        date: imp.date,
        type: imp.typeEngine,
        role: imp.role,
        saison: imp.saison,
        besoinSecond: besoinSecondCreneau(imp.typeEngine, imp.saison, periodeCtx.nbVetosSemaineSoir, periodeCtx.placesNuitSemaine),
      }
      const resultat = proposerReparation({
        creneau,
        absentId: c.absentId,
        vets: periodeCtx.vets,
        planningComplet: periodeCtx.planningComplet,
        calendrier: periodeCtx.calendrier,
        structure: periodeCtx.structure,
        equityWeights: periodeCtx.equityWeights,
        roleAvantageFinancier: periodeCtx.roleAvantageFinancier,
        contexteAnterieur: periodeCtx.contexteAnterieur,
      })
      if (!resultat.candidats.some((cand) => cand.vetId === dec.remplacant_id)) {
        return { error: `Le remplacement du ${imp.date} n'est plus légal (le planning a changé entre-temps).` }
      }

      const { data: gardeActuelle, error: gardeErr } = await ctx.supabase
        .from('gardes')
        .select('id, premier_id, second_id')
        .eq('id', dec.gardeId)
        .eq('cabinet_id', ctx.cabinetId)
        .single()
      if (gardeErr && gardeErr.code !== 'PGRST116') {
        return { error: `Je n'ai pas pu relire la garde du ${imp.date} : la base de données n'a pas répondu (${gardeErr.message}). Réessaie dans un instant.` }
      }
      if (!gardeActuelle) return { error: `Garde ${dec.gardeId} introuvable.` }

      const premier_id = dec.role === 'premier' ? dec.remplacant_id : gardeActuelle.premier_id
      const second_id = dec.role === 'second' ? dec.remplacant_id : gardeActuelle.second_id

      // Même cycle PARTAGÉ que PATCH /api/gardes/[id] : update + audit + bilan +
      // agenda + email. force:true car le planning est publié/verrouillé.
      const appRes = await appliquerChangementGarde({
        supabase: ctx.supabase,
        gardeId: dec.gardeId,
        premier_id,
        second_id,
        force: true,
        auteurVetId: ctx.vetoId,
        cabinetId: ctx.cabinetId,
      })
      if (!appRes.ok) return { error: `Échec de l'application sur la garde du ${imp.date} : ${appRes.error}` }

      // Trace d'une écriture faite MALGRÉ des règles enfreintes : l'admin avait
      // la liste sous les yeux, sa décision doit rester retrouvable.
      if (avertissementsAFroid.length > 0) {
        await tracerConfirmationMalgreAvertissement(ctx.supabase, {
          gardeId: dec.gardeId,
          chemin: 'filou-reparer-absence',
          auteurVetId: ctx.vetoId,
          avertissements: avertissementsAFroid,
          avant: {
            premier_id: gardeActuelle.premier_id,
            second_id: gardeActuelle.second_id,
          },
          apres: { premier_id, second_id },
          contexte: { absence_id: c.absenceId, role: dec.role },
        })
      }

      const { error: compErr } = await ctx.supabase.from('compensations').insert({
        cabinet_id: ctx.cabinetId,
        absence_id: c.absenceId,
        garde_id: dec.gardeId,
        remplacant_id: dec.remplacant_id,
        remplace_id: c.absentId,
        role: dec.role,
        statut: 'a_compenser',
      })
      if (compErr) {
        return {
          error: `Garde du ${imp.date} modifiée mais trace de compensation non écrite : ${compErr.message}`,
        }
      }
    }

    // L'absence est-elle entièrement réparée ? Même calcul que la route.
    // ⚠️ CE BLOC EST LE PLUS TRAÎTRE DU FICHIER : les gardes sont déjà écrites,
    // et ce qui suit décide seulement si l'absence bascule en « résolue ».
    //
    // Avant, les deux échecs possibles étaient muets, et le symptôme était le
    // même par les deux chemins : Filou annonçait « c'est réglé » sur une
    // absence restée ACTIVE. Une lecture ratée rendait `couverts` vide, donc
    // `tousCouverts` faux, donc pas de bascule ; et l'update lui-même ne
    // regardait pas son erreur.
    //
    // On ne lève pas : les remplacements, eux, ont bien eu lieu. On le DIT, ce
    // qui laisse à l'admin de quoi comprendre pourquoi l'absence reste ouverte.
    const { data: compsExistantes, error: compsErr } = await ctx.supabase
      .from('compensations')
      .select('garde_id, role')
      .eq('absence_id', c.absenceId)
      .eq('cabinet_id', ctx.cabinetId)
      .neq('statut', 'annulee')
    if (compsErr) {
      return {
        error: `Les remplacements ont bien été enregistrés, mais je n'ai pas pu vérifier si l'absence est entièrement couverte (${compsErr.message}) : elle reste marquée « active ». Rouvre-la pour la clore à la main.`,
      }
    }

    const couverts = new Set(
      ((compsExistantes ?? []) as { garde_id: string; role: string | null }[]).map(
        (cp) => `${cp.garde_id}|${cp.role ?? ''}`,
      ),
    )
    const tousCouverts = impactes.every((i) => couverts.has(`${i.gardeId}|${i.role}`))
    if (tousCouverts && impactes.length > 0) {
      const { error: cloreErr } = await ctx.supabase
        .from('absences')
        .update({ statut: 'resolue' })
        .eq('id', c.absenceId)
        .eq('cabinet_id', ctx.cabinetId)
      if (cloreErr) {
        return {
          error: `Les remplacements ont bien été enregistrés, mais l'absence n'a pas pu être marquée comme résolue (${cloreErr.message}) : elle reste « active ». Referme-la depuis la fiche de l'absence.`,
        }
      }
    }

    return {}
  },
}

const ParamsMarquerCompensation = z.object({
  prenom_remplacant: z.string().describe('Le prénom du vétérinaire qui a dépanné.'),
  date: z.string().describe('Date ISO (AAAA-MM-JJ) de la garde dépannée.'),
  role: z.enum(['premier', 'second']).optional().describe('Le rôle dépanné, si plusieurs correspondent à la même date.'),
  nouveau_statut: z
    .enum(['a_compenser', 'compensee', 'annulee'])
    .describe('a_compenser = la dette reste due ; compensee = elle a été rendue ; annulee = elle ne compte plus.'),
})

export const marquerCompensation: OutilEcriture<typeof ParamsMarquerCompensation> = {
  genre: 'ecriture',
  nom: 'marquer_compensation',
  description: `Prépare un changement de statut sur une dette de dépannage (compensation) : marquer une garde dépannée comme rendue, ou annuler une dette qui ne tient plus.

Appelle-le quand l'admin règle un dépannage : « la garde que Camille a couverte pour Fanny le 12, elle l'a rendue », « annule la compensation de Julien du 3 mars ».`,
  params: ParamsMarquerCompensation,
  adminSeulement: true,

  async resumer(params, ctx) {
    const reponseComps = await ctx.supabase.from('compensations').select(
      `id, role, statut,
       garde:gardes ( date, type ),
       remplacant:veterinaires!compensations_remplacant_id_fkey ( prenom, nom ),
       remplace:veterinaires!compensations_remplace_id_fkey ( prenom )`,
    )

    interface Ligne {
      id: string
      role: RoleGarde | null
      statut: StatutCompensation
      garde: { date: string; type: string } | null
      remplacant: { prenom: string; nom: string } | null
      remplace: { prenom: string } | null
    }

    // Sans cette lecture contrôlée, une panne donnait zéro candidat et donc la
    // phrase « Aucun dépannage de X trouvé pour la garde du … » — un fait,
    // affirmé sur une base qui n'avait rien dit.
    const candidates = lignesLues<Ligne>(reponseComps, 'les dépannages du cabinet').filter(
      (l) =>
        l.garde?.date === params.date &&
        l.remplacant &&
        memeNom(l.remplacant.prenom, params.prenom_remplacant) &&
        (!params.role || l.role === params.role),
    )

    if (candidates.length === 0) {
      return {
        ok: false,
        raison: `Aucun dépannage de ${params.prenom_remplacant} trouvé pour la garde du ${params.date}.`,
      }
    }
    if (candidates.length > 1) {
      return {
        ok: false,
        raison: `Plusieurs dépannages de ${params.prenom_remplacant} correspondent au ${params.date} (1er et 2nd) — précise le rôle.`,
      }
    }

    const ligne = candidates[0]
    if (ligne.statut === params.nouveau_statut) {
      return {
        ok: false,
        raison: `Ce dépannage est déjà au statut « ${LIBELLES_STATUT_COMPENSATION[params.nouveau_statut]} ».`,
      }
    }

    return {
      ok: true,
      proposition: {
        titre: 'Changer le statut du dépannage',
        phrase: `${ligne.remplacant?.prenom} a dépanné ${ligne.remplace?.prenom ?? 'un confrère'} le ${params.date}.`,
        lignes: [
          `Statut : ${LIBELLES_STATUT_COMPENSATION[ligne.statut]} → ${LIBELLES_STATUT_COMPENSATION[params.nouveau_statut]}`,
        ],
        action: 'Changer le statut',
      },
      charge: { id: ligne.id },
    }
  },

  async executer(params, _ctx, charge) {
    const c = charge as { id: string } | undefined
    if (!c) return { error: 'Rien à changer.' }

    // Vraie action serveur de l'écran Dépannages — mêmes gardes admin, même RLS.
    const res = await changerStatutCompensationAction(c.id, params.nouveau_statut)
    return res.error ? { error: res.error } : {}
  },
}
