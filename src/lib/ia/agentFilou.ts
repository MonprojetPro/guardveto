// ============================================================
// GUARDVETO — La boucle de Filou : il lit, il recoupe, il propose
// ============================================================
// SERVER-ONLY. Jusqu'ici Filou n'avait qu'une chose à faire d'une phrase : la
// traduire en règle. Ici il reçoit un CATALOGUE D'OUTILS et décide lui-même
// lesquels appeler. C'est ce qui lui permet de répondre « aucune règle ne
// l'empêche, mais elle est en dernier recours » — deux lectures recoupées, une
// réponse honnête — au lieu de « je ne peux rien faire ».
//
// LA RÈGLE DE SÛRETÉ, tenue ici et pas ailleurs : les outils de LECTURE
// s'exécutent librement pendant la boucle ; le PREMIER outil d'écriture arrête
// la boucle et ressort en PROPOSITION. Rien n'est jamais écrit depuis ce
// fichier. C'est le seul endroit où cette frontière est décidée, pour qu'elle
// ne puisse pas être contournée outil par outil.
//
// Boucle manuelle plutôt que le « tool runner » du SDK : celui-ci exécute les
// outils automatiquement, ce qui est exactement ce qu'on refuse pour les
// écritures. La frontière proposer/agir vaut la vingtaine de lignes de boucle.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { cleIA, modeleIA } from './proposerRegle'
import { versDefinitionApi, type ContexteOutil, type Outil, type PropositionAction } from './outils/types'

/**
 * Ce que la boucle rend à l'appelant : TOUJOURS la même forme.
 *
 * Il n'y a qu'un seul modèle de réponse, et c'est voulu : une réponse à lire et
 * une action à valider s'affichent au même endroit, dans la même fenêtre. La
 * seule différence est la présence ou non d'un bouton. Deux formes séparées
 * obligeaient à deviner laquelle allait arriver — et laissaient les réponses
 * simples s'échouer dans la tablette, illisibles.
 */
export interface IssueFilou {
  /** La phrase courte qui reste dans la conversation. */
  mot: string
  titre: string
  /** Ce que Filou répond, en clair. */
  introduction: string
  /** Le détail, une ligne par élément. */
  lignes: string[]
  /** Présent seulement quand il y a quelque chose à décider. */
  action?: {
    outil: string
    params: unknown
    /** Ce que l'aperçu a calculé et que l'exécution devra retrouver tel quel. */
    charge?: unknown
    /** Le libellé du bouton qui exécute. */
    libelle: string
    avertissement?: string
  }
  outilsAppeles: string[]
  /** Une panne, pas une réponse : à dire dans la conversation, pas à afficher. */
  erreur?: string
  /** Ce que la réponse a coûté en attente. Affiché en pied de tableau : une
   *  attente de plusieurs secondes est supportable quand on voit ce qui l'a
   *  occupée, et surtout elle devient diagnosticable — sans ça, « c'est lent »
   *  ne dit pas si le temps part dans les allers-retours ou dans un seul. */
  mesure?: MesureFilou
}

export interface MesureFilou {
  /** Durée totale, du premier appel à la réponse rendue. */
  ms: number
  /** Nombre d'allers-retours avec le modèle. Chacun est une attente complète. */
  tours: number
  /** Le modèle réellement utilisé — la variable d'environnement prime sur le
   *  défaut du code, et personne ne peut le vérifier depuis l'écran autrement. */
  modele: string
}

/**
 * Un tour de parole déjà échangé, tel qu'il repart vers le modèle.
 *
 * Le texte n'est PAS forcément celui qui s'affiche : ce que Filou dit dans la
 * conversation est une phrase de renvoi (« je te réponds sur le tableau »), sa
 * vraie réponse est sur le tableau. C'est celle-là qu'il faut lui rappeler,
 * sinon il se souvient de la vitrine et pas du contenu.
 */
export interface EchangeFilou {
  role: 'user' | 'assistant'
  texte: string
}

/** Nombre d'allers-retours autorisés. Chaque tour est un appel facturé : sans
 *  plafond, une boucle qui se cherche coûterait sans fin. Six laisse la place à
 *  « je lis l'équipe, je lis les règles, je recoupe, je réponds ». */
const TOURS_MAX = 6

