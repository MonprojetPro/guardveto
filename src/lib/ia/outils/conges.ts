// ============================================================
// GUARDVETO — Outils de Filou : congés et souhaits
// ============================================================
// SERVER-ONLY. Filou pouvait déjà lire l'équipe et les règles ; il ne voyait
// pas les congés. Une question banale comme « pourquoi Manon n'a pas de garde
// la semaine du 12 ? » restait sans réponse alors que la donnée existe — un
// congé validé, tout simplement.
//
// PIÈGE À NE PAS REPRODUIRE ICI (cf. equipe.ts) : le modèle ne manipule que
// des PRÉNOMS et des DATES ISO, jamais un UUID de congé. La résolution
// prénom+dates → ligne `conges` se fait dans ce fichier, sur la donnée réelle
// du cabinet, et refuse net dès qu'elle est ambiguë — mieux vaut redemander
// que modifier ou supprimer le mauvais congé.
//
// SÉCURITÉ — deux niveaux, et ils ne se recouvrent pas complètement :
//   • RLS (base) : un vétérinaire non-admin ne LIT que ses propres congés, et
//     ne peut modifier/supprimer que ses propres SOUHAITS (statut='souhait').
//     Valider/refuser reste une opération 100% admin (`conges_admin_all`).
//   • Ce fichier (UX) : au lieu de laisser la RLS échouer silencieusement (0
//     ligne renvoyée, ou update sans effet), on vérifie le rôle AVANT et on
//     répond une phrase claire — sinon Filou dirait « c'est fait » alors que
//     rien n'a bougé.
// ============================================================

import { z } from 'zod'
import {
  createConge,
  deleteConge,
  refuserConge as refuserCongeAction,
  validerConge as validerCongeAction,
} from '@/app/(protected)/conges/actions'
import { detecterConflitPlanningPublie } from '@/lib/conges/detection-conflit'
import { lignesLues } from './lecture'
import { SANS_PARAMETRE, type ContexteOutil, type OutilEcriture, type OutilLecture } from './types'

// ── Vocabulaire commun : les mêmes mots que l'écran Congés ─────

const TYPE_HUMAIN: Record<string, string> = {
  vacances: 'vacances',
  formation: 'formation',
  sante: 'santé',
  autre: 'autre',
  indisponibilite: 'indisponibilité',
}

const CRENEAU_HUMAIN: Record<string, string> = {
  matin: 'matin',
  'apres-midi': 'après-midi',
  soiree: 'soirée',
  journee: 'journée entière',
}

const STATUT_HUMAIN: Record<string, string> = {
  souhait: 'souhait en attente',
  valide: 'validé',
  refuse: 'refusé',
}

function creneauHumain(creneau: string | null): string {
  return creneau ? (CRENEAU_HUMAIN[creneau] ?? creneau) : CRENEAU_HUMAIN.journee
}

// ── Chargement + résolution (dupliqué à dessein depuis equipe.ts : ce
//    fichier ne doit toucher à aucun autre) ─────────────────────

interface FicheVetoLegere {
  id: string
  prenom: string
  nom: string
}

interface CongeDb {
  id: string
  veterinaire_id: string
  date_debut: string
  date_fin: string
  type: string
  creneau: string | null
  statut: string
  commentaire: string | null
  raison_refus: string | null
  created_at: string
}

async function chargerEquipeLegere(ctx: ContexteOutil): Promise<FicheVetoLegere[]> {
  return lignesLues<FicheVetoLegere>(
    await ctx.supabase.from('veterinaires').select('id, prenom, nom').order('prenom'),
    "la liste de l'équipe",
  )
}

