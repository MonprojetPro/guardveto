'use client'

// ============================================================
// GUARDVETO — Réglages refondus : les pièces communes (B-202)
// ============================================================
// Maquette validée par MiKL le 10/11 : `docs/maquettes/B-202-reglages.html`.
// Styles : `styles/v2-reglages-onglet.css`, importée par `ReglagesOnglet` seul.
// ============================================================

import { useId, type ReactNode } from 'react'

/**
 * L'interrupteur validé en B-181, en vrai bouton `role="switch"` : il se
 * lit « activé / désactivé » au lecteur d'écran et se manœuvre au clavier.
 */
export function Interrupteur({
  actif,
  onBasculer,
  libelle,
  desactive = false,
}: {
  actif: boolean
  onBasculer: (actif: boolean) => void
  libelle: string
  desactive?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-label={libelle}
      className={actif ? 'rg-sw on' : 'rg-sw'}
      disabled={desactive}
      onClick={() => onBasculer(!actif)}
    />
  )
}

export type Ton = 'ok' | 'warn' | 'bad' | 'off'

/** Une pastille d'état. `nue` = sans le point (un compteur, pas un état). */
export function Pastille({ ton, children, nue = false }: { ton: Ton; children: ReactNode; nue?: boolean }) {
  return <span className={`rg-pastille ${ton}${nue ? ' nue' : ''}`}>{children}</span>
}

/** Un bloc du panneau : un titre, son état à droite, puis son contenu. Jamais de carte dans une carte. */
export function Bloc({ titre, etat, children }: { titre?: string; etat?: ReactNode; children: ReactNode }) {
  // Le titre visible nomme la région (`aria-labelledby`) : un `aria-label`
  // en plus le faisait annoncer deux fois.
  const idTitre = useId()
  return (
    <section className="rg-bloc" aria-labelledby={titre ? idTitre : undefined}>
      {(titre || etat) && (
        <div className="rg-bloc-tete">
          {titre && <h3 id={idTitre}>{titre}</h3>}
          {etat}
        </div>
      )}
      {children}
    </section>
  )
}

/** Le petit cercle qui tourne pendant un envoi. */
export function Roue() {
  return <span className="rg-roue" aria-hidden="true" />
}
