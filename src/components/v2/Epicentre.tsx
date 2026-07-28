'use client'

// ============================================================
// GUARDVETO V2 — L'épicentre : Filou, sa tablette, le tableau du cabinet
// ============================================================
// La scène se lit en deux temps : à gauche Filou et ce qu'il a à dire, à
// droite « le coup d'œil du matin » — quatre fiches qui résument la journée.
// Cliquer une fiche ouvre une fenêtre détaillée À LA PLACE du coup d'œil ;
// Échap ou ✕ referme et le tableau revient.
//
// PARTAGE DES RÔLES entre les deux moitiés (décidé avec MiKL) : la tablette ne
// porte QUE la conversation — Filou demande une précision, on lui répond. Tout
// RÉSULTAT s'affiche sur le tableau, où il a la place d'être lu et décidé. Ce
// que Filou comprend arrive donc ici par `onResultat`, dans une fenêtre de plus,
// exactement comme les quatre fiches.
//
// Chaque chiffre affiché vient de la base (`chargerAccueil`). La fiche
// « cohérence » est la seule à se charger après coup : elle fait tourner le
// validateur indépendant sur les périodes publiées, ce qui prend une seconde.
// Tant qu'elle n'a pas répondu, elle le dit — elle n'affiche jamais un
// verdict qu'elle n'a pas.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FilouCube, type FilouHandle } from './FilouCube'
import { FilouChat, type FilouChatHandle } from './FilouChat'
import { FenetreResultatFilou, type ResultatFilou } from './FilouResultat'
import { revaliderPlanningPublie } from '@/data/revaliderPlanning'
import type { ViolationRevalidation } from '@/components/planning/types-revalidation'
import type { DonneesAccueil, GardeDuSoir } from '@/data/v2/accueilEpicentre'

type Fenetre = 'cesoir' | 'souhaits' | 'periode' | 'coherence' | 'filou'

/** Ce que Filou a posé sur le tableau survit à une navigation, comme la
 *  conversation (cf. `FilouChat`) : aller vérifier une fiche dans l'onglet
 *  Équipe puis revenir ne doit pas effacer la réponse qu'on était en train de
 *  lire. Même support, même durée de vie : l'onglet. */
const CLE_RESULTAT = 'guardveto.filou.resultat'

function relireResultat(): ResultatFilou | null {
  if (typeof window === 'undefined') return null
  try {
    const brut = window.sessionStorage.getItem(CLE_RESULTAT)
    if (!brut) return null
    const lu = JSON.parse(brut) as ResultatFilou | null
    // Une valeur écrite par une version précédente ne doit pas casser l'accueil.
    return lu && typeof lu.id === 'number' && typeof lu.titre === 'string' ? lu : null
  } catch {
    return null
  }
}

function memoriserResultat(r: ResultatFilou | null) {
  if (typeof window === 'undefined') return
  try {
    if (r) window.sessionStorage.setItem(CLE_RESULTAT, JSON.stringify(r))
    else window.sessionStorage.removeItem(CLE_RESULTAT)
  } catch {
    // Stockage refusé : la réponse vivra le temps de la page, sans casser rien.
  }
}

// ── Mise en français des dates (rien d'autre que de l'affichage) ──

const JOUR_LONG = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Paris',
})
const JOUR_COURT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Paris',
})

