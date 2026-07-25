'use client'

// ============================================================
// GUARDVETO V2 — Absences & échanges : une seule porte
// ============================================================
// Porté de `maquette/m3-absences-echanges.html`. L'idée de l'écran est une
// FUSION : les anciens écrans « Congés », « Demandes », « Échanges » et
// « Dépannages » devenaient quatre entrées de menu pour une même question —
// qui n'est pas là, et qu'est-ce qu'on fait. Ici, trois onglets, une porte.
//
// Chaque souhait en attente arrive avec son verdict de conflit DÉJÀ CALCULÉ
// contre le planning publié (`detecterConflitPlanningPublie`, côté serveur) :
// rien ne surprend au moment de valider.
//
// Les dialogues restent ceux du produit (validation, refus, création,
// conflit) : ils portent les règles métier et les effets de bord (notifs,
// re-synchro agenda). On ne redessine pas un dialogue au risque d'en perdre
// les garde-fous.
// ============================================================

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CongeForm } from '@/components/conges/CongeForm'
import { ValiderCongeDialog } from '@/components/conges/ValiderCongeDialog'
import { RefuserCongeDialog } from '@/components/conges/RefuserCongeDialog'
import { ConflitPlanningDialog } from '@/components/conges/ConflitPlanningDialog'
import type { ConflitPlanning } from '@/app/(protected)/conges/actions'
import { CriseModal, type VetCrise } from '@/components/planning/CriseModal'
import { EchangesClient, type EchangeRow, type GardeLite, type VetLite } from '@/components/echanges/EchangesClient'
import { DepannagesClient, type CompensationLigne } from '@/components/admin/DepannagesClient'
import type { CreneauImpacte } from '@/lib/crise/contexte'
import type { Conge, TypeConge, Veterinaire } from '@/types'

type Onglet = 'conges' | 'echanges' | 'depannages'

interface Props {
  conges: Conge[]
  vets: Veterinaire[]
  moiId: string
  isAdmin: boolean
  /** Conflits avec le planning publié, pré-calculés : { congeId → créneaux }. */
  conflitsParConge: Record<string, CreneauImpacte[]>
  echanges: EchangeRow[]
  gardesFutures: GardeLite[]
  vetsEchange: VetLite[]
  vetsCrise: VetCrise[]
  depannages: CompensationLigne[]
  statsDepannages: { ouvertes: number; compensees: number }
}

const LIBELLE_TYPE: Record<TypeConge, string> = {
  vacances: 'Vacances',
  formation: 'Formation',
  sante: 'Santé',
  indisponibilite: 'Indisponibilité',
  autre: 'Autre',
}

/** Le suffixe de classe qui donne sa couleur à la pastille de type. */
const CLASSE_TYPE: Record<TypeConge, string> = {
  vacances: 't-vacances',
  formation: 't-formation',
  sante: 't-sante',
  indisponibilite: 't-indispo',
  autre: 't-autre',
}

const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Paris',
})

function dateLongue(iso: string) {
  return DATE_LONGUE.format(new Date(iso + 'T12:00:00Z'))
}

function nbJours(debut: string, fin: string) {
  return Math.round((Date.parse(fin) - Date.parse(debut)) / 86_400_000) + 1
}

/** « Du lundi 16 au dimanche 22 mars 2026 · 7 jours », ou le jour seul. */
function periodeLisible(c: Conge) {
  if (c.date_debut === c.date_fin) {
    const creneau =
      c.creneau && c.creneau !== 'journee' ? ` · créneau ${c.creneau.replace('-', ' ')}` : ''
    return `${dateLongue(c.date_debut)}${creneau}`
  }
  const n = nbJours(c.date_debut, c.date_fin)
  return `Du ${dateLongue(c.date_debut)} au ${dateLongue(c.date_fin)} · ${n} jours`
}

