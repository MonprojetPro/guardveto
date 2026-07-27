'use client'

// ============================================================
// GUARDVETO V2 — Parler à Filou (la tablette devient conversation)
// ============================================================
// La maquette M6 montrait une tablette avec un fil de discussion, mais SANS
// champ de saisie : Filou parlait, personne ne pouvait lui répondre. Le champ
// avait été volontairement écarté au portage — un champ qui ne fait rien est
// une coquille vide. Il arrive maintenant qu'il y a de quoi le brancher.
//
// CE QUE FILOU SAIT VRAIMENT FAIRE, et rien de plus : traduire une phrase en
// français en une règle du cabinet, via l'assistant déjà en place
// (`proposerRegleDepuisTexte`, Palier 3). C'est le MÊME moteur que l'écran
// Règles, et la création passe par les MÊMES actions serveur
// (`creerRegleProposee`) — pas une deuxième implémentation qui divergerait.
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
type Message = { id: number; de: 'moi' | 'filou'; texte: string }

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
        (m?.de === 'moi' || m?.de === 'filou'),
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
  dit: (texte: string) => void
}

interface Props {
  /** Le mot d'accueil : premier message du fil, toujours présent. */
  enTete: ReactNode
  estAdmin: boolean
  /** Fait taper Filou sur sa tablette pendant qu'il réfléchit. */
  onFilouTape?: () => void
  /** Ce que Filou a compris, à afficher sur le tableau du cabinet. */
  onResultat: (r: ResultatFilou) => void
}

export const FilouChat = forwardRef<FilouChatHandle, Props>(function FilouChat(
  { enTete, estAdmin, onFilouTape, onResultat },
  ref,
) {
  const champId = useId()
  // La conversation est relue depuis l'onglet AU PREMIER RENDU : aller voir une
  // fiche puis revenir démonte ce composant, et sans ça on retrouvait une
  // tablette vide — comme si Filou avait tout oublié le temps d'un aller-retour.
  const [messages, setMessages] = useState<Message[]>(relireConversation)
  const [phrase, setPhrase] = useState('')
  const [enCours, demarrer] = useTransition()
  const filRef = useRef<HTMLDivElement>(null)
  const champRef = useRef<HTMLTextAreaElement>(null)
  const compteur = useRef(messages.at(-1)?.id ?? 0)

  const ajouter = (de: Message['de'], texte: string) => {
    compteur.current += 1
    setMessages((prec) => {
      const suite = [...prec, { id: compteur.current, de, texte }]
      memoriserConversation(suite)
      return suite
    })
  }

  useImperativeHandle(ref, () => ({
    dit: (texte: string) => ajouter('filou', texte),
  }))

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
    ajouter(
      'filou',
      mot?.trim() || 'J’ai compris ta demande — je l’affiche sur le tableau du cabinet.',
    )
    compteur.current += 1
    onResultat({ ...contenu, id: compteur.current })
    requestAnimationFrame(() => champRef.current?.focus())
  }

  const envoyer = () => {
    const texte = phrase.trim()
    if (texte.length < 3 || enCours) return
    ajouter('moi', texte)
    setPhrase('')
    onFilouTape?.()

    demarrer(async () => {
      const reponse = await parlerAFilou(texte)

      if ('error' in reponse) {
        ajouter('filou', reponse.error)
        return
      }

      // Une réponse, une explication, une question : ça reste dans la tablette.
      if (reponse.genre === 'message') {
        ajouter('filou', reponse.texte)
        requestAnimationFrame(() => champRef.current?.focus())
        return
      }

      // Une réponse à lire : elle va sur le tableau, où il y a la place.
      if (reponse.genre === 'affichage') {
        annoncerEtMontrer(
          {
            genre: 'affichage',
            titre: reponse.titre,
            introduction: reponse.introduction,
            lignes: reponse.lignes,
          },
          reponse.texte,
        )
        return
      }

      // Filou veut FAIRE quelque chose : ça part sur le tableau, avec un bouton.
      annoncerEtMontrer(
        {
          genre: 'action',
          outil: reponse.outil,
          params: reponse.params,
          charge: reponse.charge,
          proposition: reponse.proposition,
        },
        reponse.texte,
      )
    })
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
              <div className="bubble">
                <span className="vh">Filou : </span>
                {m.texte}
              </div>
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
