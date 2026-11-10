'use client'

// ============================================================
// GUARDVETO V2 — La messagerie de l'équipe (B-193)
// ============================================================
// À gauche, les conversations : le fil de toute l'équipe en tête, puis les
// conversations privées, la plus récente d'abord, chacune avec son DERNIER
// message et qui l'a écrit. À droite, le fil ouvert. Sur téléphone, l'un ou
// l'autre (retour par la flèche).
//
// ── CE QUI SE MET À JOUR TOUT SEUL, ET COMMENT ON LE SAIT ──────────────────
//
// Un seul canal temps réel écoute `messages` et `messagerie_lectures`. La
// base ne pousse à chacun QUE les lignes qu'il a le droit de lire (la RLS
// s'applique aussi au temps réel) : pas de filtre à écrire ici, donc pas de
// filtre à oublier.
//
// ⚠️ L'état de l'abonnement est LU. Un canal qui n'a pas démarré n'envoie
//    aucune erreur : le fil aurait l'air vivant et resterait figé (piège payé
//    sur foxeo-one et ici, 25/08). S'il tombe, l'écran le DIT.
//
// ── L'ENVOI ─────────────────────────────────────────────────────────────────
//
// L'identifiant du message est choisi ICI, avant l'envoi : le même message
// revient par le temps réel avec le même identifiant, et la fusion se fait sur
// lui — jamais sur le texte (deux « ok » d'affilée sont deux messages).
// Les pièces jointes partent DIRECTEMENT du navigateur vers le stockage : le
// plafond de 4,5 Mo de la plateforme n'est pas sur le chemin (leçon B-016).
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Copy,
  Mail,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  RotateCw,
  Search,
  SendHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  envoyerMessage,
  lireConversations,
  marquerConversationLue,
  modifierMessage,
  ouvrirConversationPrivee,
  retirerMessage,
  type EnvoiMessage,
} from '@/app/(v2)/messagerie/actions'
import {
  BUCKET_MESSAGERIE,
  COLONNES_MESSAGE,
  LONGUEUR_MESSAGE_MAX,
  NB_PIECES_MAX,
  TAILLE_PAGE_MESSAGES,
  apercuConversation,
  chiffreNonLus,
  cheminPiece,
  decouperLiens,
  fusionnerMessage,
  heureDe,
  initiales,
  jourDe,
  libelleJour,
  nomConversation,
  prenomDe,
  libelleEnvoiMail,
  refusMessage,
  versMessage,
  type ConversationListe,
  type MembreAnnuaire,
  type MessageFil,
  type PieceMessage,
  type RangeeMessage,
} from '@/lib/messagerie/regles'
import { effacerBrouillon, enregistrerBrouillon, lireBrouillon } from '@/lib/messagerie/brouillon'
import { ACCEPT_HTML, nomDeFichierSur, poidsLisible, refusFichier } from '@/lib/support/contraintes'


/** Le temps laissé aux écritures en cascade (message → conversation → notif). */
const DEBOUNCE_LISTE_MS = 500

/** Un lien de pièce jointe signé reste valable une heure : le temps de la lire. */
const DUREE_LIEN_S = 3600

type EtatSync = 'connexion' | 'direct' | 'interrompu'

interface Props {
  moiUserId: string
  cabinetId: string | null
  estAdmin: boolean
  conversationsInitiales: ConversationListe[]
  erreurInitiale: string | null
  annuaire: MembreAnnuaire[]
  conversationOuverte: string | null
  introuvable: boolean
  /** L'adresse désignait cette conversation : sur téléphone, on ouvre le fil. */
  ouvrirFil: boolean
}

interface Lecture {
  userId: string
  luJusqua: string
}

