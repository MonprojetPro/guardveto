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
// GARDE-FOU, non négociable : Filou PROPOSE, l'humain DÉCIDE. Rien n'est écrit
// en base avant le clic sur « Créer cette règle ». Tant qu'il n'a pas cliqué,
// une proposition n'est qu'une phrase à l'écran.
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

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { proposerRegleDepuisTexte, type ForceFormulaire } from '@/app/(protected)/regles/actions'
import {
  creerRegleProposee,
  estCreable,
  sansErreur,
  forceProposee,
  FORCE_LABEL,
  FORCES_ORDRE,
  type PropositionExploitable,
} from '@/components/ia/creerRegleProposee'

/** Un tour de parole dans le fil. */
type Message =
  | { id: number; de: 'moi'; texte: string }
  | { id: number; de: 'filou'; texte: string }
  /** Une proposition en attente de décision : le seul message qui porte des boutons. */
  | { id: number; de: 'proposition'; texte: string; res: PropositionExploitable; etat: 'attente' | 'creee' | 'abandonnee' }

/** `Omit` sur une union doit être DISTRIBUÉ, sinon il ne garde que les
 *  propriétés communes et perd `res`/`etat`. */
type MessageSansId = Message extends infer M ? (M extends { id: number } ? Omit<M, 'id'> : never) : never

/** Longueur maximale d'une consigne. Chaque envoi est un appel facturé au
 *  modèle : une garde de bon sens côté saisie évite qu'un copier-coller
 *  malheureux part en analyse. La vraie limite reste à poser côté serveur. */
const LONGUEUR_MAX = 400

const EXEMPLES = [
  'Manon ne fait jamais de garde le mercredi',
  'Au moins 3 jours entre deux gardes pour Antoine',
  'Un junior n’est jamais seul de garde',
]

interface Props {
  /** Le mot d'accueil : premier message du fil, toujours présent. */
  enTete: ReactNode
  /** Les pastilles de raccourci, entre le fil et le champ. */
  pastilles: ReactNode
  estAdmin: boolean
  /** Fait taper Filou sur sa tablette pendant qu'il réfléchit. */
  onFilouTape?: () => void
}