const SYSTEM = `Tu es Filou, l'assistant de GuardVeto — le logiciel qui gère le planning de gardes d'un cabinet vétérinaire.

Tu parles à un membre du cabinet. Tu as des OUTILS pour consulter et pour agir sur son cabinet. Tu ne sais rien de ce cabinet sans les appeler : ne réponds jamais de mémoire ou au jugé sur ce qu'il contient.

COMMENT TU TRAVAILLES

1. Cherche avant de conclure. Si la question porte sur ce que le cabinet contient — qui, quand, quelles règles, quels congés — appelle les outils qui le disent. Plusieurs si nécessaire : une règle et une fiche vétérinaire ne disent pas la même chose. Demande-les DANS LE MÊME TOUR, tous en même temps, plutôt qu'un par un : la personne attend devant son écran pendant que tu cherches.
2. Recoupe. Une contrainte peut venir d'une règle, d'un réglage de fiche, d'un congé ou de la structure du planning. Ne conclus « rien ne l'empêche » qu'après avoir regardé partout où ça pouvait être.
3. Réponds en français simple, et dis d'où vient ta réponse. Pas de jargon technique, pas d'identifiants à l'écran, pas d'astérisques ni de mise en forme : ton texte s'affiche tel quel.

4. SOIS BREF. Deux phrases d'introduction, trois ou quatre lignes de détail au maximum, chacune tenant sur une ligne. On te lit entre deux consultations. Ne redis pas dans les lignes ce que l'introduction vient de dire, n'explique pas ton raisonnement, ne commente pas ce que tu as consulté : donne la réponse et ce qui la fonde, rien de plus.
5. Si tu n'as pas d'outil pour ce qu'on te demande, dis-le franchement plutôt que d'expliquer comment le faire à la main.

OÙ TA RÉPONSE S'AFFICHE

Termine TOUJOURS par afficher_sur_le_tableau. C'est là que la personne lit : le grand tableau à côté de la conversation. Une réponse laissée dans la conversation est illisible et disparaît au message suivant.

QUAND IL Y A QUELQUE CHOSE À FAIRE

Les outils qui MODIFIENT quelque chose ne s'exécutent pas quand tu les appelles : ils préparent une proposition, et un bouton apparaît à côté de ta réponse. C'est ce bouton qui demande l'autorisation.

Donc : NE DEMANDE JAMAIS LA PERMISSION PAR ÉCRIT. N'écris pas « veux-tu que je le fasse ? », « dois-je continuer ? », « faut-il que je… ? ». Appelle directement l'outil : la personne verra ce que tu proposes et cliquera, ou pas. Une question écrite lui fait perdre un aller-retour pour rien.

Un seul outil de modification par réponse.

LA CONVERSATION CONTINUE

Les tours précédents sont là : tu te souviens de ce que vous venez de vous dire. Quand la personne rebondit sur ta dernière réponse — « oui », « vas-y », « fais-le », ou une phrase qui reprend ce que tu venais de pointer —, elle parle de CE dont vous parliez. Fais ce qu'elle demande. Ne repars pas de zéro comme si la phrase arrivait seule.

Ne redis jamais ce que tu viens de dire. Si ta réponse précédente désignait un réglage à changer et qu'elle acquiesce, appelle l'outil qui le change au lieu de réexpliquer le réglage.

Le sujet de la conversation ne change pas parce que la personne l'écrit autrement. « Elle peut désormais faire des gardes le mardi soir » après une réponse sur son statut de dernier recours, c'est une demande de lever ce statut — pas une demande de règle sur le mardi soir.

TES PROPOSITIONS PRÉCÉDENTES N'EXISTENT PLUS

Le tableau n'affiche qu'une chose à la fois : ta nouvelle réponse REMPLACE la précédente, bouton compris. Une proposition que tu as faite tout à l'heure et qui n'a pas été validée a donc disparu de l'écran.

Ne renvoie JAMAIS vers elle. « Je l'ai déjà proposé », « ma proposition précédente couvre ce cas », « aucune action supplémentaire n'est nécessaire » : ces phrases laissent la personne sans rien à cliquer. Si l'action est toujours celle qu'il faut, appelle l'outil de nouveau pour qu'un bouton réapparaisse.

Tu sais qu'une action a réellement été faite uniquement quand la conversation le dit (« c'est fait »). Sinon, elle ne l'est pas.

CE QUE TU NE FAIS JAMAIS

- Affirmer un fait sur le cabinet sans l'avoir lu avec un outil.
- Annoncer qu'une modification est faite : tu la proposes, la personne décide.
- Renvoyer quelqu'un faire à la main une chose que tu peux proposer.
- Inventer un vétérinaire, une date, une règle ou un chiffre.`