async function chargerConges(ctx: ContexteOutil): Promise<CongeDb[]> {
  // RLS fait déjà le premier tri : un non-admin ne reçoit ici que ses propres
  // lignes, quels que soient les filtres appliqués ensuite dans ce fichier.
  return lignesLues<CongeDb>(
    await ctx.supabase
      .from('conges')
      .select(
        'id, veterinaire_id, date_debut, date_fin, type, creneau, statut, commentaire, raison_refus, created_at',
      )
      .order('date_debut'),
    'les congés du cabinet',
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

function resoudreVeto(
  equipe: FicheVetoLegere[],
  prenom: string,
): { ok: true; veto: FicheVetoLegere } | { ok: false; raison: string } {
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

/** Retrouve LE congé désigné par un prénom + des dates exactes, parmi les
 *  statuts autorisés pour l'action demandée. Refuse s'il y en a 0 ou plus
 *  d'1 — un congé n'a pas de petit numéro affiché comme les règles, les
 *  dates ISO exactes sont le seul identifiant sûr qu'on puisse demander au
 *  modèle sans lui faire manipuler un UUID. */
function resoudreConge(
  conges: CongeDb[],
  veto: FicheVetoLegere,
  dateDebut: string,
  dateFin: string,
  statutsAutorises: string[],
): { ok: true; conge: CongeDb } | { ok: false; raison: string } {
  const candidats = conges.filter(
    (c) => c.veterinaire_id === veto.id && c.date_debut === dateDebut && c.date_fin === dateFin,
  )
  if (candidats.length === 0) {
    return {
      ok: false,
      raison: `Aucun congé de ${veto.prenom} ne commence le ${dateDebut} et ne finit le ${dateFin}. Vérifie les dates exactes avec lister_conges.`,
    }
  }
  const autorises = candidats.filter((c) => statutsAutorises.includes(c.statut))
  if (autorises.length === 0) {
    return {
      ok: false,
      raison: `Le congé de ${veto.prenom} du ${dateDebut} au ${dateFin} est déjà « ${STATUT_HUMAIN[candidats[0].statut] ?? candidats[0].statut} » — cette action ne s'applique pas à cet état.`,
    }
  }
  // Deux congés distincts partageant EXACTEMENT les mêmes dates pour la même
  // personne n'existent normalement pas (l'écran Congés ne le permet pas),
  // mais on refuse quand même plutôt que d'agir sur le premier venu.
  if (autorises.length > 1) {
    return {
      ok: false,
      raison: `Plusieurs congés de ${veto.prenom} correspondent au ${dateDebut} → ${dateFin}. Regarde lister_conges pour les distinguer.`,
    }
  }
  return { ok: true, conge: autorises[0] }
}

/** Avertissement de chevauchement avec un planning déjà publié — LE piège de
 *  ce domaine (cf. cas « Antoine »). `createConge`/`validerConge` savent le
 *  détecter, mais seulement APRÈS écriture, et `OutilEcriture.executer` ne
 *  peut renvoyer qu'une erreur — pas un avertissement en cas de succès. La
 *  seule façon de prévenir la personne AVANT qu'elle valide, c'est de courir
 *  la même détection ici, en lecture seule, pendant `resumer`. */
async function avertissementConflit(
  ctx: ContexteOutil,
  veterinaireId: string,
  dateDebut: string,
  dateFin: string,
): Promise<string | undefined> {
  const { aConflit, creneauxImpactes } = await detecterConflitPlanningPublie({
    supabase: ctx.supabase,
    cabinetId: ctx.cabinetId,
    veterinaireId,
    dateDebut,
    dateFin,
  })
  if (!aConflit) return undefined
  const dates = creneauxImpactes.map((c) => c.date).join(', ')
  return `⚠️ Cette période chevauche ${creneauxImpactes.length > 1 ? 'des gardes déjà publiées' : 'une garde déjà publiée'} (${dates}). Le planning ne sera pas corrigé automatiquement — il faudra le réparer à part.`
}

// ── Lecture ─────────────────────────────────────────────────

const ParamsLister = z.object({
  prenom: z
    .string()
    .optional()
    .describe('Pour ne garder que les congés de ce vétérinaire. Laisse vide pour tout voir.'),
  depuis: z
    .string()
    .optional()
    .describe('Date ISO (AAAA-MM-JJ) : ne garde que les congés qui se terminent à partir de cette date.'),
  jusqua: z
    .string()
    .optional()
    .describe('Date ISO (AAAA-MM-JJ) : ne garde que les congés qui commencent avant cette date.'),
})

export const lireConges: OutilLecture<typeof ParamsLister> = {
  genre: 'lecture',
  nom: 'lire_conges',
  description: `Donne les congés, formations, indisponibilités et souhaits du cabinet : qui, du combien au combien, sur quel créneau (journée entière, matin, après-midi, soirée), quel type, et où ça en est (souhait en attente, validé, refusé — avec le motif si refusé).

Appelle-le pour toute question sur les absences : « Manon est en congé quand ? », « qui est absent la semaine du 12 ? », « pourquoi X n'a pas de garde cette semaine-là ? ». Filtrable par prénom et par plage de dates ; laisse les deux vides pour tout voir.

Si tu n'es pas administrateur, tu ne verras ici que TES propres congés, même en filtrant sur un autre prénom — c'est une restriction du logiciel, pas une absence de données.`,
  params: ParamsLister,

  async executer(params, ctx) {
    const [equipe, conges] = await Promise.all([chargerEquipeLegere(ctx), chargerConges(ctx)])
    const prenoms = new Map(equipe.map((v) => [v.id, v.prenom]))

    let cible: FicheVetoLegere | null = null
    if (params.prenom) {
      const trouve = resoudreVeto(equipe, params.prenom)
      if (!trouve.ok) return { erreur: trouve.raison }
      cible = trouve.veto

      // Court-circuit AVANT d'interroger `conges` : la RLS filtre déjà les
      // lignes à un non-admin, donc filtrer sur un collègue produirait une
      // liste vide — indistinguable de « ce collègue n'a aucun congé ». Sans
      // ce refus explicite, seule la description de l'outil empêchait Filou
      // d'affirmer un vide comme une réponse ; c'est le code qui doit porter
      // cette garantie, pas la mémoire du modèle.
      if (!ctx.estAdmin && cible.id !== ctx.vetoId) {
        return {
          erreur: `Tu n'es pas administrateur : tu ne peux voir que tes propres congés, pas ceux de ${cible.prenom}.`,
        }
      }
    }

    const filtres = conges.filter((c) => {
      if (cible && c.veterinaire_id !== cible.id) return false
      // Chevauchement d'intervalle, pas égalité stricte : un congé qui déborde
      // légèrement la plage demandée doit quand même apparaître.
      if (params.depuis && c.date_fin < params.depuis) return false
      if (params.jusqua && c.date_debut > params.jusqua) return false
      return true
    })

    return {
      nombre: filtres.length,
      conges: filtres.map((c) => ({
        prenom: prenoms.get(c.veterinaire_id) ?? 'un vétérinaire',
        date_debut: c.date_debut,
        date_fin: c.date_fin,
        type: TYPE_HUMAIN[c.type] ?? c.type,
        creneau: creneauHumain(c.creneau),
        statut: STATUT_HUMAIN[c.statut] ?? c.statut,
        motif_refus: c.statut === 'refuse' ? c.raison_refus : undefined,
        commentaire: c.commentaire || undefined,
      })),
    }
  },
}

export const lireSouhaitsEnAttente: OutilLecture<typeof SANS_PARAMETRE> = {
  genre: 'lecture',
  nom: 'lire_souhaits_en_attente',
  description: `Donne les souhaits de congé encore EN ATTENTE d'une décision, du plus ancien au plus récent — la file que l'admin doit traiter.

Appelle-le pour « qu'est-ce qu'il y a à valider ? », « y a-t-il des demandes en attente ? », « qui attend une réponse pour ses congés ? ». Réservé à l'administrateur : un vétérinaire ne traite pas les demandes des autres.`,
  params: SANS_PARAMETRE,
  adminSeulement: true,

  async executer(_params, ctx) {
    const [equipe, conges] = await Promise.all([chargerEquipeLegere(ctx), chargerConges(ctx)])
    const prenoms = new Map(equipe.map((v) => [v.id, v.prenom]))

    const enAttente = conges
      .filter((c) => c.statut === 'souhait')
      .sort((a, b) => a.created_at.localeCompare(b.created_at))

    return {
      nombre: enAttente.length,
      souhaits: enAttente.map((c) => ({
        prenom: prenoms.get(c.veterinaire_id) ?? 'un vétérinaire',
        date_debut: c.date_debut,
        date_fin: c.date_fin,
        type: TYPE_HUMAIN[c.type] ?? c.type,
        creneau: creneauHumain(c.creneau),
        commentaire: c.commentaire || undefined,
        depose_le: c.created_at,
      })),
    }
  },
}

// ── Écriture : poser un congé / déposer un souhait ──────────

const TYPES_VALIDES = ['vacances', 'formation', 'sante', 'autre', 'indisponibilite'] as const
const CRENEAUX_VALIDES = ['matin', 'apres-midi', 'soiree', 'journee'] as const

const ParamsPoser = z.object({
  prenom: z
    .string()
    .optional()
    .describe(
      'À qui ce congé s’applique. Obligatoire si tu es administrateur. Si tu n’es PAS administrateur, ce champ est ignoré : le congé est toujours posé pour toi-même.',
    ),
  date_debut: z.string().describe('Date ISO (AAAA-MM-JJ) de début.'),
  date_fin: z.string().describe('Date ISO (AAAA-MM-JJ) de fin, incluse. Peut être égale à la date de début.'),
  type: z.enum(TYPES_VALIDES).describe('vacances, formation, sante (raison médicale), autre, ou indisponibilite.'),
  creneau: z
    .enum(CRENEAUX_VALIDES)
    .optional()
    .describe('Laisse vide pour une absence sur la journée entière.'),
  commentaire: z.string().optional().describe('Note libre, visible par l’administrateur.'),
})

export const poserConge: OutilEcriture<typeof ParamsPoser> = {
  genre: 'ecriture',
  nom: 'poser_conge',
  description: `Prépare la pose d'un congé, d'une formation ou d'une indisponibilité.

Appelle-le pour « pose-moi des vacances du... au... », « Manon est en formation la semaine prochaine », « ajoute une indisponibilité pour Antoine le jeudi soir ».

Si tu es administrateur, le congé est enregistré directement VALIDÉ (c'est le comportement de l'écran Congés côté admin) — précise toujours le prénom. Si tu n'es pas administrateur, c'est un SOUHAIT qui attend la validation d'un admin, et il ne peut concerner que toi-même : ignore toute autre personne mentionnée dans la demande et dis-le si la demande visait quelqu'un d'autre.`,
  params: ParamsPoser,

  async resumer(params, ctx) {
    if (params.date_fin < params.date_debut) {
      return { ok: false, raison: 'La date de fin ne peut pas être avant la date de début.' }
    }

    const equipe = await chargerEquipeLegere(ctx)

    let veto: FicheVetoLegere
    if (ctx.estAdmin) {
      if (!params.prenom) {
        return { ok: false, raison: 'Précise pour qui poser ce congé : donne un prénom.' }
      }
      const trouve = resoudreVeto(equipe, params.prenom)
      if (!trouve.ok) return { ok: false, raison: trouve.raison }
      veto = trouve.veto
    } else {
      // Le sujet est FORCÉ sur la personne connectée, quoi qu'elle ait tapé —
      // c'est la garde qui empêche un véto de déposer un souhait au nom d'un
      // collègue (la RLS le bloquerait de toute façon, mais une erreur SQL
      // brute serait une mauvaise réponse à donner ici).
      const soi = equipe.find((v) => v.id === ctx.vetoId)
      if (!soi) return { ok: false, raison: 'Ta fiche vétérinaire est introuvable.' }
      veto = soi
    }

    const statut = ctx.estAdmin ? 'valide' : 'souhait'
    const avertissementBase = ctx.estAdmin
      ? await avertissementConflit(ctx, veto.id, params.date_debut, params.date_fin)
      : undefined

    const lignes = [
      `${params.date_debut} → ${params.date_fin}`,
      `Type : ${TYPE_HUMAIN[params.type]}`,
      `Créneau : ${creneauHumain(params.creneau ?? null)}`,
    ]
    if (params.commentaire) lignes.push(`Commentaire : ${params.commentaire}`)

    return {
      ok: true,
      proposition: {
        titre: ctx.estAdmin ? `Poser un congé pour ${veto.prenom}` : 'Déposer un souhait de congé',
        phrase: ctx.estAdmin
          ? `Ce congé sera enregistré VALIDÉ pour ${veto.prenom} ${veto.nom}.`
          : 'Ce souhait sera envoyé à l’administrateur — il attendra sa validation.',
        lignes,
        action: ctx.estAdmin ? 'Poser ce congé' : 'Déposer le souhait',
        avertissement: avertissementBase,
      },
      charge: { veterinaireId: veto.id, statut },
    }
  },

  async executer(params, ctx, charge) {
    const c = charge as { veterinaireId?: string } | undefined
    if (!c?.veterinaireId) return { error: 'La proposition a été perdue — redemande-la à Filou.' }

    // Revalidation : la fiche visée doit toujours exister dans CE cabinet au
    // moment d'écrire (RLS re-vérifie de toute façon, mais un message clair
    // vaut mieux qu'une erreur SQL si elle a été désactivée entre-temps).
    const equipe = await chargerEquipeLegere(ctx)
    if (!equipe.some((v) => v.id === c.veterinaireId)) {
      return { error: 'Ce vétérinaire n’existe plus dans ce cabinet — redemande la proposition.' }
    }

    const resultat = await createConge(
      {
        veterinaire_id: c.veterinaireId,
        date_debut: params.date_debut,
        date_fin: params.date_fin,
        type: params.type,
        creneau: params.creneau && params.creneau !== 'journee' ? params.creneau : null,
        commentaire: params.commentaire ?? '',
      },
      ctx.vetoId,
      ctx.estAdmin,
    )
    return resultat.error ? { error: resultat.error } : {}
  },
}

// ── Écriture : valider un souhait ───────────────────────────

const ParamsValider = z.object({
  prenom: z.string().describe('Le prénom du vétérinaire dont le souhait doit être validé.'),
  date_debut: z.string().describe('Date ISO (AAAA-MM-JJ) de début du souhait, telle que lire_souhaits_en_attente l’a donnée.'),
  date_fin: z.string().describe('Date ISO (AAAA-MM-JJ) de fin du souhait, telle que lire_souhaits_en_attente l’a donnée.'),
  nouvelle_date_debut: z
    .string()
    .optional()
    .describe('Seulement si la personne demande d’ajuster la date de début en validant.'),
  nouvelle_date_fin: z
    .string()
    .optional()
    .describe('Seulement si la personne demande d’ajuster la date de fin en validant.'),
})

export const validerConge: OutilEcriture<typeof ParamsValider> = {
  genre: 'ecriture',
  nom: 'valider_conge',
  description: `Prépare la validation d'un souhait de congé EN ATTENTE — il devient effectif.

Appelle-le pour « valide le congé de Manon », « accepte sa demande du... au... ». Appelle lire_souhaits_en_attente juste avant si tu n'as pas les dates exactes sous la main. Réservé à l'administrateur.`,
  params: ParamsValider,
  adminSeulement: true,

  async resumer(params, ctx) {
    const [equipe, conges] = await Promise.all([chargerEquipeLegere(ctx), chargerConges(ctx)])
    const trouveVeto = resoudreVeto(equipe, params.prenom)
    if (!trouveVeto.ok) return { ok: false, raison: trouveVeto.raison }

    const trouveConge = resoudreConge(conges, trouveVeto.veto, params.date_debut, params.date_fin, [
      'souhait',
    ])
    if (!trouveConge.ok) return { ok: false, raison: trouveConge.raison }
    const conge = trouveConge.conge

    if (params.nouvelle_date_fin && params.nouvelle_date_debut !== undefined) {
      const debutEffectif = params.nouvelle_date_debut ?? conge.date_debut
      if (params.nouvelle_date_fin < debutEffectif) {
        return { ok: false, raison: 'La nouvelle date de fin ne peut pas être avant la nouvelle date de début.' }
      }
    }

    const debutEffectif = params.nouvelle_date_debut ?? conge.date_debut
    const finEffective = params.nouvelle_date_fin ?? conge.date_fin

    const avertissement = await avertissementConflit(ctx, conge.veterinaire_id, debutEffectif, finEffective)

    const lignes = [`${debutEffectif} → ${finEffective}`, `Type : ${TYPE_HUMAIN[conge.type] ?? conge.type}`]
    if (debutEffectif !== conge.date_debut || finEffective !== conge.date_fin) {
      lignes.push(`Dates ajustées par rapport à la demande initiale (${conge.date_debut} → ${conge.date_fin}).`)
    }

    return {
      ok: true,
      proposition: {
        titre: `Valider le congé de ${trouveVeto.veto.prenom}`,
        phrase: `${trouveVeto.veto.prenom} sera prévenue par e-mail que sa demande est validée.`,
        lignes,
        action: 'Valider',
        avertissement,
      },
      charge: { id: conge.id, debutEffectif, finEffective },
    }
  },

  async executer(_params, ctx, charge) {
    const c = charge as { id?: string; debutEffectif?: string; finEffective?: string } | undefined
    if (!c?.id) return { error: 'La proposition a été perdue — redemande-la à Filou.' }

    const conges = await chargerConges(ctx)
    const conge = conges.find((x) => x.id === c.id)
    if (!conge) return { error: 'Ce congé n’existe plus — redemande la liste des souhaits en attente.' }
    if (conge.statut !== 'souhait') {
      return { error: `Ce congé n’est plus en attente (déjà « ${STATUT_HUMAIN[conge.statut] ?? conge.statut} »).` }
    }

    const resultat = await validerCongeAction(
      c.id,
      ctx.vetoId,
      c.debutEffectif !== conge.date_debut ? c.debutEffectif : undefined,
      c.finEffective !== conge.date_fin ? c.finEffective : undefined,
    )
    return resultat.error ? { error: resultat.error } : {}
  },
}

// ── Écriture : refuser un souhait ───────────────────────────

const ParamsRefuser = z.object({
  prenom: z.string().describe('Le prénom du vétérinaire dont le souhait doit être refusé.'),
  date_debut: z.string().describe('Date ISO (AAAA-MM-JJ) de début du souhait.'),
  date_fin: z.string().describe('Date ISO (AAAA-MM-JJ) de fin du souhait.'),
  raison: z
    .string()
    .optional()
    .describe('Le motif du refus, envoyé par e-mail au vétérinaire. Fortement recommandé.'),
})

export const refuserConge: OutilEcriture<typeof ParamsRefuser> = {
  genre: 'ecriture',
  nom: 'refuser_conge',
  description: `Prépare le refus d'un souhait de congé — souhait EN ATTENTE, ou congé déjà VALIDÉ qu'on annule.

Appelle-le pour « refuse le congé de X », « annule finalement sa demande », en donnant si possible la raison — elle est envoyée par e-mail à la personne. Réservé à l'administrateur.`,
  params: ParamsRefuser,
  adminSeulement: true,

  async resumer(params, ctx) {
    const [equipe, conges] = await Promise.all([chargerEquipeLegere(ctx), chargerConges(ctx)])
    const trouveVeto = resoudreVeto(equipe, params.prenom)
    if (!trouveVeto.ok) return { ok: false, raison: trouveVeto.raison }

    // On accepte de refuser un souhait EN ATTENTE ou un congé déjà VALIDÉ
    // (annulation d'une validation) — pas un congé déjà refusé, ça n'aurait
    // aucun effet.
    const trouveConge = resoudreConge(conges, trouveVeto.veto, params.date_debut, params.date_fin, [
      'souhait',
      'valide',
    ])
    if (!trouveConge.ok) return { ok: false, raison: trouveConge.raison }
    const conge = trouveConge.conge

    const lignes = [
      `${conge.date_debut} → ${conge.date_fin}`,
      `Type : ${TYPE_HUMAIN[conge.type] ?? conge.type}`,
    ]
    if (params.raison) lignes.push(`Raison communiquée : ${params.raison}`)

    const avertissement =
      conge.statut === 'valide'
        ? 'Ce congé était déjà validé. Le refuser ne modifie pas automatiquement un planning déjà publié qui en tiendrait compte.'
        : undefined

    return {
      ok: true,
      proposition: {
        titre: `Refuser le congé de ${trouveVeto.veto.prenom}`,
        phrase: `${trouveVeto.veto.prenom} sera prévenue par e-mail que sa demande n’a pas été acceptée.`,
        lignes,
        action: 'Refuser',
        avertissement,
      },
      charge: { id: conge.id },
    }
  },

  async executer(params, ctx, charge) {
    const c = charge as { id?: string } | undefined
    if (!c?.id) return { error: 'La proposition a été perdue — redemande-la à Filou.' }

    const conges = await chargerConges(ctx)
    const conge = conges.find((x) => x.id === c.id)
    if (!conge) return { error: 'Ce congé n’existe plus — redemande la liste à Filou.' }
    if (conge.statut === 'refuse') {
      return { error: 'Ce congé est déjà refusé.' }
    }

    const resultat = await refuserCongeAction(c.id, params.raison)
    return resultat.error ? { error: resultat.error } : {}
  },
}

// ── Écriture : supprimer un congé ───────────────────────────

const ParamsSupprimer = z.object({
  prenom: z
    .string()
    .optional()
    .describe(
      'À qui appartient le congé. Obligatoire si tu es administrateur. Ignoré si tu n’es pas administrateur : seuls TES propres congés peuvent être supprimés par toi.',
    ),
  date_debut: z.string().describe('Date ISO (AAAA-MM-JJ) de début du congé à supprimer.'),
  date_fin: z.string().describe('Date ISO (AAAA-MM-JJ) de fin du congé à supprimer.'),
})

export const supprimerConge: OutilEcriture<typeof ParamsSupprimer> = {
  genre: 'ecriture',
  nom: 'supprimer_conge',
  description: `Prépare la suppression DÉFINITIVE d'un congé ou d'un souhait.

Appelle-le pour « supprime mon congé du... », « retire la formation de Manon », « annule cette demande » (si elle n'a jamais été traitée). Si tu n'es pas administrateur, tu ne peux supprimer qu'un de TES propres souhaits — pas encore validé.`,
  params: ParamsSupprimer,

  async resumer(params, ctx) {
    const [equipe, conges] = await Promise.all([chargerEquipeLegere(ctx), chargerConges(ctx)])

    let veto: FicheVetoLegere
    if (ctx.estAdmin) {
      if (!params.prenom) {
        return { ok: false, raison: 'Précise à qui appartient le congé à supprimer : donne un prénom.' }
      }
      const trouve = resoudreVeto(equipe, params.prenom)
      if (!trouve.ok) return { ok: false, raison: trouve.raison }
      veto = trouve.veto
    } else {
      const soi = equipe.find((v) => v.id === ctx.vetoId)
      if (!soi) return { ok: false, raison: 'Ta fiche vétérinaire est introuvable.' }
      veto = soi
    }

    // Un non-admin ne peut supprimer qu'un souhait — la RLS le bloquerait de
    // toute façon sur un congé validé/refusé, mais on donne ici la vraie
    // raison plutôt qu'une écriture qui échoue sans explication.
    const statutsAutorises = ctx.estAdmin ? ['souhait', 'valide', 'refuse'] : ['souhait']
    const trouveConge = resoudreConge(conges, veto, params.date_debut, params.date_fin, statutsAutorises)
    if (!trouveConge.ok) {
      if (!ctx.estAdmin) {
        return {
          ok: false,
          raison: `${trouveConge.raison} Si ce congé est déjà validé, seul un administrateur peut le supprimer.`,
        }
      }
      return { ok: false, raison: trouveConge.raison }
    }
    const conge = trouveConge.conge

    return {
      ok: true,
      proposition: {
        titre: `Supprimer le congé de ${veto.prenom}`,
        phrase: `Je vais supprimer définitivement ce congé de ${veto.prenom} ${veto.nom}.`,
        lignes: [
          `${conge.date_debut} → ${conge.date_fin}`,
          `Type : ${TYPE_HUMAIN[conge.type] ?? conge.type}`,
          `Statut actuel : ${STATUT_HUMAIN[conge.statut] ?? conge.statut}`,
        ],
        action: 'Supprimer définitivement',
        avertissement: 'La suppression ne se rattrape pas.',
      },
      charge: { id: conge.id },
    }
  },

  async executer(_params, ctx, charge) {
    const c = charge as { id?: string } | undefined
    if (!c?.id) return { error: 'La proposition a été perdue — redemande-la à Filou.' }

    const conges = await chargerConges(ctx)
    if (!conges.some((x) => x.id === c.id)) {
      return { error: 'Ce congé n’existe déjà plus.' }
    }

    const resultat = await deleteConge(c.id)
    return resultat.error ? { error: resultat.error } : {}
  },
}
