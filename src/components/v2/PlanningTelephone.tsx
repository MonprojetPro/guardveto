'use client'

// ============================================================
// GUARDVETO — Le planning sur téléphone (B-179a, maquette validée le 02/11)
// ============================================================
// Sous 640 px, il REMPLACE la grille (les deux : celle du cabinet et celle du
// chantier). Au-dessus, il est caché et rien ne change. La bascule est en CSS
// (`v2-planning-telephone.css`) : pas de détection d'appareil, pas de second
// rendu qui pourrait diverger selon le navigateur.
//
// Les cinq choix tranchés par MiKL (« ok pour tout », 02/11) :
//   1. un véto ouvre sur « Mes jours », l'admin et le secrétariat sur « Tout le
//      cabinet » ;
//   2. semaine par semaine (flèches + « Aujourd'hui »), et tout se lit aussi en
//      faisant défiler ;
//   3. dans « Mes jours », les jours sans rien sont REPLIÉS en une ligne, jamais
//      cachés — un jour qui disparaît se lit comme une erreur ;
//   4. au téléphone on voit, on ouvre un jour, on échange, et l'admin attribue
//      une place ; générer et publier restent sur ordinateur ;
//   5. sous 640 px seulement.
//
// ⚠️ AUCUN GESTE RÉÉCRIT ICI. Ils passent par ce qui existe : la fenêtre de
//    garde des grilles (`GardeDetailModal`), la proposition d'échange de
//    l'écran Absences, et — B-179c, 02/11 — « Je prends la place »
//    (`BoutonPrendrePlace`, route `/api/gardes/[id]/prendre-place`), le même
//    bouton que sur ordinateur.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { GardeDetailModal, peutProposerUnEchange, placeAPrendreDe } from '@/components/planning/GardeDetailModal'
import { BoutonPrendrePlace } from '@/components/planning/BoutonPrendrePlace'
import { stylePastille } from '@/lib/couleurs'
import { bilanSemaine, type JourTel, type SemaineTel } from '@/lib/planning/joursTelephone'
import type { GardeDenormalisee } from '@/types'
import '@/styles/v2-planning-telephone.css'

type Vue = 'moi' | 'tous'

const JOUR_COURT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' })
const JOUR_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const JOUR_MOIS = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const JOUR_MOIS_COURT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const MOIS_ANNEE = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })

const d = (iso: string) => new Date(`${iso}T12:00:00Z`)
const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const jourCourt = (iso: string) => majuscule(JOUR_COURT.format(d(iso)).replace('.', ''))

