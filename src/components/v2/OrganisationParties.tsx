'use client'

// ============================================================
// GUARDVETO V2 — Organisation : les deux plannings du cabinet, en tuiles
// ============================================================
// B-175 (27/10) : une partie Gardes et une partie Journées, et le choix
// gardes / journées / les deux « appartient à l'admin ».
//
// B-177 (28/10) — MiKL : « c'est un paramètre super important et ce sont 2
// pauvres cases, et en plus quand on coche ça modifie l'aspect pour un truc
// complètement moche ». Les cases deviennent DEUX TUILES qui sont à la fois
// les onglets (clic : on ouvre la partie) et les interrupteurs (dans le coin).
//
// ⚠️ UNE TUILE ÉTEINTE GARDE SA PLACE ET SA TAILLE. C'était tout le défaut :
//    éteindre faisait disparaître les onglets et surgir une phrase alignée à
//    droite, la page changeait de forme. Ici, seul l'état de la tuile change.
//
// ⚠️ L'INTERRUPTEUR N'EST PAS DANS LE LIEN. Un bouton dans un lien est du HTML
//    invalide (deux commandes l'une dans l'autre) : le lien couvre la tuile par
//    un calque (`::after`), l'interrupteur passe au-dessus.
//
// ⚠️ ÉTEINDRE DEMANDE CONFIRMATION, allumer non (zone d'ombre ① tranchée par
//    MiKL le 28/10) : éteindre retire un planning à TOUTE l'équipe d'un clic.
// ============================================================

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Lock, Moon, Sun } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { basculerModuleCabinet } from '@/app/(v2)/regles/modules-actions'

export type PartieOrganisation = 'gardes' | 'journees'

type ModuleReglable = 'gardes' | 'planning-journee'

/** Ce que chaque tuile résume quand son planning est allumé. */
export interface ResumesPlannings {
  gardes: string
  journees: string
}

interface Props {
  partie: PartieOrganisation
  estAdmin: boolean
  journeeAllumee: boolean
  /** B-175a — les gardes s'éteignent aussi (cabinet « journées seules »). */
  gardesAllumees: boolean
  resumes: ResumesPlannings
}

const TUILES: {
  module: ModuleReglable
  partie: PartieOrganisation
  nom: string
  href: string
  Icone: typeof Moon
}[] = [
  { module: 'gardes', partie: 'gardes', nom: 'Gardes', href: '/regles', Icone: Moon },
  {
    module: 'planning-journee',
    partie: 'journees',
    nom: 'Journées',
    href: '/regles?partie=journees',
    Icone: Sun,
  },
]

const NOM_COMPLET: Record<ModuleReglable, string> = {
  gardes: 'les gardes du soir et du week-end',
  'planning-journee': 'le planning de la journée',
}

export function OrganisationParties({
  partie,
  estAdmin,
  journeeAllumee,
  gardesAllumees,
  resumes,
}: Props) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [refus, setRefus] = useState<string | null>(null)
  const [aEteindre, setAEteindre] = useState<ModuleReglable | null>(null)

  const allume: Record<ModuleReglable, boolean> = {
    gardes: gardesAllumees,
    'planning-journee': journeeAllumee,
  }
  const nbAllumes = Number(gardesAllumees) + Number(journeeAllumee)

  const basculer = (module: ModuleReglable, actif: boolean) => {
    setRefus(null)
    demarrer(async () => {
      const r = await basculerModuleCabinet(module, actif)
      setAEteindre(null)
      if ('error' in r) {
        setRefus(r.error)
        return
      }
      // On atterrit sur une partie qui existe encore ; allumer un planning
      // ouvre sa partie.
      const journeesRestent = r.modules.includes('planning-journee')
      const gardesRestent = r.modules.includes('gardes')
      const versJournees =
        journeesRestent &&
        (!gardesRestent || (module === 'planning-journee' ? actif : partie === 'journees'))
      router.replace(versJournees ? '/regles?partie=journees' : '/regles')
      router.refresh()
    })
  }

  // Un véto sur un cabinet à un seul planning n'a rien à choisir : pas de
  // tuiles, pas de bloc vide en haut de page.
  if (nbAllumes < 2 && !estAdmin) return null

  return (
    <>
      <section className="org-tuiles rise" aria-label="Les plannings du cabinet">
        {TUILES.map(({ module, partie: p, nom, href, Icone }) => {
          const on = allume[module]
          const ici = on && partie === p
          const dernier = on && nbAllumes === 1
          return (
            <article
              key={module}
              className={`org-tuile${on ? '' : ' eteinte'}${ici ? ' ici' : ''}`}
            >
              <div className="org-tuile-tete">
                <Icone className="org-tuile-ico" aria-hidden="true" />
                {on ? (
                  <Link
                    href={href}
                    className="org-tuile-lien"
                    aria-current={ici ? 'page' : undefined}
                  >
                    {nom}
                  </Link>
                ) : (
                  <span className="org-tuile-nom">{nom}</span>
                )}

                {estAdmin &&
                  (dernier ? (
                    <span className="org-tuile-seul">
                      <Lock aria-hidden="true" />
                      Seul planning actif
                    </span>
                  ) : (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`${on ? 'Éteindre' : 'Allumer'} ${NOM_COMPLET[module]}`}
                      className="org-inter"
                      disabled={enCours}
                      onClick={() => (on ? setAEteindre(module) : basculer(module, true))}
                    >
                      <span className="org-inter-piste" aria-hidden="true">
                        <span className="org-inter-pastille" />
                      </span>
                      {on ? 'Actif' : 'Éteint'}
                    </button>
                  ))}
              </div>
              <p className="org-tuile-resume">
                {on
                  ? module === 'gardes'
                    ? resumes.gardes
                    : resumes.journees
                  : 'Non utilisé par le cabinet. Vos réglages sont gardés.'}
              </p>
            </article>
          )
        })}
      </section>

      {refus && (
        <p className="org-refus" role="alert">
          {refus}
        </p>
      )}

      <Dialog
        open={aEteindre !== null}
        onOpenChange={(o) => {
          if (!o && !enCours) setAEteindre(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">
              Éteindre {aEteindre ? NOM_COMPLET[aEteindre] : ''} ?
            </DialogTitle>
            <DialogDescription>
              {aEteindre === 'gardes'
                ? 'Elles disparaissent pour toute l’équipe. Rien n’est effacé : tout revient tel quel si vous les rallumez.'
                : 'Il disparaît pour toute l’équipe. Rien n’est effacé : tout revient tel quel si vous le rallumez.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAEteindre(null)} disabled={enCours}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              disabled={enCours}
              onClick={() => aEteindre && basculer(aEteindre, false)}
            >
              Éteindre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