function dateLongue(iso: string) {
  return JOUR_LONG.format(new Date(iso + 'T12:00:00Z'))
}
function dateCourte(iso: string) {
  return JOUR_COURT.format(new Date(iso + 'T12:00:00Z'))
}
function majuscule(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function initiale(prenom: string) {
  return prenom.slice(0, 1).toUpperCase()
}

/** Les prénoms d'une garde, dans l'ordre, prêts à entrer dans une phrase.
 *  « Fanny et Antoine » — pas « Fanny & Antoine » : l'esperluette va dans un
 *  titre, pas au milieu d'une phrase. */
function prenomsDe(garde: GardeDuSoir): string[] {
  return [garde.premier?.prenom, garde.second?.prenom].filter(
    (p): p is string => Boolean(p),
  )
}

/** Accorde un verbe sur un nombre de personnes. Le pluriel écrit en dur
 *  donnait « Jean prennent le relais » les soirs où un seul véto est de
 *  garde — et une nuit de semaine à un seul véto, c'est le cas courant. */
function accord(n: number, singulier: string, pluriel: string) {
  return n > 1 ? pluriel : singulier
}

/** Nature + horaire d'une garde, tels que la donnée les porte. L'horaire vient
 *  de `creneau_modele` (réglable par profil de planning) : il peut manquer, et
 *  dans ce cas on annonce la nature seule plutôt qu'un horaire inventé. */
function natureEtHoraire(garde: GardeDuSoir): string {
  return garde.horaire ? `${garde.nature} · ${garde.horaire}` : garde.nature
}

/** « il y a 3 jours », « aujourd'hui » — pour l'ancienneté d'un souhait. */
function anciennete(iso: string) {
  const jours = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (jours <= 0) return "aujourd'hui"
  if (jours === 1) return 'hier'
  if (jours < 7) return `il y a ${jours} jours`
  const semaines = Math.floor(jours / 7)
  return semaines === 1 ? 'il y a une semaine' : `il y a ${semaines} semaines`
}

export function Epicentre({ data }: { data: DonneesAccueil }) {
  const router = useRouter()
  const [ouverte, setOuverte] = useState<Fenetre | null>(null)
  const [heure, setHeure] = useState('--:--')
  // Ce que Filou a compris et pose sur le tableau. Conservé après fermeture :
  // rouvrir ne doit pas ressusciter une décision déjà prise, donc on l'efface
  // au moment de la décision, pas au moment de la fermeture.
  //
  // Relu depuis l'onglet au premier rendu, comme la conversation : aller voir
  // une fiche puis revenir ne doit pas effacer ce qu'on était en train de lire.
  const [resultatFilou, setResultatFilou] = useState<ResultatFilou | null>(relireResultat)
  const filou = useRef<FilouHandle>(null)
  const chat = useRef<FilouChatHandle>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  // Verdict de cohérence : chargé après le rendu, jamais deviné. S'il n'y a
  // rien à vérifier, on le sait dès le premier rendu — pas d'attente pour rien.
  const [verdict, setVerdict] = useState<
    { etat: 'attente' } | { etat: 'sans-objet' } | { etat: 'ok'; violations: ViolationRevalidation[] }
  >(() =>
    data.estAdmin && data.periodesPubliees.length > 0
      ? { etat: 'attente' }
      : { etat: 'sans-objet' },
  )

  useEffect(() => {
    if (!data.estAdmin || data.periodesPubliees.length === 0) return
    let vivant = true
    revaliderPlanningPublie(data.periodesPubliees)
      .then((violations) => {
        if (vivant) setVerdict({ etat: 'ok', violations })
      })
      .catch(() => {
        if (vivant) setVerdict({ etat: 'sans-objet' })
      })
    return () => {
      vivant = false
    }
  }, [data.estAdmin, data.periodesPubliees])

  // L'heure réelle sur la barre de statut de la tablette, recalée à la minute.
  useEffect(() => {
    const maj = () => {
      const d = new Date()
      setHeure(
        new Intl.DateTimeFormat('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Europe/Paris',
        }).format(d),
      )
    }
    maj()
    // On se recale sur la minute pile, puis on bat la minute.
    let battement: ReturnType<typeof setInterval> | null = null
    const amorce = setTimeout(
      () => {
        maj()
        battement = setInterval(maj, 60_000)
      },
      (60 - new Date().getSeconds()) * 1000 + 50,
    )
    return () => {
      clearTimeout(amorce)
      if (battement) clearInterval(battement)
    }
  }, [])

  const ouvrir = useCallback((f: Fenetre) => {
    setOuverte(f)
    filou.current?.tape()
  }, [])

  /** Filou a compris quelque chose : ça s'affiche sur le tableau. Le
   *  `scrollIntoView` n'a aucun effet quand le tableau est déjà en vue (grand
   *  écran) ; en dessous de 940 px, où le tableau passe SOUS la tablette, il
   *  évite qu'un résultat s'ouvre hors de l'écran sans qu'on le voie. */
  const montrer = useCallback((r: ResultatFilou) => {
    setResultatFilou(r)
    memoriserResultat(r)
    setOuverte('filou')
    requestAnimationFrame(() => {
      stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }, [])

  /** On repart de zéro depuis la tablette : le tableau se vide avec le fil.
   *  Rien n'est touché en base — une proposition non décidée est simplement
   *  abandonnée, ce qui était déjà le cas en fermant la fenêtre. */
  const oublierResultat = useCallback(() => {
    setResultatFilou(null)
    memoriserResultat(null)
    setOuverte((f) => (f === 'filou' ? null : f))
  }, [])

  /** La décision prise sur le tableau revient se dire dans la conversation :
   *  les deux moitiés de l'écran racontent la même histoire. */
  const deciderResultat = useCallback(
    ({ fermer, dire }: { fermer: boolean; dire: string }) => {
      chat.current?.dit(dire)
      if (!fermer) return
      setOuverte(null)
      setResultatFilou(null)
      memoriserResultat(null)
      // Les compteurs de la barre (règles fermes / souples) lisent la base :
      // sans ce refresh, le dock afficherait encore l'ancien décompte.
      router.refresh()
    },
    [router],
  )

  // Échap referme la fenêtre et rend le tableau.
  useEffect(() => {
    if (!ouverte) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuverte(null)
    }
    window.addEventListener('keydown', onKey)
    // Le titre de la fenêtre prend le focus : le lecteur d'écran suit.
    stageRef.current?.querySelector<HTMLElement>('.fen.active h2')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [ouverte])

  const nbSouhaits = data.souhaits.length

  return (
    <section className="scene" aria-label="Accueil du matin : Filou et la fenêtre contextuelle">
      <div className="float-wrap">
        <div className="epicentre">
          <div className="epi-inner">
            {/* ------ Le bureau de Filou ------ */}
            <div className="desk">
              <div className="desk-top rise rise-2">
                <FilouCube ref={filou} />

                <div className="convo">
                  <span className="tab-marque" aria-hidden="true">
                    Filou
                  </span>
                  <span className="tab-btn" aria-hidden="true" />
                  <header className="convo-head">
                    <span className="tab-status" aria-hidden="true">
                      <span>{heure}</span>{' '}
                      <span className="ts-batt">
                        <i />
                      </span>
                    </span>
                    <p className="hello-kicker">
                      {data.periodeCourante
                        ? `Période ${data.dock.libellePlanning}`
                        : 'Aucune période en cours'}
                    </p>
                    <h1>{majuscule(dateLongue(data.ceSoir?.date ?? aujourdhui()))}</h1>
                  </header>

                  {/* Le fil et le champ pour PARLER à Filou — rien d'autre.
                      C'est FilouChat qui tient la conversation : il appelle le
                      même assistant que l'écran Règles. Ce qu'il comprend
                      ressort par `onResultat` et s'affiche sur le tableau. */}
                  <FilouChat
                    ref={chat}
                    estAdmin={data.estAdmin}
                    onFilouTape={() => filou.current?.tape()}
                    onResultat={montrer}
                    onRemiseAZero={oublierResultat}
                    enTete={<MotDAccueil data={data} />}
                  />
                </div>
              </div>
            </div>

            {/* ------ Le tableau du cabinet ------ */}
            <div className={`stage rise rise-5${ouverte ? ' open' : ''}`} ref={stageRef}>
              <div className="glance" aria-label="Le coup d'œil du matin">
                <p className="glance-title">Le coup d&apos;œil du matin</p>

                <FicheCeSoir garde={data.ceSoir} onOpen={() => ouvrir('cesoir')} />

                {data.estAdmin && nbSouhaits > 0 && (
                  <button type="button" className="widget" onClick={() => ouvrir('souhaits')}>
                    <span className="w-ico" aria-hidden="true">
                      ⏳
                    </span>
                    <span className="w-body">
                      <h3>
                        {nbSouhaits} souhait{nbSouhaits > 1 ? 's' : ''} de congé en attente
                      </h3>
                      <p>Le plus ancien date d&apos;{anciennete(data.souhaits[0].depose)}</p>
                    </span>
                    <span className="w-go" aria-hidden="true">
                      →
                    </span>
                  </button>
                )}

                {data.estAdmin && data.recapPeriode && data.joursAvantPublication !== null && (
                  <button type="button" className="widget" onClick={() => ouvrir('periode')}>
                    <span className="w-ico" aria-hidden="true">
                      📣
                    </span>
                    <span className="w-body">
                      <h3>
                        {data.joursAvantPublication > 0
                          ? `Publication de la période dans ${data.joursAvantPublication} jour${data.joursAvantPublication > 1 ? 's' : ''}`
                          : 'Publication de la période à faire'}
                      </h3>
                      <p>
                        {data.recapPeriode.libelle} ·{' '}
                        {data.joursAvantPublication > 0
                          ? "le préavis d'un mois sera respecté"
                          : `le préavis d'un mois est dépassé de ${-data.joursAvantPublication} jour${-data.joursAvantPublication > 1 ? 's' : ''}`}
                      </p>
                    </span>
                    <span className="w-go" aria-hidden="true">
                      →
                    </span>
                  </button>
                )}

                {data.estAdmin && (
                  <FicheCoherence verdict={verdict} onOpen={() => ouvrir('coherence')} />
                )}

                <p className="glance-foot">
                  Chaque fiche s&apos;ouvre en grand ici même. <b>Filou n&apos;affiche que ce qu&apos;il a vérifié.</b>
                </p>
              </div>

              {/* ===== Fenêtre · la garde de ce soir ===== */}
              <article
                className={`fen${ouverte === 'cesoir' ? ' active' : ''}`}
                role="region"
                aria-label="La garde de ce soir"
              >
                <header className="fen-head">
                  <span className="f-ico" aria-hidden="true">
                    🌙
                  </span>
                  <div className="f-titles">
                    <h2 tabIndex={-1}>Ce soir, au cabinet</h2>
                    <p className="f-sub">
                      {data.ceSoir
                        ? majuscule(natureEtHoraire(data.ceSoir))
                        : 'Aucune garde enregistrée'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="fen-close"
                    aria-label="Refermer la fenêtre"
                    onClick={() => setOuverte(null)}
                  >
                    ✕
                  </button>
                </header>
                <div className="fen-body">
                  {data.ceSoir ? (
                    <>
                      <p className="soir-date">{majuscule(dateLongue(data.ceSoir.date))}</p>
                      {data.ceSoir.premier && (
                        <CarteGarde
                          prenom={data.ceSoir.premier.prenom}
                          couleur={data.ceSoir.premier.couleur}
                          rang="1ʳᵉ de garde"
                          mission="prend les appels"
                        />
                      )}
                      {data.ceSoir.second && (
                        <CarteGarde
                          prenom={data.ceSoir.second.prenom}
                          couleur={data.ceSoir.second.couleur}
                          rang="2ᵈ de garde"
                          mission="en renfort"
                        />
                      )}
                      {data.demain && <Demain garde={data.demain} />}
                    </>
                  ) : (
                    <p className="f-vide">
                      Aucune garde n&apos;est enregistrée pour ce soir. Soit la période n&apos;est pas
                      encore générée, soit la date sort des périodes connues.
                    </p>
                  )}
                </div>
                <footer className="fen-foot">
                  <Link className="btn btn-ghost" href="/planning">
                    Voir sur le planning
                  </Link>
                  <span className="hint">Échap pour refermer</span>
                </footer>
              </article>

              {/* ===== Fenêtre · souhaits en attente ===== */}
              {data.estAdmin && (
                <article
                  className={`fen${ouverte === 'souhaits' ? ' active' : ''}`}
                  role="region"
                  aria-label="Souhaits de congé en attente"
                >
                  <header className="fen-head">
                    <span className="f-ico" aria-hidden="true">
                      ⏳
                    </span>
                    <div className="f-titles">
                      <h2 tabIndex={-1}>
                        Souhaits de congé · {nbSouhaits} en attente
                      </h2>
                      <p className="f-sub">Par ordre d&apos;arrivée, du plus ancien au plus récent</p>
                    </div>
                    <button
                      type="button"
                      className="fen-close"
                      aria-label="Refermer la fenêtre"
                      onClick={() => setOuverte(null)}
                    >
                      ✕
                    </button>
                  </header>
                  <div className="fen-body">
                    {data.souhaits.map((s) => (
                      <div className="souhait-row" key={s.id}>
                        <span className="vdot" style={{ background: s.couleur }} aria-hidden="true">
                          {initiale(s.prenom)}
                        </span>
                        <span className="s-what">
                          <b>{s.prenom}</b> ·{' '}
                          {s.dateDebut === s.dateFin
                            ? dateCourte(s.dateDebut)
                            : `${dateCourte(s.dateDebut)} → ${dateCourte(s.dateFin)}`}
                          <span className="s-flag">Déposé {anciennete(s.depose)}</span>
                        </span>
                      </div>
                    ))}
                    {nbSouhaits === 0 && (
                      <p className="f-vide">Aucun souhait de congé n&apos;attend de décision.</p>
                    )}
                  </div>
                  <footer className="fen-foot">
                    <Link className="btn btn-valider" href="/conges">
                      Traiter dans Congés →
                    </Link>
                    <span className="hint">Échap pour refermer</span>
                  </footer>
                </article>
              )}

              {/* ===== Fenêtre · préparer la période suivante ===== */}
              {data.estAdmin && data.recapPeriode && (
                <article
                  className={`fen${ouverte === 'periode' ? ' active' : ''}`}
                  role="region"
                  aria-label="Préparer la période suivante"
                >
                  <header className="fen-head">
                    <span className="f-ico" aria-hidden="true">
                      🌱
                    </span>
                    <div className="f-titles">
                      <h2 tabIndex={-1}>Période · {data.recapPeriode.libelle}</h2>
                      <p className="f-sub">
                        {data.recapPeriode.statut === 'brouillon'
                          ? 'Encore en brouillon · rien n’est parti chez l’équipe'
                          : 'Récap de la période'}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="fen-close"
                      aria-label="Refermer la fenêtre"
                      onClick={() => setOuverte(null)}
                    >
                      ✕
                    </button>
                  </header>
                  <div className="fen-body">
                    <div className="recap-grid">
                      <div className="recap-chip hero">
                        {data.recapPeriode.saison === 'ete' ? '☀️' : '❄️'}{' '}
                        {data.recapPeriode.nbSemaines} semaines · du{' '}
                        {dateCourte(data.recapPeriode.dateDebut)} au{' '}
                        {dateCourte(data.recapPeriode.dateFin)}
                        <small>
                          {data.recapPeriode.profil
                            ? `profil « ${data.recapPeriode.profil} »`
                            : 'profil par défaut du cabinet'}
                        </small>
                      </div>
                      <div className="recap-chip">
                        {data.recapPeriode.nbVetos} vétérinaires
                        <small>actifs au cabinet</small>
                      </div>
                      <div className="recap-chip">
                        Effectif de nuit
                        <small>
                          {data.recapPeriode.effectifNuitSemaine
                            ? `${data.recapPeriode.effectifNuitSemaine} véto${data.recapPeriode.effectifNuitSemaine > 1 ? 's' : ''} par nuit de semaine`
                            : 'selon la saison'}
                        </small>
                      </div>
                      <div className="recap-chip">
                        {data.recapPeriode.nbReglesFermes} règles fermes
                        <small>toutes actives</small>
                      </div>
                      <div className="recap-chip">
                        {data.recapPeriode.nbReglesSouples} préférences
                        <small>règles souples actives</small>
                      </div>
                      <div className="recap-chip">
                        {data.recapPeriode.nbCongesValides} congés validés
                        <small>qui tombent dans la période</small>
                      </div>
                      <div className="recap-chip">
                        Préavis d&apos;un mois
                        <small>
                          publication à prévoir avant le{' '}
                          {dateCourte(data.recapPeriode.limitePublication)}
                        </small>
                      </div>
                    </div>
                    {nbSouhaits > 0 && (
                      <div className="f-note">
                        <span className="who">🦊 Filou signale</span>
                        {nbSouhaits} souhait{nbSouhaits > 1 ? 's' : ''} de congé{' '}
                        {nbSouhaits > 1 ? 'attendent' : 'attend'} encore une décision. Générer
                        maintenant, c&apos;est prendre le risque de régénérer après coup.
                      </div>
                    )}
                  </div>
                  <footer className="fen-foot">
                    <Link className="btn btn-valider" href="/planning">
                      Continuer sur le planning →
                    </Link>
                    <span className="hint">Échap pour refermer</span>
                  </footer>
                </article>
              )}

              {/* ===== Fenêtre · vérification du planning ===== */}
              {data.estAdmin && (
                <article
                  className={`fen${ouverte === 'coherence' ? ' active' : ''}`}
                  role="region"
                  aria-label="Vérification du planning"
                >
                  <header className="fen-head">
                    <span className="f-ico" aria-hidden="true">
                      🛡
                    </span>
                    <div className="f-titles">
                      <h2 tabIndex={-1}>Vérification continue du planning</h2>
                      <p className="f-sub">
                        Le validateur indépendant repasse après chaque changement
                      </p>
                    </div>
                    <button
                      type="button"
                      className="fen-close"
                      aria-label="Refermer la fenêtre"
                      onClick={() => setOuverte(null)}
                    >
                      ✕
                    </button>
                  </header>
                  <div className="fen-body">
                    {verdict.etat === 'attente' && (
                      <p className="f-vide">Vérification en cours…</p>
                    )}
                    {verdict.etat === 'sans-objet' && (
                      <p className="f-vide">
                        Aucune période publiée en cours : il n&apos;y a rien à re-vérifier pour le
                        moment.
                      </p>
                    )}
                    {verdict.etat === 'ok' && verdict.violations.length === 0 && (
                      <div className="check-row">
                        <span className="ck ok">✓</span>
                        <span>
                          <b>Aucune règle ferme enfreinte</b> sur{' '}
                          {data.periodesPubliees.length === 1
                            ? 'la période publiée'
                            : `les ${data.periodesPubliees.length} périodes publiées`}{' '}
                          en cours.
                        </span>
                      </div>
                    )}
                    {verdict.etat === 'ok' &&
                      verdict.violations.map((v, i) => (
                        <div className="check-row" key={`${v.regle}-${v.date}-${i}`}>
                          <span className="ck warn">⚠</span>
                          <span>
                            <b>{v.regle}</b> · {dateCourte(v.date)} — {v.detail}
                          </span>
                        </div>
                      ))}
                    <div className="f-note">
                      <span className="who">🦊 Filou veille</span>
                      Le validateur est <b>indépendant du moteur</b> : il ne rejoue pas le
                      raisonnement qui a construit le planning, il le recontrôle à froid. C&apos;est
                      ce qui lui permet d&apos;attraper une erreur du moteur lui-même.
                    </div>
                  </div>
                  <footer className="fen-foot">
                    <Link className="btn btn-ghost" href="/planning">
                      Ouvrir le planning
                    </Link>
                    <span className="hint">Échap pour refermer</span>
                  </footer>
                </article>
              )}

              {/* ===== Fenêtre · ce que Filou a compris ===== */}
              {resultatFilou && (
                <FenetreResultatFilou
                  key={resultatFilou.id}
                  actif={ouverte === 'filou'}
                  resultat={resultatFilou}
                  onFermer={() => setOuverte(null)}
                  onDecision={deciderResultat}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Fragments ───────────────────────────────────────────────

function aujourdhui() {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date())
}

/** Le relais du lendemain. Deux pièges évités : l'accord du verbe quand un
 *  seul véto est de garde, et la garde SANS titulaire — `data.demain` peut
 *  exister avec ses deux places vides, et la phrase devenait alors
 *  « Demain :  prennent le relais », soit une coquille vide affirmative. */
function Demain({ garde }: { garde: GardeDuSoir }) {
  const noms = prenomsDe(garde)
  return (
    <div className="demain">
      <span aria-hidden="true">🔭</span>
      <span>
        <b>Demain :</b>{' '}
        {noms.length > 0 ? (
          <>
            {noms.join(' et ')} {accord(noms.length, 'prend', 'prennent')} le relais (
            {garde.nature}).
          </>
        ) : (
          <>personne n&apos;est encore inscrit ({garde.nature}).</>
        )}
      </span>
    </div>
  )
}

/** Une personne de garde : qui, à quel rang, et ce qu'elle fait.
 *  Pas d'horaire ici — les deux vétos d'un même créneau ont le même, et il est
 *  déjà écrit dans l'en-tête de la fenêtre. Le répéter par personne écrasait le
 *  nom sur quatre lignes en colonne étroite. */
function CarteGarde({
  prenom,
  couleur,
  rang,
  mission,
}: {
  prenom: string
  couleur: string
  rang: string
  mission: string
}) {
  return (
    <div className="garde-card">
      <span className="big-dot" style={{ background: couleur }} aria-hidden="true">
        {initiale(prenom)}
      </span>
      <div className="g-qui">
        <p className="g-name">{prenom}</p>
        <p className="g-role">{rang}</p>
      </div>
      <p className="g-mission">{mission}</p>
    </div>
  )
}

function FicheCeSoir({ garde, onOpen }: { garde: GardeDuSoir | null; onOpen: () => void }) {
  // Une garde peut exister avec ses deux places vides : ce n'est pas la meme
  // chose qu'aucune garde, mais ca s'annonce pareil — sans nom a montrer.
  if (!garde || prenomsDe(garde).length === 0) {
    return (
      <button type="button" className="widget" onClick={onOpen}>
        <span className="w-ico" aria-hidden="true">
          🌙
        </span>
        <span className="w-body">
          <h3>Ce soir : personne d&apos;enregistré</h3>
          <p>Aucune garde n&apos;est posée sur cette date</p>
        </span>
        <span className="w-go" aria-hidden="true">
          →
        </span>
      </button>
    )
  }
  const noms = prenomsDe(garde).join(' & ')  // titre : l'esperluette passe bien
  return (
    <button type="button" className="widget" onClick={onOpen}>
      <span className="w-ico" aria-hidden="true">
        🌙
      </span>
      <span className="w-body">
        <h3>Ce soir : {noms}</h3>
        <p>{majuscule(natureEtHoraire(garde))}</p>
        <span className="w-duo" aria-hidden="true">
          {garde.premier && (
            <span className="vdot" style={{ background: garde.premier.couleur }}>
              {initiale(garde.premier.prenom)}
            </span>
          )}
          {garde.second && (
            <span className="vdot" style={{ background: garde.second.couleur }}>
              {initiale(garde.second.prenom)}
            </span>
          )}
        </span>
      </span>
      <span className="w-go" aria-hidden="true">
        →
      </span>
    </button>
  )
}

function FicheCoherence({
  verdict,
  onOpen,
}: {
  verdict: { etat: 'attente' } | { etat: 'sans-objet' } | { etat: 'ok'; violations: ViolationRevalidation[] }
  onOpen: () => void
}) {
  const sain = verdict.etat === 'ok' && verdict.violations.length === 0
  return (
    <button type="button" className={`widget${sain ? ' w-ok' : ''}`} onClick={onOpen}>
      <span className="w-ico" aria-hidden="true">
        {verdict.etat === 'ok' ? (sain ? '✓' : '⚠') : '…'}
      </span>
      <span className="w-body">
        <h3>
          {verdict.etat === 'attente' && 'Vérification du planning en cours'}
          {verdict.etat === 'sans-objet' && 'Rien à vérifier'}
          {verdict.etat === 'ok' &&
            (sain
              ? 'Planning cohérent'
              : `${verdict.violations.length} règle${verdict.violations.length > 1 ? 's' : ''} enfreinte${verdict.violations.length > 1 ? 's' : ''}`)}
        </h3>
        <p>
          {verdict.etat === 'attente' && 'Le validateur indépendant est en train de repasser'}
          {verdict.etat === 'sans-objet' && 'Aucune période publiée en cours'}
          {verdict.etat === 'ok' &&
            (sain
              ? 'Vérifié à l’instant · 0 règle ferme enfreinte'
              : 'À regarder avant que ça gêne quelqu’un')}
        </p>
      </span>
      <span className="w-go" aria-hidden="true">
        →
      </span>
    </button>
  )
}

/** Le mot d'accueil : ce que Filou a réellement trouvé, pas une formule. */
function MotDAccueil({ data }: { data: DonneesAccueil }) {
  const phrases: string[] = []

  const nomsCeSoir = data.ceSoir ? prenomsDe(data.ceSoir) : []
  if (nomsCeSoir.length > 0) {
    // L'accord suit le NOMBRE DE NOMS, pas la presence d'un second : une garde
    // ou seule la 2e place est pourvue existe, et « Jean sont de garde » aussi.
    phrases.push(
      `Ce soir, ${nomsCeSoir.join(' et ')} ${accord(nomsCeSoir.length, 'est', 'sont')} de garde.`,
    )
  } else if (data.ceSoir) {
    phrases.push("La garde de ce soir n'a encore personne d'inscrit.")
  } else {
    phrases.push("Je ne vois aucune garde posée pour ce soir.")
  }

  if (data.estAdmin) {
    const n = data.souhaits.length
    if (n > 0) {
      phrases.push(
        `${n} souhait${n > 1 ? 's' : ''} de congé ${n > 1 ? 'attendent' : 'attend'} ta décision.`,
      )
    }
    if (data.joursAvantPublication !== null && data.recapPeriode) {
      phrases.push(
        data.joursAvantPublication > 0
          ? `Il te reste ${data.joursAvantPublication} ${accord(data.joursAvantPublication, 'jour', 'jours')} pour publier ${data.recapPeriode.libelle}.`
          : `${data.recapPeriode.libelle} aurait dû être publiée : le préavis d'un mois est dépassé.`,
      )
    }
  }

  return (
    <div className="msg filou">
      <span className="m-ava" aria-hidden="true">
        🦊
      </span>
      <div className="bubble">
        <span className="vh">Filou : </span>
        Bonjour {data.veterinaire.prenom}. {phrases.join(' ')}
      </div>
    </div>
  )
}
