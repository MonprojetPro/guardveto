'use client'

// ============================================================
// GUARDVETO V2 — Filou accroché au rebord de la carte planning
// ============================================================
// Il attend qu'on le sollicite, agrippé au bord gauche de l'espace de
// travail. Son ATTENTE est en couches (4 WebP animés par le CSS : il respire,
// cligne, remue les oreilles — 50 Ko, aucune vidéo). Son COUCOU reste du
// métrage, parce que la patte n'existe pas dans les couches.
//
// La bascule couches → vidéo se fait en DEUX temps : les couches reviennent
// d'abord à leur pose neutre (240 ms), qui est exactement la 1re image du
// métrage, puis on échange en 80 ms sur deux images superposables. Un fondu
// croisé long superposerait deux Filous décalés, et ça se verrait.
//
// ⚠ Le calage `left: -160px` n'est pas un réglage au jugé : l'arête visible
// du détourage est à x≈192 natif, et c'est elle qui doit tomber PILE sur le
// bord de la carte. Le détail est dans le CSS (v2-planning.css) — deux
// calages ont raté pour avoir pris la bbox de la pièce à la place.
//
// Un clic ouvre l'accueil AVEC la mémoire de l'origine (`#filou=planning`) :
// Filou accueille par une phrase liée au planning, pas par un bonjour générique.
// Porté depuis `maquette/m1-planning.html`.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/** Le coucou se rejoue tout seul entre 30 et 45 s. */
const COUCOU_MIN_MS = 30_000
const COUCOU_ALEA_MS = 15_000
/** Au survol, au plus un coucou toutes les 8 s (sinon il s'agite). */
const SURVOL_REPOS_MS = 8000
/** Filet si `ended` ne vient pas (onglet en arrière-plan, décodage coupé). */
const COUCOU_SECOURS_MS = 6000

export function FilouEdge() {
  const router = useRouter()
  const bouton = useRef<HTMLButtonElement>(null)
  const coucou = useRef<HTMLVideoElement>(null)
  const [part, setPart] = useState(false)

  const enCours = useRef(false)
  const dernierSurvol = useRef(0)
  const minuteries = useRef<ReturnType<typeof setTimeout>[]>([])

  const poser = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms)
    minuteries.current.push(t)
    return t
  }, [])

  const finCoucou = useCallback(() => {
    const el = bouton.current
    if (!el) return
    el.classList.remove('fe-wave')
    enCours.current = false
    // On ne relâche la pose neutre qu'une fois les couches revenues : retirer
    // `fe-neutre` relance les animations à 0 %, donc pile au neutre.
    poser(() => el.classList.remove('fe-neutre'), 140)
  }, [poser])

  const jouerCoucou = useCallback(() => {
    const el = bouton.current
    const v = coucou.current
    if (!el || !v || enCours.current || v.readyState < 2) return
    enCours.current = true
    el.classList.add('fe-neutre')
    poser(() => {
      if (!enCours.current) return
      try {
        v.currentTime = 0
      } catch {
        /* le recalage a échoué : le geste partira de là où il en était */
      }
      void v.play().catch(() => {})
      el.classList.add('fe-wave')
      poser(() => {
        if (enCours.current) finCoucou()
      }, COUCOU_SECOURS_MS)
    }, 240)
  }, [finCoucou, poser])

  // Le coucou spontané + la fin du geste.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const v = coucou.current
    if (!v) return

    let vivant = true
    const replanifier = () => {
      if (!vivant) return
      poser(() => {
        if (!vivant) return
        jouerCoucou()
        replanifier()
      }, COUCOU_MIN_MS + Math.random() * COUCOU_ALEA_MS)
    }
    const surFin = () => finCoucou()
    v.addEventListener('ended', surFin)
    v.addEventListener('error', finCoucou, true)
    replanifier()

    const timers = minuteries.current
    return () => {
      vivant = false
      v.removeEventListener('ended', surFin)
      v.removeEventListener('error', finCoucou, true)
      timers.forEach(clearTimeout)
    }
  }, [finCoucou, jouerCoucou, poser])

  function surSurvol() {
    const t = Date.now()
    if (t - dernierSurvol.current < SURVOL_REPOS_MS) return
    dernierSurvol.current = t
    jouerCoucou()
  }

  function surClic() {
    if (part) return
    setPart(true)
    const vers = '/accueil#filou=planning'
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      router.push(vers)
      return
    }
    bouton.current?.classList.add('fe-hop')
    poser(() => router.push(vers), 700)
  }

  return (
    <>
      <button
        type="button"
        className="filou-edge"
        ref={bouton}
        onMouseEnter={surSurvol}
        onClick={surClic}
        aria-label="Faire appel à Filou — ouvre l'accueil"
      >
        <span className="fe-crop" aria-hidden="true">
          {/* Les pièces sont posées en coordonnées NATIVES du métrage
              (1080×1920) ; --ech les ramène à 200 px de large. */}
          <span className="fx">
            <span className="fx-scene">
              {/* eslint-disable @next/next/no-img-element -- pièces découpées,
                  positionnées au pixel natif : toute ré-optimisation décale
                  l'assemblage. */}
              <img
                className="fx-corps"
                src="/filou/couches/corps.webp"
                style={{ left: 143, top: 834, width: 667, height: 423 }}
                alt=""
              />
              <span className="fx-tete">
                <img
                  className="fx-or-g"
                  src="/filou/couches/oreille-g.webp"
                  style={{ left: 375, top: 149, width: 260, height: 358 }}
                  alt=""
                />
                <img
                  className="fx-or-d"
                  src="/filou/couches/oreille-d.webp"
                  style={{ left: 772, top: 344, width: 248, height: 327 }}
                  alt=""
                />
                <img
                  src="/filou/couches/tete.webp"
                  style={{ left: 183, top: 149, width: 824, height: 794 }}
                  alt=""
                />
                {/* eslint-enable @next/next/no-img-element */}
                <span className="fx-oeil g" style={{ left: 466, top: 511, width: 138, height: 138 }}>
                  <i />
                </span>
                <span className="fx-oeil d" style={{ left: 661, top: 575, width: 128, height: 126 }}>
                  <i />
                </span>
              </span>
            </span>
          </span>

          <video ref={coucou} id="fe-coucou" muted playsInline preload="auto">
            <source src="/filou/filou-accroche-coucou.webm" type="video/webm" />
          </video>
        </span>

        {/* Le socle rend deux services : il masque la coupe nette du métrage
            (qui n'a pas de fin — sans lui il faudrait un fondu, et le fondu
            détruit l'image) ET il dit à quoi sert Filou. Hors du .fe-crop,
            sinon son libellé partirait à l'envers avec le miroir. */}
        <span className="fe-socle">
          <span className="fe-socle-txt">Faire appel à Filou</span>
        </span>
      </button>

      <div className={`depart-veil${part ? ' show' : ''}`} aria-hidden="true" />
    </>
  )
}
