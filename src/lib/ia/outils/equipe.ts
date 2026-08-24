// ============================================================
// GUARDVETO — Outils de Filou : l'équipe du cabinet
// ============================================================
// SERVER-ONLY. C'est le trou qui a déclenché tout ce chantier : Filou ne voyait
// que les règles, et répondait « aucune règle ne concerne Anne-Catherine » alors
// qu'elle est marquée DERNIER RECOURS — un réglage qui vit sur sa fiche, pas
// dans les règles. Il voit maintenant les fiches, et peut proposer de les
// changer.
//
// Le modèle ne manipule que des PRÉNOMS, jamais des identifiants : un modèle
// recopie mal un UUID, et ici une erreur de recopie voudrait dire modifier la
// mauvaise personne. La résolution prénom → fiche se fait ici, sur la liste du
// cabinet, et refuse net dès qu'elle est ambiguë.
// ============================================================

import { z } from 'zod'
import { updateVeterinaire } from '@/app/(protected)/admin/veterinaires/actions'
import { etiquettesProches } from '@/lib/equipe/etiquettes'
import { SANS_PARAMETRE, type ContexteOutil, type OutilEcriture, type OutilLecture } from './types'

interface FicheVeto {
  id: string
  prenom: string
  nom: string
  /** Facultatif : une fiche pas encore invitée n'a pas d'adresse. */
  email: string | null
  statut: string
  role_app: string
  actif: boolean
  dernier_recours: boolean
  couleur: string | null
  tags: string[] | null
}

async function chargerEquipe(ctx: ContexteOutil): Promise<FicheVeto[]> {
  const { data } = await ctx.supabase
    .from('veterinaires')
    .select('id, prenom, nom, email, statut, role_app, actif, dernier_recours, couleur, tags')
    .order('prenom')
  return (data as FicheVeto[] | null) ?? []
}

/** Les signes diacritiques, écrits en échappements : la classe de caractères
 *  saisie littéralement est invisible à la relecture et facile à casser. */
const DIACRITIQUES = /[̀-ͯ]/g

/** Compare deux prénoms sans se laisser arrêter par les accents, la casse ou un
 *  trait d'union — « anne catherine » doit trouver « Anne-Catherine ». */
