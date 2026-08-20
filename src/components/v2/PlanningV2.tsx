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

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { supprimerPeriode } from '@/app/(protected)/admin/periodes/actions'
import { FilouEdge } from './FilouEdge'
import { useOutilsPlanning } from './outils-planning'
import { GardeDetailModal, peutProposerUnEchange } from '@/components/planning/GardeDetailModal'
import { CriseModal, type VetCrise } from '@/components/planning/CriseModal'
import { estJourFerie } from '@/engine/utils'
import { placesDeGarde } from '@/lib/gardes/places'
import { libelleTypeGardeDb } from '@/lib/libelles-gardes'
import { CompteursPanel } from './CompteursPanel'
import type { CompteursRow } from '@/hooks/useCompteurs'
import type { BilanVet } from '@/engine/bilan'
import type { CleColonne } from '@/lib/planning/colonnesCompteurs'
import type { GardeDenormalisee, Periode, ProfilPlanning } from '@/types'

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
  /** Périodes types actives du cabinet — proposées à la création d'un planning. */
  periodesTypes: ProfilPlanning[]
  /** Les gardes que chaque période type fait couvrir, par id de période type. */
  gardesParType: Record<string, string[]>
  /** Écarts à la juste part — source unique `calculerBilans`, comme l'Historique. */
  bilans: BilanVet[]
  /** Colonnes de l'encart compteurs choisies par la personne connectée. */
  colonnesCompteurs: CleColonne[]
  /**
   * Vacances scolaires de la ZONE du cabinet, chevauchant la grille affichée.
   * Elles ne décorent pas : plusieurs règles en dépendent (le repos du mercredi
   * de Fanny saute pendant les vacances, l'alternance d'Anne-Sophie s'y recale).
   * Sans repère visuel, une garde parfaitement légitime passe pour une erreur.
   */
  vacances?: PlageVacances[]
}