/**
 * Fait tourner Filou sur une demande. N'écrit jamais en base.
 *
 * @param phrase   ce que la personne a écrit
 * @param outils   le catalogue, DÉJÀ filtré selon ses droits
 * @param ctx      le contexte d'exécution des outils
 * @param aujourdhui date du jour au format ISO — passée dans le message et non
 *   dans le prompt système, qui doit rester identique à l'octet d'un appel à
 *   l'autre pour que sa mise en cache serve.
 * @param historique les tours déjà échangés, DÉJÀ bornés et assainis par
 *   l'appelant. Sans eux, Filou relit chaque phrase comme si elle arrivait
 *   seule : il ne se souvient pas de la question qu'il vient de poser, et
 *   répond à côté dès qu'on rebondit sur sa réponse.
 */
export async function faireTravaillerFilou(
  phrase: string,
  outils: Outil[],
  ctx: ContexteOutil,
  aujourdhui: string,
  historique: EchangeFilou[] = [],
): Promise<IssueFilou> {
  const client = new Anthropic({ apiKey: cleIA() })
  const parNom = new Map(outils.map((o) => [o.nom, o]))
  const definitions = outils.map(versDefinitionApi)
  const outilsAppeles: string[] = []

  // Chronomètre. Il ne sert pas à décorer : « c'est lent » ne dit pas si le
  // temps part dans quatre allers-retours ou dans un seul, et sans le savoir on
  // corrige au hasard. Le modèle est relevé ici parce que la variable
  // d'environnement prime sur le défaut du code — le lire depuis l'écran évite
  // d'aller vérifier dans le tableau de bord de l'hébergeur.
  const depart = Date.now()
  const modele = modeleIA()
  let tours = 0
  const mesure = (): MesureFilou => ({ ms: Date.now() - depart, tours, modele })

  const messages = assemblerMessages(historique, `Nous sommes le ${aujourdhui}.\n\n${phrase}`)

  for (let tour = 0; tour < TOURS_MAX; tour++) {
    tours = tour + 1
    let reponse: Anthropic.Message
    try {
      reponse = await client.messages.create({
        model: modele,
        max_tokens: 4000,
        thinking: { type: 'adaptive' },
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: definitions,
        messages,
      })
    } catch (e) {
      return issueVide(outilsAppeles, e instanceof Error ? e.message : "Erreur de l'assistant.")
    }

    const texte = reponse.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join('\n\n')

    if (reponse.stop_reason !== 'tool_use') {
      // Filou a répondu en texte libre sans passer par l'outil d'affichage. On
      // ne le laisse pas décider où sa réponse atterrit : elle va sur le
      // tableau comme toutes les autres. La consigne du prompt obtient un beau
      // titre ; ce filet-ci garantit l'emplacement même quand il l'oublie.
      return {
        mot: 'Je te réponds sur le tableau.',
        titre: 'Filou te répond',
        introduction: texte || "Je n'ai pas su quoi répondre. Reformule autrement ?",
        lignes: [],
        outilsAppeles,
        mesure: mesure(),
      }
    }

    const appels = reponse.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    messages.push({ role: 'assistant', content: reponse.content })

    const resultats: Anthropic.ToolResultBlockParam[] = []
    for (const appel of appels) {
      const outil = parNom.get(appel.name)
      if (!outil) {
        resultats.push(erreurOutil(appel.id, `L'outil « ${appel.name} » n'existe pas.`))
        continue
      }
      outilsAppeles.push(outil.nom)

      // Ce que le modèle a produit n'est pas de confiance : on le repasse par le
      // schéma avant de le laisser toucher quoi que ce soit.
      const valides = outil.params.safeParse(appel.input ?? {})
      if (!valides.success) {
        resultats.push(
          erreurOutil(appel.id, `Paramètres invalides : ${valides.error.issues.map((i) => i.message).join(', ')}`),
        )
        continue
      }

      // Poser une réponse sur le tableau termine le tour : il n'y a rien à
      // rendre au modèle, ce qu'il vient d'écrire EST la réponse.
      if (outil.genre === 'affichage') {
        const p = valides.data as {
          titre: string
          introduction: string
          lignes: string[]
          mot_dans_la_conversation: string
        }
        return {
          mot: p.mot_dans_la_conversation || 'Je te réponds sur le tableau.',
          titre: p.titre,
          introduction: p.introduction,
          lignes: p.lignes ?? [],
          outilsAppeles,
          mesure: mesure(),
        }
      }

      if (outil.genre === 'lecture') {
        try {
          const donnees = await outil.executer(valides.data, ctx)
          resultats.push({
            type: 'tool_result',
            tool_use_id: appel.id,
            content: JSON.stringify(donnees ?? null),
          })
        } catch (e) {
          resultats.push(
            erreurOutil(appel.id, e instanceof Error ? e.message : 'Lecture impossible.'),
          )
        }
        continue
      }

      // ── Écriture : on ne fait rien, on décrit ──────────────
      let resume: Awaited<ReturnType<typeof outil.resumer>>
      try {
        resume = await outil.resumer(valides.data, ctx)
      } catch (e) {
        resultats.push(
          erreurOutil(appel.id, e instanceof Error ? e.message : 'Action impossible.'),
        )
        continue
      }
      if (!resume.ok) {
        // Filou reprend la main avec la raison : il expliquera, ou tentera
        // autrement. Un bouton qui échouerait au clic serait pire.
        resultats.push(erreurOutil(appel.id, resume.raison))
        continue
      }

      // Une proposition s'affiche au même endroit qu'une réponse, avec un
      // bouton en plus. Le mot que Filou a écrit avant d'appeler l'outil sert
      // d'introduction s'il en a écrit un — c'est plus vivant que la phrase
      // toute faite de l'outil.
      const p = resume.proposition
      return {
        mot: 'Je te propose ça sur le tableau.',
        titre: p.titre,
        introduction: texte || p.phrase,
        lignes: p.lignes ?? [],
        action: {
          outil: outil.nom,
          params: valides.data,
          charge: resume.charge,
          libelle: p.action,
          avertissement: p.avertissement,
        },
        outilsAppeles,
        mesure: mesure(),
      }
    }

    messages.push({ role: 'user', content: resultats })
  }

  return {
    mot: 'Je m’arrête là.',
    titre: 'Je tourne en rond',
    introduction:
      "Je n'arrive pas à aboutir sur cette demande — je préfère m'arrêter plutôt que de continuer à chercher. Reformule-la autrement ?",
    lignes: [],
    outilsAppeles,
    mesure: mesure(),
  }
}

