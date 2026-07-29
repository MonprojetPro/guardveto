'use client'

// ============================================================
// GUARDVETO V2 — L'espace de travail du planning
// ============================================================
// Porté de `maquette/m1-planning.html`. La grille est le cœur de l'écran :
// une case = un jour, et chaque fiche de garde est un BOUTON. La consigne
// posée juste au-dessus le dit explicitement — sans elle, rien n'indique que
// la grille est autre chose qu'un tableau (retour MiKL).
//
// Les actions passent par les modales existantes (`GardeDetailModal`,
// `CriseModal`) : elles portent déjà la réattribution, le signalement
// d'absence et la proposition d'échange, avec leurs contrôles. On ne les
// réécrit pas pour un changement d'habillage — ce serait risquer des règles
// métier pour du décor.
// ============================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FilouEdge } from './FilouEdge'
import { useOutilsPlanning } from './outils-planning'
import { GardeDetailModal } from '@/components/planning/GardeDetailModal'
import { CriseModal, type VetCrise } from '@/components/planning/CriseModal'
import { estJourFerie } from '@/engine/utils'
import { libelleTypeGardeDb } from '@/lib/libelles-gardes'
import type { CompteursRow } from '@/hooks/useCompteurs'
import type { GardeDenormalisee, Periode } from '@/types'

interface Props {
  gardes: GardeDenormalisee[]
  periodes: Periode[]
  /** Période dont relève le mois affiché (celle dont on montre l'identité). */
  periodeAffichee: Periode | null
  /** Format « YYYY-MM ». */
  anneeMois: string
  isAdmin: boolean
  vets: VetCrise[]
  moiVetId?: string
  nomsTypes: Record<string, string>
  compteurs: CompteursRow[]
  /** Congés et souhaits qui tombent sur le mois affiché. */
  conges: CongeAffiche[]
  /** Nom du profil de planning de la période, s'il y en a un. */
  profil: string | null
  /** Périodes qui ont déjà des gardes — conditionne PDF et publication. */
  periodesAvecGardes: string[]
}

export interface CongeAffiche {
  id: string
  prenom: string
  couleur: string
  dateDebut: string
  dateFin: string
  statut: string
}

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

const DATE_COURTE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Paris',
})

function aujourdhuiISO() {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date())
}

function dateCourte(iso: string) {
  return DATE_COURTE.format(new Date(iso + 'T12:00:00Z'))
}

/** La grille part du lundi de la semaine du 1er et couvre des semaines pleines. */
function genererGrille(annee: number, mois: number): string[] {
  const premier = new Date(Date.UTC(annee, mois - 1, 1))
  const decalage = (premier.getUTCDay() + 6) % 7
  const depart = new Date(premier)
  depart.setUTCDate(depart.getUTCDate() - decalage)

  const dernier = new Date(Date.UTC(annee, mois, 0))
  const cases: string[] = []
  const curseur = new Date(depart)
  while (curseur <= dernier || cases.length % 7 !== 0) {
    cases.push(curseur.toISOString().slice(0, 10))
    curseur.setUTCDate(curseur.getUTCDate() + 1)
  }
  return cases
}

function initiale(prenom: string | null) {
  return (prenom ?? '?').slice(0, 1).toUpperCase()
}

function libelleStatut(statut: Periode['statut']) {
  if (statut === 'publie') return { classe: 'st-publiee', texte: '● Publiée' }
  if (statut === 'verrouille') return { classe: 'st-verrouillee', texte: '● Verrouillée' }
  return { classe: 'st-brouillon', texte: '● Brouillon · non publié' }
}

function nomPeriode(p: Periode) {
  return p.libelle ?? `${p.saison === 'ete' ? 'Été' : 'Hiver'} ${p.date_debut.slice(0, 4)}`
}

