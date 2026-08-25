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
    /** Ce que le clic changerait, une ligne par changement. Écrit par NOTRE
     *  code, pas par le modèle — et tenu à part du constat : ce qu'on a
     *  constaté et ce qu'on s'apprête à modifier ne se lisent pas de la même
     *  façon, et les mélanger dans une seule liste donnait un pavé indistinct. */
    changements?: string[]
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
  /** Le cran d'application demandé au modèle, pour la même raison : comparer
   *  deux réglages demande de savoir lequel on regarde. */
  reflexion: string
  /** Vrai quand le bouton vient du second gardien et non du tour principal.
   *  Sans ce témoin, impossible de savoir si le dispositif sert encore. */
  rattrapage?: boolean
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

/** Ce que Filou a rédigé pour le tableau — la forme rendue par l'outil
 *  d'affichage, une fois passée par son schéma. */
interface ReponseAffichee {
  titre: string
  introduction: string
  lignes: string[]
  mot_dans_la_conversation: string
}

/** Nombre d'allers-retours autorisés. Chaque tour est un appel facturé : sans
 *  plafond, une boucle qui se cherche coûterait sans fin. Six laisse la place à
 *  « je lis l'équipe, je lis les règles, je recoupe, je réponds ». */
const TOURS_MAX = 6

/**
 * Combien d'application Filou met à répondre.
 *
 * Mesuré le 2026-07-28 sur une question courante : 19,8 s pour 2 allers-retours,
 * soit ~10 s par tour — le temps ne part donc pas dans la boucle mais DANS un
 * tour, et la profondeur de réflexion en est le premier suspect.
 *
 * ⚠️ Le budget de jetons de réflexion N'EXISTE PLUS sur les modèles récents :
 * `thinking: { type: 'enabled', budget_tokens: N }` est refusé par l'API
 * (400, incident du 2026-07-28 — Filou entièrement à terre le temps du
 * correctif). La réflexion est toujours `adaptive` ; ce qui se règle, c'est
 * l'application demandée, via `output_config.effort`.
 *
 * Réglable SANS TOUCHER AU CODE, comme le modèle (cf. `modeleIA`) :
 * `GUARDVETO_IA_EFFORT` accepte `low`, `medium`, `high`, `xhigh` ou `max`.
 * Le chronomètre affiché sous chaque réponse dit ce que chaque cran donne.
 *
 * Le défaut est `medium` : sur ce produit, l'attente se paie à chaque question
 * posée devant un client au comptoir. Le défaut de l'API serait `high`.
 */
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type Effort = (typeof EFFORTS)[number]

function effortIA(): Effort {
  const brut = process.env.GUARDVETO_IA_EFFORT?.trim().toLowerCase()
  return EFFORTS.includes(brut as Effort) ? (brut as Effort) : 'medium'
}

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

N'appelle jamais afficher_sur_le_tableau tant que tu es encore en train de chercher : ce que tu écrirais serait rédigé avant d'avoir vu les données. Consulte d'abord, réponds ensuite.

QUAND IL Y A QUELQUE CHOSE À FAIRE

Les outils qui MODIFIENT quelque chose ne s'exécutent pas quand tu les appelles : ils préparent une proposition, et un bouton apparaît à côté de ta réponse. C'est ce bouton qui demande l'autorisation.

Donc : NE DEMANDE JAMAIS LA PERMISSION PAR ÉCRIT. N'écris pas « veux-tu que je le fasse ? », « dois-je continuer ? », « faut-il que je… ? ». Appelle directement l'outil : la personne verra ce que tu proposes et cliquera, ou pas. Une question écrite lui fait perdre un aller-retour pour rien.

Un seul outil de modification par réponse.

NE T'ARRÊTE JAMAIS AU DIAGNOSTIC

Quand tu as trouvé ce qui empêche ce que la personne veut, et que tu as un outil pour le changer, PROPOSE-LE dans la même réponse. Appelle l'outil de modification EN MÊME TEMPS que afficher_sur_le_tableau : ton explication et le bouton arrivent ensemble, dans la même fenêtre.