/**
 * Le fil, mis en forme pour l'API.
 *
 * Deux exigences de l'API que l'historique venu de l'écran ne respecte pas
 * spontanément : la conversation COMMENCE par la personne (un fil qui débute
 * par une phrase de Filou est refusé), et deux tours du même côté à la suite
 * sont fusionnés plutôt qu'empilés. Le cas arrive pour de bon : Filou répond,
 * puis la décision prise sur le tableau vient s'annoncer dans le fil — deux
 * messages de Filou d'affilée.
 */
export function assemblerMessages(
  historique: EchangeFilou[],
  dernier: string,
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = []
  for (const e of historique) {
    const texte = e.texte.trim()
    if (!texte) continue
    // Rien avant la première prise de parole de la personne.
    if (messages.length === 0 && e.role !== 'user') continue
    const precedent = messages.at(-1)
    if (precedent && precedent.role === e.role) {
      precedent.content = `${precedent.content as string}\n\n${texte}`
      continue
    }
    messages.push({ role: e.role, content: texte })
  }

  // La nouvelle demande ferme le fil. Si le dernier tour retenu venait déjà de
  // la personne, on les fusionne plutôt que d'empiler deux « user ».
  const precedent = messages.at(-1)
  if (precedent && precedent.role === 'user') {
    precedent.content = `${precedent.content as string}\n\n${dernier}`
  } else {
    messages.push({ role: 'user', content: dernier })
  }
  return messages
}

/** Une panne : rien à afficher, juste à dire. */
function issueVide(outilsAppeles: string[], erreur: string): IssueFilou {
  return { mot: erreur, titre: '', introduction: '', lignes: [], outilsAppeles, erreur }
}

function erreurOutil(id: string, texte: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: id, content: texte, is_error: true }
}
