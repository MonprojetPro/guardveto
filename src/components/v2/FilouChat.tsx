'use client'

// ============================================================
// GUARDVETO V2 — Parler à Filou (la tablette devient conversation)
// ============================================================
// La maquette M6 montrait une tablette avec un fil de discussion, mais SANS
// champ de saisie : Filou parlait, personne ne pouvait lui répondre. Le champ
// avait été volontairement écarté au portage — un champ qui ne fait rien est
// une coquille vide. Il arrive maintenant qu'il y a de quoi le brancher.
//
// CE QUE FILOU SAIT VRAIMENT FAIRE se lit à UN seul endroit : le catalogue
// d'outils (`src/lib/ia/outils/registre.ts`). Il y lit le planning, les congés,
// les échanges, les absences, l'équipe, les règles et la structure, et propose
// des écritures que l'humain valide. Rien ici ne doit annoncer une capacité qui
// n'y figure pas — et toute écriture repasse par les MÊMES actions serveur que
// les boutons de l'application, jamais par une seconde implémentation.
//
// LA TABLETTE NE PORTE QUE LA CONVERSATION. Ce que Filou COMPREND part sur le
// tableau du cabinet via `onResultat` (cf. `FilouResultat.tsx`) : c'est là qu'il
// y a la place de lire et de décider. Ici ne restent que les tours de parole —
// ce qu'on demande, ce que Filou répond, ce qu'il n'a pas su faire.
//
// GARDE-FOU, non négociable : Filou PROPOSE, l'humain DÉCIDE. Rien n'est écrit
// en base avant le clic sur « Créer cette règle », qui vit désormais sur le
// tableau.
//
// ADMIN SEULEMENT : l'action serveur est admin-only. Afficher le champ à un
// vétérinaire non-admin lui promettrait une conversation qui répondrait « accès
// refusé » à chaque essai — soit exactement la coquille vide qu'on refuse. Il
// voit donc le fil de Filou, sans le champ.
//
// CE QUI N'EST PAS LÀ, sciemment : la conversation ne SURVIT PAS au
// rechargement de la page (aucune table de messages). Filou ne répond pas non
// plus aux questions sur le planning (« qui est de garde jeudi ? ») : il ne sait
// pas encore lire le planning pour répondre, et deviner serait mentir.
// ============================================================

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react'
import { parlerAFilou } from '@/app/(protected)/filou/actions'
import type { ContenuResultat, ResultatFilou } from './FilouResultat'

/** Un tour de parole dans le fil. Il n'y a plus que de la parole : une
 *  proposition à décider n'est pas un message, c'est un résultat — et les
 *  résultats vont sur le tableau. */
type Message = {
  id: number
  de: 'moi' | 'filou'
  texte: string
  /** Des phrases toutes prêtes proposées sous la bulle. Un clic les ENVOIE
   *  directement.
   *
   *  La version précédente les déposait dans le champ pour qu'on les relise :
   *  ça se tenait tant qu'elles contenaient des prénoms et des dates inventés
   *  qu'il fallait corriger à la main. Elles sont maintenant taillées dans la
   *  donnée réelle du cabinet (cf. `filou-origine.ts`) — il n'y a plus rien à
   *  corriger, et faire relire une phrase déjà juste était une étape pour rien. */
  exemples?: string[]
  /** Ce que Filou doit se rappeler avoir dit, quand ce n'est pas ce qui
   *  s'affiche. Sa vraie réponse est sur le tableau ; dans le fil il ne reste
   *  qu'un renvoi (« je te réponds sur le tableau »). Lui renvoyer ce renvoi
   *  revenait à lui donner la vitrine sans le contenu — il ne se souvenait de
   *  rien et repartait de zéro à la phrase suivante. */
  pourFilou?: string
}

/** Où la conversation survit à une navigation.
 *
 *  `sessionStorage` et non la base : la conversation n'a pas vocation à être
 *  archivée ni relue plus tard, elle doit juste survivre à un aller-retour vers
 *  l'onglet Équipe. Elle disparaît donc à la fermeture de l'onglet — ce qui est
 *  aussi ce qu'on veut sur un poste partagé au cabinet. */
