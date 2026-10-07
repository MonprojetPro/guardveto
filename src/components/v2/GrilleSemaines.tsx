'use client'

// ============================================================
// GUARDVETO V2 — La grille en semaines (concept 3a)
// ============================================================
// B-145 lots 2b+2c, fusionnés par MiKL le 07/10 : « option A », le design
// arrive entier. Portage du concept 3a arrêté avec Claude Design le 06/10.
//
// 🔴 POURQUOI UN FICHIER À PART, et pas 400 lignes de plus dans `PlanningV2`.
//    Ce composant ne décide RIEN : il dessine ce que `lib/planning/grilleSemaines`
//    a composé. Les deux responsabilités séparées, la logique devient testable
//    (35 cas) — et sur ce projet, c'est la seule vérification possible : aucun
//    test ne monte un composant React (B-144b). Mélangées, elles seraient
//    vérifiables uniquement à l'œil, c'est-à-dire pas vérifiées.
//
// ── CE QUI TIENT L'ALIGNEMENT ───────────────────────────────────────────────
//
// La marge des prénoms et les 7 cases sont des colonnes sœurs d'une grille CSS.
// Chacune empile EXACTEMENT les mêmes hauteurs dans le même ordre : en-tête,
// titres, « à pourvoir », puis une ligne par personne — y compris vide. C'est
// pour ça que `lignesDeLaSemaine` rend des lignes vides au lieu de les omettre.
// Un planning décalé d'un cran se lit sans qu'on le soupçonne, et on y lit la
// garde du voisin.
//
// ── CE QUI A ÉTÉ CONSERVÉ, ET POURQUOI ──────────────────────────────────────
//
// Les cadenas (B-111) restent, bornés aux gardes — « pour le planning jour pas
// besoin » (MiKL, 06/10). Le clic sur une garde ouvre toujours `GardeDetailModal`,
// qui porte la réattribution et ses contrôles : on ne réécrit pas des règles
// métier pour un changement d'habillage.
// ============================================================

import { estJourFerie } from '@/engine/utils'
import { stylePoint } from '@/lib/couleurs'
import {
  lignesCaseRepliee,
  lignesDeLaSemaine,
  semaineASignaler,
  type AxeContenu,
  type GardeGrille,
  type PersonneGrille,
  type RailBornes,
} from '@/lib/planning/grilleSemaines'
import { heureCourte, type JourneeAffichee } from '@/lib/planning/presencesDuJour'
import { visibilite } from '@/lib/planning/grilleSemaines'

/** Tout ce que la grille sait d'un jour. */
export interface JourGrille {
  date: string
  /** Le jour sort du mois affiché (semaine à cheval). */
  horsMois: boolean
  /** Le jour sort des bornes de la période affichée. */
  horsPeriode: boolean
  gardes: GardeGrille[]
  journee?: JourneeAffichee
  absences: { vetId: string | null; prenom: string; statut: string }[]
  /** Nom des vacances scolaires couvrant ce jour, ou null. */
  vacances: string | null
}

