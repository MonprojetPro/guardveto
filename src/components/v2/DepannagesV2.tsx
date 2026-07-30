'use client'

// ============================================================
// GUARDVETO V2 — « Qui a dépanné qui » (onglet 3 d'Absences & échanges)
// ============================================================
// Porté de `maquette/m3-absences-echanges.html` (onglet 3). Le tableau était
// resté habillé en V1 au milieu d'un écran redessiné : on le rhabille ici,
// sans toucher au composant V1 `DepannagesClient` que la route `/admin/
// depannages` sert encore.
//
// La maquette a six colonnes, la donnée réelle en porte huit : le type de
// garde, le rôle tenu et la date de l'absence descendent en `<small>` sous
// la colonne qu'ils précisent, comme le fait la maquette. Rien n'est perdu.
//
// L'action reste EXACTEMENT celle de la V1 (`changerStatutCompensation`) :
// elle porte la garde admin et la liste fermée des statuts. Elle revalide
// `/admin/depannages`, pas cet écran-ci — d'où le `router.refresh()`.
// ============================================================

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { changerStatutCompensation } from '@/app/(protected)/admin/depannages/actions'
import type { CompensationLigne } from '@/components/admin/DepannagesClient'
import type { RoleCompensation, StatutCompensation, TypeGarde, Veterinaire } from '@/types'

interface Props {
  lignes: CompensationLigne[]
  stats: { ouvertes: number; compensees: number }
  /** Pour la pastille de couleur devant chaque prénom. */
  vets: Veterinaire[]
}

/** Le type de garde tel qu'il se lit sous la date, en minuscules. */
const LIBELLE_TYPE_GARDE: Record<TypeGarde, string> = {
  semaine: 'garde de semaine',
  weekend: 'week-end',
  ferie: 'jour férié',
}

const LIBELLE_ROLE: Record<RoleCompensation, string> = {
  premier: '1er de garde',
  second: '2nd de garde',
}

const LIBELLE_MOTIF: Record<'maladie' | 'urgence' | 'autre', string> = {
  maladie: 'Maladie',
  urgence: 'Urgence',
  autre: 'Autre',
}

/** Statut de la dette → pastille de la maquette (`.st-*`) + son libellé. */
const DETTE: Record<StatutCompensation, { classe: string; libelle: string }> = {
  a_compenser: { classe: 'st-ouverte', libelle: 'Dette ouverte' },
  compensee: { classe: 'st-compensee', libelle: 'Compensée' },
  annulee: { classe: 'st-dette-annulee', libelle: 'Annulée (geste offert)' },
}

const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Paris',
})

const DATE_COURTE = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Paris',
})

function dateLongue(iso: string) {
  const s = DATE_LONGUE.format(new Date(iso + 'T12:00:00Z'))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function DepannagesV2({ lignes, stats, vets }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [enCours, setEnCours] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  // Les lignes ne portent que le prénom (jointure aplatie côté serveur) :
  // c'est par lui qu'on retrouve la couleur du véto.
  const couleurParPrenom = useMemo(
    () => new Map(vets.map((v) => [v.prenom, v.couleur])),
    [vets],
  )

  function muter(id: string, nouveauStatut: StatutCompensation) {
    setEnCours(id)
    setErreur(null)
    startTransition(async () => {
      const res = await changerStatutCompensation(id, nouveauStatut)
      setEnCours(null)
      if (res?.error) {
        setErreur(res.error)
        return
      }
      router.refresh()
    })
  }

  function pastilleVet(prenom: string | null) {
    if (!prenom) return <span className="dep-vet">—</span>
    return (
      <span className="dep-vet">
        <i style={{ ['--c' as string]: couleurParPrenom.get(prenom) ?? 'var(--soft)' }} />
        {prenom}
      </span>
    )
  }

  return (
    <section className="card" aria-label="Dépannages et compensations">
      <div className="card-head">
        <h2>Qui a dépanné qui</h2>
        <span className={`section-count${lignes.length === 0 ? ' zero' : ''}`}>
          {lignes.length}
        </span>
        <p className="sub">
          Chaque garde reprise en urgence ouvre une dette de dépannage. Elle se solde quand
          l’absent rend la pareille, ou s’annule d’un geste. Les absences déclarées alimentent ce
          tableau automatiquement.
        </p>
      </div>

      <div className="dep-bilan">
        <div className="b-ouvertes">
          <span className="b-val">{stats.ouvertes}</span>
          <span className="b-label">Dettes ouvertes</span>
        </div>
        <div className="b-compensees">
          <span className="b-val">{stats.compensees}</span>
          <span className="b-label">Compensées</span>
        </div>
        <div>
          <span className="b-val">{lignes.length}</span>
          <span className="b-label">Total</span>
        </div>
      </div>

      {erreur && <p className="dep-erreur">Le changement n’a pas pu être enregistré : {erreur}</p>}

      {lignes.length === 0 ? (
        <p className="empty-row">
          Aucun dépannage enregistré. Les compensations apparaîtront ici dès qu’un véto en dépanne
          un autre.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="dep-table">
            <thead>
              <tr>
                <th scope="col">Créneau repris</th>
                <th scope="col">Absent·e</th>
                <th scope="col">Dépanneur·se</th>
                <th scope="col">Motif</th>
                <th scope="col">Dette</th>
                <th scope="col">
                  <span className="dep-sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => {
                const occupe = isPending && enCours === l.id
                const dette = DETTE[l.statut]
                const precisions = [
                  l.gardeType ? LIBELLE_TYPE_GARDE[l.gardeType] : null,
                  l.role ? LIBELLE_ROLE[l.role] : null,
                ].filter(Boolean)

                return (
                  <tr key={l.id}>
                    <td>
                      {l.gardeDate ? dateLongue(l.gardeDate) : 'Créneau inconnu'}
                      {precisions.length > 0 && <small>{precisions.join(' · ')}</small>}
                    </td>
                    <td>
                      {pastilleVet(l.remplacePrenom)}
                      {l.absenceDateDebut && (
                        <small>
                          absence du {DATE_COURTE.format(new Date(l.absenceDateDebut + 'T12:00:00Z'))}
                        </small>
                      )}
                    </td>
                    <td>{pastilleVet(l.remplacantPrenom)}</td>
                    <td>{l.absenceMotif ? LIBELLE_MOTIF[l.absenceMotif] : '—'}</td>
                    <td>
                      <span className={`status-pill ${dette.classe}`}>{dette.libelle}</span>
                    </td>
                    <td>
                      <div className="dep-actions">
                        {l.statut === 'a_compenser' && (
                          <button
                            type="button"
                            onClick={() => muter(l.id, 'compensee')}
                            disabled={occupe}
                          >
                            Marquer compensée
                          </button>
                        )}
                        {l.statut !== 'annulee' && (
                          <button
                            type="button"
                            onClick={() => muter(l.id, 'annulee')}
                            disabled={occupe}
                          >
                            Annuler la dette
                          </button>
                        )}
                        {l.statut === 'annulee' && (
                          <button
                            type="button"
                            onClick={() => muter(l.id, 'a_compenser')}
                            disabled={occupe}
                          >
                            Rouvrir
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
