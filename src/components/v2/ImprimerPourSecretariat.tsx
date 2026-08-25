'use client'

// ============================================================
// GUARDVETO V2 — Imprimer, côté secrétariat (B-017)
// ============================================================
// MiKL, le 2026-08-25, devant l'écran du secrétariat affichant « Hors
// période » : « finalement, pour les secrétaires, pas besoin de notion de
// période — tous les plannings publiés et c'est tout. À la limite pour
// l'impression PDF, elles peuvent choisir. »
//
// C'est juste, et ça se voyait à l'écran : la pilule annonçait « Hors
// période » sur un mois sans planning, ce qui se lit comme une anomalie alors
// que ce n'est qu'une absence de garde. La notion de période est un outil de
// PRÉPARATION — on génère par période, on publie par période. Le secrétariat
// ne prépare rien : il regarde un calendrier et répond au téléphone. Un mois
// lui suffit comme repère.
//
// L'impression est le seul endroit où la question se repose vraiment : un PDF
// porte forcément une période entière. D'où ce bouton, qui la demande au
// moment où elle a un sens — et seulement là.
//
// ⚠️ Ce menu ne liste QUE des périodes diffusées et pourvues de gardes : c'est
// ce que la page lui transmet. Le serveur revérifie de son côté
// (`api/export-pdf`, sur `publie_at`) — sans quoi il aurait suffi de taper
// l'adresse avec l'identifiant d'un brouillon.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import type { Periode } from '@/types'

function nomPeriode(p: Periode): string {
  return p.libelle ?? `${p.saison === 'ete' ? 'Été' : 'Hiver'} ${p.date_debut.slice(0, 4)}`
}

/** « du 7 septembre au 20 septembre 2026 » — repère de dates, pas de jargon. */
function bornes(p: Periode): string {
  const f = (iso: string, avecAnnee: boolean) =>
    new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      ...(avecAnnee ? { year: 'numeric' } : {}),
    })
  return `du ${f(p.date_debut, false)} au ${f(p.date_fin, true)}`
}

export function ImprimerPourSecretariat({ periodes }: { periodes: Periode[] }) {
  const [ouvert, setOuvert] = useState(false)
  const boite = useRef<HTMLDivElement>(null)

  // Fermeture au clic extérieur et à Échap — un menu qu'on ne peut refermer
  // qu'en rechoisissant quelque chose oblige à agir pour annuler.
  useEffect(() => {
    if (!ouvert) return
    const dehors = (e: MouseEvent) => {
      if (boite.current && !boite.current.contains(e.target as Node)) setOuvert(false)
    }
    const echap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuvert(false)
    }
    document.addEventListener('mousedown', dehors)
    document.addEventListener('keydown', echap)
    return () => {
      document.removeEventListener('mousedown', dehors)
      document.removeEventListener('keydown', echap)
    }
  }, [ouvert])

  // Aucun planning diffusé : le bouton est désactivé et DIT pourquoi. Le
  // masquer laisserait chercher où est passée l'impression.
  if (periodes.length === 0) {
    return (
      <button
        type="button"
        className="head-btn ghost"
        disabled
        title="Aucun planning diffusé pour l’instant — il n’y a rien à imprimer."
      >
        🖨 PDF
      </button>
    )
  }

  // Une seule période diffusée : on n'ouvre pas un menu pour un choix unique.
  if (periodes.length === 1) {
    return (
      <button
        type="button"
        className="head-btn ghost"
        title={`Imprimer ${nomPeriode(periodes[0])}`}
        onClick={() => {
          window.location.href = `/api/export-pdf?periodeId=${periodes[0].id}`
        }}
      >
        🖨 PDF
      </button>
    )
  }

  return (
    <div className="pdf-choix" ref={boite}>
      <button
        type="button"
        className="head-btn ghost"
        aria-expanded={ouvert}
        aria-haspopup="menu"
        onClick={() => setOuvert((v) => !v)}
        title="Choisir le planning à imprimer"
      >
        🖨 PDF
      </button>

      {ouvert && (
        <div className="pdf-menu" role="menu" aria-label="Planning à imprimer">
          <p className="pdf-menu-titre">Quel planning imprimer ?</p>
          {periodes.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              className="pdf-menu-item"
              onClick={() => {
                setOuvert(false)
                window.location.href = `/api/export-pdf?periodeId=${p.id}`
              }}
            >
              <b>{nomPeriode(p)}</b>
              <span>{bornes(p)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
