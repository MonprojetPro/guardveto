'use client'

// ============================================================
// GUARDVETO — Alerte de pré-vol (backlog n°23 + n°24)
// ============================================================
// Affichée sur l'écran de planning DÈS qu'une période est visible, AVANT le
// clic « Générer » :
//   • demandes de congé en attente qui chevauchent la période (n°24 —
//     même détection que le gate de publication, signal plus précoce),
//   • incohérences de règles détectées par le pré-vol (n°23).
//
// TROIS REFONTES SUCCESSIVES, LE 2026-08-02 (retours MiKL) :
//   1. Tout était déplié d'office → replié. Un bandeau est un SIGNAL.
//   2. Constat et règles en cause au même niveau dans une liste à puces →
//      une carte par point, les règles en pastilles sous le constat.
//   3. « Y a rien qui permette de changer quoi que ce soit directement » →
//      chaque point porte ses GESTES (`PointPreVol`), et le compteur sépare
//      ce qui BARRE la route de ce qu'il faut seulement surveiller.
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import { CalendarClock, ShieldAlert, ChevronDown } from 'lucide-react'
import { PointPreVol, type VetEtiquette } from './PointPreVol'
import type { AvertissementPreVol } from '@/engine/pre-vol'

interface PreVolAlertProps {
  avertissements: AvertissementPreVol[]
  souhaitsEnAttente: number
  /** Vétérinaires actifs — pour poser/retirer une étiquette sur place. */
  vets?: VetEtiquette[]
  /** Recalcule le pré-vol après une correction appliquée depuis un point. */
  onCorrige?: () => void
}

export function PreVolAlert({
  avertissements,
  souhaitsEnAttente,
  vets = [],
  onCorrige,
}: PreVolAlertProps) {
  const [ouvert, setOuvert] = useState(false)

  if (avertissements.length === 0 && souhaitsEnAttente === 0) return null

  const pluriel = souhaitsEnAttente > 1
  const bloquants = avertissements.filter((a) => a.gravite === 'bloquant')
  const aSurveiller = avertissements.filter((a) => a.gravite !== 'bloquant')
  const ton = bloquants.length > 0 ? 'danger' : 'attention'

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
        <div className={`gv-alerte ${ton}`}>
          <div className="gva-tete">
            <ShieldAlert className="gva-ico" aria-hidden />
            <div className="gva-titres">
              <p className="gva-titre">
                {bloquants.length > 0
                  ? `${bloquants.length} point${bloquants.length > 1 ? 's' : ''} ${bloquants.length > 1 ? 'bloquants' : 'bloquant'} — la génération échouera`
                  : `${aSurveiller.length} point${aSurveiller.length > 1 ? 's' : ''} à surveiller`}
                {bloquants.length > 0 && aSurveiller.length > 0 && (
                  <span className="gva-compte">
                    {' '}· et {aSurveiller.length} à surveiller
                  </span>
                )}
              </p>
              <p className="gva-sous">
                {bloquants.length > 0
                  ? 'Ces points se règlent d’ici — pas besoin d’aller chercher les règles ailleurs.'
                  : 'Le planning sortira, mais ces réglages n’auront pas l’effet attendu.'}
              </p>
            </div>
            <button
              type="button"
              className="gva-toggle"
              aria-expanded={ouvert}
              onClick={() => setOuvert((v) => !v)}
            >
              {ouvert ? 'Masquer' : 'Régler maintenant'}
              <ChevronDown className={`gva-chevron${ouvert ? ' ouvert' : ''}`} aria-hidden />
            </button>
          </div>

          {ouvert && (
            <div className="gva-corps">
              {[...bloquants, ...aSurveiller].map((a, i) => (
                <PointPreVol
                  key={`${a.code}-${i}`}
                  avertissement={a}
                  vets={vets}
                  onCorrige={() => onCorrige?.()}
                />
              ))}

              <div className="gva-actions">
                <Link href="/regles" className="gva-lien">Ouvrir l’écran Règles →</Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