function moisVoisin(anneeMois: string, delta: number): string {
  const [a, m] = anneeMois.split('-').map(Number)
  const x = new Date(Date.UTC(a, m - 1 + delta, 1))
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`
}

function Pastille({ prenom, couleur, moi }: { prenom: string; couleur: string | null; moi?: boolean }) {
  return (
    <span className={`pt-nom${moi ? ' moi' : ''}`}>
      <i style={stylePastille(couleur)} aria-hidden="true">{prenom.charAt(0).toUpperCase()}</i>
      {prenom}
    </span>
  )
}

const NATURE: Record<'conge' | 'souhait' | 'absence', string> = {
  conge: 'Congé',
  souhait: 'Souhait',
  absence: 'Absent·e',
}

interface Props {
  semaines: SemaineTel[]
  /** Les gardes complètes, pour ouvrir la fenêtre de garde existante. */
  gardes: GardeDenormalisee[]
  anneeMois: string
  aujourdhui: string
  moiVetId: string
  isAdmin: boolean
  lectureSeule: boolean
  nomsTypes: Record<string, string>
  /** « Hiver P2 · publié », ou null si aucune période ne couvre le mois. */
  etiquettePeriode: string | null
}

export function PlanningTelephone({
  semaines, gardes, anneeMois, aujourdhui, moiVetId, isAdmin, lectureSeule, nomsTypes, etiquettePeriode,
}: Props) {
  const router = useRouter()
  // Choix 1 — un véto commence par SES jours. L'admin et le secrétariat
  // travaillent sur toute l'équipe ; le secrétariat n'a d'ailleurs pas de jours
  // à lui (pas de fiche vétérinaire).
  const aDesJours = Boolean(moiVetId)
  const [vue, setVue] = useState<Vue>(aDesJours && !isAdmin && !lectureSeule ? 'moi' : 'tous')
  const [jourOuvert, setJourOuvert] = useState<JourTel | null>(null)
  const [gardeModal, setGardeModal] = useState<GardeDenormalisee | null>(null)
  const [deplies, setDeplies] = useState<ReadonlySet<string>>(new Set())

  const indexAujourdhui = semaines.findIndex((s) => s.debut <= aujourdhui && aujourdhui <= s.fin)
  const [courante, setCourante] = useState(indexAujourdhui >= 0 ? indexAujourdhui : 0)
  const sections = useRef<(HTMLElement | null)[]>([])
  const racine = useRef<HTMLDivElement | null>(null)

  // Choix 2 — on ouvre sur la semaine d'aujourd'hui. Seulement si la vue est
  // AFFICHÉE (sous 640 px) : sur ordinateur, elle est cachée et ne doit pas
  // faire défiler la page sous les pieds de la grille.
  useEffect(() => {
    if (indexAujourdhui <= 0) return
    if (!racine.current?.offsetParent) return
    sections.current[indexAujourdhui]?.scrollIntoView({ block: 'start' })
    // une seule fois, au montage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // La semaine affichée dans la barre suit le défilement.
  useEffect(() => {
    if (!racine.current?.offsetParent || typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver(
      (entrees) => {
        for (const e of entrees) {
          if (!e.isIntersecting) continue
          const i = Number((e.target as HTMLElement).dataset.index)
          if (!Number.isNaN(i)) setCourante(i)
        }
      },
      { rootMargin: '-30% 0px -60% 0px' },
    )
    for (const s of sections.current) if (s) obs.observe(s)
    return () => obs.disconnect()
  }, [semaines.length])

  // La feuille du jour se ferme à Échap, comme toute fenêtre.
  useEffect(() => {
    if (!jourOuvert) return
    const fermer = (e: KeyboardEvent) => { if (e.key === 'Escape') setJourOuvert(null) }
    window.addEventListener('keydown', fermer)
    return () => window.removeEventListener('keydown', fermer)
  }, [jourOuvert])

  const gardesParId = useMemo(() => new Map(gardes.map((g) => [g.id, g])), [gardes])

  const allerSemaine = (i: number) => {
    if (i < 0) return router.push(`/planning?mois=${moisVoisin(anneeMois, -1)}`)
    if (i >= semaines.length) return router.push(`/planning?mois=${moisVoisin(anneeMois, 1)}`)
    setCourante(i)
    sections.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const allerAujourdhui = () => {
    if (indexAujourdhui < 0) return router.push('/planning')
    allerSemaine(indexAujourdhui)
  }

  const semaineCourante = semaines[courante]

  return (
    <div className="plan-tel" ref={racine}>
      <div className="pt-tete">
        {etiquettePeriode && <div className="pt-kick">{etiquettePeriode}</div>}
        <h1>{majuscule(MOIS_ANNEE.format(d(`${anneeMois}-01`)))}</h1>
      </div>

      {aDesJours && (
        <div className="pt-bascule" role="tablist" aria-label="Ce que montre le planning">
          <button type="button" role="tab" aria-selected={vue === 'moi'} className={vue === 'moi' ? 'on' : ''} onClick={() => setVue('moi')}>
            Mes jours
          </button>
          <button type="button" role="tab" aria-selected={vue === 'tous'} className={vue === 'tous' ? 'on' : ''} onClick={() => setVue('tous')}>
            Tout le cabinet
          </button>
        </div>
      )}

      {semaineCourante && (
        <div className="pt-semaine-nav">
          <button type="button" className="pt-fleche" onClick={() => allerSemaine(courante - 1)} aria-label="Semaine précédente">‹</button>
          <div className="pt-semaine-titre">
            <b>Semaine du {JOUR_MOIS.format(d(semaineCourante.debut))}</b>
            <button type="button" className="pt-aujourdhui" onClick={allerAujourdhui}>Aujourd&apos;hui</button>
          </div>
          <button type="button" className="pt-fleche" onClick={() => allerSemaine(courante + 1)} aria-label="Semaine suivante">›</button>
        </div>
      )}

      {isAdmin && (
        <p className="pt-note">Générer, publier et réorganiser un planning se font sur ordinateur.</p>
      )}

      {semaines.map((s, i) => (
        <section
          key={s.debut}
          className="pt-section"
          data-index={i}
          ref={(el) => { sections.current[i] = el }}
          aria-label={`Semaine du ${JOUR_MOIS.format(d(s.debut))}`}
        >
          <h2 className="pt-section-titre">
            Semaine du {JOUR_MOIS.format(d(s.debut))}
            <small>{JOUR_MOIS_COURT.format(d(s.debut))} → {JOUR_MOIS_COURT.format(d(s.fin))}</small>
          </h2>
          {vue === 'moi'
            ? <SemaineMoi semaine={s} moiVetId={moiVetId} deplies={deplies} onDeplier={(cle) => setDeplies((x) => new Set(x).add(cle))} onOuvrir={setJourOuvert} />
            : s.jours.map((j) => <CarteJour key={j.date} jour={j} vue="tous" moiVetId={moiVetId} onOuvrir={setJourOuvert} />)}
        </section>
      ))}

      {jourOuvert && (
        <FeuilleJour
          jour={jourOuvert}
          moiVetId={moiVetId}
          isAdmin={isAdmin}
          lectureSeule={lectureSeule}
          aujourdhui={aujourdhui}
          etiquettePeriode={etiquettePeriode}
          gardesParId={gardesParId}
          onFermer={() => setJourOuvert(null)}
          onOuvrirGarde={(g) => { setJourOuvert(null); setGardeModal(g) }}
        />
      )}

      {/* La fenêtre de garde des grilles, telle quelle : mêmes droits, mêmes
          refus, même vérification serveur. Rien n'est réécrit ici. */}
      <GardeDetailModal
        garde={gardeModal}
        date={gardeModal?.date ?? null}
        isAdmin={isAdmin}
        moiVetId={moiVetId}
        nomsTypes={nomsTypes}
        onClose={() => setGardeModal(null)}
        onSaved={() => router.refresh()}
        manque={gardeModal ? (semaines.flatMap((s) => s.jours).flatMap((j) => j.gardes).find((x) => x.id === gardeModal.id)?.manque ?? 0) : 0}
      />
    </div>
  )
}

// ── « Mes jours » : mes cartes, et les autres repliées ─────────────────────
function SemaineMoi({
  semaine, moiVetId, deplies, onDeplier, onOuvrir,
}: {
  semaine: SemaineTel
  moiVetId: string
  deplies: ReadonlySet<string>
  onDeplier: (cle: string) => void
  onOuvrir: (j: JourTel) => void
}) {
  const b = bilanSemaine(semaine, moiVetId)
  const morceaux: string[] = []
  if (b.gardes) morceaux.push(`${b.gardes} garde${b.gardes > 1 ? 's' : ''}`)
  if (b.joursAuCabinet) morceaux.push(`${b.joursAuCabinet} jour${b.joursAuCabinet > 1 ? 's' : ''} au cabinet`)
  if (b.absences) morceaux.push(`${b.absences} jour${b.absences > 1 ? 's' : ''} d'absence`)

  // On regroupe les jours SANS RIEN consécutifs en une seule ligne repliée.
  const blocs: (JourTel | JourTel[])[] = []
  for (const j of semaine.jours) {
    if (j.pourMoi || deplies.has(j.date)) { blocs.push(j); continue }
    const dernier = blocs[blocs.length - 1]
    if (Array.isArray(dernier)) dernier.push(j)
    else blocs.push([j])
  }

  return (
    <>
      <p className="pt-bilan">
        {morceaux.length > 0 ? <>Cette semaine : <b>{morceaux.join(', ')}</b>.</> : 'Rien pour toi cette semaine.'}
      </p>
      {blocs.map((x) => {
        if (!Array.isArray(x)) return <CarteJour key={x.date} jour={x} vue="moi" moiVetId={moiVetId} onOuvrir={onOuvrir} />
        const noms = x.map((j) => `${jourCourt(j.date)} ${d(j.date).getUTCDate()}`)
        const texte = noms.length === 1 ? noms[0] : `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`
        return (
          <button
            key={x[0].date}
            type="button"
            className="pt-replie"
            onClick={() => x.forEach((j) => onDeplier(j.date))}
          >
            {texte} : rien pour toi · <u>les voir</u>
          </button>
        )
      })}
    </>
  )
}