export function AbsencesV2({
  conges,
  vets,
  moiId,
  isAdmin,
  conflitsParConge,
  echanges,
  gardesFutures,
  vetsEchange,
  vetsCrise,
  depannages,
  statsDepannages,
}: Props) {
  const router = useRouter()
  const [onglet, setOnglet] = useState<Onglet>('conges')
  const [creerOuvert, setCreerOuvert] = useState(false)
  const [criseOuverte, setCriseOuverte] = useState(false)
  const [aValider, setAValider] = useState<Conge | null>(null)
  const [aRefuser, setARefuser] = useState<Conge | null>(null)
  const [conflit, setConflit] = useState<ConflitPlanning | null>(null)
  const [repareConflit, setRepareConflit] = useState(false)
  const [filtreVet, setFiltreVet] = useState('tous')
  const [filtreType, setFiltreType] = useState('tous')

  const parVet = useMemo(() => new Map(vets.map((v) => [v.id, v])), [vets])

  const vetDuConflit = conflit ? parVet.get(conflit.veterinaire_id) : undefined
  const nomConflit = vetDuConflit
    ? `${vetDuConflit.prenom} ${vetDuConflit.nom}`.trim()
    : 'Cette vétérinaire'

  const souhaits = useMemo(
    () =>
      conges
        .filter((c) => c.statut === 'souhait')
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [conges],
  )

  const traites = useMemo(
    () =>
      conges
        .filter((c) => c.statut !== 'souhait')
        .sort((a, b) => b.date_debut.localeCompare(a.date_debut)),
    [conges],
  )

  const traitesFiltres = traites.filter(
    (c) =>
      (filtreVet === 'tous' || c.veterinaire_id === filtreVet) &&
      (filtreType === 'tous' || c.type === filtreType),
  )

  // Le compteur intégré aux chips : combien de congés traités par véto.
  const compteParVet = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of traites) m.set(c.veterinaire_id, (m.get(c.veterinaire_id) ?? 0) + 1)
    return m
  }, [traites])

  const echangesAAgir = echanges.filter(
    (e) => e.statut === 'proposee' || (isAdmin && e.statut === 'acceptee'),
  ).length

  return (
    <>
      <div className="page-head">
        <div>
          <p className="page-kicker">
            Absences &amp; échanges{isAdmin ? ' · vue administratrice' : ''}
          </p>
          <h1>Congés, échanges et coups durs : une seule porte.</h1>
          <p className="lede">
            {isAdmin
              ? 'Chaque souhait arrive avec son verdict déjà calculé : les gardes publiées qu’il toucherait. Rien ne surprend au moment de valider.'
              : 'Poser un congé, proposer un échange, suivre tes demandes — tout est ici.'}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-outline" onClick={() => setCreerOuvert(true)}>
            + {isAdmin ? 'Créer un congé' : 'Poser un congé'}
          </button>
          {isAdmin && vetsCrise.length > 0 && (
            <button type="button" className="btn btn-accent" onClick={() => setCriseOuverte(true)}>
              🚨 Déclarer une absence
            </button>
          )}
        </div>
      </div>

      <nav className="tabs" role="tablist" aria-label="Sections d'Absences et échanges">
        <button
          type="button"
          role="tab"
          aria-selected={onglet === 'conges'}
          onClick={() => setOnglet('conges')}
        >
          Congés {souhaits.length > 0 && <span className="count">{souhaits.length}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={onglet === 'echanges'}
          onClick={() => setOnglet('echanges')}
        >
          Échanges de gardes {echangesAAgir > 0 && <span className="count">{echangesAAgir}</span>}
        </button>
        {isAdmin && (
          <button
            type="button"
            role="tab"
            aria-selected={onglet === 'depannages'}
            onClick={() => setOnglet('depannages')}
          >
            Dépannages{' '}
            {statsDepannages.ouvertes > 0 && (
              <span className="count">{statsDepannages.ouvertes}</span>
            )}
          </button>
        )}
      </nav>

      {/* ── Onglet 1 · les congés ───────────────────────────── */}
      {onglet === 'conges' && (
        <section className="tab-panel" role="tabpanel">
          {isAdmin && (
            <section className="card" aria-label="Souhaits de congé en attente">
              <div className="card-head">
                <h2>Souhaits en attente</h2>
                {souhaits.length > 0 && <span className="section-count">{souhaits.length}</span>}
                <p className="sub">
                  Le verdict de conflit est calculé d&apos;avance sur chaque demande : les gardes
                  déjà publiées que ce congé toucherait.
                </p>
              </div>

              {souhaits.length === 0 ? (
                <p className="empty-row">
                  Aucun souhait en attente. Les prochaines demandes des vétérinaires arriveront ici.
                </p>
              ) : (
                <ul className="rows">
                  {souhaits.map((c) => {
                    const vet = parVet.get(c.veterinaire_id)
                    const impacts = conflitsParConge[c.id]
                    return (
                      <li key={c.id}>
                        <div className="row">
                          <span
                            className="vet-dot"
                            style={{ ['--c' as string]: vet?.couleur ?? 'var(--soft)' }}
                          >
                            {(vet?.prenom ?? '?').slice(0, 1)}
                          </span>
                          <div className="row-main">
                            <p className="row-line">
                              <b>{vet?.prenom ?? 'Vétérinaire'}</b>
                              <span className={`type-chip ${CLASSE_TYPE[c.type]}`}>
                                {LIBELLE_TYPE[c.type]}
                              </span>
                            </p>
                            <p className="row-dates">{periodeLisible(c)}</p>
                            {c.commentaire && <p className="row-motif">« {c.commentaire} »</p>}
                          </div>
                          <div className="row-side">
                            {impacts && impacts.length > 0 ? (
                              <span className="conflict warn">
                                ⚠ {impacts.length} garde{impacts.length > 1 ? 's' : ''} publiée
                                {impacts.length > 1 ? 's' : ''} touchée
                                {impacts.length > 1 ? 's' : ''}
                              </span>
                            ) : (
                              <span className="conflict ok">
                                ✓ Aucun conflit avec le planning publié
                              </span>
                            )}
                            <div className="row-actions">
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => setARefuser(c)}
                              >
                                Refuser…
                              </button>
                              <button
                                type="button"
                                className="btn btn-ok btn-sm"
                                onClick={() => setAValider(c)}
                              >
                                Valider…
                              </button>
                            </div>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )}

          <section className="card" aria-label="Congés du cabinet">
            <div className="card-head">
              <h2>{isAdmin ? 'Congés du cabinet' : 'Mes congés'}</h2>
              {traites.length > 0 && <span className="section-count">{traites.length}</span>}
              <p className="sub">
                Validés et refusés. Chaque prénom compte et filtre d&apos;un même geste.
              </p>
            </div>

            {isAdmin && (
              <div className="filters">
                <span className="f-label">Filtrer</span>
                <button
                  type="button"
                  className="vet-filter"
                  aria-pressed={filtreVet === 'tous'}
                  onClick={() => setFiltreVet('tous')}
                >
                  <i style={{ ['--c' as string]: 'var(--accent)' }} />
                  Toute l&apos;équipe
                </button>
                {vets
                  .filter((v) => (compteParVet.get(v.id) ?? 0) > 0)
                  .map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="vet-filter"
                      aria-pressed={filtreVet === v.id}
                      onClick={() => setFiltreVet(v.id)}
                    >
                      <i style={{ ['--c' as string]: v.couleur }} />
                      {v.prenom} · {compteParVet.get(v.id)}
                    </button>
                  ))}
                <select
                  value={filtreType}
                  onChange={(e) => setFiltreType(e.target.value)}
                  aria-label="Filtrer par type de congé"
                >
                  <option value="tous">Tous les types</option>
                  {(Object.keys(LIBELLE_TYPE) as TypeConge[]).map((t) => (
                    <option key={t} value={t}>
                      {LIBELLE_TYPE[t]}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {traitesFiltres.length === 0 ? (
              <p className="empty-row">
                {traites.length === 0
                  ? 'Aucun congé enregistré pour le moment.'
                  : 'Aucun congé ne correspond à ce filtre.'}
              </p>
            ) : (
              <ul className="rows">
                {traitesFiltres.map((c) => {
                  const vet = parVet.get(c.veterinaire_id)
                  return (
                    <li key={c.id}>
                      <div className="row">
                        <span
                          className="vet-dot"
                          style={{ ['--c' as string]: vet?.couleur ?? 'var(--soft)' }}
                        >
                          {(vet?.prenom ?? '?').slice(0, 1)}
                        </span>
                        <div className="row-main">
                          <p className="row-line">
                            <b>{vet?.prenom ?? 'Vétérinaire'}</b>
                            <span className={`type-chip ${CLASSE_TYPE[c.type]}`}>
                              {LIBELLE_TYPE[c.type]}
                            </span>
                          </p>
                          <p className="row-dates">{periodeLisible(c)}</p>
                          {c.statut === 'refuse' && c.raison_refus && (
                            <p className="row-motif">Refusé : « {c.raison_refus} »</p>
                          )}
                        </div>
                        <div className="row-side">
                          <span
                            className={`status-pill ${c.statut === 'valide' ? 'st-valide' : 'st-refuse'}`}
                          >
                            {c.statut === 'valide' ? 'Validé' : 'Refusé'}
                          </span>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </section>
      )}

      {/* ── Onglet 2 · les échanges de gardes ───────────────── */}
      {onglet === 'echanges' && (
        <section className="tab-panel v2-greffe" role="tabpanel">
          <EchangesClient
            moiId={moiId}
            isAdmin={isAdmin}
            echanges={echanges}
            gardesFutures={gardesFutures}
            vets={vetsEchange}
            gardePreselectionnee={null}
          />
        </section>
      )}

      {/* ── Onglet 3 · qui a dépanné qui ────────────────────── */}
      {onglet === 'depannages' && isAdmin && (
        <section className="tab-panel v2-greffe" role="tabpanel">
          <DepannagesClient lignes={depannages} stats={statsDepannages} />
        </section>
      )}

      {/* ── Les dialogues du produit ────────────────────────── */}
      <CongeForm
        open={creerOuvert}
        onClose={() => {
          setCreerOuvert(false)
          router.refresh()
        }}
        vets={vets}
        currentUserId={moiId}
        isAdmin={isAdmin}
        onConflit={setConflit}
      />

      {aValider && (
        <ValiderCongeDialog
          open
          onClose={() => {
            setAValider(null)
            router.refresh()
          }}
          conge={aValider}
          vet={parVet.get(aValider.veterinaire_id)}
          currentVetoId={moiId}
          onConflit={setConflit}
        />
      )}

      {aRefuser && (
        <RefuserCongeDialog
          open
          onClose={() => {
            setARefuser(null)
            router.refresh()
          }}
          conge={aRefuser}
          vet={parVet.get(aRefuser.veterinaire_id)}
        />
      )}

      {/* Conflit congé ↔ planning publié (cas « Antoine ») : l'alerte, puis la
          réparation par le flux de crise EXISTANT, pré-rempli. Le parcours
          complet est repris de la V1 — s'arrêter à l'alerte laisserait
          l'administratrice devant un problème sans porte de sortie. */}
      {conflit && (
        <ConflitPlanningDialog
          open={!repareConflit}
          onOpenChange={(o) => {
            if (!o) {
              setConflit(null)
              router.refresh()
            }
          }}
          vetNom={nomConflit}
          creneauxImpactes={conflit.creneauxImpactes}
          onGerer={() => setRepareConflit(true)}
        />
      )}

      {conflit && repareConflit && vetsCrise.length > 0 && (
        <CriseModal
          key={`crise-${conflit.veterinaire_id}-${conflit.date_debut}`}
          open
          onOpenChange={(o) => {
            setRepareConflit(o)
            if (!o) {
              setConflit(null)
              router.refresh()
            }
          }}
          vets={vetsCrise}
          vetDefautId={conflit.veterinaire_id}
          dateDebutDefaut={conflit.date_debut}
          dateFinDefaut={conflit.date_fin}
        />
      )}

      {/* Signalement d'absence « à froid », depuis le bouton de la tête de page. */}
      {isAdmin && vetsCrise.length > 0 && (
        <CriseModal open={criseOuverte} onOpenChange={setCriseOuverte} vets={vetsCrise} />
      )}
    </>
  )
}
