'use client'

// ============================================================
// GUARDVETO — « Je ne m'en sors pas » : prévenir l'équipe
// ============================================================
// PALIER 4 de l'audit du 2026-08-03. Le filet du filet.
//
// Les trois premiers paliers empêchent ce qu'on sait prévoir. Il restera
// toujours des configurations que personne n'a imaginées — et à ce moment-là,
// le cabinet se retrouve seul devant un message. Ce bouton est la sortie : il
// envoie à l'éditeur le contexte technique et ce que l'utilisateur a écrit,
// pour que le produit soit corrigé à distance.
//
// DEUX PRÉCAUTIONS DE TON
//
//  · On ne le montre QUE sur un échec réel. Un « signaler un problème »
//    permanent dit à l'utilisateur qu'on s'attend à ce que ça casse.
//  · On ne promet rien qu'on ne tienne : le message de confirmation dit ce qui
//    se passe ensuite, sans annoncer de délai.
// ============================================================

import { useState } from 'react'
import { LifeBuoy, Check, Loader2 } from 'lucide-react'
import { signalerLimite } from '@/app/(protected)/assistance/actions'

interface Props {
  /** D'où vient le signalement : « génération », « règles »… */
  origine: string
  /** Contexte technique déjà connu de l'écran (diagnostic, période, codes). */
  contexte?: Record<string, unknown>
}

export function SignalerLimite({ origine, contexte }: Props) {
  const [ouvert, setOuvert] = useState(false)
  const [message, setMessage] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [envoye, setEnvoye] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function envoyer() {
    setEnvoi(true)
    setErreur(null)
    const res = await signalerLimite({ origine, message: message.trim() || undefined, contexte })
    setEnvoi(false)
    if ('error' in res && res.error) {
      setErreur(res.error)
      return
    }
    setEnvoye(true)
  }

  if (envoye) {
    return (
      <div className="sig-fait">
        <Check className="ppv-ico" aria-hidden />
        <span>
          <b>C’est parti.</b> L’équipe GuardVeto a reçu ta situation et ce qui bloque.
          Elle peut corriger à distance — tu n’as rien d’autre à faire.
        </span>
      </div>
    )
  }

  if (!ouvert) {
    return (
      <button type="button" className="ppv-btn" onClick={() => setOuvert(true)}>
        <LifeBuoy className="ppv-ico" aria-hidden />
        Je ne m’en sors pas — prévenir l’équipe
      </button>
    )
  }

  return (
    <div className="sig-panneau">
      <p className="sig-titre">Qu’est-ce que tu essayais de faire ?</p>
      <p className="sig-sous">
        Ce que tu écris part avec le détail technique de ce qui a bloqué (période,
        règles en cause, diagnostic du moteur). Aucun planning nominatif n’est envoyé.
      </p>
      <textarea
        className="sig-zone"
        rows={3}
        placeholder="ex. je veux que Fanny et Victor ne soient jamais de garde la même semaine, mais je n’y arrive pas…"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        autoFocus
      />
      {erreur && <p className="gen-erreur">{erreur}</p>}
      <div className="ppv-actions">
        <button type="button" className="ppv-btn" disabled={envoi} onClick={() => setOuvert(false)}>
          Annuler
        </button>
        <button type="button" className="ppv-btn fort" disabled={envoi} onClick={() => void envoyer()}>
          {envoi && <Loader2 className="ppv-spin" aria-hidden />}
          Envoyer à l’équipe
        </button>
      </div>
    </div>
  )
}
