// ============================================================
// GUARDVETO — Outils de Filou : le SECRÉTARIAT (B-017)
// ============================================================
// SERVER-ONLY.
//
// POURQUOI CES OUTILS EXISTENT — constat du 2026-08-25.
//
// Le secrétariat a été livré le jour même, et Filou n'en savait rien. Le
// symptôme n'était pas « il ne sait pas faire » : c'était pire. À la question
// « qui a accès au planning ? », il appelait `lire_equipe`, recevait les sept
// vétérinaires, et répondait — sans le secrétariat, et sans que rien dans sa
// réponse ne signale l'absence. Une réponse incomplète PRÉSENTÉE COMME
// COMPLÈTE, c'est-à-dire le mode de panne que ce projet paie depuis des mois.
//
// D'où la règle qui a guidé ce fichier : quand une capacité nouvelle apparaît
// dans le produit, la question n'est pas « faut-il un outil ? » mais « une
// question existante reçoit-elle désormais une réponse fausse ? ».
//
// ── LE MODÈLE NE MANIPULE QUE DES NOMS ──────────────────────────────────────
//
// Comme pour l'équipe : jamais d'identifiant. Un modèle recopie mal un UUID, et
// ici une erreur de recopie voudrait dire supprimer le mauvais accès. La
// résolution nom → fiche se fait ici, et refuse net dès qu'elle est ambiguë.
// ============================================================

import { z } from 'zod'
import {
  creerSecretaire,
  inviterSecretaire,
  supprimerSecretaire,
} from '@/app/(v2)/equipe/secretariat-actions'
import { lignesLues } from './lecture'
import { SANS_PARAMETRE, type ContexteOutil, type OutilEcriture, type OutilLecture } from './types'

interface FicheSecretariat {
  id: string
  nom: string
  email: string | null
  user_id: string | null
  actif: boolean
}

async function chargerSecretariat(ctx: ContexteOutil): Promise<FicheSecretariat[]> {
  return lignesLues<FicheSecretariat>(
    await ctx.supabase
      .from('secretaires')
      .select('id, nom, email, user_id, actif')
      .order('nom'),
    'la liste du secrétariat',
  )
}

/** Les signes diacritiques, en échappements — voir `outils/equipe.ts`. */
const DIACRITIQUES = /[̀-ͯ]/g

