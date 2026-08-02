'use client'

// ============================================================
// GUARDVETO — Alerte de pré-vol (backlog n°23 + n°24)
// ============================================================
// Affichée sur l'écran de planning DÈS qu'une période est visible, AVANT le
// clic « Générer » :
//   • demandes de congé en attente qui chevauchent la période (n°24 —
//     même détection que le gate de publication, signal plus précoce),
//   • incohérences de règles détectées par le pré-vol (n°23 — règles
//     fantômes, contradictions arithmétiques certaines).
// NON bloquant : l'admin peut toujours générer. Rien à signaler → rien
// n'est affiché (aucun bruit).
//
// REFONTE 2026-08-02 (retour MiKL : « faut vraiment faire quelque chose pour
// cette présentation »). Deux défauts, pas un :
//   1. Tout était déplié d'office — six avertissements et leurs règles en
//      cause repoussaient le calendrier hors de l'écran. C'est un SIGNAL, il
//      se replie ; le détail est à un clic.
//   2. Le constat et les règles en cause vivaient dans la même liste à puces,
//      au même niveau : impossible de savoir quelle règle allait avec quel
//      constat. Chaque avertissement est désormais une carte — le constat en
//      corps de texte, les règles fautives en pastilles dessous.
// L'habillage passe des classes `amber-*` de la V1 aux jetons du terrier.
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import { CalendarClock, ShieldAlert, ChevronDown } from 'lucide-react'
import type { AvertissementPreVol } from '@/engine/pre-vol'

interface PreVolAlertProps {
  avertissements: AvertissementPreVol[]
  souhaitsEnAttente: number
}

export function PreVolAlert({ avertissements, souhaitsEnAttente }: PreVolAlertProps) {
  const [ouvert, setOuvert] = useState(false)

  if (avertissements.length === 0 && souhaitsEnAttente === 0) return null

  const pluriel = souhaitsEnAttente > 1

  return (
    <div className="gv-alertes-pile">
      {/* n°24 — souhaits de congé en attente (avant même de générer).
          Jamais replié : une seule ligne, et c'est une action à faire. */}
      {souhaitsEnAttente > 0 && (
        <div className="gv-alerte attention">
          <div className="gva-tete">
            <CalendarClock className="gva-ico" aria-hidden />
            <div className="gva-titres">
              <p className="gva-titre">
                {souhaitsEnAttente} demande{pluriel ? 's' : ''} de congé en attente
                {pluriel ? ' chevauchent' : ' chevauche'} cette période
              </p>
              <p className="gva-sous">
                Un congé validé après coup obligera à régénérer le planning.
              </p>
            </div>
            <Link href="/conges" className="gva-lien">Voir les demandes →</Link>
          </div>
        </div>
      )}

      {/* n°23 — pré-vol de cohérence des règles */}
      {avertissements.length > 0 && (
        <div className="gv-alerte attention">
          <div className="gva-tete">
            <ShieldAlert className="gva-ico" aria-hidden />
            <div className="gva-titres">
              <p className="gva-titre">
                {avertissements.length > 1
                  ? `${avertissements.length} points à vérifier avant de générer`
                  : 'Un point à vérifier avant de générer'}
              </p>
              <p className="gva-sous">
                Tu peux générer quand même — mais ces points risquent de faire
                échouer ou fausser le planning.
              </p>
            </div>
            <button
              type="button"
              className="gva-toggle"
              aria-expanded={ouvert}
              onClick={() => setOuvert((v) => !v)}
            >
              {ouvert ? 'Masquer' : 'Voir le détail'}
              <ChevronDown className={`gva-chevron${ouvert ? ' ouvert' : ''}`} aria-hidden />
            </button>
          </div>

          {ouvert && (
            <div className="gva-corps">
              {avertissements.map((a, i) => (
                <div key={i} className="gva-cause">
                  <p className="gva-cause-detail">{a.message}</p>
                  {a.regles.length > 0 && (
                    <p className="gva-puces">
                      <span className="gva-puces-label">
                        Règle{a.regles.length > 1 ? 's' : ''} en cause
                      </span>
                      {a.regles.map((r, j) => (
                        <span key={j} className="gva-puce">{r}</span>
                      ))}
                    </p>
                  )}
                </div>
              ))}

              <div className="gva-actions">
                <Link href="/regles" className="gva-lien">Revoir les règles →</Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