export interface ProprietesGrille {
  semaines: JourGrille[][]
  equipe: PersonneGrille[]
  rail: RailBornes
  contenu: AxeContenu
  /** Index des semaines dépliées. Vide = tout replié. */
  depliees: ReadonlySet<number>
  onBasculerSemaine: (index: number) => void
  today: string
  /** La personne survolée, pour éclairer sa ligne d'un bout à l'autre. */
  survol: string | null
  onSurvol: (vetId: string | null) => void
  /** Ouvre le détail d'une garde (réattribution, échange). */
  onOuvrirGarde: (gardeId: string) => void
  /** Ouvre la cellule d'une personne un jour donné (poser / retirer). */
  onOuvrirCellule?: (date: string, vetId: string) => void
  /** Ouvre le détail « Au cabinet » d un jour — le SEUL chemin en vue repliée. */
  onOuvrirJournee?: (date: string) => void
  /** Les personnes dont la garde est figée par un cadenas, par garde. */
  vetsFiges: (gardeId: string) => ReadonlySet<string>
  /**
   * B-111 — le bouton qui POSE ou LÈVE un cadenas, rendu par l'appelant.
   *
   * ⚠️ RENDU PAR L'APPELANT, et pas importé ici. `BoutonCadenas` porte son
   *    propre appel serveur et son `onFini` ; le faire traverser cette grille
   *    y ferait entrer une action, alors que ce composant ne fait que dessiner.
   *
   * 🔴 SANS LUI, LA REFONTE AURAIT ÉTÉ UNE RÉGRESSION. La première version de
   *    cette grille affichait l'ÉTAT du cadenas (l'anneau) sans permettre de le
   *    poser : un verrou qu'on voit et qu'on ne peut plus tourner. MiKL avait
   *    pourtant tranché le 06/10 — « on rajoute évidemment les cadenas pour les
   *    gardes ». Trouvé à la revue, pas par un test : aucun test ne monte un
   *    composant (B-144b).
   *
   * `undefined` = les cadenas n'ont pas lieu d'être (pas admin, ou planning qui
   * n'est plus un brouillon) et la colonne Nuit garde sa largeur d'origine.
   */
  rendreCadenas?: (garde: GardeGrille, vetId: string, fige: boolean) => React.ReactNode
  /**
   * B-111 — le pré-remplissage d'un jour SANS aucune garde.
   *
   * Avant génération, une période n'a aucune garde : sans ce bouton, il
   * n'existerait aucun endroit où cliquer pour fixer une date à l'avance, et la
   * moitié de la demande resterait inatteignable.
   */
  rendrePoseJourVide?: (date: string) => React.ReactNode
}

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

/** Le numéro de semaine ISO — le même repère que les trames de présence. */
function numeroSemaine(iso: string): number {
  const d = new Date(iso + 'T12:00:00Z')
  const jour = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - jour + 3)
  const premierJeudi = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const decalage = (premierJeudi.getUTCDay() + 6) % 7
  premierJeudi.setUTCDate(premierJeudi.getUTCDate() - decalage + 3)
  return 1 + Math.round((d.getTime() - premierJeudi.getTime()) / (7 * 86400000))
}