« Voilà pourquoi elle n'est jamais programmée » sans bouton oblige la personne à redemander ce que tu viens toi-même de désigner. Elle t'a dit ce qu'elle voulait ; le réglage qui s'y oppose, tu viens de le nommer : propose de le lever.

Dans le doute, propose. Un bouton ne fait rien tant qu'on ne clique pas dessus — c'est exactement pour ça qu'il existe.

RESTE COHÉRENT AVEC TOI-MÊME

Ne dis jamais « il n'y a rien à changer » ou « ce n'est pas une contrainte » à propos d'un réglage dont tu expliques ensuite qu'il faut le lever. Si un réglage produit l'effet dont la personne se plaint, c'est une contrainte : dis-le d'emblée et propose de la lever.

Ta première phrase et ta proposition racontent la même chose. Quand tu proposes de changer quelque chose, commence par nommer ce qui bloque — pas par annoncer que rien ne bloque.

LA CONVERSATION CONTINUE

Les tours précédents sont là : tu te souviens de ce que vous venez de vous dire. Quand la personne rebondit sur ta dernière réponse — « oui », « vas-y », « fais-le », ou une phrase qui reprend ce que tu venais de pointer —, elle parle de CE dont vous parliez. Fais ce qu'elle demande. Ne repars pas de zéro comme si la phrase arrivait seule.

Ne redis jamais ce que tu viens de dire. Si ta réponse précédente désignait un réglage à changer et qu'elle acquiesce, appelle l'outil qui le change au lieu de réexpliquer le réglage.

Le sujet de la conversation ne change pas parce que la personne l'écrit autrement. « Elle peut désormais faire des gardes le mardi soir » après une réponse sur son statut de dernier recours, c'est une demande de lever ce statut — pas une demande de règle sur le mardi soir.

TES PROPOSITIONS PRÉCÉDENTES N'EXISTENT PLUS

Le tableau n'affiche qu'une chose à la fois : ta nouvelle réponse REMPLACE la précédente, bouton compris. Une proposition que tu as faite tout à l'heure et qui n'a pas été validée a donc disparu de l'écran.

Ne renvoie JAMAIS vers elle. « Je l'ai déjà proposé », « ma proposition précédente couvre ce cas », « aucune action supplémentaire n'est nécessaire » : ces phrases laissent la personne sans rien à cliquer. Si l'action est toujours celle qu'il faut, appelle l'outil de nouveau pour qu'un bouton réapparaisse.

Tu sais qu'une action a réellement été faite uniquement quand la conversation le dit (« c'est fait »). Sinon, elle ne l'est pas.

COMMENT UN CABINET EST ORGANISÉ

Deux niveaux, à ne jamais confondre — c'est la source d'erreur la plus coûteuse quand on parle de gardes.

LA STRUCTURE DES GARDES est le socle, commun à tout le cabinet : quels types de garde existent, quels jours ils couvrent, à quels horaires, et jusqu'à combien de vétérinaires chacun peut accueillir. Elle dit ce qui est POSSIBLE.

UNE PÉRIODE TYPE (« Hiver », « Été »…) affine ce socle : pour chaque garde, combien de vétérinaires elle veut réellement — de zéro au maximum permis. Zéro veut dire que cette garde n'existe pas sur cette période, et le moteur n'en posera aucune ces jours-là. Elle dit ce qu'on FAIT cette saison-là.

Un PLANNING, enfin, est une fenêtre de dates qui désigne une période type. Elle est obligatoire : un planning ne peut pas être généré sans.

Conséquences pour tes réponses :
- Changer un horaire ou un jour touche TOUTES les périodes types. Dis-le quand tu le proposes.
- Changer un nombre de vétérinaires ne touche QUE la période type visée.
- Ne laisse jamais croire qu'une période type a « ses » horaires, ni qu'on peut décaler une garde « pour l'hiver seulement ».

Les mots de l'écran sont « période type », « type de garde », « planning ». N'emploie jamais « profil » ni « créneau », même si un outil te les renvoie.