const CLE_CONVERSATION = 'guardveto.filou.conversation'

function relireConversation(): Message[] {
  if (typeof window === 'undefined') return []
  try {
    const brut = window.sessionStorage.getItem(CLE_CONVERSATION)
    if (!brut) return []
    const lu: unknown = JSON.parse(brut)
    if (!Array.isArray(lu)) return []
    // On revalide la forme : une valeur écrite par une version précédente ne
    // doit pas faire planter la tablette au chargement.
    return lu.filter(
      (m): m is Message =>
        typeof m?.id === 'number' &&
        typeof m?.texte === 'string' &&
        (m?.de === 'moi' || m?.de === 'filou') &&
        (m?.pourFilou === undefined || typeof m.pourFilou === 'string') &&
        (m?.exemples === undefined ||
          (Array.isArray(m.exemples) &&
            m.exemples.every((e: unknown) => typeof e === 'string'))),
    )
  } catch {
    return []
  }
}

function memoriserConversation(messages: Message[]) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(CLE_CONVERSATION, JSON.stringify(messages))
  } catch {
    // Stockage plein ou refusé : la conversation vivra le temps de la page.
    // Ce n'est pas une raison de casser l'écran.
  }
}

/** Longueur maximale d'une consigne. Chaque envoi est un appel facturé au
 *  modèle : une garde de bon sens côté saisie évite qu'un copier-coller
 *  malheureux part en analyse. La vraie limite reste à poser côté serveur. */
const LONGUEUR_MAX = 400


/** Ce que l'Épicentre peut demander à la tablette : faire parler Filou. C'est
 *  ce qui permet au tableau (« créée », « abandonnée ») de revenir commenter
 *  dans la conversation, au lieu de laisser deux moitiés d'écran s'ignorer. */
export interface FilouChatHandle {
  dit: (texte: string, options?: OptionsDit) => void
}

export interface OptionsDit {
  /** Phrases toutes prêtes à proposer sous la bulle. Ignorées hors
   *  administrateur : sans champ de saisie, un exemple cliquable ne mènerait
   *  nulle part. */
  exemples?: string[]
  /** Ne rien ajouter si Filou vient déjà de dire exactement ça. Sert aux
   *  phrases déclenchées par une navigation (cf. l'accroche d'origine dans
   *  `Epicentre`) : quatre allers-retours sans un mot entre-temps ne doivent pas
   *  empiler quatre fois la même bulle. */
  saufSiDejaDit?: boolean
}

interface Props {
  /** Le mot d'accueil : premier message du fil, toujours présent. */
  enTete: ReactNode
  estAdmin: boolean
  /** Fait taper Filou sur sa tablette pendant qu'il réfléchit. */
  onFilouTape?: () => void
  /** Ce que Filou a compris, à afficher sur le tableau du cabinet. */
  onResultat: (r: ResultatFilou) => void
  /** On repart de zéro : le tableau doit se vider en même temps que le fil,
   *  sinon on efface la conversation et la réponse reste affichée à droite,
   *  orpheline de la question qui l'a produite. */
  onRemiseAZero: () => void
}

