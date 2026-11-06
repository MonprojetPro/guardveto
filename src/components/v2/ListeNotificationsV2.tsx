'use client'

// ============================================================
// GUARDVETO V2 — La liste des notifications et ses gestes (B-191, 06/11)
// ============================================================
// Le MÊME composant dans la cloche et dans « Toutes mes notifications » :
// « Tout marquer comme lu », « Vider » (avec confirmation), la croix d'une
// notification, et la suite des plus anciennes sur la page.
//
// « Vider » demande confirmation DANS le panneau, pas par une fenêtre du
// navigateur : un `confirm()` natif fermerait le panneau au clic suivant et ne
// porte pas le ton de l'application.
// ============================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { lienInterne, tempsRelatif, type EtatCloche, type NotificationCloche } from '@/lib/notifications/types'

interface Props {
  variante: 'cloche' | 'page'
  etat: EtatCloche
  charge: boolean
  marquerLue: (n: NotificationCloche) => Promise<void>
  toutLire: () => Promise<void>
  retirer: (n: NotificationCloche) => Promise<void>
  vider: () => Promise<void>
  chargerPlus?: () => Promise<void>
  /** Appelé avant de suivre le lien d'une notification (la cloche se ferme). */
  avantOuverture?: () => void
}

export function ListeNotificationsV2({
  variante, etat, charge, marquerLue, toutLire, retirer, vider, chargerPlus, avantOuverture,
}: Props) {
  const router = useRouter()
  const [confirmer, setConfirmer] = useState(false)
  const [chargement, setChargement] = useState(false)

  async function ouvrir(n: NotificationCloche) {
    const lien = lienInterne(n.lien)
    avantOuverture?.()
    await marquerLue(n)
    if (lien) router.push(lien)
  }

  const aDesItems = etat.items.length > 0

  return (
    <>
      <div className="cl-tete">
        {variante === 'cloche' ? <span className="cl-titre">Notifications</span> : <span />}
        {confirmer ? (
          <span className="cl-confirme" role="group" aria-label="Confirmer le vidage">
            <span className="cl-confirme-txt">Tout retirer ?</span>
            <button type="button" className="cl-action danger" onClick={() => { setConfirmer(false); void vider() }}>
              Vider
            </button>
            <button type="button" className="cl-action" onClick={() => setConfirmer(false)}>
              Annuler
            </button>
          </span>
        ) : (
          <span className="cl-actions">
            {etat.nbNonLues > 0 && (
              <button type="button" className="cl-action" onClick={() => void toutLire()}>
                Tout marquer comme lu
              </button>
            )}
            {aDesItems && (
              <button type="button" className="cl-action" onClick={() => setConfirmer(true)}>
                Vider
              </button>
            )}
          </span>
        )}
      </div>

      {etat.erreur ? (
        <p className="cl-vide">Les notifications n’ont pas pu être lues. Réessayez dans un instant.</p>
      ) : !charge ? (
        <p className="cl-vide">Un instant…</p>
      ) : !aDesItems ? (
        <p className="cl-vide">Aucune notification pour l’instant.</p>
      ) : (
        <ul className={variante === 'page' ? 'cl-liste pleine' : 'cl-liste'}>
          {etat.items.map((n) => (
            <li key={n.id} className="cl-li">
              <button type="button" className={`cl-item${n.lu ? '' : ' non-lu'}`} onClick={() => void ouvrir(n)}>
                <span className="cl-point" aria-hidden="true" />
                <span className="cl-corps">
                  <span className="cl-ligne">
                    <span className="cl-item-titre">{n.titre}</span>
                    <span className="cl-quand">{tempsRelatif(n.created_at)}</span>
                  </span>
                  <span className={variante === 'page' ? 'cl-message entier' : 'cl-message'}>{n.message}</span>
                </span>
                {!n.lu && <span className="vh">non lue</span>}
              </button>
              <button
                type="button"
                className="cl-retirer"
                aria-label={`Retirer « ${n.titre} »`}
                title="Retirer"
                onClick={() => void retirer(n)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {variante === 'page' && etat.aSuite && chargerPlus && (
        <div className="cl-pied">
          <button
            type="button"
            className="cl-action"
            disabled={chargement}
            onClick={async () => {
              setChargement(true)
              try { await chargerPlus() } finally { setChargement(false) }
            }}
          >
            {chargement ? 'Un instant…' : 'Afficher les plus anciennes'}
          </button>
        </div>
      )}
    </>
  )
}