export function PlanningV2({
  gardes,
  periodes,
  periodeAffichee,
  anneeMois,
  isAdmin,
  vets,
  moiVetId,
  nomsTypes,
  compteurs,
  conges,
  profil,
  periodesAvecGardes,
}: Props) {
  const router = useRouter()
  const [annee, mois] = anneeMois.split('-').map(Number)
  const [popOuvert, setPopOuvert] = useState(false)
  const [compteursOuverts, setCompteursOuverts] = useState(true)
  const [gardeModal, setGardeModal] = useState<GardeDenormalisee | null>(null)
  const [criseOpen, setCriseOpen] = useState(false)
  const [criseDate, setCriseDate] = useState<string | undefined>()
  const [criseVetId, setCriseVetId] = useState<string | undefined>()

  const today = aujourdhuiISO()
  const grille = genererGrille(annee, mois)

  // Les outils de la barre (PDF, absence, générer, publier) et leurs
  // garde-fous. La période vient de la PILULE — une seule source de vérité,
  // là où la V1 embarquait un second sélecteur qui la contredisait.
  const { pilules, alertes, modales } = useOutilsPlanning({
    periode: periodeAffichee,
    aDesGardes: periodeAffichee ? periodesAvecGardes.includes(periodeAffichee.id) : false,
    isAdmin,
    onSignalerAbsence: () => {
      setCriseDate(undefined)
      setCriseVetId(undefined)
      setCriseOpen(true)
    },
  })

  // Index par date : plusieurs créneaux peuvent coexister le même jour (P3b).
  const parDate = new Map<string, GardeDenormalisee[]>()
  for (const g of gardes) {
    const liste = parDate.get(g.date)
    if (liste) liste.push(g)
    else parDate.set(g.date, [g])
  }

  function naviguer(delta: number) {
    const d = new Date(Date.UTC(annee, mois - 1 + delta, 1))
    router.push(
      `/planning?mois=${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
    )
  }

  /** Aller au premier mois d'une autre période. */
  function allerVersPeriode(p: Periode) {
    setPopOuvert(false)
    router.push(`/planning?mois=${p.date_debut.slice(0, 7)}`)
  }

  function declarerAbsent(date: string, vetId: string) {
    setGardeModal(null)
    setCriseDate(date)
    setCriseVetId(vetId)
    setCriseOpen(true)
  }

  const statut = periodeAffichee ? libelleStatut(periodeAffichee.statut) : null
  const consultationSeule =
    periodeAffichee !== null && periodeAffichee.statut === 'verrouille'

  return (
    <div className="plan-scene">
      <FilouEdge />

      <div className={`workspace${compteursOuverts ? '' : ' counters-closed'}`}>
        <div className="work-head">
          {/* La période est un seul objet : la pilule EST le sélecteur, et sa
              carte d'identité vit dans le panneau qu'elle ouvre. */}
          <div className="period-wrap" style={{ position: 'relative' }}>
            <button
              type="button"
              className="period-pill"
              aria-expanded={popOuvert}
              onClick={() => setPopOuvert((v) => !v)}
            >
              <b>{periodeAffichee ? nomPeriode(periodeAffichee) : 'Hors période'}</b>
              {statut && <span className={`status-badge ${statut.classe}`}>{statut.texte}</span>}
              <span className="pp-caret" aria-hidden="true">
                ▾
              </span>
            </button>

            {popOuvert && (
              <div className="period-pop">
                {periodeAffichee ? (
                  <>
                    <p className="pp-sub">
                      Période <b>{nomPeriode(periodeAffichee)}</b> · du{' '}
                      {dateCourte(periodeAffichee.date_debut)} au{' '}
                      {dateCourte(periodeAffichee.date_fin)}
                    </p>
                    <div className="pb-chips">
                      <span className="pb-chip">
                        {periodeAffichee.saison === 'ete' ? '☀️ Saison été' : '❄️ Saison hiver'}
                      </span>
                      {profil && <span className="pb-chip">Profil de planning « {profil} »</span>}
                      {periodeAffichee.nb_vetos_semaine_soir && (
                        <span className="pb-chip effectif">
                          <b>
                            {periodeAffichee.nb_vetos_semaine_soir} véto
                            {periodeAffichee.nb_vetos_semaine_soir > 1 ? 's' : ''} par nuit de
                            semaine
                          </b>
                          <small>réglé sur cette période</small>
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="pp-sub">Le mois affiché ne tombe dans aucune période.</p>
                )}

                <p className="pp-label">Changer de période</p>
                {periodes.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="pp-item"
                    aria-current={p.id === periodeAffichee?.id ? 'true' : undefined}
                    onClick={() => allerVersPeriode(p)}
                  >
                    {nomPeriode(p)}
                    <small>
                      {p.statut === 'brouillon' && 'Brouillon · en cours de préparation'}
                      {p.statut === 'publie' && 'Publiée · connue de l’équipe'}
                      {p.statut === 'verrouille' && 'Verrouillée · consultation seule'}
                    </small>
                  </button>
                ))}
                {isAdmin && (
                  <a className="pp-new" href="/admin/periodes">
                    Gérer les périodes
                    <small>Créer la période suivante, changer ses dates ou son profil</small>
                  </a>
                )}
                <p className="pp-today">📌 Aujourd&apos;hui : {dateCourte(today)}</p>
              </div>
            )}
          </div>

          <div className="month-nav">
            <button
              type="button"
              className="mn-btn"
              onClick={() => naviguer(-1)}
              aria-label="Mois précédent"
            >
              ←
            </button>
            <h2>
              {MOIS[mois - 1]} {annee}
            </h2>
            <button
              type="button"
              className="mn-btn"
              onClick={() => naviguer(1)}
              aria-label="Mois suivant"
            >
              →
            </button>
          </div>

          <div className="head-actions">
            <button
              type="button"
              className="head-btn"
              aria-pressed={compteursOuverts}
              onClick={() => setCompteursOuverts((v) => !v)}
            >
              Compteurs
            </button>
            {pilules}
          </div>
        </div>

        <div className="work-body">
          {/* Les avertissements du moteur vivent ICI, au-dessus de la grille —
              pas dans la barre d'en-tête, qu'ils faisaient gonfler. */}
          {alertes}

          <p className="grid-hint">
            <span className="gh-ico" aria-hidden="true">
              👆
            </span>
            <span>
              <b>Clique sur une case pour agir dessus</b> — réattribuer une garde, signaler une
              absence.
            </span>
            <span className="gh-sep" aria-hidden="true">
              ·
            </span>
            <span className="gh-lock">Le passé est verrouillé 🔒</span>
          </p>

          <div className="work-grid">
            <div className="work-main">
              <div className="cal-scroll">
                <div className="cal">
                  <div className="cal-head" aria-hidden="true">
                    {JOURS.map((j) => (
                      <span key={j}>{j}</span>
                    ))}
                  </div>
                  <div className="cal-body">
                    {grille.map((date) => (
                      <CaseJour
                        key={date}
                        date={date}
                        moisAffiche={mois}
                        today={today}
                        horsPeriode={
                          periodeAffichee !== null &&
                          (date < periodeAffichee.date_debut || date > periodeAffichee.date_fin)
                        }
                        gardes={parDate.get(date) ?? []}
                        conges={conges.filter((c) => c.dateDebut <= date && c.dateFin >= date)}
                        nomsTypes={nomsTypes}
                        onOuvrir={setGardeModal}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <aside className="counters-panel" aria-label="Compteurs de la période">
              <div className="cnt-head">
                <h4>Compteurs · période</h4>
                <p>Ils bougent à chaque changement, manuel comme automatique.</p>
              </div>
              <Compteurs lignes={compteurs} />
              <p className="cnt-foot">
                « 1er WE » = premier de garde du week-end (celui qui porte l&apos;avantage
                financier).
              </p>
            </aside>
          </div>
        </div>

        {consultationSeule && (
          <div className="archive-veil show" role="region" aria-label="Période verrouillée">
            <div className="archive-card">
              <h3>{nomPeriode(periodeAffichee)}</h3>
              <p>
                Cette période est verrouillée : elle se consulte, elle ne se modifie plus. Ouvre la
                période de travail pour agir.
              </p>
              <button type="button" className="btn btn-valider" onClick={() => setPopOuvert(true)}>
                Choisir une autre période
              </button>
            </div>
          </div>
        )}
      </div>

      <GardeDetailModal
        garde={gardeModal}
        date={gardeModal?.date ?? null}
        isAdmin={isAdmin}
        moiVetId={moiVetId}
        nomsTypes={nomsTypes}
        onClose={() => setGardeModal(null)}
        onSaved={() => router.refresh()}
        onDeclarerAbsent={isAdmin && vets.length > 0 ? declarerAbsent : undefined}
      />

      {isAdmin && vets.length > 0 && (
        <CriseModal
          open={criseOpen}
          onOpenChange={setCriseOpen}
          vets={vets}
          dateDefaut={criseDate}
          vetDefautId={criseVetId}
        />
      )}

      {modales}
    </div>
  )
}

// ── Une case de la grille ───────────────────────────────────

function CaseJour({
  date,
  moisAffiche,
  today,
  horsPeriode,
  gardes,
  conges,
  nomsTypes,
  onOuvrir,
}: {
  date: string
  moisAffiche: number
  today: string
  /** Le jour tombe en dehors des bornes de la période affichée. */
  horsPeriode: boolean
  gardes: GardeDenormalisee[]
  conges: CongeAffiche[]
  nomsTypes: Record<string, string>
  onOuvrir: (g: GardeDenormalisee) => void
}) {
  const jour = new Date(date + 'T12:00:00Z')
  const dow = (jour.getUTCDay() + 6) % 7 // 0 = lundi
  const numero = jour.getUTCDate()
  const moisCase = jour.getUTCMonth() + 1

  const classes = ['day']
  if (dow === 4) classes.push('fri')
  if (dow >= 5) classes.push('we')
  if (moisCase !== moisAffiche) classes.push('other')
  if (date < today) classes.push('past')
  if (date === today) classes.push('today')
  if (horsPeriode) classes.push('hors')

  const ferie = estJourFerie(date)

  return (
    <div className={classes.join(' ')} data-date={date}>
      <div className="d-head">
        <span className="d-num">{numero}</span>
        {ferie && <span className="d-ferie">★ Férié</span>}
        {date === today && <span className="d-today-tag">Aujourd&apos;hui</span>}
      </div>

      {conges.map((c) => (
        <span key={c.id} className={`conge-chip${c.statut === 'souhait' ? ' souhait' : ''}`}>
          <span className="vdot" style={{ borderColor: c.couleur }} aria-hidden="true" />
          {c.statut === 'souhait' ? 'Souhait' : 'Congé'} · {c.prenom}
        </span>
      ))}

      {gardes.map((g) => (
        <div className="slot-card" key={g.id}>
          <span className="sc-tag">{libelleTypeGardeDb(g.type, nomsTypes)}</span>
          <LigneVet
            prenom={g.premier_prenom}
            couleur={g.premier_couleur}
            role={g.second_prenom ? '1er' : ''}
            titre={`${dateCourte(date)} · premier de garde`}
            onClick={() => onOuvrir(g)}
          />
          {/* La seconde place ne s'affiche que si elle est occupée : on ne
              connaît pas ici le nombre de places du créneau, et dessiner un
              « à pourvoir » sur un créneau à une seule place inventerait un
              trou qui n'existe pas. */}
          {g.second_prenom && (
            <LigneVet
              prenom={g.second_prenom}
              couleur={g.second_couleur}
              role={g.premier_prenom ? '2e' : ''}
              titre={`${dateCourte(date)} · second de garde`}
              onClick={() => onOuvrir(g)}
            />
          )}
        </div>
      ))}

      {horsPeriode && <span className="d-hors-note">hors période</span>}
    </div>
  )
}

/** Une place dans une fiche : point de couleur + prénom, ou « à pourvoir ». */
function LigneVet({
  prenom,
  couleur,
  role,
  titre,
  onClick,
}: {
  prenom: string | null
  couleur: string | null
  role: string
  titre: string
  onClick: () => void
}) {
  if (!prenom) {
    return (
      <button type="button" className="vet-row empty" onClick={onClick} aria-label={`${titre} · place à pourvoir`}>
        <span className="vdot" aria-hidden="true" />À pourvoir
      </button>
    )
  }
  return (
    <button type="button" className="vet-row" onClick={onClick} aria-label={`${titre} · ${prenom}`}>
      <span className="vdot" style={{ background: couleur ?? 'var(--soft)' }} aria-hidden="true" />
      {prenom}
      {role && <span className="role">{role}</span>}
    </button>
  )
}

// ── Le volet compteurs ──────────────────────────────────────

function Compteurs({ lignes }: { lignes: CompteursRow[] }) {
  if (lignes.length === 0) {
    return <p className="cnt-ecart">Aucune garde comptée sur cette période pour l&apos;instant.</p>
  }

  const maxWe = Math.max(1, ...lignes.map((l) => l.we_total))
  const maxSem = Math.max(1, ...lignes.map((l) => l.sem_total))

  // L'écart d'équité qui se voit : entre le plus et le moins chargé en week-ends.
  const weMin = Math.min(...lignes.map((l) => l.we_total))
  const weMax = Math.max(...lignes.map((l) => l.we_total))

  return (
    <>
      <div>
        <div className="cnt-row cnt-header">
          <span>Vétérinaire</span>
          <span>WE</span>
          <span>Nuits</span>
          <span>1er WE</span>
        </div>
        {lignes.map((l) => (
          <div className="cnt-row" key={l.veterinaire_id}>
            <span className="cnt-vet">
              <i style={{ background: l.couleur }} />
              {l.prenom}
              <small>{l.statut === 'associe' ? 'assoc.' : 'sal.'}</small>
            </span>
            <span className={`cnt-num${l.we_total === 0 ? ' zero' : ''}`}>
              {l.we_total}
              <span className="bar">
                <b style={{ transform: `scaleX(${l.we_total / maxWe})` }} />
              </span>
            </span>
            <span className={`cnt-num${l.sem_total === 0 ? ' zero' : ''}`}>
              {l.sem_total}
              <span className="bar">
                <b style={{ transform: `scaleX(${l.sem_total / maxSem})` }} />
              </span>
            </span>
            <span className={`cnt-num${l.we_premier === 0 ? ' zero' : ''}`}>{l.we_premier}</span>
          </div>
        ))}
      </div>
      <p className="cnt-ecart">
        {weMax - weMin === 0
          ? 'Week-ends parfaitement répartis.'
          : `Écart de ${weMax - weMin} week-end${weMax - weMin > 1 ? 's' : ''} entre le plus et le moins chargé.`}
      </p>
    </>
  )
}