function memeNom(a: string, b: string): boolean {
  const nettoyer = (s: string) =>
    s
      .normalize('NFD')
      .replace(DIACRITIQUES, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
  return nettoyer(a) === nettoyer(b)
}

/** Résout un prénom en fiche. Refuse l'à-peu-près : mieux vaut redemander que
 *  modifier la mauvaise personne. */
function resoudre(
  equipe: FicheVeto[],
  prenom: string,
): { ok: true; veto: FicheVeto } | { ok: false; raison: string } {
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

// ── Lecture ─────────────────────────────────────────────────

export const lireEquipe: OutilLecture<typeof SANS_PARAMETRE> = {
  genre: 'lecture',
  nom: 'lire_equipe',
  description: `Donne la fiche de chaque vétérinaire du cabinet : prénom, nom, statut (associé ou salarié), rôle dans le logiciel (administrateur ou vétérinaire), s'il est actif dans le planning, s'il est en DERNIER RECOURS, et ses étiquettes (junior, senior…).

Appelle-le dès qu'une question porte sur une personne : qui fait partie de l'équipe, qui est junior, pourquoi quelqu'un n'est jamais programmé, si quelqu'un peut ou non prendre des gardes.

DERNIER RECOURS est important : ce n'est pas une interdiction, c'est un ordre de passage. Le moteur ne programme ce vétérinaire que si personne d'autre n'est disponible, sur tous les créneaux. Quelqu'un qui « n'a jamais de garde » sans qu'aucune règle ne l'en empêche est souvent en dernier recours, ou inactif.`,
  params: SANS_PARAMETRE,
  async executer(_params, ctx) {
    const equipe = await chargerEquipe(ctx)

    // ⛔ CE QUI REGARDE L'ORGANISATION NE REGARDE PAS TOUTE L'EQUIPE.
    //
    // L'ecran Equipe est ferme aux veterinaires : statut contractuel
    // (associe / salarie), role applicatif, etiquettes et surtout DERNIER
    // RECOURS sont des donnees d'organisation — la derniere est meme un
    // jugement que l'administratrice porte sur l'ordre de passage.
    //
    // On ne ferme pas l'outil pour autant : il fonde presque toutes les
    // reponses qui nomment quelqu'un, et un veterinaire a besoin de savoir qui
    // compose son equipe. On restreint les CHAMPS, et chacun garde le detail
    // de SA propre ligne — meme principe que lire_compteurs.
    const detail = (id: string) => ctx.estAdmin || id === ctx.vetoId

    return equipe.map((v) => ({
      prenom: v.prenom,
      nom: v.nom,
      actif_dans_le_planning: v.actif,
      // Le RÔLE reste visible de tous : savoir à qui s'adresser pour un congé
      // est une question banale, et l'identité de l'administratrice n'a rien
      // d'un secret — c'est elle qui signe les e-mails de validation. La
      // masquer forçait Filou à répondre « je ne sais pas », ou pire à deviner.
      role: v.role_app === 'admin' ? 'administrateur' : 'vétérinaire',
      ...(detail(v.id)
        ? {
            statut: v.statut,
            dernier_recours: v.dernier_recours,
            etiquettes: v.tags ?? [],
          }
        : {}),
    }))
  },
}

// ── Écriture ────────────────────────────────────────────────

const ParamsModifier = z.object({
  prenom: z.string().describe('Le prénom du vétérinaire concerné, tel qu’il apparaît dans l’équipe.'),
  dernier_recours: z
    .boolean()
    .optional()
    .describe(
      'true = ne le programmer qu’en tout dernier recours ; false = le remettre dans l’ordre normal.',
    ),
  actif: z
    .boolean()
    .optional()
    .describe(
      'false = le retirer du planning (il ne sera plus programmé du tout) ; true = l’y remettre.',
    ),
  etiquettes: z
    .array(z.string())
    .optional()
    .describe(
      'Remplace TOUTES ses étiquettes (junior, senior…). Pour en ajouter une, reprends les existantes.',
    ),
  confirmer_nouvelles_etiquettes: z
    .boolean()
    .optional()
    .describe(
      'Ne le mets à true QUE si la personne a confirmé vouloir créer une étiquette qui ressemble à une étiquette déjà utilisée dans le cabinet (par exemple « séniors » alors que « senior » existe). Sans cette confirmation, la modification est refusée et il faut lui demander laquelle elle veut.',
    ),
})

/**
 * Le vocabulaire d'étiquettes RÉELLEMENT en usage dans le cabinet, toutes
 * fiches confondues. C'est lui qui sert de référence : une étiquette n'existe
 * pas parce qu'elle est plausible, elle existe parce que quelqu'un la porte.
 */
function vocabulaireEtiquettes(equipe: FicheVeto[]): string[] {
  return equipe.flatMap((v) => v.tags ?? [])
}

/**
 * Barrage au JUMEAU ORTHOGRAPHIQUE.
 *
 * Écrire « séniors » quand l'équipe dit « senior » réussit sans un mot : la
 * fiche affiche bien la nouvelle étiquette, et l'admin voit que ça a marché.
 * Mais les règles de composition portent sur l'étiquette à la lettre près —
 * elles cessent alors d'atteindre cette personne. Le contrôle de
 * `regles/actions.ts` ne rattrape rien : l'étiquette fautive est désormais
 * portée, donc valide à ses yeux.
 *
 * On ne bloque PAS la création d'une étiquette réellement nouvelle : c'est
 * légitime, et le cabinet a le droit d'enrichir son vocabulaire. On ne bloque
 * que la RESSEMBLANCE, et on la renvoie sous forme de question. La personne
 * tranche, Filou rappelle l'outil avec sa réponse.
 */
function refusJumeauEtiquette(
  etiquettes: string[] | undefined,
  equipe: FicheVeto[],
  confirme: boolean | undefined,
): string | null {
  if (!etiquettes || confirme) return null
  const proches = etiquettesProches(etiquettes, vocabulaireEtiquettes(equipe))
  if (proches.length === 0) return null

  const questions = proches.map(
    (p) =>
      `« ${p.demandee} » n’existe pas encore dans le cabinet, mais ${p.proches.map((e) => `« ${e} »`).join(' et ')} oui`,
  )
  return `${questions.join(' ; ')}. Les règles du cabinet visent l’étiquette à la lettre près : une écriture voisine créerait un doublon et cette personne sortirait sans bruit des règles existantes. Tu veux laquelle ?`
}

export const modifierVeterinaire: OutilEcriture<typeof ParamsModifier> = {
  genre: 'ecriture',
  nom: 'modifier_veterinaire',
  description: `Prépare une modification de la fiche d'un vétérinaire : son statut de dernier recours, sa présence dans le planning, ou ses étiquettes.

Appelle-le quand la demande revient à changer la façon dont quelqu'un est programmé sans passer par une règle — « ne la programme qu'en dépannage », « remets-le dans le planning », « marque-la comme senior ».

Ne touche que ce que tu précises : les champs que tu laisses de côté ne bougent pas. Rien n'est enregistré tant que la personne n'a pas validé.

ÉTIQUETTES — les règles du cabinet visent l'étiquette à la lettre près. Si tu demandes une étiquette qui ressemble à une étiquette déjà utilisée (« séniors » alors que « senior » existe), l'outil refuse et te dit laquelle existe : demande à la personne ce qu'elle veut, puis rappelle l'outil — avec l'étiquette existante, ou avec confirmer_nouvelles_etiquettes à true si elle veut vraiment créer la nouvelle.`,
  params: ParamsModifier,
  adminSeulement: true,

  async resumer(params, ctx) {
    const equipe = await chargerEquipe(ctx)
    const trouve = resoudre(equipe, params.prenom)
    if (!trouve.ok) return { ok: false, raison: trouve.raison }
    const v = trouve.veto

    const lignes: string[] = []
    if (params.dernier_recours !== undefined && params.dernier_recours !== v.dernier_recours) {
      lignes.push(
        params.dernier_recours
          ? `Dernier recours : ${v.prenom} ne sera plus programmée que si personne d’autre n’est disponible.`
          : `Dernier recours retiré : ${v.prenom} reprend sa place normale dans l’ordre de choix.`,
      )
    }
    if (params.actif !== undefined && params.actif !== v.actif) {
      lignes.push(
        params.actif
          ? `${v.prenom} revient dans le planning et pourra être programmée.`
          : `${v.prenom} sort du planning : elle ne sera plus programmée du tout.`,
      )
    }
    if (params.etiquettes) {
      const jumeau = refusJumeauEtiquette(params.etiquettes, equipe, params.confirmer_nouvelles_etiquettes)
      if (jumeau) return { ok: false, raison: jumeau }
      const avant = (v.tags ?? []).join(', ') || 'aucune'
      const apres = params.etiquettes.join(', ') || 'aucune'
      if (avant !== apres) lignes.push(`Étiquettes : ${avant} → ${apres}`)
    }

    if (lignes.length === 0) {
      return {
        ok: false,
        raison: `La fiche de ${v.prenom} est déjà dans cet état — il n’y a rien à changer.`,
      }
    }

    return {
      ok: true,
      proposition: {
        titre: `Modifier la fiche de ${v.prenom}`,
        phrase: `Voici ce que je changerais sur la fiche de ${v.prenom} ${v.nom}.`,
        lignes,
        action: 'Appliquer',
        avertissement:
          'Le planning déjà publié ne bouge pas : le changement vaudra pour la prochaine génération.',
      },
    }
  },

  async executer(params, ctx) {
    const equipe = await chargerEquipe(ctx)
    const trouve = resoudre(equipe, params.prenom)
    if (!trouve.ok) return { error: trouve.raison }
    const v = trouve.veto

    // Rejoué À FROID. Le résumé a barré le jumeau orthographique, mais rien ne
    // garantit que ce qui arrive ici est ce qui a été résumé : l'équipe a pu
    // changer entre les deux, et cette exécution ne relit pas une `charge`
    // scellée — elle repart des paramètres.
    const jumeau = refusJumeauEtiquette(params.etiquettes, equipe, params.confirmer_nouvelles_etiquettes)
    if (jumeau) return { error: jumeau }

    // On repasse par l'action de l'écran Équipe : mêmes gardes admin, même RLS,
    // même contrôle d'unicité d'e-mail. La fiche est renvoyée ENTIÈRE, avec les
    // seuls champs demandés modifiés — l'action attend le formulaire complet, et
    // en omettre un l'effacerait.
    return updateVeterinaire(v.id, {
      nom: v.nom,
      prenom: v.prenom,
      email: v.email,
      statut: v.statut as 'associe' | 'salarie',
      role_app: v.role_app as 'admin' | 'veto',
      couleur: v.couleur ?? '#6B7280',
      actif: params.actif ?? v.actif,
      dernier_recours: params.dernier_recours ?? v.dernier_recours,
      tags: params.etiquettes ?? v.tags ?? [],
    })
  },
}