function memeNom(a: string, b: string): boolean {
  const nettoyer = (s: string) =>
    s.normalize('NFD').replace(DIACRITIQUES, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return nettoyer(a) === nettoyer(b)
}

type Resolution = { ok: true; fiche: FicheSecretariat } | { ok: false; raison: string }

function resoudre(fiches: FicheSecretariat[], nom: string): Resolution {
  const exacts = fiches.filter((f) => memeNom(f.nom, nom))
  if (exacts.length === 1) return { ok: true, fiche: exacts[0] }
  if (exacts.length > 1) {
    return {
      ok: false,
      raison: `Plusieurs accès de secrétariat s’appellent « ${nom} ». Précise lequel.`,
    }
  }
  if (fiches.length === 0) {
    return {
      ok: false,
      raison: "Ce cabinet n'a aucun accès de secrétariat pour l'instant.",
    }
  }
  return {
    ok: false,
    raison: `Aucun accès de secrétariat ne s’appelle « ${nom} ». Il y a : ${fiches
      .map((f) => f.nom)
      .join(', ')}.`,
  }
}

// ── LECTURE ────────────────────────────────────────────────────────────────

export const lireSecretariat: OutilLecture<typeof SANS_PARAMETRE> = {
  genre: 'lecture',
  nom: 'lire_secretariat',
  description: `Donne les accès de SECRÉTARIAT du cabinet : leur nom affiché, leur adresse e-mail, s'ils ont déjà un compte pour se connecter, et s'ils sont actifs.

Le secrétariat n'est PAS l'équipe vétérinaire : ce sont des accès en consultation, qui voient le planning diffusé et les absences à venir, et ne modifient rien. Ils n'apparaissent dans aucun planning, aucun compteur, aucune règle.

Appelle-le dès qu'une question porte sur QUI PEUT SE CONNECTER ou QUI A ACCÈS au logiciel — « qui a accès au planning ? », « est-ce que le secrétariat est branché ? », « combien de personnes peuvent se connecter ? ». Sur ces questions, lire_equipe seul donne une réponse incomplète : il ne connaît que les vétérinaires.`,
  params: SANS_PARAMETRE,
  adminSeulement: true,

  async executer(_params, ctx) {
    const fiches = await chargerSecretariat(ctx)
    return fiches.map((f) => ({
      nom: f.nom,
      email: f.email,
      // On rend un FAIT, pas une interprétation : « il existe un compte ».
      // Écrire « invitation envoyée » serait affirmer ce qu'on ne sait pas —
      // c'est le drapeau qui a menti deux mois sur la fiche de Fanny.
      a_un_compte: f.user_id !== null,
      actif: f.actif,
    }))
  },
}

// ── ÉCRITURE ───────────────────────────────────────────────────────────────

const ParamsCreer = z.object({
  nom: z
    .string()
    .describe(
      'Le nom affiché de l’accès. « Secrétariat » quand plusieurs personnes le partagent, un prénom quand chacune a le sien.',
    ),
  email: z
    .string()
    .optional()
    .describe("L'adresse e-mail, facultative. Sans elle, l'accès existe mais ne peut pas être invité."),
})

export const creerAccesSecretariat: OutilEcriture<typeof ParamsCreer> = {
  genre: 'ecriture',
  nom: 'creer_acces_secretariat',
  description: `Prépare la création d'un accès de secrétariat : un accès en consultation au planning diffusé et aux absences.

Appelle-le quand la demande revient à ouvrir l'application à l'accueil du cabinet — « donne un accès à la secrétaire », « il faut que le secrétariat puisse voir le planning ».

UNE FICHE = UN ACCÈS, pas une personne. Si plusieurs secrétaires doivent partager le même identifiant, on crée UNE seule fiche « Secrétariat » — c'est le cas le plus fréquent. Ne crée trois fiches que si on te demande explicitement trois accès distincts.

Rien n'est enregistré tant que la personne n'a pas validé. L'invitation est un second geste, séparé.`,
  params: ParamsCreer,
  adminSeulement: true,

  async resumer(params, ctx) {
    const fiches = await chargerSecretariat(ctx)
    const nom = params.nom.trim()

    if (fiches.some((f) => memeNom(f.nom, nom))) {
      return { ok: false, raison: `Un accès de secrétariat s’appelle déjà « ${nom} ».` }
    }

    const lignes = [`Nom affiché : ${nom}`]
    lignes.push(
      params.email?.trim()
        ? `E-mail : ${params.email.trim()} — l’invitation pourra être envoyée ensuite.`
        : 'Sans adresse e-mail : l’accès existera, mais ne pourra pas encore être invité.',
    )
    lignes.push('Consultation seule : planning diffusé et absences à venir, rien d’autre.')

    return {
      ok: true,
      proposition: {
        titre: 'Créer un accès de secrétariat',
        phrase: `Voici l’accès que je créerais.`,
        lignes,
        action: 'Créer l’accès',
      },
    }
  },

  async executer(params, ctx) {
    // On repasse par l'action de l'écran : elle porte la garde admin, la
    // normalisation de l'adresse et le contrôle d'unicité. Un chemin d'écriture
    // parallèle serait un endroit de plus où ces contrôles peuvent manquer —
    // c'est exactement ce qui a produit les quatre portes d'écriture de garde
    // trouvées le 22/08.
    void ctx
    const res = await creerSecretaire({ nom: params.nom, email: params.email ?? '' })
    return 'error' in res ? { error: res.error } : {}
  },
}

const ParamsNom = z.object({
  nom: z.string().describe("Le nom affiché de l'accès de secrétariat concerné."),
})

export const inviterAccesSecretariat: OutilEcriture<typeof ParamsNom> = {
  genre: 'ecriture',
  nom: 'inviter_acces_secretariat',
  description: `Prépare l'envoi de l'invitation à un accès de secrétariat : la personne reçoit un e-mail pour choisir son mot de passe.

Appelle-le quand on te demande d'ouvrir concrètement l'accès — « envoie l'invitation au secrétariat », « elles peuvent se connecter maintenant ? » suivi d'un oui.

Sans adresse e-mail sur la fiche, l'invitation n'a nulle part où aller : l'outil refuse et le dit.`,
  params: ParamsNom,
  adminSeulement: true,

  async resumer(params, ctx) {
    const trouve = resoudre(await chargerSecretariat(ctx), params.nom)
    if (!trouve.ok) return { ok: false, raison: trouve.raison }
    const f = trouve.fiche

    if (!f.actif) {
      return {
        ok: false,
        raison: `L’accès « ${f.nom} » est désactivé. Il faut le rétablir avant de l’inviter.`,
      }
    }
    if (!f.email?.trim()) {
      return {
        ok: false,
        raison: `L’accès « ${f.nom} » n’a pas d’adresse e-mail : l’invitation n’aurait nulle part où aller. Renseigne-la d’abord sur l’écran Équipe.`,
      }
    }
    if (f.user_id) {
      return {
        ok: false,
        raison: `L’accès « ${f.nom} » a déjà un compte : la personne peut se connecter. Si elle a oublié son mot de passe, elle peut le réinitialiser depuis l’écran de connexion.`,
      }
    }

    return {
      ok: true,
      proposition: {
        titre: `Inviter « ${f.nom} »`,
        phrase: `Un e-mail partira à ${f.email} pour choisir un mot de passe.`,
        lignes: [
          'L’accès donne le planning diffusé et les absences à venir, en consultation.',
          'Aucune modification n’est possible depuis cet accès.',
        ],
        action: 'Envoyer l’invitation',
      },
    }
  },

  async executer(params, ctx) {
    const trouve = resoudre(await chargerSecretariat(ctx), params.nom)
    if (!trouve.ok) return { error: trouve.raison }
    const res = await inviterSecretaire(trouve.fiche.id)
    return 'error' in res ? { error: res.error } : {}
  },
}

export const supprimerAccesSecretariat: OutilEcriture<typeof ParamsNom> = {
  genre: 'ecriture',
  nom: 'supprimer_acces_secretariat',
  description: `Prépare la suppression d'un accès de secrétariat : la fiche ET le compte de connexion sont effacés.

Appelle-le quand on te demande de retirer définitivement un accès — « supprime l'accès de X », « elle ne travaille plus ici ».

Si la demande est TEMPORAIRE (« le temps de son congé », « pour l'instant »), ne l'appelle pas : dis qu'on peut retirer l'accès sans perdre la fiche depuis l'écran Équipe, avec le bouton d'extinction.

Le planning et les gardes ne sont jamais touchés : un accès de secrétariat n'est titulaire de rien.`,
  params: ParamsNom,
  adminSeulement: true,

  async resumer(params, ctx) {
    const trouve = resoudre(await chargerSecretariat(ctx), params.nom)
    if (!trouve.ok) return { ok: false, raison: trouve.raison }
    const f = trouve.fiche

    return {
      ok: true,
      proposition: {
        titre: `Supprimer l’accès « ${f.nom} »`,
        phrase: f.user_id
          ? `La fiche et son compte de connexion seront effacés : la personne ne pourra plus se connecter.`
          : `La fiche sera effacée. Aucun compte n’y est rattaché.`,
        lignes: ['Le planning et les gardes ne sont pas concernés.'],
        action: 'Supprimer',
        avertissement: 'C’est définitif. Pour un retrait temporaire, préfère l’extinction.',
      },
    }
  },

  async executer(params, ctx) {
    const trouve = resoudre(await chargerSecretariat(ctx), params.nom)
    if (!trouve.ok) return { error: trouve.raison }
    const res = await supprimerSecretaire(trouve.fiche.id)
    return 'error' in res ? { error: res.error } : {}
  },
}