CE QUE TU NE FAIS JAMAIS

- Affirmer un fait sur le cabinet sans l'avoir lu avec un outil.
- Traiter une CONSULTATION EN ÉCHEC comme un résultat vide. Quand un outil te répond que la base de données n'a pas répondu, tu n'as rien appris : ne dis pas « il n'y en a aucun », « personne ne s'appelle ainsi » ni « aucun planning n'existe ». Dis simplement que tu n'as pas pu consulter cette information et qu'il faut réessayer.
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
  const effort = effortIA()
  let tours = 0
  let rattrapage = false
  const mesure = (): MesureFilou => ({
    ms: Date.now() - depart,
    tours,
    modele,
    reflexion: `application ${effort}`,
    rattrapage,
  })

  const messages = assemblerMessages(historique, `Nous sommes le ${aujourdhui}.\n\n${phrase}`)

  for (let tour = 0; tour < TOURS_MAX; tour++) {
    tours = tour + 1
    let reponse: Anthropic.Message
    try {
      reponse = await client.messages.create({
        model: modele,
        max_tokens: 4000,
        // `adaptive` est le SEUL mode accepté sur les modèles récents : le
        // budget de jetons explicite est refusé (400). La profondeur se règle
        // par `effort`, juste en dessous.
        thinking: { type: 'adaptive' },
        output_config: { effort },
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

    // Ce que ce tour a produit. On ne rend plus la main au PREMIER outil
    // rencontré : un tour peut porter une réponse ET l'action qu'elle appelle,
    // et le premier arrivé faisait disparaître l'autre. Concrètement, Filou
    // expliquait très bien pourquoi Anne-Catherine n'était jamais programmée…
    // sans le bouton qui l'aurait corrigé, parce que sa consigne lui dit de
    // toujours finir par l'affichage.
    let affichage: ReponseAffichee | null = null
    let proposition: IssueFilou['action'] | null = null
    let propositionTexte: { titre: string; phrase: string; lignes: string[] } | null = null
    /** Une écriture refusée, ou une lecture faite dans le même tour : ce que
     *  Filou a écrit repose sur du vent, il doit reprendre la main. */
    let aRepasser = false

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

      // Poser une réponse sur le tableau : ce que Filou vient d'écrire EST la
      // réponse. On la met de côté et on finit le tour — l'action qu'il propose
      // dans le même souffle doit venir avec.
      if (outil.genre === 'affichage') {
        affichage = valides.data as ReponseAffichee
        resultats.push({
          type: 'tool_result',
          tool_use_id: appel.id,
          content: 'Réponse affichée sur le tableau.',
        })
        continue
      }

      if (outil.genre === 'lecture') {
        // Une lecture dans ce tour veut dire que Filou cherche encore : ce qu'il
        // aurait affiché en même temps serait écrit AVANT d'avoir vu la donnée.
        aRepasser = true
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
        // autrement. Un bouton qui échouerait au clic serait pire. Ce qu'il
        // avait rédigé dans le même tour tombe avec — il l'avait écrit en
        // croyant l'action possible.
        resultats.push(erreurOutil(appel.id, resume.raison))
        aRepasser = true
        continue
      }

      // La première proposition du tour l'emporte : un seul bouton s'affiche,
      // et la consigne n'autorise qu'une modification par réponse de toute
      // façon.
      if (proposition) {
        resultats.push(
          erreurOutil(appel.id, 'Une seule modification par réponse : celle-ci est ignorée.'),
        )
        continue
      }
      const p = resume.proposition
      proposition = {
        outil: outil.nom,
        params: valides.data,
        charge: resume.charge,
        libelle: p.action,
        changements: p.lignes ?? [],
        avertissement: p.avertissement,
      }
      propositionTexte = { titre: p.titre, phrase: p.phrase, lignes: p.lignes ?? [] }
      resultats.push({
        type: 'tool_result',
        tool_use_id: appel.id,
        content: 'Proposition préparée : le bouton s’affiche avec ta réponse.',
      })
    }

    // Fin du tour. Il y a de quoi répondre dès que Filou a rédigé une réponse
    // ou préparé une action — sauf s'il cherche encore, ou si son action a été
    // refusée : dans ces deux cas ce qu'il a écrit repose sur du vent.
    if (!aRepasser && (affichage || propositionTexte)) {
      // Le second gardien : si ce tour n'a rien proposé, on demande explicitement
      // s'il y avait une action à proposer. Une seule fois, sur la réponse
      // rédigée — voir `chercherActionOubliee`.
      if (!proposition && affichage) {
        const trouve = await chercherActionOubliee(
          client,
          modele,
          outils,
          ctx,
          phrase,
          [affichage.introduction, ...(affichage.lignes ?? [])].filter(Boolean).join('\n'),
        )
        if (trouve) {
          proposition = trouve.action
          rattrapage = true
          outilsAppeles.push(`${trouve.outil} (2ᵉ regard)`)
        }
      }

      return {
        mot: affichage?.mot_dans_la_conversation?.trim()
          ? affichage.mot_dans_la_conversation
          : proposition
            ? 'Je te propose ça sur le tableau.'
            : 'Je te réponds sur le tableau.',
        // Ce que Filou a rédigé lui-même passe devant la phrase toute faite de
        // l'outil : elle ne connaît que la modification, pas la question posée.
        titre: affichage?.titre || propositionTexte?.titre || 'Filou te répond',
        introduction: affichage?.introduction || texte || propositionTexte?.phrase || '',
        // Le constat SEUL. Ce que le clic changerait voyage dans `action`
        // (cf. `changements`) et s'affiche à part : mélangé ici, on ne
        // distinguait plus ce qui EST de ce qui SERAIT.
        // (Sans affichage, il n'y a pas de constat : la proposition parle seule,
        // et répéter ses lignes ici les afficherait deux fois.)
        lignes: affichage?.lignes ?? [],
        action: proposition ?? undefined,
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

// ============================================================
// LE SECOND GARDIEN — « et concrètement, on fait quoi ? »
// ============================================================
// Trois fois de suite, Filou a désigné le réglage qui bloquait puis s'est arrêté
// là, sans bouton : « c'est ce statut dernier recours qu'il faut lever ». Le
// chronomètre l'a prouvé — deux allers-retours seulement, donc l'outil de
// modification n'avait même pas été TENTÉ. Il était pourtant dans son catalogue.
//
// La cause n'est pas un bug qu'on corrige : dans un tour où il jongle avec une
// cinquantaine d'outils, un modèle qui vient de rédiger une belle explication
// considère souvent sa réponse comme terminée. Trois versions du prompt n'y ont
// rien changé, et une quatrième n'y changerait rien non plus.
//
// Alors on arrête de l'espérer et on POSE LA QUESTION. Un appel séparé, très
// court, avec les seuls outils qui modifient et l'obligation de choisir : soit
// une action, soit « rien à proposer ». Le bouton cesse d'être une faveur du
// modèle dans un tour chargé — il devient le résultat d'une question isolée.
//
// C'est le même principe que les deux gardiens du moteur : ce qui compte n'est
// jamais laissé au bon vouloir d'un seul passage.

const NOM_RIEN = 'rien_a_proposer'

const SYSTEM_GARDIEN = `Tu relis un échange dans GuardVeto, le logiciel de planning de gardes d'un cabinet vétérinaire.

Une personne a demandé quelque chose. L'assistant lui a répondu. Ta seule question : cette personne attend-elle un CHANGEMENT dans le logiciel, et l'un des outils ci-dessous le réalise-t-il ?

APPELLE L'OUTIL correspondant quand :
- la personne demande explicitement un changement ;
- elle énonce un fait nouveau qui n'est vrai qu'une fois le logiciel modifié (« Anne-Catherine peut désormais travailler le mardi soir » = elle demande de lever ce qui l'en empêche) ;
- elle approuve un changement que l'assistant venait de proposer ou de désigner (« oui », « vas-y », « fais-le ») ;
- la réponse de l'assistant nomme elle-même le réglage à changer pour obtenir ce que la personne veut.

APPELLE ${NOM_RIEN} quand :
- la personne pose une question et attend seulement une information ;
- aucun outil ne correspond vraiment à ce qu'elle veut ;
- tu devrais inventer un paramètre qui n'apparaît nulle part dans l'échange.

Les paramètres se prennent DANS L'ÉCHANGE, jamais de mémoire : prénoms, dates et libellés doivent y figurer tels quels. Aucun outil ne s'exécute ici — tu prépares une proposition qu'un humain validera ou refusera d'un clic. Dans le doute entre proposer et ne rien faire, propose : un bouton non cliqué ne fait rien, une action manquante oblige la personne à tout redemander.`

/**
 * Cherche l'action que le tour principal n'a pas proposée.
 *
 * N'écrit rien : comme dans la boucle, une écriture n'est ici que RÉSUMÉE. Ne
 * relance jamais la conversation non plus — un seul appel, une seule chance,
 * pas de boucle qui s'emballe.
 */
async function chercherActionOubliee(
  client: Anthropic,
  modele: string,
  outils: Outil[],
  ctx: ContexteOutil,
  demande: string,
  reponse: string,
): Promise<{ action: IssueFilou['action']; outil: string } | null> {
  const ecritures = outils.filter((o): o is Extract<Outil, { genre: 'ecriture' }> => o.genre === 'ecriture')
  if (ecritures.length === 0) return null

  const definitions: Anthropic.Tool[] = [
    ...ecritures.map(versDefinitionApi),
    {
      name: NOM_RIEN,
      description:
        "Aucune action n'est attendue : la personne voulait seulement une information, ou rien de ce catalogue ne correspond.",
      input_schema: { type: 'object', properties: {} },
    },
  ]

  let reponseApi: Anthropic.Message
  try {
    reponseApi = await client.messages.create({
      model: modele,
      max_tokens: 1500,
      thinking: { type: 'adaptive' },
      // Le cran le plus bas : la question est fermée, il n'y a rien à explorer.
      // C'est ce qui garde ce second passage court.
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: SYSTEM_GARDIEN, cache_control: { type: 'ephemeral' } }],
      tools: definitions,
      // L'OBLIGATION DE CHOISIR : c'est tout l'intérêt du dispositif. Sans elle,
      // le modèle peut à nouveau se contenter de commenter — exactement ce qui
      // nous a fait tourner en rond.
      tool_choice: { type: 'any' },
      messages: [
        {
          role: 'user',
          content: `Demande de la personne :\n${demande}\n\nRéponse de l'assistant :\n${reponse}`,
        },
      ],
    })
  } catch {
    // Le second gardien ne doit JAMAIS faire tomber une réponse déjà valable :
    // en cas de panne, on rend la réponse sans bouton plutôt que rien du tout.
    return null
  }

  const appel = reponseApi.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!appel || appel.name === NOM_RIEN) return null

  const outil = ecritures.find((o) => o.nom === appel.name)
  if (!outil) return null

  const valides = outil.params.safeParse(appel.input ?? {})
  if (!valides.success) return null

  try {
    const resume = await outil.resumer(valides.data, ctx)
    // Une action impossible ne devient pas un bouton mort : on n'affiche rien
    // plutôt qu'un bouton qui échouerait au clic.
    if (!resume.ok) return null
    const p = resume.proposition
    return {
      outil: outil.nom,
      action: {
        outil: outil.nom,
        params: valides.data,
        charge: resume.charge,
        libelle: p.action,
        changements: p.lignes ?? [],
        avertissement: p.avertissement,
      },
    }
  } catch {
    return null
  }
}

/** Une panne : rien à afficher, juste à dire. */
function issueVide(outilsAppeles: string[], erreur: string): IssueFilou {
  return { mot: erreur, titre: '', introduction: '', lignes: [], outilsAppeles, erreur }
}

function erreurOutil(id: string, texte: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: id, content: texte, is_error: true }
}