// ── Une carte de jour ──────────────────────────────────────────────────────
function CarteJour({
  jour, vue, moiVetId, onOuvrir,
}: {
  jour: JourTel
  vue: Vue
  moiVetId: string
  onOuvrir: (j: JourTel) => void
}) {
  const classes = ['pt-jour']
  if (jour.aujourdhui) classes.push('auj')
  if (jour.passe) classes.push('passe')
  if (jour.horsMois) classes.push('hors')

  // « Mes jours » ne montre que ce qui me concerne ; un jour déplié (rien pour
  // moi) montre l'équipe, sinon il serait vide.
  const filtrer = vue === 'moi' && jour.pourMoi
  const gardes = filtrer ? jour.gardes.filter((g) => g.moi) : jour.gardes
  const mesPresences = jour.presences.filter((p) => p.vetId === moiVetId)
  const absences = filtrer ? jour.absences.filter((a) => a.vetId === moiVetId) : jour.absences
  const rien = gardes.length === 0 && absences.length === 0 && (filtrer ? mesPresences.length === 0 : jour.personnesPresentes === 0)

  return (
    <button type="button" className={classes.join(' ')} onClick={() => onOuvrir(jour)} aria-label={`${majuscule(JOUR_LONG.format(d(jour.date)))} — voir le détail`}>
      <span className="pt-date" aria-hidden="true">
        <small>{jourCourt(jour.date)}</small>
        <b>{d(jour.date).getUTCDate()}</b>
      </span>
      <span className="pt-lignes">
        {gardes.map((g) => (
          <span key={g.id} className="pt-bloc">
            <span className="pt-ligne"><span className="pt-etiq garde">Garde</span><span className="pt-quoi">{g.libelle}</span></span>
            {filtrer ? (
              g.places.filter((p) => p.vetId !== moiVetId).length > 0 && (
                <span className="pt-qui">avec {g.places.filter((p) => p.vetId !== moiVetId).map((p) => p.prenom).join(', ')}</span>
              )
            ) : (
              g.places.length > 0 && (
                <span className="pt-noms">{g.places.map((p, k) => <Pastille key={k} prenom={p.prenom} couleur={p.couleur} moi={p.vetId === moiVetId && Boolean(moiVetId)} />)}</span>
              )
            )}
            {g.manque > 0 && <span className="pt-trou">{g.manque === 1 ? '1 place à pourvoir' : `${g.manque} places à pourvoir`}</span>}
          </span>
        ))}

        {filtrer
          ? mesPresences.map((p, k) => (
              <span key={k} className="pt-ligne"><span className="pt-etiq journee">Journée</span><span className="pt-quoi">{p.tranche}</span>{p.heures && <span className="pt-heure">{p.heures}</span>}</span>
            ))
          : jour.personnesPresentes > 0 && (
              <span className="pt-ligne"><span className="pt-etiq journee">Journée</span><span className="pt-qui">{jour.personnesPresentes} au cabinet</span></span>
            )}

        {absences.map((a, k) => (
          <span key={k} className="pt-ligne">
            <span className="pt-etiq absence">{NATURE[a.nature]}</span>
            <span className="pt-qui">{filtrer ? (a.precision ?? 'Toute la journée') : `${a.prenom}${a.precision ? ` (${a.precision})` : ''}`}</span>
          </span>
        ))}

        {rien && <span className="pt-vide">Rien de prévu</span>}
      </span>
    </button>
  )
}

