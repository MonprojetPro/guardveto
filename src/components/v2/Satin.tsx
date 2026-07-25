'use client'

// ============================================================
// GUARDVETO V2 — Le satin (plan 1 du décor « Terrier chaleureux »)
// ============================================================
// Fond d'écran de toute la page, bord à bord, derrière tout le reste. Il
// dérive un peu plus lentement que la carte au scroll : deux plans distincts,
// jamais de parallaxe à la souris (ça rend la page nerveuse).
// Porté depuis `maquette/m6-accueil-epicentre.html`.
// ============================================================

import { useEffect, useRef } from 'react'

export function Satin() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const el = ref.current
    if (!el) return

    let enAttente = false
    const onScroll = () => {
      if (enAttente) return
      enAttente = true
      window.requestAnimationFrame(() => {
        el.style.transform = `translate3d(0,${(window.scrollY * 0.07).toFixed(1)}px,0)`
        enAttente = false
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="satin" ref={ref} aria-hidden="true">
      <div className="silk">
        <i className="s1" />
        <i className="s2" />
        <i className="s3" />
        <i className="s4" />
      </div>
      <div className="folds f1" />
      <div className="folds f2" />
      <div className="sheen" />
      <div className="grain" />
    </div>
  )
}