/** Une période de vacances scolaires, telle que servie par la page. */
export interface PlageVacances {
  debut: string
  fin: string
  label: string
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
  periodesTypes,
  gardesParType,
  bilans,
  colonnesCompteurs,
  vacances = [],
}: Props) {
  const router = useRouter()
  const [annee, mois] = anneeMois.split('-').map(Number)
  const [popOuvert, setPopOuvert] = useState(false)
  const [compteursOuverts, setCompteursOuverts] = useState(true)
  const [gardeModal, setGardeModal] = useState<GardeDenormalisee | null>(null)
  const [criseOpen, setCriseOpen] = useState(false)
  const [criseDate, setCriseDate] = useState<string | undefined>()
  const [criseVetId, setCriseVetId] = useState<string | undefined>()
  // Suppression d'un planning depuis le menu de période (demande MiKL du
  // 2026-08-03 : le geste doit exister là où on choisit les plannings, pas
  // seulement au fond du parcours de génération).
  const [supprimerId, setSupprimerId] = useState<string | null>(null)
  const [suppressionEnCours, setSuppressionEnCours] = useState(false)

  async function supprimerLePlanning(id: string) {
    setSuppressionEnCours(true)
    const res = await supprimerPeriode(id)
    setSuppressionEnCours(false)
    setSupprimerId(null)
    if ('error' in res && res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Planning supprimé.')
    setPopOuvert(false)
    router.refresh()
  }

  const today = aujourdhuiISO()
  const grille = genererGrille(annee, mois)

  // Noms des vacances réellement VISIBLES dans la grille affichée — on charge
  // une fenêtre un peu plus large que le mois, la légende ne doit pas annoncer
  // une période qu'on ne voit nulle part.
  const vacancesDuMois = [
    ...new Set(
      vacances
        .filter((v) => grille.some((d) => v.debut <= d && v.fin >= d))
        .map((v) => v.label),
    ),
  ]

  // Le panneau de période se referme comme n'importe quel menu : en cliquant
  // ailleurs ou avec Échap. Sans ça, la flèche du menu était la SEULE sortie
  // (retour MiKL 2026-07-29).
  const periodeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!popOuvert) return
    function auClic(e: MouseEvent) {
      if (!periodeRef.current?.contains(e.target as Node)) setPopOuvert(false)
    }
    function auClavier(e: KeyboardEvent) {
      if (e.key === 'Escape') setPopOuvert(false)
    }
    // `mousedown` plutôt que `click` : le panneau disparaît dès l'appui,
    // sans attendre le relâchement.
    document.addEventListener('mousedown', auClic)
    document.addEventListener('keydown', auClavier)
    return () => {
      document.removeEventListener('mousedown', auClic)
      document.removeEventListener('keydown', auClavier)
    }
  }, [popOuvert])

  // Les outils de la barre (PDF, absence, générer, publier) et leurs
  // garde-fous. La période vient de la PILULE — une seule source de vérité,
  // là où la V1 embarquait un second sélecteur qui la contredisait.
  const { pilules, alertes, modales, ouvrirAssistant } = useOutilsPlanning({
    periode: periodeAffichee,
    aDesGardes: periodeAffichee ? periodesAvecGardes.includes(periodeAffichee.id) : false,
    isAdmin,
    periodes,
    periodesTypes,
    gardesParType,
    vets,
    periodesAvecGardes,
    onNaviguerVersMois: (anneeMois) => router.push(`/planning?mois=${anneeMois}`),
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

  /**
   * Une fiche de garde n'est un BOUTON que si le clic mène quelque part.
   *
   * L'admin agit sur tout — c'est son écran. Un vétérinaire n'a qu'un geste
   * possible, l'échange, et seulement sur ses propres gardes à venir : ailleurs,
   * le clic ouvrait une fenêtre sans la moindre action (« un bouton qui ne fait
   * rien »). On dessine donc une ligne inerte plutôt qu'un bouton menteur — et
   * le test est le MÊME que celui qui décide du bouton dans la modale, ce qui
   * rend la divergence impossible.
   */
  function estCliquable(g: GardeDenormalisee): boolean {
    return isAdmin || peutProposerUnEchange(g, moiVetId, today)
  }

  const statut = periodeAffichee ? libelleStatut(periodeAffichee.statut) : null
  // Le bandeau « lecture seule » s'adresse à celle qui, d'habitude, PEUT
  // modifier : il explique une exception, et propose d'aller travailler
  // ailleurs. Pour un vétérinaire, tout est en lecture seule en permanence —
  // le bandeau n'annoncerait aucune exception, et « ouvre la période de travail
  // pour agir » lui désignerait un pouvoir qu'il n'a pas.
  const consultationSeule =
    isAdmin && periodeAffichee !== null && periodeAffichee.statut === 'verrouille'

  return (
    <div className="plan-scene">
      <FilouEdge origine="planning" />

      <div className={`workspace${compteursOuverts ? '' : ' counters-closed'}`}>
        <div className="work-head">
          {/* La période est un seul objet : la pilule EST le sélecteur, et sa
              carte d'identité vit dans le panneau qu'elle ouvre. */}
          <div className="period-wrap" ref={periodeRef} style={{ position: 'relative' }}>
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
                      {/* Sans période type, on ne se tait plus : depuis le
                          2026-08-04 elle est obligatoire, et un planning qui
                          n'en a pas est un planning d'avant la règle qu'il faut
                          rattacher (le parcours de génération le propose). */}
                      {profil
                        ? <span className="pb-chip">Période type « {profil} »</span>
                        : isAdmin && <span className="pb-chip">Aucune période type — à choisir</span>}
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
                ) : periodes.length === 0 ? (
                  // Aucune période DU TOUT n'est un état de démarrage, pas une
                  // erreur de navigation : dire « le mois affiché ne tombe dans
                  // aucune période » laisserait croire qu'il suffit de changer
                  // de mois pour en trouver une.
                  <p className="pp-sub">
                    {isAdmin
                      ? 'Aucun planning n’existe encore. Le bouton « Générer », en haut de l’écran, crée le premier.'
                      : // Côté véto, « aucun planning n'existe » serait un
                        // mensonge dès qu'un brouillon est en préparation — et
                        // dire qu'il en existe un en trahirait le contenu. On
                        // parle donc de ce qui le concerne : ce qui lui a été
                        // diffusé.
                        'Aucun planning ne t’a encore été diffusé. Tes gardes apparaîtront ici dès qu’il sera publié.'}
                  </p>
                ) : (
                  <p className="pp-sub">Le mois affiché ne tombe dans aucune période.</p>
                )}

                {periodes.length > 0 && <p className="pp-label">Changer de période</p>}
                {periodes.map((p) => {
                  // La corbeille tient sur les BROUILLONS seulement, comme
                  // partout ailleurs (le serveur refuse les autres de toute
                  // façon). En confirmation, la rangée bascule entièrement :
                  // pas de « oui/non » glissé à côté d'un nom de planning.
                  if (supprimerId === p.id) {
                    return (
                      <div key={p.id} className="pp-item confirme">
                        <span className="pp-confirme-txt">
                          Supprimer « {nomPeriode(p)} » ?
                          <small>
                            {periodesAvecGardes.includes(p.id)
                              ? 'Ses gardes seront effacées — personne ne les a vues.'
                              : 'Ce planning est vide.'}
                          </small>
                        </span>
                        <span className="pp-confirme-actions">
                          <button
                            type="button"
                            className="ppv-btn"
                            disabled={suppressionEnCours}
                            onClick={() => setSupprimerId(null)}
                          >
                            Annuler
                          </button>
                          <button
                            type="button"
                            className="ppv-btn danger"
                            disabled={suppressionEnCours}
                            onClick={() => void supprimerLePlanning(p.id)}
                          >
                            Supprimer
                          </button>
                        </span>
                      </div>
                    )
                  }
                  return (
                    <div key={p.id} className="pp-rangee">
                      <button
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
                      {isAdmin && p.statut === 'brouillon' && (
                        <button
                          type="button"
                          className="gen-suppr"
                          title={`Supprimer « ${nomPeriode(p)} »`}
                          aria-label={`Supprimer le planning ${nomPeriode(p)}`}
                          onClick={() => setSupprimerId(p.id)}
                        >
                          <Trash2 className="ppv-ico" aria-hidden />
                        </button>
                      )}
                    </div>
                  )
                })}
                {/* Menait à `/historique` du temps où la création vivait
                    là-bas. Depuis le 2026-08-02 elle est ici, dans l'assistant
                    de génération — le raccourci ouvre donc directement la voie
                    « nouveau planning » au lieu de renvoyer sur un écran de
                    consultation qui ne sait plus le faire. */}
                {isAdmin && (
                  <button
                    type="button"
                    className="pp-new"
                    onClick={() => {
                      setPopOuvert(false)
                      ouvrirAssistant('nouveau')
                    }}
                  >
                    Créer un nouveau planning
                    <small>Des dates, une période type — et le moteur le remplit</small>
                  </button>
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
          {/* Un BANDEAU, plus un voile. Le voile couvrait tout le plan de
              travail en promettant « elle se consulte » — et c'est exactement
              ce qu'il empêchait (retour MiKL, 2026-08-19). Ce qu'il protégeait
              est déjà tenu, et mieux : chaque garde verrouillée ferme son
              propre mode édition (GardeDetailModal), la barre affiche
              « 🔒 Verrouillé » au lieu de « Publier », et la régénération est
              refusée côté SERVEUR (api/generate) — pas seulement masquée ici. */}
          {consultationSeule && (
            <div className="archive-bandeau" role="status">
              <span className="ab-ico" aria-hidden>🔒</span>
              <div className="ab-txt">
                <b>{nomPeriode(periodeAffichee)} · lecture seule</b>
                <p>
                  Cette période est verrouillée : tu peux la consulter dans le détail, mais plus la
                  modifier. Ouvre la période de travail pour agir.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setPopOuvert(true)}
              >
                Changer de période
              </button>
            </div>
          )}

          {/* Les avertissements du moteur vivent ICI, au-dessus de la grille —
              pas dans la barre d'en-tête, qu'ils faisaient gonfler. */}
          {alertes}

          {/* La consigne doit décrire ce que CETTE personne peut faire.
              Annoncer « réattribuer une garde, signaler une absence » à un
              vétérinaire, c'est lui promettre deux gestes que le serveur lui
              refuse — et lui faire chercher pendant dix minutes le bouton qui
              n'existe pas (constat MiKL du 2026-08-20). Un véto n'a qu'un
              geste ici : proposer un échange sur une de SES gardes à venir. */}
          {isAdmin ? (
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
          ) : (
            <p className="grid-hint">
              <span className="gh-ico" aria-hidden="true">
                🔄
              </span>
              <span>
                <b>Clique sur une de tes gardes à venir</b> pour proposer un échange à un
                collègue.
              </span>
              <span className="gh-sep" aria-hidden="true">
                ·
              </span>
              <span className="gh-lock">Les autres gardes sont en lecture seule</span>
            </p>
          )}

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
                        estCliquable={estCliquable}
                        conges={conges.filter((c) => c.dateDebut <= date && c.dateFin >= date)}
                        nomsTypes={nomsTypes}
                        vacances={vacances.find((v) => v.debut <= date && v.fin >= date)?.label ?? null}
                        onOuvrir={setGardeModal}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Légende — n'apparaît QUE si le mois affiché contient des
                  vacances. Un repère visuel sans mode d'emploi n'explique
                  rien ; une légende affichée en permanence serait du bruit
                  onze mois sur douze. */}
              {vacancesDuMois.length > 0 && (
                <p className="cal-legende">
                  <span className="lg-vac" aria-hidden="true" />
                  {vacancesDuMois.length === 1
                    ? vacancesDuMois[0]
                    : vacancesDuMois.join(' · ')}{' '}
                  — vacances scolaires. Certaines règles changent pendant ces
                  périodes.
                </p>
              )}
            </div>

            <aside className="counters-panel" aria-label="Compteurs de la période">
              <div className="cnt-head">
                <h4>Compteurs · période</h4>
                <p>Ils bougent à chaque changement, manuel comme automatique.</p>
              </div>
              <CompteursPanel lignes={compteurs} bilans={bilans} colonnes={colonnesCompteurs} />
              <p className="cnt-foot">
                « 1er WE » = premier de garde du week-end (celui qui porte l&apos;avantage
                financier).
              </p>
            </aside>
          </div>
        </div>

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
  estCliquable,
  conges,
  nomsTypes,
  vacances,
  onOuvrir,
}: {
  date: string
  moisAffiche: number
  today: string
  /** Le jour tombe en dehors des bornes de la période affichée. */
  horsPeriode: boolean
  gardes: GardeDenormalisee[]
  /** Le clic sur cette garde mène-t-il à une action réelle pour la personne connectée ? */
  estCliquable: (g: GardeDenormalisee) => boolean
  conges: CongeAffiche[]
  nomsTypes: Record<string, string>
  /** Nom des vacances scolaires couvrant ce jour, ou null. */
  vacances: string | null
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
  // Vacances scolaires : marquage par LISERÉ, pas par fond. Les fonds portent
  // déjà quatre états (week-end, vendredi, passé, hors période) — en ajouter un
  // cinquième les ferait se recouvrir, et on ne saurait plus lire ni l'un ni
  // l'autre. Le liseré se superpose à tous sans en effacer aucun.
  if (vacances) classes.push('vac')

  const ferie = estJourFerie(date)

  return (
    <div className={classes.join(' ')} data-date={date} title={vacances ?? undefined}>
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

      {gardes.map((g) => {
        // TOUTES les places, pas seulement les deux premières : un créneau
        // sur-mesure peut en compter jusqu'à quatre, et un vétérinaire de
        // garde qui n'apparaît pas dans la case serait invisible partout.
        const places = placesDeGarde(g)
        const cliquable = estCliquable(g)
        return (
          <div className="slot-card" key={g.id}>
            <span className="sc-tag">{libelleTypeGardeDb(g.type, nomsTypes)}</span>
            {/* Une place seule n'affiche pas son rôle : « 1er » n'a de sens
                que s'il y a un 2e. Les places vides ne sont pas dessinées —
                on ne connaît pas ici le nombre de places du créneau, et un
                « à pourvoir » inventerait un trou qui n'existe pas. */}
            {places.map((p) => (
              <LigneVet
                key={p.index}
                prenom={p.prenom}
                couleur={p.couleur}
                role={places.length > 1 ? p.role : ''}
                titre={`${dateCourte(date)} · ${p.role} de garde`}
                onClick={cliquable ? () => onOuvrir(g) : undefined}
              />
            ))}
          </div>
        )
      })}

      {horsPeriode && <span className="d-hors-note">hors période</span>}
    </div>
  )
}

