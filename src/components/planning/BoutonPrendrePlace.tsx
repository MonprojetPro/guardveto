'use client'

// ============================================================
// GUARDVETO — « Je prends la place » (B-179c)
// ============================================================
// UN bouton, posé à deux endroits : la feuille du jour au téléphone et la
// fenêtre de garde sur ordinateur. Le serveur (`/api/gardes/[id]/prendre-place`)
// décide de tout ; ce composant porte le dialogue :
//   • refus net (place prise, garde passée…) → la phrase du serveur, sur place ;
//   • avertissements (une règle s'y oppose) → la liste, et le choix : « je
//     prends quand même » ou « non ». Décision de MiKL : jamais de blocage par
//     les règles, la personne tranche, l'administratrice en garde la trace ;
//   • succès → un toast, puis l'écran se recharge.
// ============================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { roleParDefaut } from '@/lib/gardes/places'
import '@/styles/bouton-prendre-place.css'

type Etat =
  | { t: 'repos' }
  | { t: 'envoi' }
  | { t: 'avertir'; avertissements: string[] }
  | { t: 'refus'; message: string }

export function BoutonPrendrePlace({
  gardeId,
  placeIndex,
  className,
  onFait,
}: {
  gardeId: string
  placeIndex: number
  className?: string
  onFait?: () => void
}) {
  const router = useRouter()
  const [etat, setEtat] = useState<Etat>({ t: 'repos' })

  async function envoyer(confirmer: boolean) {
    setEtat({ t: 'envoi' })
    try {
      const res = await fetch(`/api/gardes/${gardeId}/prendre-place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeIndex, confirmerAvertissements: confirmer }),
      })
      const corps = (await res.json().catch(() => ({}))) as {
        error?: string; warnings?: string[]; needsConfirmation?: boolean
      }
      if (res.ok) {
        toast.success('C’est noté : la place est à vous. L’administratrice est prévenue.')
        setEtat({ t: 'repos' })
        onFait?.()
        router.refresh()
        return
      }
      if (res.status === 409 && corps.needsConfirmation && corps.warnings?.length) {
        setEtat({ t: 'avertir', avertissements: corps.warnings })
        return
      }
      setEtat({ t: 'refus', message: corps.error ?? 'La place n’a pas pu être prise.' })
    } catch {
      setEtat({ t: 'refus', message: 'Le serveur ne répond pas. Réessayez dans un instant.' })
    }
  }

  if (etat.t === 'avertir') {
    return (
      <div className="bpp-avertir" role="alert">
        <p className="bpp-titre">Avant de prendre cette place</p>
        <ul>
          {etat.avertissements.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
        <p className="bpp-note">Vous pouvez la prendre quand même : l’administratrice verra ces points.</p>
        <div className="bpp-actions">
          <button type="button" className="bpp-btn secondaire" onClick={() => setEtat({ t: 'repos' })}>Non, je laisse</button>
          <button type="button" className="bpp-btn" onClick={() => envoyer(true)}>Je la prends quand même</button>
        </div>
      </div>
    )
  }

  return (
    <div className="bpp">
      <button
        type="button"
        className={className ?? 'bpp-btn'}
        disabled={etat.t === 'envoi'}
        onClick={() => envoyer(false)}
      >
        {etat.t === 'envoi' ? 'Un instant…' : `Je prends la place (${roleParDefaut(placeIndex)})`}
      </button>
      {etat.t === 'refus' && <p className="bpp-refus" role="alert">{etat.message}</p>}
    </div>
  )
}
