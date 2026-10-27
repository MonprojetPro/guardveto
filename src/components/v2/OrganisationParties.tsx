'use client'

// ============================================================
// GUARDVETO V2 — Organisation : les deux parties et « Vos plannings » (B-175)
// ============================================================
// MiKL, le 27/10 : « il devrait y avoir dans l'onglet organisation une partie
// consacrée aux gardes et une partie consacrée aux journées » ; et le choix
// gardes / journées / les deux « appartient à l'admin ».
//
// ⚠️ Les parties sont des LIENS (`?partie=`), pas un état local : la page
//    serveur ne charge que la partie affichée, et un lien envoyé à quelqu'un
//    l'ouvre au bon endroit.
// ============================================================

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { basculerModuleCabinet } from '@/app/(v2)/regles/modules-actions'

export type PartieOrganisation = 'gardes' | 'journees'

interface Props {
  partie: PartieOrganisation
  estAdmin: boolean
  journeeAllumee: boolean
}

export function OrganisationParties({ partie, estAdmin, journeeAllumee }: Props) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [refus, setRefus] = useState<string | null>(null)

  const basculer = (actif: boolean) => {
    setRefus(null)
    demarrer(async () => {
      const r = await basculerModuleCabinet('planning-journee', actif)
      if ('error' in r) {
        setRefus(r.error)
        return
      }
      // Éteint depuis la partie Journées : on retombe sur les gardes, sinon la
      // page afficherait une partie qui n'existe plus.
      router.replace(actif ? '/regles?partie=journees' : '/regles')
      router.refresh()
    })
  }

  // Un véto sur un cabinet sans journées n'a ni bascule ni encart : pas de
  // bloc vide qui pousserait la page vers le bas.
  if (!journeeAllumee && !estAdmin) return null

  return (
    <div className="org-tete rise">
      {journeeAllumee && (
        <nav className="org-parties" aria-label="Parties de l’organisation">
          <Link
            href="/regles"
            className="org-partie"
            aria-current={partie === 'gardes' ? 'page' : undefined}
          >
            Gardes
          </Link>
          <Link
            href="/regles?partie=journees"
            className="org-partie"
            aria-current={partie === 'journees' ? 'page' : undefined}
          >
            Journées
          </Link>
        </nav>
      )}

      {estAdmin && (
        <section className="org-plannings" aria-label="Vos plannings">
          <span className="org-plannings-titre">Vos plannings</span>
          <span className="org-module">
            <span className="org-coche on" aria-hidden="true" />
            Gardes du soir et du week-end
            <span className="org-fixe">toujours actif</span>
          </span>
          <label className="org-module org-module-reglable">
            <input
              type="checkbox"
              checked={journeeAllumee}
              disabled={enCours}
              onChange={(e) => basculer(e.target.checked)}
            />
            Planning de la journée
          </label>
          {refus && (
            <p className="org-refus" role="alert">
              {refus}
            </p>
          )}
          {!journeeAllumee && (
            <p className="org-note">
              Éteint, il disparaît pour toute l’équipe. Ce qui a déjà été saisi est conservé et
              revient si vous le rallumez.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