/**
 * Une place dans une fiche : point de couleur + prénom, ou « à pourvoir ».
 *
 * `onClick` absent = la ligne se DESSINE mais ne se clique pas. On rend alors
 * un `<span>`, pas un `<button disabled>` : un bouton grisé annonce une action
 * momentanément indisponible, alors qu'ici il n'y a rien à faire du tout — et
 * le clavier n'a aucune raison de s'arrêter dessus. Les styles `.vet-row` sont
 * neutres quant à la balise (seul `button.vet-row:hover` réagit), le rendu est
 * donc identique à l'œil, sans l'affordance de clic.
 */
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
  onClick?: () => void
}) {
  const contenu = !prenom ? (
    <>
      <span className="vdot" aria-hidden="true" />À pourvoir
    </>
  ) : (
    <>
      <span className="vdot" style={{ background: couleur ?? 'var(--soft)' }} aria-hidden="true" />
      {prenom}
      {role && <span className="role">{role}</span>}
    </>
  )
  const classe = prenom ? 'vet-row' : 'vet-row empty'
  const libelle = prenom ? `${titre} · ${prenom}` : `${titre} · place à pourvoir`

  if (!onClick) {
    return (
      <span className={classe} aria-label={libelle}>
        {contenu}
      </span>
    )
  }
  return (
    <button type="button" className={classe} onClick={onClick} aria-label={libelle}>
      {contenu}
    </button>
  )
}

// ── Le volet compteurs ──────────────────────────────────────