export const FilouChat = forwardRef<FilouChatHandle, Props>(function FilouChat(
  { enTete, estAdmin, onFilouTape, onResultat, onRemiseAZero },
  ref,
) {
  const champId = useId()
  // La conversation est relue depuis l'onglet AU PREMIER RENDU : aller voir une
  // fiche puis revenir démonte ce composant, et sans ça on retrouvait une
  // tablette vide — comme si Filou avait tout oublié le temps d'un aller-retour.
  const [messages, setMessages] = useState<Message[]>(relireConversation)
  const [phrase, setPhrase] = useState('')
  const [enCours, demarrer] = useTransition()
  // La remise à zéro demande confirmation : effacer un échange qu'on est en
  // train de lire sur un clic malheureux serait irrattrapable (rien n'est
  // archivé). Le bouton pose donc la question avant de faire.
  const [confirmeRaz, setConfirmeRaz] = useState(false)
  // La lecture d'un document a son propre témoin d'attente : elle prend dix à
  // trente secondes (une photo de planning se lit page par page), là où une
  // phrase revient en cinq. Les confondre ferait croire à un blocage.
  const filRef = useRef<HTMLDivElement>(null)
  const champRef = useRef<HTMLTextAreaElement>(null)
  /** Verrou d'envoi, lisible dans le même battement que le clic (cf. `envoyerTexte`). */
  const envoiParti = useRef(false)
  const compteur = useRef(messages.at(-1)?.id ?? 0)

  // Le fil tel qu'il est MAINTENANT, lisible hors du rendu. `dit` doit pouvoir
  // comparer sa phrase au dernier message avant d'écrire, et il est appelé
  // depuis un effet du parent — la variable `messages` capturée par la fermeture
  // y serait celle du rendu précédent.
  const filActuel = useRef(messages)
  useEffect(() => {
    filActuel.current = messages
  }, [messages])

  const ajouter = (
    de: Message['de'],
    texte: string,
    extra?: { pourFilou?: string; exemples?: string[] },
  ) => {
    compteur.current += 1
    const message: Message = { id: compteur.current, de, texte, ...extra }
    setMessages((prec) => {
      const suite = [...prec, message]
      memoriserConversation(suite)
      return suite
    })
    filActuel.current = [...filActuel.current, message]
  }

  useImperativeHandle(ref, () => ({
    dit: (texte: string, options?: OptionsDit) => {
      const dernier = filActuel.current.at(-1)
      if (options?.saufSiDejaDit && dernier?.de === 'filou' && dernier.texte === texte) return
      ajouter('filou', texte, {
        // Sans champ de saisie, un exemple cliquable ne mène nulle part : on ne
        // les propose donc qu'à qui peut s'en servir.
        exemples: estAdmin && options?.exemples?.length ? options.exemples : undefined,
      })
    },
  }))

  /** On repart d'une page blanche : le fil, sa trace dans l'onglet, le champ,
   *  et le tableau du cabinet. Le mot d'accueil (`enTete`) reste : il n'est pas
   *  un tour de parole, c'est l'état du cabinet ce matin. */
  const remettreAZero = () => {
    if (enCours) return
    setMessages([])
    memoriserConversation([])
    compteur.current = 0
    setPhrase('')
    setConfirmeRaz(false)
    onRemiseAZero()
    requestAnimationFrame(() => champRef.current?.focus())
  }

  // La demande de confirmation ne reste pas plantée sur l'écran : sans réponse,
  // le bouton reprend son visage normal plutôt que de guetter un clic oublié.
  useEffect(() => {
    if (!confirmeRaz) return
    const t = setTimeout(() => setConfirmeRaz(false), 6000)
    return () => clearTimeout(t)
  }, [confirmeRaz])

  // Le fil descend sur le dernier message : sans ça, la réponse de Filou
  // arriverait sous la ligne de flottaison, invisible.
  useEffect(() => {
    if (messages.length === 0) return
    const fil = filRef.current
    if (fil) fil.scrollTop = fil.scrollHeight
  }, [messages])

  /** Le résultat part sur le tableau, et le fil dit où regarder : sans cette
   *  phrase, quelque chose apparaîtrait à l'autre bout de l'écran sans que rien
   *  ne l'annonce. */
  const annoncerEtMontrer = (contenu: ContenuResultat, mot?: string) => {
    // Le mot de Filou s'il en a écrit un, sinon une phrase qui dit où regarder :
    // sans ça, quelque chose apparaîtrait à l'autre bout de l'écran sans que
    // rien ne l'annonce.
    //
    // Ce qui part sur le tableau est ce dont Filou doit se souvenir : le mot du
    // fil ne dit rien de ce qu'il a répondu.
    //
    // Et s'il avait proposé quelque chose, on lui dit que cette proposition A
    // DISPARU — le tableau n'affiche qu'un résultat à la fois, celui-ci l'a
    // remplacée. Sans ça il renvoie vers un bouton qui n'existe plus (« je l'ai
    // déjà proposé, rien à faire de plus »), et la personne n'a plus rien à
    // cliquer nulle part.
    ajouter(
      'filou',
      mot?.trim() || 'J’ai compris ta demande — je l’affiche sur le tableau du cabinet.',
      { pourFilou: [
        contenu.introduction,
        ...(contenu.lignes ?? []),
        // Ce qu'il proposait de changer vit désormais à part de son constat
        // (cf. `FilouResultat`) : sans cette reprise, il ne se souviendrait plus
        // de ce que son propre bouton faisait.
        ...(contenu.action?.changements ?? []).map((c) => `Tu proposais : ${c}`),
        contenu.action
          ? `(Tu as proposé « ${contenu.action.libelle} ». Cette proposition n’est plus affichée : ta prochaine réponse a pris sa place sur le tableau.)`
          : '',
      ]
        .filter(Boolean)
        .join('\n') },
    )
    compteur.current += 1
    onResultat({ ...contenu, id: compteur.current })
    requestAnimationFrame(() => champRef.current?.focus())
  }

  /** Les pistes d'un message ont servi : elles disparaissent.
   *
   *  Les laisser sous une bulle devenue ancienne invite à recliquer la même
   *  question — soit un second appel facturé au modèle pour une réponse déjà
   *  obtenue. L'offre d'ouverture ne vaut qu'une fois ; ensuite, on écrit. */
  const oublierPistes = (idMessage: number) => {
    setMessages((prec) => {
      const suite = prec.map((m) => (m.id === idMessage ? { ...m, exemples: undefined } : m))
      memoriserConversation(suite)
      return suite
    })
    filActuel.current = filActuel.current.map((m) =>
      m.id === idMessage ? { ...m, exemples: undefined } : m,
    )
  }

  /** Le geste unique d'envoi : depuis le champ comme depuis une piste. */
  const envoyerTexte = (brut: string) => {
    const texte = brut.trim().slice(0, LONGUEUR_MAX)
    if (texte.length < 3 || enCours || envoiParti.current) return
    // `enCours` vient d'une transition : il ne repasse à vrai qu'au rendu
    // suivant. Deux clics dans le même battement passeraient donc tous les
    // deux — et un envoi de trop, c'est un appel de trop facturé au modèle.
    envoiParti.current = true

    // Le fil PRÉCÉDENT part avec la demande : sans lui, Filou relisait chaque
    // phrase comme si elle arrivait seule et réexpliquait ce qu'il venait de
    // dire dès qu'on rebondissait sur sa réponse. Le serveur le borne et
    // n'en tire aucun droit — cf. `assainirHistorique`.
    //
    // Lu dans `filActuel` et pas dans `messages` : une piste cliquée vient de
    // retirer ses propres exemples du fil, et l'état du rendu est en retard.
    const fil = filActuel.current.map((m) => ({
      role: m.de === 'moi' ? ('user' as const) : ('assistant' as const),
      texte: m.pourFilou ?? m.texte,
    }))

    ajouter('moi', texte)
    setConfirmeRaz(false)
    onFilouTape?.()

    demarrer(async () => {
      // `finally` et pas une simple ligne après l'attente : si l'action serveur
      // part en exception (réseau coupé), le verrou resterait fermé et la
      // tablette n'accepterait plus jamais rien.
      let reponse: Awaited<ReturnType<typeof parlerAFilou>>
      try {
        reponse = await parlerAFilou(texte, fil)
      } finally {
        envoiParti.current = false
      }

      // Une panne n'est pas une réponse : elle se dit dans la conversation,
      // elle n'a rien à faire sur le tableau.
      if ('error' in reponse) {
        // Une panne se dit à la personne, mais ne se raconte pas à Filou : lui
        // renvoyer son propre message d'erreur comme s'il l'avait pensé le
        // ferait raisonner dessus au tour suivant. Texte vide = tour ignoré.
        ajouter('filou', reponse.error, { pourFilou: '' })
        requestAnimationFrame(() => champRef.current?.focus())
        return
      }

      // Tout le reste part sur le tableau, réponse comme proposition : c'est le
      // même modèle, avec ou sans bouton.
      annoncerEtMontrer(
        {
          titre: reponse.titre,
          introduction: reponse.introduction,
          lignes: reponse.lignes,
          action: reponse.action,
          mesure: reponse.mesure,
        },
        reponse.mot,
      )
    })
  }

  /** Ce que fait le bouton d'envoi : prendre ce qui est écrit et le faire
   *  partir. Le champ se vide ici, et pas dans `envoyerTexte` — une piste
   *  cliquée ne doit pas effacer un brouillon en cours de frappe. */
  const envoyer = () => {
    if (enCours || phrase.trim().length < 3) return
    const texte = phrase
    setPhrase('')
    envoyerTexte(texte)
  }

  /** Une piste part TELLE QUELLE, sans étape de relecture. */
  const envoyerPiste = (idMessage: number, texte: string) => {
    if (enCours) return
    oublierPistes(idMessage)
    envoyerTexte(texte)
  }

  return (
    <>
      <div className="thread" ref={filRef} aria-label="Ce que Filou a préparé">
        <div aria-live="polite">{enTete}</div>

        {messages.map((m) =>
          m.de === 'moi' ? (
            <div className="msg user" key={m.id}>
              <div className="bubble">{m.texte}</div>
            </div>
          ) : (
            <div className="msg filou" key={m.id}>
              <span className="m-ava" aria-hidden="true">
                🦊
              </span>
              {/* Le sur-emballage n'apparaît QUE s'il y a des pistes à poser
                  sous la bulle : `.bubble` est large de 86 % de son parent, et
                  intercaler un conteneur pour tous les messages changerait la
                  largeur de toutes les bulles du fil. */}
              {m.exemples?.length ? (
                <div className="msg-pistes">
                  <div className="bubble">
                    <span className="vh">Filou : </span>
                    {m.texte}
                  </div>
                  <div className="pistes">
                    {m.exemples.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        className="piste"
                        onClick={() => envoyerPiste(m.id, ex)}
                        disabled={enCours}
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bubble">
                  <span className="vh">Filou : </span>
                  {m.texte}
                </div>
              )}
            </div>
          ),
        )}

        {enCours && (
          <div className="msg filou" key="attente">
            <span className="m-ava" aria-hidden="true">
              🦊
            </span>
            <div className="bubble bubble-attente" role="status">
              <span className="vh">Filou : </span>
              Je regarde ça
              <span className="typing" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
      </div>

      {estAdmin ? (
        <div className="saisie">
          {/* Repartir de zéro. N'apparaît qu'une fois qu'il y a quelque chose à
              effacer : un bouton « effacer » sur un fil vide n'a rien à dire. */}
          {messages.length > 0 && (
            <button
              type="button"
              className={`saisie-raz${confirmeRaz ? ' confirme' : ''}`}
              onClick={() => (confirmeRaz ? remettreAZero() : setConfirmeRaz(true))}
              disabled={enCours}
              aria-label={
                confirmeRaz
                  ? 'Confirmer : effacer la conversation et le tableau'
                  : 'Repartir de zéro : effacer la conversation'
              }
              title="Repartir de zéro"
            >
              {confirmeRaz ? (
                <span className="raz-mot">Tout effacer ?</span>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 11.5A8 8 0 1 1 17.6 6M20 4v5h-5" />
                </svg>
              )}
            </button>
          )}
          <label className="vh" htmlFor={champId}>
            Écrire à Filou : décris une règle du cabinet
          </label>
          <textarea
            id={champId}
            ref={champRef}
            rows={1}
            maxLength={LONGUEUR_MAX}
            value={phrase}
            onChange={(e) => setPhrase(e.target.value.slice(0, LONGUEUR_MAX))}
            onKeyDown={(e) => {
              // Entrée envoie, Maj+Entrée passe à la ligne : le geste attendu
              // dans une conversation.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                envoyer()
              }
            }}
            placeholder="Dis-moi une règle… ex. « Manon jamais de garde le mercredi »"
            className="saisie-champ"
          />
          <button
            type="button"
            className="saisie-envoi"
            onClick={envoyer}
            disabled={enCours || phrase.trim().length < 3}
            aria-label="Envoyer à Filou"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h13M12.5 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      ) : null}
    </>
  )
})