export function FilouChat({ enTete, pastilles, estAdmin, onFilouTape }: Props) {
  const router = useRouter()
  const champId = useId()
  const [messages, setMessages] = useState<Message[]>([])
  const [phrase, setPhrase] = useState('')
  const [force, setForce] = useState<ForceFormulaire | null>(null)
  const [puissanceOuverte, setPuissanceOuverte] = useState(false)
  const [enCours, demarrer] = useTransition()
  const [creation, demarrerCreation] = useTransition()
  const filRef = useRef<HTMLDivElement>(null)
  const champRef = useRef<HTMLTextAreaElement>(null)
  const compteur = useRef(0)

  const ajouter = (m: MessageSansId) => {
    compteur.current += 1
    setMessages((prec) => [...prec, { ...m, id: compteur.current } as Message])
  }

  // Le fil descend sur le dernier message : sans ça, la réponse de Filou
  // arriverait sous la ligne de flottaison, invisible.
  useEffect(() => {
    if (messages.length === 0) return
    const fil = filRef.current
    if (fil) fil.scrollTop = fil.scrollHeight
  }, [messages])

  const envoyer = () => {
    const texte = phrase.trim()
    if (texte.length < 3 || enCours) return
    ajouter({ de: 'moi', texte })
    setPhrase('')
    setForce(null)
    setPuissanceOuverte(false)
    onFilouTape?.()

    demarrer(async () => {
      const res = await proposerRegleDepuisTexte(texte)

      if (!sansErreur(res)) {
        ajouter({ de: 'filou', texte: res.error })
        return
      }
      if (!estCreable(res)) {
        // Non faisable : on rend la RAISON de l'assistant, pas une formule de
        // politesse. Savoir pourquoi ça ne marche pas, c'est ce qui permet de
        // reformuler utilement.
        ajouter({
          de: 'filou',
          texte:
            res.proposition.message ||
            "Je n'arrive pas à traduire ça en règle du cabinet. Reformule autrement ?",
        })
        return
      }
      ajouter({ de: 'proposition', texte: res.apercu, res, etat: 'attente' })
      setForce(forceProposee(res))
    })
  }

  const creer = (msg: Extract<Message, { de: 'proposition' }>) => {
    demarrerCreation(async () => {
      const r = await creerRegleProposee(msg.res, force)
      if (r.error) {
        ajouter({ de: 'filou', texte: r.error })
        return
      }
      setMessages((prec) =>
        prec.map((m) => (m.id === msg.id ? { ...m, etat: 'creee' as const } : m)),
      )
      ajouter({
        de: 'filou',
        texte: 'C’est enregistré. La règle s’appliquera à la prochaine génération de planning.',
      })
      // Les compteurs de la barre (règles fermes / souples) lisent la base :
      // sans ce refresh, le dock afficherait encore l'ancien décompte.
      router.refresh()
    })
  }

  const abandonner = (msg: Extract<Message, { de: 'proposition' }>) => {
    setMessages((prec) =>
      prec.map((m) => (m.id === msg.id ? { ...m, etat: 'abandonnee' as const } : m)),
    )
    ajouter({ de: 'filou', texte: 'D’accord, je n’enregistre rien.' })
    requestAnimationFrame(() => champRef.current?.focus())
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
          ) : m.de === 'filou' ? (
            <div className="msg filou" key={m.id}>
              <span className="m-ava" aria-hidden="true">
                🦊
              </span>
              <div className="bubble">
                <span className="vh">Filou : </span>
                {m.texte}
              </div>
            </div>
          ) : (
            <div className="msg filou" key={m.id}>
              <span className="m-ava" aria-hidden="true">
                🦊
              </span>
              <div className="bubble">
                <span className="vh">Filou : </span>
                <b>J’ai compris ça :</b>
                <span className="prop-apercu">{m.texte}</span>

                {m.etat === 'attente' && (
                  <>
                    {/* La puissance est annoncée en clair, pas cachée dans un
                        réglage : « interdiction ferme » et « préférence » ne
                        produisent pas du tout le même planning. */}
                    {force && (
                      <p className="prop-force">
                        Puissance : <b>{FORCE_LABEL[force]}</b>{' '}
                        <button
                          type="button"
                          className="prop-lien"
                          onClick={() => setPuissanceOuverte((v) => !v)}
                          aria-expanded={puissanceOuverte}
                        >
                          {puissanceOuverte ? 'garder celle-ci' : 'changer'}
                        </button>
                      </p>
                    )}
                    {puissanceOuverte && (
                      <div className="prop-crans" role="group" aria-label="Puissance de la règle">
                        {FORCES_ORDRE.map((f) => (
                          <button
                            key={f}
                            type="button"
                            aria-pressed={force === f}
                            className={`prop-cran${force === f ? ' actif' : ''}`}
                            onClick={() => setForce(f)}
                          >
                            {FORCE_LABEL[f]}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="prop-actions">
                      <button
                        type="button"
                        className="btn btn-valider btn-sm"
                        onClick={() => creer(m)}
                        disabled={creation}
                      >
                        {creation ? 'J’enregistre…' : 'Créer cette règle'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => abandonner(m)}
                        disabled={creation}
                      >
                        Laisse tomber
                      </button>
                    </div>
                  </>
                )}
                {m.etat === 'creee' && (
                  <p className="prop-verdict ok">
                    ✓ Créée ·{' '}
                    <Link className="prop-lien" href="/regles">
                      voir dans les règles
                    </Link>
                  </p>
                )}
                {m.etat === 'abandonnee' && <p className="prop-verdict">Abandonnée.</p>}
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

      {pastilles}

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

      {estAdmin && messages.length === 0 && (
        <div className="saisie-exemples">
          {EXEMPLES.map((ex) => (
            <button key={ex} type="button" className="ex-chip" onClick={() => setPhrase(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