export function GrilleSemaines({
  semaines,
  equipe,
  rail,
  contenu,
  depliees,
  onBasculerSemaine,
  today,
  survol,
  onSurvol,
  onOuvrirGarde,
  onOuvrirCellule,
  onOuvrirJournee,
  vetsFiges,
  rendreCadenas,
  rendrePoseJourVide,
}: ProprietesGrille) {
  const vue = visibilite(contenu)

  return (
    <div className="cal-sem-wrap">
      {/* 🔴 L'EN-TÊTE DES JOURS, qui avait disparu au premier jet du portage.
          Sans elle, la seule façon de savoir qu'une colonne est le mercredi est
          de lire le numéro du jour et de compter — sur un écran dont c'est la
          question première. Trouvé à la revue : `JOURS` était resté défini et
          n'était plus utilisé nulle part, et rien d'autre ne l'aurait signalé. */}
      <div className="sem-entete" aria-hidden="true">
        <div />
        {JOURS.map((j) => (
          <span key={j}>{j}</span>
        ))}
      </div>

      {semaines.map((jours, index) => {
        const depliee = depliees.has(index)
        const trous = semaineASignaler(jours, vue.gardesVisibles)

        return (
          <div
            key={jours[0]?.date ?? index}
            className={depliee ? 'sem depliee' : 'sem repliee'}
            onClick={depliee ? undefined : () => onBasculerSemaine(index)}
          >
            <MargeSemaine
              numero={numeroSemaine(jours[0]?.date ?? today)}
              trous={trous}
              depliee={depliee}
              equipe={equipe}
              gardesVisibles={vue.gardesVisibles}
              survol={survol}
              onSurvol={onSurvol}
              onBasculer={() => onBasculerSemaine(index)}
            />

            {jours.map((jour) => (
              <CaseJour
                key={jour.date}
                jour={jour}
                depliee={depliee}
                equipe={equipe}
                rail={rail}
                vue={vue}
                today={today}
                survol={survol}
                onSurvol={onSurvol}
                onOuvrirGarde={onOuvrirGarde}
                onOuvrirCellule={onOuvrirCellule}
                onOuvrirJournee={onOuvrirJournee}
                vetsFiges={vetsFiges}
                rendreCadenas={rendreCadenas}
                rendrePoseJourVide={rendrePoseJourVide}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

/** La colonne de gauche : le numéro de semaine, puis les prénoms. */
function MargeSemaine({
  numero,
  trous,
  depliee,
  equipe,
  gardesVisibles,
  survol,
  onSurvol,
  onBasculer,
}: {
  numero: number
  trous: number
  depliee: boolean
  equipe: PersonneGrille[]
  gardesVisibles: boolean
  survol: string | null
  onSurvol: (vetId: string | null) => void
  onBasculer: () => void
}) {
  return (
    <div className="sem-marge">
      <button
        type="button"
        className="sem-lbl"
        onClick={(e) => {
          e.stopPropagation()
          onBasculer()
        }}
        aria-expanded={depliee}
        aria-label={`Semaine ${numero}${trous > 0 ? ` · ${trous} place${trous > 1 ? 's' : ''} à pourvoir` : ''}`}
      >
        S{numero}
        {/* Le SEUL repère d'une semaine repliée : sans lui, replier le mois
            cacherait les trous, et « replié » se lirait « rien à voir ». */}
        {trous > 0 && <span className="sem-flag" aria-hidden="true" />}
      </button>

      {depliee && (
        <>
          <div className="sem-marge-espace" aria-hidden="true" />
          {gardesVisibles && (
            <div className={trous > 0 ? 'sem-marge-pourvoir actif' : 'sem-marge-pourvoir'}>
              À pourvoir
              {trous > 0 && <span className="smp-n">{trous}</span>}
            </div>
          )}
          {equipe.map((v) => (
            <div
              key={v.id}
              className={survol === v.id ? 'sem-prenom survol' : 'sem-prenom'}
              onMouseEnter={() => onSurvol(v.id)}
              onMouseLeave={() => onSurvol(null)}
            >
              <span className="vdot" style={stylePoint(v.couleur)} aria-hidden="true" />
              {v.prenom}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function CaseJour({
  jour,
  depliee,
  equipe,
  rail,
  vue,
  today,
  survol,
  onSurvol,
  onOuvrirGarde,
  onOuvrirCellule,
  onOuvrirJournee,
  vetsFiges,
  rendreCadenas,
  rendrePoseJourVide,
}: {
  jour: JourGrille
  depliee: boolean
  equipe: PersonneGrille[]
  rail: RailBornes
  vue: { gardesVisibles: boolean; journeeVisible: boolean }
  today: string
  survol: string | null
  onSurvol: (vetId: string | null) => void
  onOuvrirGarde: (gardeId: string) => void
  onOuvrirCellule?: (date: string, vetId: string) => void
  onOuvrirJournee?: (date: string) => void
  vetsFiges: (gardeId: string) => ReadonlySet<string>
  rendreCadenas?: (garde: GardeGrille, vetId: string, fige: boolean) => React.ReactNode
  rendrePoseJourVide?: (date: string) => React.ReactNode
}) {
  const d = new Date(jour.date + 'T12:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7
  const ferie = estJourFerie(jour.date)

  const classes = ['jour']
  if (dow >= 5) classes.push('we')
  if (jour.horsMois) classes.push('other')
  if (jour.date < today) classes.push('past')
  if (jour.date === today) classes.push('today')
  if (jour.horsPeriode) classes.push('hors')
  if (jour.vacances) classes.push('vac')

  const trous = vue.gardesVisibles ? jour.gardes.reduce((s, g) => s + g.manque, 0) : 0
  const aSignaler = trous > 0

  return (
    <div className={classes.join(' ')} data-date={jour.date} title={jour.vacances ?? undefined}>
      <div className="jour-tete">
        <span className="jt-num">{d.getUTCDate()}</span>
        {ferie && <span className="jt-ferie">Férié</span>}
        {aSignaler && <span className="jt-flag" aria-hidden="true" />}
      </div>

      {!depliee
        ? lignesCaseRepliee(jour, vue).map((l, i) => {
            // 🔴 LA LIGNE « N PRÉSENTS » OUVRE LA FENÊTRE DE DÉTAIL, et c'est
            //    le seul chemin vers elle en vue repliée. Au premier jet du
            //    portage, l'ancienne case a été retirée avec son bouton : la
            //    fenêtre livrée le matin même (lot 2a, arbitrage ④ de MiKL)
            //    était encore montée et PLUS ATTEIGNABLE. Trouvé en mesurant
            //    que la classe `jour-presents` n'était plus utilisée nulle
            //    part — exactement la famille de défauts de ce chantier : une
            //    moitié de chaîne qui survit à la refonte, l'autre non.
            const ouvrable = l.genre === 'presents' && Boolean(onOuvrirJournee)
            const contenu = (
              <>
                {l.etiquette && <span className="jr-etq">{l.etiquette}</span>}
                {l.genre === 'presents' && (
                  <>
                    <span className="jr-n">{l.nombre}</span>
                    <span className="jr-sub">{l.nombre === 1 ? 'présent' : 'présents'}</span>
                  </>
                )}
                {l.genre === 'pourvoir' && <span className="jr-n">{l.nombre}</span>}
                {l.pastilles.map((p, j) => (
                  <span
                    key={`${p.texte}-${j}`}
                    className={p.creux ? 'jr-chip creux' : 'jr-chip'}
                    style={p.couleur ? { color: p.couleur } : undefined}
                  >
                    {p.texte}
                  </span>
                ))}
              </>
            )

            return ouvrable ? (
              <button
                key={`${l.genre}-${i}`}
                type="button"
                className={`jr-ligne ${l.genre} ouvrable`}
                onClick={(e) => {
                  // La semaine repliée est elle-même cliquable : sans ça, le
                  // clic la déplierait au lieu d'ouvrir le détail.
                  e.stopPropagation()
                  onOuvrirJournee?.(jour.date)
                }}
                aria-label={`${l.nombre} présent${(l.nombre ?? 0) > 1 ? 's' : ''} — voir le détail`}
              >
                {contenu}
              </button>
            ) : (
              <div key={`${l.genre}-${i}`} className={`jr-ligne ${l.genre}`}>
                {contenu}
              </div>
            )
          })
        : (
          <CaseDepliee
            jour={jour}
            equipe={equipe}
            rail={rail}
            vue={vue}
            trous={trous}
            survol={survol}
            onSurvol={onSurvol}
            onOuvrirGarde={onOuvrirGarde}
            onOuvrirCellule={onOuvrirCellule}
            vetsFiges={vetsFiges}
            rendreCadenas={rendreCadenas}
            rendrePoseJourVide={rendrePoseJourVide}
          />
        )}
    </div>
  )
}

/** Le dedans d'une case dépliée : titres, places à pourvoir, puis les lignes. */
function CaseDepliee({
  jour,
  equipe,
  rail,
  vue,
  trous,
  survol,
  onSurvol,
  onOuvrirGarde,
  onOuvrirCellule,
  vetsFiges,
  rendreCadenas,
  rendrePoseJourVide,
}: {
  jour: JourGrille
  equipe: PersonneGrille[]
  rail: RailBornes
  vue: { gardesVisibles: boolean; journeeVisible: boolean }
  trous: number
  survol: string | null
  onSurvol: (vetId: string | null) => void
  onOuvrirGarde: (gardeId: string) => void
  onOuvrirCellule?: (date: string, vetId: string) => void
  vetsFiges: (gardeId: string) => ReadonlySet<string>
  rendreCadenas?: (garde: GardeGrille, vetId: string, fige: boolean) => React.ReactNode
  rendrePoseJourVide?: (date: string) => React.ReactNode
}) {
  const lignes = lignesDeLaSemaine(equipe, jour, rail, vue)
  const gardeDuJour = jour.gardes[0] ?? null

  return (
    <>
      <div className="jd-titres" aria-hidden="true">
        {vue.journeeVisible && (
          <div className="jdt-journee">
            <span>Journée</span>
            <small>
              {heureCourte(minutesEnTime(rail.debut))}–{heureCourte(minutesEnTime(rail.fin))}
            </small>
          </div>
        )}
        {!vue.journeeVisible && <div className="jdt-journee" />}
        {vue.gardesVisibles && <div className="jdt-nuit">Nuit</div>}
      </div>

      {vue.gardesVisibles && (
        <div className="jd-pourvoir">
          <div className="jdp-piste">
            {/* B-111 — le pré-remplissage. Avant génération une période n'a
                AUCUNE garde : sans ce bouton, il n'existerait nulle part où
                cliquer pour fixer une date à l'avance. */}
            {jour.gardes.length === 0 && !jour.horsPeriode && rendrePoseJourVide?.(jour.date)}
          </div>
          <div className="jdp-nuit">
            {trous > 0 && gardeDuJour && (
              <button
                type="button"
                className="jdp-trou"
                onClick={() => onOuvrirGarde(gardeDuJour.id)}
                aria-label={`${trous} place${trous > 1 ? 's' : ''} à pourvoir — ouvrir`}
              >
                {trous > 1 ? `×${trous}` : '?'}
              </button>
            )}
          </div>
        </div>
      )}

      {lignes.map((ligne) => {
        const personne = equipe.find((v) => v.id === ligne.vetId)
        const couleur = personne?.couleur ?? null
        const garde = ligne.nuit
          ? jour.gardes.find((g) => g.places.some((p) => p.vetId === ligne.vetId))
          : undefined
        const figee = garde ? vetsFiges(garde.id).has(ligne.vetId) : false

        const pisteClasses = ['jd-piste']
        if (ligne.absence === 'valide') pisteClasses.push('conge')
        if (ligne.absence === 'souhait') pisteClasses.push('souhait')
        if (onOuvrirCellule && vue.journeeVisible) pisteClasses.push('cliquable')

        return (
          <div
            key={ligne.vetId}
            className={survol === ligne.vetId ? 'jd-rangee survol' : 'jd-rangee'}
            onMouseEnter={() => onSurvol(ligne.vetId)}
            onMouseLeave={() => onSurvol(null)}
          >
            <div
              className={pisteClasses.join(' ')}
              onClick={
                onOuvrirCellule && vue.journeeVisible
                  ? () => onOuvrirCellule(jour.date, ligne.vetId)
                  : undefined
              }
              role={onOuvrirCellule && vue.journeeVisible ? 'button' : undefined}
              tabIndex={onOuvrirCellule && vue.journeeVisible ? 0 : undefined}
              onKeyDown={
                onOuvrirCellule && vue.journeeVisible
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOuvrirCellule(jour.date, ligne.vetId)
                      }
                    }
                  : undefined
              }
              aria-label={libelleCellule(personne?.prenom ?? '', ligne)}
            >
              {vue.journeeVisible && <span className="jd-mi" aria-hidden="true" />}

              {/* Le congé se LIT, il ne se devine pas à la hachure seule. */}
              {ligne.absence === 'valide' && ligne.journee.length === 0 && (
                <span className="jd-conge-txt">congé</span>
              )}

              {ligne.journee.map(({ presence, position }) =>
                position ? (
                  <span
                    key={presence.id}
                    className={presence.anomalie ? 'jd-barre anomalie' : 'jd-barre'}
                    style={{
                      left: `${position.gauche}%`,
                      width: `${position.largeur}%`,
                      background: teinte(couleur),
                      color: couleur ?? undefined,
                    }}
                    title={`${presence.tranche} ${presence.heures}${presence.anomalie ? ` · ${presence.anomalie}` : ''}`}
                  >
                    {presence.heures}
                  </span>
                ) : null,
              )}
            </div>

            {vue.gardesVisibles && (
              <div className={rendreCadenas ? 'jd-nuit avec-cadenas' : 'jd-nuit'}>
                {/* B-111 — le cadenas est À GAUCHE de la pastille. À droite, il
                    chevauchait le rôle (« 1er », « 2e ») dans une colonne
                    étroite — constaté par MiKL en recette le 04/09. */}
                {ligne.nuit && garde && rendreCadenas?.(garde, ligne.vetId, figee)}
                {ligne.nuit && garde && (
                  <button
                    type="button"
                    className={[
                      'jdn-pastille',
                      ligne.nuit.plusieursPlaces ? 'rang' : 'seul',
                      figee ? 'figee' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ background: couleur ?? 'var(--t-muted)' }}
                    onClick={() => onOuvrirGarde(garde.id)}
                    aria-label={`${personne?.prenom ?? ''} de garde${ligne.nuit.plusieursPlaces ? ` · ${ligne.nuit.role}` : ''}${figee ? ' · fixé par l’administratrice' : ''}`}
                  >
                    {ligne.nuit.plusieursPlaces ? ligne.nuit.role : ''}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

/** 480 → `08:00`. Sert uniquement à réafficher les bornes du rail. */
function minutesEnTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * La teinte d'une barre de présence.
 *
 * Volontairement PÂLE : une présence de journée n'a pas le même poids qu'une
 * garde, qui est l'information qu'on cherche en ouvrant le planning (B-047).
 * Une barre pleine ferait de la journée l'élément dominant de la case.
 */
function teinte(couleur: string | null): string {
  if (!couleur) return 'rgba(124, 106, 85, 0.30)'
  // `#RRGGBB` + alpha en hexadécimal : pas de conversion, pas d'arrondi.
  //
  // 🔴 `2E` (18 %) À LA RECETTE DU 07/10 — MiKL : « on voit rien ». Il avait
  //    raison, et la mesure le confirme : 18 % d'une couleur sur un fond crème
  //    ne fait pas une barre, ça fait une nuance. Monté à `4D` (30 %), avec un
  //    liseré à gauche qui marque le début de la tranche (CSS `jd-barre`).
  //
  // ⚠️ Pâle VOLONTAIREMENT, pas timidement : une présence de journée n'a pas
  //    le même poids qu'une garde, qui reste l'information qu'on cherche en
  //    ouvrant le planning (B-047). Une barre pleine ferait de la journée
  //    l'élément dominant. L'équilibre se règle ici, et nulle part ailleurs.
  return /^#[0-9a-f]{6}$/i.test(couleur) ? `${couleur}4D` : couleur
}

/** Ce qu'un lecteur d'écran entend sur une cellule — le visuel ne s'annonce pas. */
function libelleCellule(
  prenom: string,
  ligne: { journee: { presence: { tranche: string; heures: string } }[]; absence: string | null },
): string {
  const bouts: string[] = [prenom]
  if (ligne.absence === 'valide') bouts.push('congé')
  if (ligne.absence === 'souhait') bouts.push('souhait de congé, non tranché')
  for (const j of ligne.journee) bouts.push(`${j.presence.tranche} ${j.presence.heures}`)
  if (bouts.length === 1) bouts.push('rien ce jour-là')
  return bouts.join(' · ')
}