function stockageLocal() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function normaliser(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function MessagerieV2({
  moiUserId,
  cabinetId,
  estAdmin,
  conversationsInitiales,
  erreurInitiale,
  annuaire,
  conversationOuverte,
  introuvable,
  ouvrirFil,
}: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [conversations, setConversations] = useState(conversationsInitiales)
  const [erreurListe, setErreurListe] = useState<string | null>(erreurInitiale)
  const [activeId, setActiveId] = useState<string | null>(conversationOuverte)
  // Sur téléphone : la liste OU le fil. On ouvre le fil d'emblée seulement si
  // l'adresse le demandait (lien d'une notification).
  const [voirFil, setVoirFil] = useState(ouvrirFil)
  const [sync, setSync] = useState<EtatSync>('connexion')
  const [nouveau, setNouveau] = useState(false)

  const active = conversations.find((c) => c.id === activeId) ?? null

  // ── La liste se relit sur tout changement (debounce) ──────────────────────
  const minuterieListe = useRef<ReturnType<typeof setTimeout> | null>(null)
  const relireListe = useCallback(() => {
    if (minuterieListe.current) clearTimeout(minuterieListe.current)
    minuterieListe.current = setTimeout(async () => {
      const r = await lireConversations()
      if (r.ok) {
        setConversations(r.conversations)
        setErreurListe(null)
      } else {
        setErreurListe(r.error)
      }
    }, DEBOUNCE_LISTE_MS)
  }, [])

  // ── Le fil ouvert ──────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<MessageFil[]>([])
  // Vrai dès qu'une conversation est ouverte : le chargement démarre avec le
  // geste (ouvrir, réessayer), jamais dans un effet.
  const [chargement, setChargement] = useState(Boolean(conversationOuverte))
  const [erreurFil, setErreurFil] = useState<string | null>(null)
  const [aPlusAnciens, setAPlusAnciens] = useState(false)
  const [lectures, setLectures] = useState<Lecture[]>([])
  const activeRef = useRef<string | null>(activeId)
  useEffect(() => {
    activeRef.current = activeId
  }, [activeId])

  const chargerFil = useCallback(
    async (convId: string) => {
      const [res, lec] = await Promise.all([
        supabase
          .from('messages')
          .select(COLONNES_MESSAGE)
          .eq('conversation_id', convId)
          .order('cree_le', { ascending: false })
          .limit(TAILLE_PAGE_MESSAGES),
        supabase.from('messagerie_lectures').select('user_id, lu_jusqua').eq('conversation_id', convId),
      ])
      if (activeRef.current !== convId) return
      setChargement(false)
      if (res.error) {
        console.error('[Messagerie] Lecture du fil impossible :', res.error.message)
        setErreurFil('Je n’arrive pas à lire cette conversation pour le moment.')
        return
      }
      const lus = ((res.data ?? []) as RangeeMessage[]).map(versMessage).reverse()
      // Fusion, pas remplacement : un message arrivé par le temps réel (ou
      // envoyé) PENDANT la lecture serait sinon effacé de l'écran.
      setMessages((avant) =>
        avant.filter((m) => m.conversationId === convId).reduce((fil, m) => fusionnerMessage(fil, m), lus),
      )
      setAPlusAnciens(lus.length === TAILLE_PAGE_MESSAGES)
      setLectures(
        ((lec.data ?? []) as { user_id: string; lu_jusqua: string }[]).map((l) => ({
          userId: l.user_id,
          luJusqua: l.lu_jusqua,
        })),
      )
    },
    [supabase, setMessages, setChargement, setErreurFil, setAPlusAnciens, setLectures],
  )

  const chargerPlusAnciens = useCallback(async () => {
    if (!activeId || messages.length === 0) return
    const plusVieux = messages.find((m) => !m.enEnvoi)?.creeLe
    if (!plusVieux) return
    const { data, error } = await supabase
      .from('messages')
      .select(COLONNES_MESSAGE)
      .eq('conversation_id', activeId)
      .lt('cree_le', plusVieux)
      .order('cree_le', { ascending: false })
      .limit(TAILLE_PAGE_MESSAGES)
    if (error) {
      toast.error('Les messages plus anciens n’ont pas pu être lus.')
      return
    }
    const anciens = ((data ?? []) as RangeeMessage[]).map(versMessage)
    setMessages((fil) => anciens.reduce((acc, m) => fusionnerMessage(acc, m), fil))
    setAPlusAnciens(anciens.length === TAILLE_PAGE_MESSAGES)
  }, [activeId, messages, supabase, setMessages])

  // « J'ai lu » : seulement si l'onglet est visible. Un message arrivé
  // pendant qu'on regardait ailleurs n'a pas été lu.
  const minuterieLu = useRef<ReturnType<typeof setTimeout> | null>(null)
  const marquerLu = useCallback(
    (convId: string) => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (minuterieLu.current) clearTimeout(minuterieLu.current)
      minuterieLu.current = setTimeout(async () => {
        const r = await marquerConversationLue(convId)
        if (r.ok) {
          setConversations((cs) => cs.map((c) => (c.id === convId ? { ...c, nbNonLus: 0 } : c)))
        }
      }, 400)
    },
    [],
  )

  useEffect(() => {
    if (!activeId) return
    // Les états ne changent qu'APRÈS la réponse de la base (await) : c'est une
    // lecture de donnée externe, le cas pour lequel un effet existe.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void chargerFil(activeId)
    marquerLu(activeId)
    // L'adresse suit la conversation ouverte, sans recharger la page : un
    // rechargement ou un lien partagé retombe au même endroit.
    try {
      window.history.replaceState(null, '', `/messagerie?c=${activeId}`)
    } catch {
      // sans conséquence
    }
  }, [activeId, chargerFil, marquerLu])

  useEffect(() => {
    const auRetour = () => {
      if (document.visibilityState === 'visible' && activeRef.current) marquerLu(activeRef.current)
    }
    document.addEventListener('visibilitychange', auRetour)
    return () => document.removeEventListener('visibilitychange', auRetour)
  }, [marquerLu])

  // ── Le temps réel ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canal = supabase.channel('messagerie-fil')
    canal.on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (charge) => {
      const ligne = (charge.new ?? {}) as Partial<RangeeMessage>
      if (ligne.id && ligne.conversation_id === activeRef.current) {
        setMessages((fil) => fusionnerMessage(fil, versMessage(ligne as RangeeMessage)))
        if (charge.eventType === 'INSERT' && ligne.auteur_user_id !== moiUserId) {
          marquerLu(ligne.conversation_id)
        }
      }
      relireListe()
    })
    canal.on('postgres_changes', { event: '*', schema: 'public', table: 'messagerie_lectures' }, (charge) => {
      const l = (charge.new ?? {}) as { conversation_id?: string; user_id?: string; lu_jusqua?: string }
      if (l.conversation_id && l.conversation_id === activeRef.current && l.user_id && l.lu_jusqua) {
        const lecture = { userId: l.user_id, luJusqua: l.lu_jusqua }
        setLectures((ls) => [...ls.filter((x) => x.userId !== lecture.userId), lecture])
      }
      if (l.user_id === moiUserId) relireListe()
    })
    canal.subscribe((statut, erreur) => {
      if (statut === 'SUBSCRIBED') {
        setSync('direct')
        return
      }
      if (statut === 'CLOSED') return
      setSync('interrompu')
      console.error(
        `[temps réel] La messagerie ne se met plus à jour toute seule (${statut}). ` +
          'Causes probables : table absente de la publication supabase_realtime, ou RLS.' +
          (erreur ? ` Détail : ${erreur.message}` : ''),
      )
    })
    return () => {
      if (minuterieListe.current) clearTimeout(minuterieListe.current)
      if (minuterieLu.current) clearTimeout(minuterieLu.current)
      supabase.removeChannel(canal)
    }
  }, [supabase, moiUserId, relireListe, marquerLu])

  // ── Ouvrir une conversation ───────────────────────────────────────────────
  const ouvrir = (id: string) => {
    setVoirFil(true)
    if (id === activeId) return
    // Le fil précédent disparaît tout de suite : on ne montre jamais les
    // messages d'une conversation sous le nom d'une autre.
    setMessages([])
    setLectures([])
    setErreurFil(null)
    setChargement(true)
    setActiveId(id)
  }

  const [ouverture, demarrerOuverture] = useTransition()
  const ecrireA = (membre: MembreAnnuaire) => {
    demarrerOuverture(async () => {
      const r = await ouvrirConversationPrivee(membre.userId)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setNouveau(false)
      const liste = await lireConversations()
      if (liste.ok) setConversations(liste.conversations)
      ouvrir(r.conversationId)
    })
  }

  const nomsParUser = useMemo(() => new Map(annuaire.map((m) => [m.userId, m.nom])), [annuaire])

  return (
    <div className={`messagerie rise${voirFil ? ' voir-fil' : ''}`}>
      <aside className="msg-liste" aria-label="Conversations">
        <div className="msg-liste-tete">
          <h1>Messagerie</h1>
          <button
            type="button"
            className="msg-nouveau"
            onClick={() => setNouveau(true)}
            aria-label="Écrire à quelqu’un"
            title="Écrire à quelqu’un"
            disabled={annuaire.length === 0}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>

        {introuvable && (
          <p className="msg-note" role="status">
            Cette conversation n’existe plus ou ne vous est pas ouverte.
          </p>
        )}
        {erreurListe && (
          <p className="msg-note msg-note-erreur" role="alert">
            {erreurListe}
          </p>
        )}

        <ul className="msg-convs">
          {conversations.map((c) => {
            const nom = nomConversation(c)
            const nonLus = chiffreNonLus(c.nbNonLus)
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={`msg-conv${c.id === activeId ? ' ici' : ''}${nonLus ? ' non-lu' : ''}`}
                  onClick={() => ouvrir(c.id)}
                  aria-current={c.id === activeId ? 'true' : undefined}
                >
                  <span className={`msg-avatar${c.genre === 'equipe' ? ' equipe' : ''}`} aria-hidden="true">
                    {c.genre === 'equipe' ? <Users /> : initiales(nom)}
                  </span>
                  <span className="msg-conv-texte">
                    <span className="msg-conv-ligne">
                      <span className="msg-conv-nom">{nom}</span>
                      {c.dernierLe && <span className="msg-conv-heure">{heureOuJour(c.dernierLe)}</span>}
                    </span>
                    <span className="msg-conv-ligne">
                      <span className="msg-conv-apercu">{apercuConversation(c)}</span>
                      {nonLus && (
                        <span className="msg-pastille" aria-label={`${c.nbNonLus} non lu${c.nbNonLus > 1 ? 's' : ''}`}>
                          {nonLus}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      <section className="msg-fil" aria-label={active ? `Conversation : ${nomConversation(active)}` : 'Conversation'}>
        {active ? (
          <Fil
            key={active.id}
            conversation={active}
            moiUserId={moiUserId}
            cabinetId={cabinetId}
            estAdmin={estAdmin}
            messages={messages}
            setMessages={setMessages}
            chargement={chargement}
            erreur={erreurFil}
            aPlusAnciens={aPlusAnciens}
            surPlusAnciens={chargerPlusAnciens}
            surRecharger={() => {
              setErreurFil(null)
              setChargement(true)
              void chargerFil(active.id)
            }}
            lectures={lectures}
            nomsParUser={nomsParUser}
            annuaire={annuaire}
            sync={sync}
            surRetour={() => setVoirFil(false)}
            supabase={supabase}
          />
        ) : (
          <div className="msg-vide">
            <p>Choisissez une conversation.</p>
          </div>
        )}
      </section>

      <NouvelleConversation
        ouvert={nouveau}
        surFermer={() => setNouveau(false)}
        annuaire={annuaire}
        enCours={ouverture}
        surChoisir={ecrireA}
      />
    </div>
  )
}

function heureOuJour(iso: string): string {
  const auj = jourDe(new Date().toISOString()) === jourDe(iso)
  return auj ? heureDe(iso) : new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

// ── LE FIL ──────────────────────────────────────────────────────────────────

interface PropsFil {
  conversation: ConversationListe
  moiUserId: string
  cabinetId: string | null
  estAdmin: boolean
  messages: MessageFil[]
  setMessages: React.Dispatch<React.SetStateAction<MessageFil[]>>
  chargement: boolean
  erreur: string | null
  aPlusAnciens: boolean
  surPlusAnciens: () => Promise<void>
  surRecharger: () => void
  lectures: Lecture[]
  nomsParUser: Map<string, string>
  annuaire: MembreAnnuaire[]
  sync: EtatSync
  surRetour: () => void
  supabase: ReturnType<typeof createClient>
}

function Fil({
  conversation,
  moiUserId,
  cabinetId,
  estAdmin,
  messages,
  setMessages,
  chargement,
  erreur,
  aPlusAnciens,
  surPlusAnciens,
  surRecharger,
  lectures,
  nomsParUser,
  annuaire,
  sync,
  surRetour,
  supabase,
}: PropsFil) {
  const nom = nomConversation(conversation)
  const bas = useRef<HTMLDivElement | null>(null)
  const zone = useRef<HTMLDivElement | null>(null)
  const dernierId = messages[messages.length - 1]?.id

  // On descend au dernier message à l'arrivée d'un message — sauf si la
  // personne est remontée lire l'historique : on ne lui arrache pas sa lecture.
  const presDuBas = useRef(true)
  useEffect(() => {
    if (presDuBas.current) bas.current?.scrollIntoView({ block: 'end' })
  }, [dernierId])

  const surDefilement = () => {
    const z = zone.current
    if (!z) return
    presDuBas.current = z.scrollHeight - z.scrollTop - z.clientHeight < 120
  }

  // ── Les accusés de lecture (sous MON dernier message) ─────────────────────
  const monDernier = [...messages].reverse().find((m) => m.auteurUserId === moiUserId && !m.enEnvoi && !m.retireLe)
  const lecteurs = monDernier
    ? lectures.filter(
        (l) => l.userId !== moiUserId && new Date(l.luJusqua).getTime() >= new Date(monDernier.creeLe).getTime(),
      )
    : []

  // ── Envoyer, réessayer ────────────────────────────────────────────────────
  const enAttente = useRef(new Map<string, EnvoiMessage>())

  const expedier = async (envoi: EnvoiMessage) => {
    const r = await envoyerMessage(envoi)
    if (r.ok) {
      enAttente.current.delete(envoi.id)
      setMessages((fil) => fusionnerMessage(fil, r.message))
      return true
    }
    setMessages((fil) => fil.map((m) => (m.id === envoi.id ? { ...m, enEnvoi: false, echec: true } : m)))
    toast.error(r.error)
    return false
  }

  const surEnvoyer = async (corps: string, pieces: PieceMessage[], id: string, mailA: string[]) => {
    const envoi: EnvoiMessage = { id, conversationId: conversation.id, corps, pieces, mailA }
    enAttente.current.set(id, envoi)
    setMessages((fil) =>
      fusionnerMessage(fil, {
        id,
        conversationId: conversation.id,
        auteurUserId: moiUserId,
        auteurNom: 'Vous',
        corps,
        pieces,
        creeLe: new Date().toISOString(),
        modifieLe: null,
        retireLe: null,
        mailEnvoyeA: null,
        mailEchecs: null,
        enEnvoi: true,
      }),
    )
    presDuBas.current = true
    return expedier(envoi)
  }

  const reessayer = (id: string) => {
    const envoi = enAttente.current.get(id)
    if (!envoi) return
    setMessages((fil) => fil.map((m) => (m.id === id ? { ...m, enEnvoi: true, echec: false } : m)))
    void expedier(envoi)
  }

  const abandonner = async (id: string) => {
    const envoi = enAttente.current.get(id)
    enAttente.current.delete(id)
    setMessages((fil) => fil.filter((m) => m.id !== id))
    // Les fichiers déjà déposés pour un message jamais parti : on fait le ménage.
    if (envoi && envoi.pieces.length > 0) {
      await supabase.storage.from(BUCKET_MESSAGERIE).remove(envoi.pieces.map((p) => p.chemin))
    }
  }

  // ── Modifier, retirer ─────────────────────────────────────────────────────
  const [enEdition, setEnEdition] = useState<string | null>(null)
  const [aRetirer, setARetirer] = useState<MessageFil | null>(null)
  const [geste, demarrerGeste] = useTransition()

  const enregistrerEdition = (id: string, corps: string) => {
    demarrerGeste(async () => {
      const r = await modifierMessage(id, corps)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setEnEdition(null)
      setMessages((fil) => fusionnerMessage(fil, r.message))
    })
  }

  const confirmerRetrait = () => {
    if (!aRetirer) return
    const id = aRetirer.id
    demarrerGeste(async () => {
      const r = await retirerMessage(id)
      setARetirer(null)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setMessages((fil) => fusionnerMessage(fil, r.message))
    })
  }

  const ecritureFermee = conversation.genre === 'privee' && !conversation.autreActif

  return (
    <>
      <header className="msg-fil-tete">
        <button type="button" className="msg-retour" onClick={surRetour} aria-label="Revenir aux conversations">
          <ArrowLeft aria-hidden="true" />
        </button>
        <span className={`msg-avatar${conversation.genre === 'equipe' ? ' equipe' : ''}`} aria-hidden="true">
          {conversation.genre === 'equipe' ? <Users /> : initiales(nom)}
        </span>
        <div className="msg-fil-titre">
          <h2>{nom}</h2>
          <p>
            {conversation.genre === 'equipe'
              ? 'Tout le cabinet, secrétariat compris'
              : conversation.autreActif
                ? 'Conversation privée'
                : 'A quitté le cabinet'}
          </p>
        </div>
      </header>

      {sync === 'interrompu' && (
        <p className="msg-note msg-note-erreur msg-note-fil" role="alert">
          La mise à jour automatique est interrompue : les nouveaux messages n’apparaîtront pas tout seuls.
          Rechargez la page.
        </p>
      )}

      <div className="msg-messages" ref={zone} onScroll={surDefilement}>
        {aPlusAnciens && (
          <button type="button" className="msg-plus-anciens" onClick={() => void surPlusAnciens()}>
            Messages plus anciens
          </button>
        )}

        {chargement && messages.length === 0 && (
          <div className="msg-squelette" aria-label="Chargement">
            <span />
            <span />
            <span />
          </div>
        )}

        {erreur && (
          <div className="msg-note msg-note-erreur" role="alert">
            {erreur}{' '}
            <button type="button" className="msg-lien" onClick={surRecharger}>
              Réessayer
            </button>
          </div>
        )}

        {!chargement && !erreur && messages.length === 0 && (
          <p className="msg-debut">
            {conversation.genre === 'equipe'
              ? 'Rien d’écrit pour l’instant. Un message ici est lu par toute l’équipe.'
              : `Rien d’écrit pour l’instant. Seuls vous et ${prenomDe(nom)} lirez cette conversation.`}
          </p>
        )}

        {messages.map((m, i) => {
          const precedent = messages[i - 1]
          const nouveauJour = !precedent || jourDe(precedent.creeLe) !== jourDe(m.creeLe)
          const deMoi = m.auteurUserId === moiUserId
          const memeAuteur =
            !nouveauJour &&
            precedent?.auteurUserId === m.auteurUserId &&
            new Date(m.creeLe).getTime() - new Date(precedent.creeLe).getTime() < 5 * 60_000
          return (
            <div key={m.id}>
              {nouveauJour && (
                <div className="msg-jour" role="separator">
                  <span>{libelleJour(m.creeLe)}</span>
                </div>
              )}
              <Bulle
                message={m}
                deMoi={deMoi}
                montrerNom={!deMoi && conversation.genre === 'equipe' && !memeAuteur}
                peutModifier={deMoi && !m.retireLe && !m.enEnvoi && !m.echec}
                peutRetirer={(deMoi || estAdmin) && !m.retireLe && !m.enEnvoi && !m.echec}
                enEdition={enEdition === m.id}
                surEditer={() => setEnEdition(m.id)}
                surAnnulerEdition={() => setEnEdition(null)}
                surEnregistrer={(t) => enregistrerEdition(m.id, t)}
                surRetirer={() => setARetirer(m)}
                surReessayer={() => reessayer(m.id)}
                surAbandonner={() => void abandonner(m.id)}
                geste={geste}
                supabase={supabase}
              />
              {monDernier?.id === m.id && lecteurs.length > 0 && (
                <p className="msg-lu" title={lecteurs.map((l) => nomsParUser.get(l.userId) ?? 'Ancien membre').join(', ')}>
                  <CheckCheck aria-hidden="true" />
                  {conversation.genre === 'privee'
                    ? 'Lu'
                    : `Vu par ${lecteurs.length} personne${lecteurs.length > 1 ? 's' : ''}`}
                </p>
              )}
            </div>
          )
        })}
        <div ref={bas} />
      </div>

      {ecritureFermee ? (
        <p className="msg-ferme">
          {prenomDe(nom)} ne fait plus partie du cabinet. La conversation reste lisible, on ne peut plus y écrire.
        </p>
      ) : cabinetId ? (
        <Saisie
          conversationId={conversation.id}
          cabinetId={cabinetId}
          surEnvoyer={surEnvoyer}
          supabase={supabase}
          // B-193c — seule l'administratrice peut prévenir aussi par mail. Le
          // serveur le revérifie : ce n'est ici qu'un affichage.
          destinatairesMail={
            estAdmin
              ? conversation.genre === 'equipe'
                ? annuaire
                : annuaire.filter((m) => m.userId === conversation.autreUserId)
              : []
          }
          equipe={conversation.genre === 'equipe'}
        />
      ) : (
        <p className="msg-ferme">Votre compte n’est rattaché à aucun cabinet : impossible d’écrire.</p>
      )}

      <Dialog open={aRetirer !== null} onOpenChange={(o) => !o && !geste && setARetirer(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Retirer ce message ?</DialogTitle>
            <DialogDescription>
              {aRetirer && aRetirer.auteurUserId !== moiUserId
                ? `Le message de ${prenomDe(aRetirer.auteurNom)} sera remplacé par « Message retiré » pour tout le monde. C’est définitif.`
                : 'Il sera remplacé par « Message retiré » pour tout le monde. C’est définitif.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setARetirer(null)} disabled={geste}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={confirmerRetrait} disabled={geste}>
              Retirer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── UNE BULLE ───────────────────────────────────────────────────────────────

interface PropsBulle {
  message: MessageFil
  deMoi: boolean
  montrerNom: boolean
  peutModifier: boolean
  peutRetirer: boolean
  enEdition: boolean
  surEditer: () => void
  surAnnulerEdition: () => void
  surEnregistrer: (texte: string) => void
  surRetirer: () => void
  surReessayer: () => void
  surAbandonner: () => void
  geste: boolean
  supabase: ReturnType<typeof createClient>
}

function Bulle({
  message: m,
  deMoi,
  montrerNom,
  peutModifier,
  peutRetirer,
  enEdition,
  surEditer,
  surAnnulerEdition,
  surEnregistrer,
  surRetirer,
  surReessayer,
  surAbandonner,
  geste,
  supabase,
}: PropsBulle) {
  const [texte, setTexte] = useState(m.corps)

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(m.corps)
      toast.success('Message copié.')
    } catch {
      toast.error('Copie impossible depuis ce navigateur.')
    }
  }

  if (m.retireLe) {
    return (
      <div className={`msg-ligne${deMoi ? ' moi' : ''}`}>
        <div className="msg-bulle retire">
          {montrerNom && <span className="msg-auteur">{prenomDe(m.auteurNom)}</span>}
          <span>Message retiré</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`msg-ligne${deMoi ? ' moi' : ''}${m.echec ? ' echec' : ''}`}>
      <div className={`msg-bulle${m.enEnvoi ? ' en-envoi' : ''}`}>
        {montrerNom && <span className="msg-auteur">{m.auteurNom}</span>}

        {enEdition ? (
          <div className="msg-edition">
            <textarea
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              maxLength={LONGUEUR_MESSAGE_MAX}
              rows={Math.min(8, Math.max(2, texte.split('\n').length))}
              aria-label="Modifier le message"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Escape') surAnnulerEdition()
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (texte.trim()) surEnregistrer(texte)
                }
              }}
            />
            <div className="msg-edition-actions">
              <button type="button" className="msg-lien" onClick={surAnnulerEdition} disabled={geste}>
                Annuler
              </button>
              <button
                type="button"
                className="msg-lien fort"
                onClick={() => surEnregistrer(texte)}
                disabled={geste || !texte.trim() || texte === m.corps}
              >
                Enregistrer
              </button>
            </div>
          </div>
        ) : (
          m.corps && (
            <p className="msg-corps">
              {decouperLiens(m.corps).map((morceau, i) =>
                morceau.lien ? (
                  <a key={i} href={morceau.texte} target="_blank" rel="noopener noreferrer nofollow">
                    {morceau.texte}
                  </a>
                ) : (
                  <span key={i}>{morceau.texte}</span>
                ),
              )}
            </p>
          )
        )}

        {m.pieces.length > 0 && (
          <div className="msg-pieces">
            {m.pieces.map((p) => (
              <Piece key={p.chemin} piece={p} supabase={supabase} />
            ))}
          </div>
        )}

        <span className="msg-meta">
          {m.modifieLe && <span>modifié · </span>}
          {heureDe(m.creeLe)}
          {m.enEnvoi && <span className="msg-envoi"> · envoi…</span>}
          {deMoi && !m.enEnvoi && !m.echec && <Check className="msg-meta-ico" aria-label="Envoyé" />}
          {deMoi && m.mailEnvoyeA !== null && (
            <span className={'msg-mail' + (m.mailEchecs ? ' echec' : '')}>
              {' · '}
              {libelleEnvoiMail(m.mailEnvoyeA, m.mailEchecs ?? 0)}
            </span>
          )}
        </span>
      </div>

      {m.echec ? (
        <div className="msg-echec">
          Non envoyé.{' '}
          <button type="button" className="msg-lien fort" onClick={surReessayer}>
            <RotateCw aria-hidden="true" /> Réessayer
          </button>{' '}
          <button type="button" className="msg-lien" onClick={surAbandonner}>
            Supprimer
          </button>
        </div>
      ) : (
        !enEdition &&
        !m.enEnvoi && (
          <div className="msg-gestes">
            {m.corps && (
              <button type="button" onClick={() => void copier()} aria-label="Copier le message" title="Copier">
                <Copy aria-hidden="true" />
              </button>
            )}
            {peutModifier && m.corps && (
              <button
                type="button"
                onClick={() => {
                  setTexte(m.corps)
                  surEditer()
                }}
                aria-label="Modifier le message"
                title="Modifier"
              >
                <Pencil aria-hidden="true" />
              </button>
            )}
            {peutRetirer && (
              <button type="button" onClick={surRetirer} aria-label="Retirer le message" title="Retirer">
                <Trash2 aria-hidden="true" />
              </button>
            )}
          </div>
        )
      )}
    </div>
  )
}

// ── UNE PIÈCE JOINTE : le lien est signé À L'AFFICHAGE, jamais stocké ───────

function Piece({ piece, supabase }: { piece: PieceMessage; supabase: ReturnType<typeof createClient> }) {
  const [url, setUrl] = useState<string | null>(null)
  const [echec, setEchec] = useState(false)
  const image = piece.type.startsWith('image/') && piece.type !== 'image/heic' && piece.type !== 'image/heif'

  useEffect(() => {
    let vivant = true
    supabase.storage
      .from(BUCKET_MESSAGERIE)
      .createSignedUrl(piece.chemin, DUREE_LIEN_S)
      .then(({ data, error }) => {
        if (!vivant) return
        if (error || !data?.signedUrl) setEchec(true)
        else setUrl(data.signedUrl)
      })
    return () => {
      vivant = false
    }
  }, [piece.chemin, supabase])

  if (echec) return <span className="msg-piece indispo">{piece.nom} — indisponible</span>
  if (image && url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="msg-piece-image">
        {/* eslint-disable-next-line @next/next/no-img-element -- URL signée, hors du domaine optimisé */}
        <img src={url} alt={piece.nom} loading="lazy" />
      </a>
    )
  }
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="msg-piece"
      aria-disabled={!url}
    >
      <FileText aria-hidden="true" />
      <span>{piece.nom}</span>
      <em>{poidsLisible(piece.taille)}</em>
    </a>
  )
}

// ── LA SAISIE ───────────────────────────────────────────────────────────────

function Saisie({
  conversationId,
  cabinetId,
  surEnvoyer,
  supabase,
  destinatairesMail,
  equipe,
}: {
  conversationId: string
  cabinetId: string
  surEnvoyer: (corps: string, pieces: PieceMessage[], id: string, mailA: string[]) => Promise<boolean>
  supabase: ReturnType<typeof createClient>
  /** Vide si la personne ne peut pas prévenir par mail. */
  destinatairesMail: MembreAnnuaire[]
  equipe: boolean
}) {
  const [mailA, setMailA] = useState<string[]>([])
  const [choixMail, setChoixMail] = useState(false)
  const joignables = destinatairesMail.filter((m) => m.aEmail)
  const [texte, setTexte] = useState('')
  const [fichiers, setFichiers] = useState<File[]>([])
  const [depot, setDepot] = useState(false)
  const champ = useRef<HTMLTextAreaElement | null>(null)
  const choix = useRef<HTMLInputElement | null>(null)

  // Le brouillon revient quand on rouvre la conversation.
  useEffect(() => {
    // Lu APRÈS le montage, exprès : le stockage du navigateur n'existe pas au
    // rendu serveur, le lire plus tôt ferait diverger les deux rendus.
    const s = stockageLocal()
    const brouillon = s ? lireBrouillon(s, conversationId) : null
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronisation avec localStorage, système externe
    if (brouillon) setTexte(brouillon)
  }, [conversationId])

  const changer = (v: string) => {
    setTexte(v)
    const s = stockageLocal()
    if (s) enregistrerBrouillon(s, conversationId, v)
  }

  const ajouter = (liste: FileList | null) => {
    if (!liste) return
    const nouveaux = [...fichiers]
    for (const f of Array.from(liste)) {
      const refus = refusFichier(f)
      if (refus) {
        toast.error(refus)
        continue
      }
      if (nouveaux.length >= NB_PIECES_MAX) {
        toast.error('Trois pièces jointes au maximum par message.')
        break
      }
      nouveaux.push(f)
    }
    setFichiers(nouveaux)
    if (choix.current) choix.current.value = ''
  }

  const refus = refusMessage({ corps: texte, nbPieces: fichiers.length })
  const peutEnvoyer = !refus && !depot

  const envoyer = async () => {
    if (!peutEnvoyer) return
    const id = crypto.randomUUID()
    setDepot(true)

    // ① Les fichiers, directement du navigateur vers le stockage.
    const pieces: PieceMessage[] = []
    for (const f of fichiers) {
      const chemin = cheminPiece(cabinetId, conversationId, crypto.randomUUID().slice(0, 8), nomDeFichierSur(f.name))
      const { error } = await supabase.storage
        .from(BUCKET_MESSAGERIE)
        .upload(chemin, f, { contentType: f.type, upsert: false })
      if (error) {
        console.error('[Messagerie] Dépôt refusé :', error.message)
        toast.error(`« ${f.name} » n’a pas pu être envoyé. Le message n’est pas parti.`)
        if (pieces.length > 0) await supabase.storage.from(BUCKET_MESSAGERIE).remove(pieces.map((p) => p.chemin))
        setDepot(false)
        return
      }
      pieces.push({ chemin, nom: f.name, taille: f.size, type: f.type })
    }

    // ② Le message. La saisie se vide tout de suite ; le brouillon, lui,
    //    n'est effacé qu'APRÈS confirmation du serveur.
    const corps = texte
    const destinataires = mailA
    setTexte('')
    setFichiers([])
    setMailA([])
    setChoixMail(false)
    setDepot(false)
    champ.current?.focus()
    const ok = await surEnvoyer(corps, pieces, id, destinataires)
    const s = stockageLocal()
    if (ok && s) effacerBrouillon(s, conversationId)
  }

  return (
    <form
      className="msg-saisie"
      onSubmit={(e) => {
        e.preventDefault()
        void envoyer()
      }}
    >
      {choixMail && (
        <ChoixMail
          membres={destinatairesMail}
          choisis={mailA}
          equipe={equipe}
          surChanger={setMailA}
          surFermer={() => setChoixMail(false)}
        />
      )}
      {mailA.length > 0 && !choixMail && (
        <p className="msg-mail-choisi">
          <Mail aria-hidden="true" />
          <span>
            Aussi par mail à{' '}
            {equipe && mailA.length === joignables.length
              ? 'toute l’équipe'
              : mailA.map((u) => prenomDe(destinatairesMail.find((m) => m.userId === u)?.nom ?? '?')).join(', ')}
          </span>
          <button type="button" onClick={() => setMailA([])} aria-label="Ne pas envoyer par mail">
            <X aria-hidden="true" />
          </button>
        </p>
      )}
      {fichiers.length > 0 && (
        <ul className="msg-joints">
          {fichiers.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <Paperclip aria-hidden="true" />
              <span>{f.name}</span>
              <em>{poidsLisible(f.size)}</em>
              <button
                type="button"
                onClick={() => setFichiers(fichiers.filter((_, j) => j !== i))}
                aria-label={`Retirer ${f.name}`}
              >
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="msg-saisie-ligne">
        <button
          type="button"
          className="msg-joindre"
          onClick={() => choix.current?.click()}
          aria-label="Joindre une image ou un PDF"
          title="Joindre une image ou un PDF (10 Mo)"
          disabled={depot || fichiers.length >= NB_PIECES_MAX}
        >
          <Paperclip aria-hidden="true" />
        </button>
        {destinatairesMail.length > 0 && (
          <button
            type="button"
            className={'msg-joindre' + (mailA.length > 0 ? ' actif' : '')}
            onClick={() => {
              // En privé, un seul destinataire possible : le geste est direct.
              if (!equipe) {
                const autre = joignables[0]
                if (!autre) {
                  toast.error('Cette personne n’a pas d’adresse mail enregistrée.')
                  return
                }
                setMailA(mailA.length > 0 ? [] : [autre.userId])
                return
              }
              setChoixMail(!choixMail)
            }}
            aria-label="Prévenir aussi par mail"
            aria-pressed={mailA.length > 0}
            title="Prévenir aussi par mail"
            disabled={depot}
          >
            <Mail aria-hidden="true" />
          </button>
        )}
        <input
          ref={choix}
          type="file"
          accept={ACCEPT_HTML}
          multiple
          hidden
          onChange={(e) => ajouter(e.target.files)}
        />
        <textarea
          ref={champ}
          value={texte}
          onChange={(e) => changer(e.target.value)}
          placeholder="Écrire un message"
          aria-label="Écrire un message"
          rows={Math.min(6, Math.max(1, texte.split('\n').length))}
          maxLength={LONGUEUR_MESSAGE_MAX}
          onKeyDown={(e) => {
            // Entrée envoie, Maj + Entrée passe à la ligne — sur ordinateur.
            // Sur téléphone, Entrée passe à la ligne (le bouton envoie) : un
            // doigt qui glisse ne doit pas expédier un message à moitié écrit.
            const tactile = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !tactile) {
              e.preventDefault()
              void envoyer()
            }
          }}
        />
        <button type="submit" className="msg-envoyer" disabled={!peutEnvoyer} aria-label="Envoyer">
          <SendHorizontal aria-hidden="true" />
        </button>
      </div>
      {texte.length > LONGUEUR_MESSAGE_MAX - 200 && (
        <p className="msg-compte">
          {texte.length} / {LONGUEUR_MESSAGE_MAX}
        </p>
      )}
    </form>
  )
}

// ── ÉCRIRE À QUELQU'UN ──────────────────────────────────────────────────────

function NouvelleConversation({
  ouvert,
  surFermer,
  annuaire,
  enCours,
  surChoisir,
}: {
  ouvert: boolean
  surFermer: () => void
  annuaire: MembreAnnuaire[]
  enCours: boolean
  surChoisir: (m: MembreAnnuaire) => void
}) {
  const [cherche, setCherche] = useState('')
  const visibles = annuaire.filter((m) => normaliser(m.nom).includes(normaliser(cherche.trim())))
  const libelleRole = (r: MembreAnnuaire['role']) =>
    r === 'admin' ? 'Administratrice' : r === 'secretaire' ? 'Secrétariat' : 'Vétérinaire'

  return (
    <Dialog
      open={ouvert}
      onOpenChange={(o) => {
        if (!o && !enCours) {
          setCherche('')
          surFermer()
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Écrire à quelqu’un</DialogTitle>
          <DialogDescription>Une conversation privée, que vous seuls lirez.</DialogDescription>
        </DialogHeader>
        <label className="msg-cherche">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={cherche}
            onChange={(e) => setCherche(e.target.value)}
            placeholder="Chercher un nom"
            aria-label="Chercher un nom"
          />
        </label>
        <ul className="msg-annuaire">
          {visibles.map((m) => (
            <li key={m.userId}>
              <button type="button" onClick={() => surChoisir(m)} disabled={enCours}>
                <span className="msg-avatar" aria-hidden="true">
                  {initiales(m.nom)}
                </span>
                <span>
                  <b>{m.nom}</b>
                  <em>{libelleRole(m.role)}</em>
                </span>
              </button>
            </li>
          ))}
          {visibles.length === 0 && <li className="msg-annuaire-vide">Personne ne porte ce nom.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

// ── PRÉVENIR AUSSI PAR MAIL : à qui (B-193c) ────────────────────────────────
// MiKL, 10/11 : « ceux qu'elle aura choisi, comme pour les conversations du
// chat ». Une liste à cocher, avec « Tout le monde » en raccourci. Une personne
// sans adresse est montrée grisée : la cacher laisserait croire qu'elle sera
// prévenue.

function ChoixMail({
  membres,
  choisis,
  equipe,
  surChanger,
  surFermer,
}: {
  membres: MembreAnnuaire[]
  choisis: string[]
  equipe: boolean
  surChanger: (ids: string[]) => void
  surFermer: () => void
}) {
  const joignables = membres.filter((m) => m.aEmail)
  const tous = joignables.length > 0 && joignables.every((m) => choisis.includes(m.userId))
  const basculer = (id: string) =>
    surChanger(choisis.includes(id) ? choisis.filter((x) => x !== id) : [...choisis, id])

  return (
    <div className="msg-choix-mail" role="group" aria-label="Prévenir aussi par mail">
      <div className="msg-choix-mail-tete">
        <span>{equipe ? 'Prévenir aussi par mail' : 'Aussi par mail'}</span>
        <button
          type="button"
          className="msg-lien"
          onClick={() => surChanger(tous ? [] : joignables.map((m) => m.userId))}
          disabled={joignables.length === 0}
        >
          {tous ? 'Personne' : 'Tout le monde'}
        </button>
        <button type="button" className="msg-choix-fermer" onClick={surFermer} aria-label="Valider le choix">
          <Check aria-hidden="true" />
        </button>
      </div>
      <ul>
        {membres.map((m) => {
          const coche = choisis.includes(m.userId)
          return (
            <li key={m.userId}>
              <button
                type="button"
                role="checkbox"
                aria-checked={coche}
                className={coche ? 'coche' : ''}
                onClick={() => basculer(m.userId)}
                disabled={!m.aEmail}
                title={m.aEmail ? undefined : 'Pas d’adresse mail enregistrée'}
              >
                <span className="msg-case" aria-hidden="true">
                  {coche && <Check />}
                </span>
                <span>{m.nom}</span>
                {!m.aEmail && <em>sans adresse</em>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
