'use client'

// ============================================================
// GUARDVETO V2 — Filou assis sur son cube
// ============================================================
// Deux boucles vidéo WebM à fond transparent : l'attente (il respire) et
// « il tape sur sa tablette » (quand on lui donne une consigne). La boucle
// tape commence ET finit sur la pose d'attente : au retour on recale l'attente
// sur sa frame 0 pendant qu'elle est cachée, et la couture est invisible.
//
// ⚠ Ne JAMAIS réintroduire de fondu dans ces assets : c'est ce qui avait
// détruit le métrage (docs/patch-log.md + mémoire projet). Le fondu ici est
// un fondu CSS entre deux vidéos, pas un fondu gravé dans les images.
//
// Repli sans trou : si le WebM alpha ne charge pas (Safari, fichier absent)
// ou en motion réduite, l'avatar fixe prend sa place dans la niche.
// Porté depuis `maquette/m6-accueil-epicentre.html`.
// ============================================================

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from 'react'

const REQUETE_MOTION = '(prefers-reduced-motion: reduce)'

/** La préférence système est un état EXTERNE : on s'y abonne, on ne la copie
 *  pas dans un state (sinon premier rendu serveur ≠ premier rendu client). */
function useMotionReduite(): boolean {
  return useSyncExternalStore(
    (prevenir) => {
      const mq = window.matchMedia(REQUETE_MOTION)
      mq.addEventListener('change', prevenir)
      return () => mq.removeEventListener('change', prevenir)
    },
    () => window.matchMedia(REQUETE_MOTION).matches,
    () => false, // côté serveur : on part du principe que ça bouge
  )
}

export interface FilouHandle {
  /** Déclenche la boucle « il tape sur sa tablette », puis revient à l'attente. */
  tape: () => void
}

/** Filet de sécurité si l'évènement `ended` ne vient jamais (ms). */
const SECOURS_MS = 8600

export function FilouCube({ ref }: { ref?: Ref<FilouHandle> }) {
  const attenteRef = useRef<HTMLVideoElement>(null)
  const tapeRef = useRef<HTMLVideoElement>(null)
  const cubeRef = useRef<HTMLDivElement>(null)
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null)
  const motionReduite = useMotionReduite()
  const [videoMuette, setVideoMuette] = useState(false)
  // Repli sans trou : motion réduite, ou vidéo non décodable après 3 s.
  const replier = motionReduite || videoMuette

  useEffect(() => {
    if (motionReduite) return
    const v = attenteRef.current
    if (!v) return
    const echec = () => setVideoMuette(true)
    v.addEventListener('error', echec, true)
    const t = setTimeout(() => {
      if ((attenteRef.current?.readyState ?? 0) < 2) setVideoMuette(true)
    }, 3000)
    return () => {
      v.removeEventListener('error', echec, true)
      clearTimeout(t)
    }
  }, [motionReduite])

  const retour = useCallback(() => {
    const attente = attenteRef.current
    const tape = tapeRef.current
    if (minuterie.current) clearTimeout(minuterie.current)
    if (attente) {
      try {
        attente.currentTime = 0
      } catch {
        /* recalage impossible : la couture sera juste un peu visible */
      }
      void attente.play().catch(() => {})
    }
    cubeRef.current?.classList.remove('taping')
    setTimeout(() => tape?.pause(), 320)
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      tape() {
        if (replier) return
        const tape = tapeRef.current
        const attente = attenteRef.current
        if (!tape || !attente || tape.readyState < 2) return
        if (minuterie.current) clearTimeout(minuterie.current)
        tape.currentTime = 0
        tape.onended = retour
        void tape.play().catch(() => {})
        cubeRef.current?.classList.add('taping')
        minuterie.current = setTimeout(retour, SECOURS_MS)
      },
    }),
    [replier, retour],
  )

  return (
    <div className="filou-cube" ref={cubeRef} aria-hidden="true">
      <div className="socle">
        <i className="sc-shadow" />
        <i className="sc-side" />
        <i className="sc-top" />
        <i className="sc-front" />
        <i className="sc-contact" />
      </div>

      {replier ? (
        /* Image de repli déjà dimensionnée (85 Ko, WebP) et calée au pixel sur
           la niche : next/image la re-encoderait et décalerait l'assise. */
        // eslint-disable-next-line @next/next/no-img-element
        <img className="filou-fallback" src="/filou/filou-pose-fixe.webp" alt="" />
      ) : (
        <>
          <video ref={attenteRef} id="filou-video" autoPlay loop muted playsInline>
            <source src="/filou/filou-attente.webm" type="video/webm" />
          </video>
          <video ref={tapeRef} id="filou-video-tape" muted playsInline preload="auto">
            <source src="/filou/filou-tape-tablette.webm" type="video/webm" />
          </video>
        </>
      )}
    </div>
  )
}