// ── La feuille du jour ─────────────────────────────────────────────────────
function FeuilleJour({
  jour, moiVetId, isAdmin, lectureSeule, aujourdhui, etiquettePeriode, gardesParId, onFermer, onOuvrirGarde,
}: {
  jour: JourTel
  moiVetId: string
  isAdmin: boolean
  lectureSeule: boolean
  aujourdhui: string
  etiquettePeriode: string | null
  gardesParId: Map<string, GardeDenormalisee>
  onFermer: () => void
  onOuvrirGarde: (g: GardeDenormalisee) => void
}) {
  const fermer = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { fermer.current?.focus() }, [])

  // Les présences, par tranche, dans l'ordre où elles arrivent.
  const parTranche = new Map<string, typeof jour.presences>()
  for (const p of jour.presences) {
    const cle = p.heures ? `${p.tranche} · ${p.heures}` : p.tranche
    parTranche.set(cle, [...(parTranche.get(cle) ?? []), p])
  }

  return (
    <div className="pt-voile" onClick={onFermer}>
      <div
        className="pt-feuille"
        role="dialog"
        aria-modal="true"
        aria-label={majuscule(JOUR_LONG.format(d(jour.date)))}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pt-poignee" aria-hidden="true" />
        <button type="button" className="pt-fermer" ref={fermer} onClick={onFermer} aria-label="Fermer">×</button>
        <h3>{majuscule(JOUR_LONG.format(d(jour.date)))}</h3>
        {etiquettePeriode && <p className="pt-sous">{etiquettePeriode}</p>}

        {jour.gardes.map((g) => {
          const complete = gardesParId.get(g.id)
          const echange = complete ? peutProposerUnEchange(complete, moiVetId, aujourdhui) : false
          // B-179c — une place libre qu'un vétérinaire peut prendre lui-même.
          const placeLibre = !isAdmin && !lectureSeule ? placeAPrendreDe(complete, g.manque, moiVetId, aujourdhui) : null
          return (
            <div key={g.id} className="pt-bloc-feuille">
              <h4>{g.libelle}</h4>
              {g.places.map((p, k) => (
                <div key={k} className="pt-place"><Pastille prenom={p.prenom} couleur={p.couleur} moi={p.vetId === moiVetId && Boolean(moiVetId)} /></div>
              ))}
              {Array.from({ length: g.manque }, (_, k) => (
                <div key={`v${k}`} className="pt-place"><span className="pt-trou large">Place à pourvoir · personne</span></div>
              ))}
              {/* Les gestes : ceux qui existent, pas un de plus. */}
              {isAdmin && complete && (
                <button type="button" className="pt-btn" onClick={() => onOuvrirGarde(complete)}>
                  {g.manque > 0 ? 'Choisir qui prend la place' : 'Modifier qui est de garde'}
                </button>
              )}
              {!isAdmin && !lectureSeule && echange && (
                <Link className="pt-btn" href={`/absences?onglet=echanges&proposer=${g.id}`}>Proposer un échange</Link>
              )}
              {placeLibre !== null && complete && (
                // La feuille se ferme au succès : elle montrerait sinon le jour
                // d'AVANT, la place encore vide, pendant que l'écran se recharge.
                <BoutonPrendrePlace gardeId={complete.id} placeIndex={placeLibre} onFait={onFermer} />
              )}
              {/* Pas de bouton (garde du jour, déjà de garde, secrétariat…) :
                  on dit qui s'en occupe, plutôt qu'un trou muet. */}
              {!isAdmin && g.manque > 0 && placeLibre === null && (
                <p className="pt-aide">C&apos;est l&apos;administratrice qui attribue cette place.</p>
              )}
            </div>
          )
        })}

        {parTranche.size > 0 && (
          <div className="pt-bloc-feuille">
            <h4>Au cabinet · {jour.personnesPresentes} {jour.personnesPresentes > 1 ? 'personnes' : 'personne'}</h4>
            {[...parTranche].map(([tranche, liste]) => (
              <div key={tranche} className="pt-tranche">
                <div className="pt-tranche-nom">{tranche}</div>
                <div className="pt-noms">{liste.map((p, k) => <Pastille key={k} prenom={p.prenom} couleur={p.couleur} moi={p.vetId === moiVetId && Boolean(moiVetId)} />)}</div>
              </div>
            ))}
          </div>
        )}

        {jour.absences.length > 0 && (
          <div className="pt-bloc-feuille">
            <h4>{jour.absences.length > 1 ? 'Absents' : 'Absent·e'}</h4>
            <div className="pt-noms">
              {jour.absences.map((a, k) => (
                <span key={k} className="pt-nom"><i style={stylePastille(a.couleur)} aria-hidden="true">{a.prenom.charAt(0).toUpperCase()}</i>{a.prenom} · {NATURE[a.nature].toLowerCase()}{a.precision ? ` (${a.precision})` : ''}</span>
              ))}
            </div>
          </div>
        )}

        {jour.gardes.length === 0 && parTranche.size === 0 && jour.absences.length === 0 && (
          <p className="pt-vide">Rien de prévu ce jour-là.</p>
        )}
      </div>
    </div>
  )
}
