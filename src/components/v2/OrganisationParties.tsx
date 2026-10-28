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
  /** B-175a — les gardes s'éteignent aussi (cabinet « journées seules »). */
  gardesAllumees: boolean
}

type ModuleReglable = 'gardes' | 'planning-journee'

export function OrganisationParties({ partie, estAdmin, journeeAllumee, gardesAllumees }: Props) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [refus, setRefus] = useState<string | null>(null)

  const basculer = (module: ModuleReglable, actif: boolean) => {
    setRefus(null)
    demarrer(async () => {
      const r = await basculerModuleCabinet(module, actif)
      if ('error' in r) {
        setRefus(r.error)
        return
      }
      // On atterrit sur une partie qui existe encore : éteindre les journées
      // ramène aux gardes, éteindre les gardes ouvre les journées.
      const journeesRestent = r.modules.includes('planning-journee')
      const gardesRestent = r.modules.includes('gardes')
      // Allumer les journées y mène, comme avant B-175a.
      const versJournees =
        journeesRestent &&
        (!gardesRestent || partie === 'journees' || (module === 'planning-journee' && actif))
      router.replace(versJournees ? '/regles?partie=journees' : '/regles')
      router.refresh()
    })
  }

  // Un véto sur un cabinet à un seul planning n'a ni onglets ni encart : pas
  // de bloc vide qui pousserait la page vers le bas.
  const lesDeux = journeeAllumee && gardesAllumees
  if (!lesDeux && !estAdmin) return null

  // Le DERNIER planning allumé ne se décoche pas : la base le refuserait, et
  // une case qui revient toute seule ne dit pas pourquoi. On grise et on le dit.
  const seulGardes = gardesAllumees && !journeeAllumee
  const seulJournees = journeeAllumee && !gardesAllumees

  return (
    <div className="org-tete rise">
      {lesDeux && (
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
          <label className="org-module org-module-reglable">
            <input
              type="checkbox"
              checked={gardesAllumees}
              disabled={enCours || seulGardes}
              onChange={(e) => basculer('gardes', e.target.checked)}
            />
            Gardes du soir et du week-end
          </label>
          <label className="org-module org-module-reglable">
            <input
              type="checkbox"
              checked={journeeAllumee}
              disabled={enCours || seulJournees}
              onChange={(e) => basculer('planning-journee', e.target.checked)}
            />
            Planning de la journée
          </label>
          {refus && (
            <p className="org-refus" role="alert">
              {refus}
            </p>
          )}
          {(seulGardes || seulJournees) && (
            <p className="org-note">
              Il faut garder au moins un planning. Ce qui est éteint disparaît pour toute
              l’équipe ; ce qui a déjà été saisi est conservé et revient si vous le rallumez.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
