'use client'

// ============================================================
// GUARDVETO — La grille « Planning Cabinet V2 » (B-153 lot 1)
// ============================================================
// Le prototype arrete avec Claude Design le 08/10 se decrit lui-meme :
// « Renouveau visuel de 3a · meme structure, meme palette ». Ce fichier est
// donc le PORTAGE VISUEL de `GrilleSemaines` (B-145), pas une refonte : la
// logique est inchangee et vit toujours dans `lib/planning/grilleSemaines`.
//
// 🔴 IL VIT SOUS `components/chantier/`, ET CE N'EST PAS UN DETAIL DE RANGEMENT.
//    C'est la convention que `tests/lib/chantier-restreint.test.ts` fait
//    respecter : aucun fichier hors de ce dossier ne peut l'importer sans
//    consulter `chantierOuvert`. Le 08/10, un renouveau visuel est parti sur le
//    compte du client parce que RIEN NE POUVAIT L'EN EMPECHER (B-151) — le
//    dossier EST le garde-fou.
//
// ── CE QUE LE DESIGN V2 CHANGE, PAR RAPPORT A 3a ────────────────────────────
//
//  · UNE SEULE SURFACE. Les cases perdent leurs bordures ; la semaine ouverte
//    se CREUSE (fond plus soutenu, filet interieur) et ses jours s'y SOULEVENT
//    en blanc. C'est l'inverse de 3a, ou chaque case portait son propre cadre.
//  · LA GELULE PARTOUT. Pistes, pastilles, compteurs, barres : un seul rayon.
//  · UNE HIERARCHIE DE LECTURE. Le nombre de presents en grand (Figtree 800),
//    les noms en petites pastilles, les libelles en capitales espacees.
//  · LA COLONNE NUIT devient un COULOIR arrronde, dessine en fond de case.
//  · UNE LIGNE « PRESENTS » ferme la case depliee, avec deux compteurs.
//
// ── CE QUI EST VOLONTAIREMENT ABSENT DU PORTAGE ─────────────────────────────
//
// 🔴 LES MINIMUMS D'EFFECTIF. Le prototype montre « 5 presents » et « mat. 2/3 »
//    en rouge, avec une legende « Sous le minimum ». CETTE DONNEE N'EXISTE PAS :
//    aucune colonne au schema ne porte un effectif minimum, et MiKL l'a
//    explicitement ecartee le 06/10. La porter demanderait de l'INVENTER, ce qui
//    ferait de ce dessin un juge sans regle — « ne jamais afficher un parametre
//    que le moteur n'evalue pas ». Les compteurs sont donc neutres.
//
//  · « Mettre en avant » (le focus par personne) etait annonce au LOT 3. Il est
//    LIVRE depuis le 09/10 (B-157a), MiKL l'ayant demande a la recette : c'est
//    le survol EPINGLE, pas un second mecanisme — la ligne s'eclaire comme au
//    survol, et tout le reste s'estompe.
//
// ── CE QUI TIENT L'ALIGNEMENT (inchange, et toujours vital) ─────────────────
//
// La marge des prenoms et les 7 cases sont des colonnes sœurs d'une meme grille
// CSS, qui empilent EXACTEMENT les memes hauteurs — et le meme CHASSIS (padding
// et bordure), faute de quoi l'ecart s'accumule ligne apres ligne. C'est le
// defaut B-145c, paye une fois : 18px de derive a la 7e ligne, pour des lignes
// de 20px, donc on lisait la garde du voisin. `grille-alignement-css-v2.test.ts`
// le verrouille ; `lignesDeLaSemaine` rend une ligne par personne MEME VIDE.
// ============================================================

import { estJourFerie } from '@/engine/utils'
import { stylePoint } from '@/lib/couleurs'
import {
  effectifsDemiJournee,
  lignesCaseRepliee,
  lignesDeLaSemaine,
  semaineASignaler,
  visibilite,
  type AxeContenu,
  type GardeGrille,
  type PersonneGrille,
  type RailBornes,
} from '@/lib/planning/grilleSemaines'
import type { JourneeAffichee } from '@/lib/planning/presencesDuJour'

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
  /**
   * B-157a — `survol` vient-il d'un choix ÉPINGLÉ (« Mettre en avant ») plutôt
   * que de la souris ? Un éclairage de survol est fugace : il peut rester
   * discret. Un choix délibéré, lui, doit se voir — on estompe alors tout ce
   * qui n'est pas la personne retenue, faute de quoi le filtre ne filtre rien
   * et devient le bouton décoratif que le KIT COMPLET interdit.
   */
  epingleSur?: string | null
  /** B-157b — un clic sur un prénom de la marge épingle ou désépingle. */
  onEpingler?: (vetId: string) => void
  /**
   * Le PRÉNOM de la personne mise en avant, pour les semaines REPLIÉES.
   *
   * ⚠️ POURQUOI UN PRÉNOM ET PAS UN IDENTIFIANT : une case repliée n'affiche
   * pas de ligne par personne, mais des pastilles — et `lignesCaseRepliee`, qui
   * les fabrique, ne porte QUE le texte et la couleur. Elle vit dans
   * `lib/planning/grilleSemaines.ts`, **partagé avec l'écran du client** : y
   * ajouter un identifiant modifierait un fichier que ce chantier n'a pas le
   * droit de toucher (la leçon de B-157, payée le matin même). On compare donc
   * ce qui est AFFICHÉ. Sans ce détour, le filtre n'aurait aucun effet en vue
   * repliée — un demi-filtre, qui laisse croire qu'il n'y a rien à montrer.
   */
  prenomEnAvant?: string | null
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
   * 🔴 SANS LUI, LA REFONTE EST UNE RÉGRESSION, et c'est arrivé : la première
   *    version de B-145 affichait l'ÉTAT du cadenas sans permettre de le poser
   *    — un verrou qu'on voit et qu'on ne peut plus tourner, alors que MiKL
   *    avait tranché « on rajoute évidemment les cadenas ». Trouvé à la revue,
   *    par aucun test : aucun test ne monte un composant (B-144b).
   */
  rendreCadenas?: (garde: GardeGrille, vetId: string, fige: boolean) => React.ReactNode
  /**
   * B-111 — le pré-remplissage d'un jour SANS aucune garde. Avant génération,
   * une période n'en a aucune : sans ce bouton, il n'existerait nulle part où
   * cliquer pour fixer une date à l'avance.
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

export function GrilleSemainesV2({
  semaines,
  equipe,
  rail,
  contenu,
  depliees,
  onBasculerSemaine,
  today,
  survol,
  onSurvol,
  epingleSur = null,
  onEpingler,
  prenomEnAvant = null,
  onOuvrirGarde,
  onOuvrirCellule,
  onOuvrirJournee,
  vetsFiges,
  rendreCadenas,
  rendrePoseJourVide,
}: ProprietesGrille) {
  const vue = visibilite(contenu)

  return (
    <div className={epingleSur ? 'pv2-wrap pv2-epingle' : 'pv2-wrap'}>
      {/* 🔴 L'EN-TÊTE DES JOURS. Elle avait disparu au premier jet de B-145 :
          sans elle, savoir qu'une colonne est le mercredi demande de lire le
          numéro et de compter — sur l'écran dont c'est la question première. */}
      <div className="pv2-entete" aria-hidden="true">
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
            className={depliee ? 'pv2-sem depliee' : 'pv2-sem repliee'}
            onClick={depliee ? undefined : () => onBasculerSemaine(index)}
          >
            <MargeSemaine
              numero={numeroSemaine(jours[0]?.date ?? today)}
              trous={trous}
              depliee={depliee}
              equipe={equipe}
              vue={vue}
              survol={survol}
              onSurvol={onSurvol}
              epingleSur={epingleSur}
              onEpingler={onEpingler}
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
                prenomEnAvant={prenomEnAvant}
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
  vue,
  survol,
  onSurvol,
  epingleSur,
  onEpingler,
  onBasculer,
}: {
  numero: number
  trous: number
  depliee: boolean
  equipe: PersonneGrille[]
  vue: { gardesVisibles: boolean; journeeVisible: boolean }
  survol: string | null
  onSurvol: (vetId: string | null) => void
  epingleSur?: string | null
  onEpingler?: (vetId: string) => void
  onBasculer: () => void
}) {
  return (
    <div className={depliee ? 'pv2-marge depliee' : 'pv2-marge'}>
      <button
        type="button"
        className="pv2-sem-lbl"
        onClick={(e) => {
          e.stopPropagation()
          onBasculer()
        }}
        aria-expanded={depliee}
        aria-label={`Semaine ${numero}${trous > 0 ? ` · ${trous} place${trous > 1 ? 's' : ''} à pourvoir` : ''}`}
      >
        <span className="pv2-sem-num">S{numero}</span>
        {/* Le SEUL repère d'une semaine repliée : sans lui, replier le mois
            cacherait les trous, et « replié » se lirait « rien à voir ». */}
        {trous > 0 && <span className="pv2-sem-trous">{trous}</span>}
      </button>

      {depliee && (
        <>
          <div className="pv2-marge-espace" aria-hidden="true" />
          {vue.gardesVisibles && (
            <div className={trous > 0 ? 'pv2-marge-pourvoir actif' : 'pv2-marge-pourvoir'}>
              À pourvoir
            </div>
          )}
          {/* B-157b — LE PRÉNOM EST UN BOUTON, et c'est MiKL qui a eu raison.
              Le 09/10, un bandeau « Mettre en avant » recopiait ces mêmes
              prénoms en haut de l'écran : « mets plutôt la fonction
              directement sur les noms dans les colonnes du planning ». Un
              contrôle qui duplique une liste déjà affichée ajoute un endroit
              où chercher, pas une capacité — le geste va à la donnée.

              Le survol éclaire toujours (fugace), le CLIC épingle (persistant
              et il estompe le reste). Deuxième clic sur le même nom = retour à
              la normale, sinon le seul moyen d'en sortir serait de deviner. */}
          {equipe.map((v) => (
            <button
              key={v.id}
              type="button"
              className={survol === v.id ? 'pv2-prenom survol' : 'pv2-prenom'}
              aria-pressed={epingleSur === v.id}
              title={
                epingleSur === v.id
                  ? `Arrêter de mettre ${v.prenom} en avant`
                  : `Mettre ${v.prenom} en avant sur tout le planning`
              }
              onMouseEnter={() => onSurvol(v.id)}
              onMouseLeave={() => onSurvol(null)}
              onClick={(e) => {
                // La semaine dépliée ne se replie pas sous le clic : la marge
                // est dans la rangée-semaine, qui porte son propre onClick.
                e.stopPropagation()
                onEpingler?.(v.id)
              }}
            >
              <span className="pv2-dot" style={stylePoint(v.couleur)} aria-hidden="true" />
              <span className="pv2-prenom-txt">{v.prenom}</span>
            </button>
          ))}
          {vue.journeeVisible && <div className="pv2-marge-presents">Présents</div>}
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
  prenomEnAvant,
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
  prenomEnAvant?: string | null
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

  const classes = ['pv2-jour']
  if (depliee) classes.push('ouvert')
  if (dow >= 5) classes.push('we')
  if (jour.horsMois) classes.push('other')
  if (jour.date < today) classes.push('past')
  if (jour.date === today) classes.push('today')
  if (jour.horsPeriode) classes.push('hors')

  const trous = vue.gardesVisibles ? jour.gardes.reduce((s, g) => s + g.manque, 0) : 0

  return (
    <div className={classes.join(' ')} data-date={jour.date} title={jour.vacances ?? undefined}>
      {/* Le bandeau des vacances scolaires : un filet en haut de case, pas une
          teinte de fond — le fond porte déjà le week-end et le hors-mois. */}
      {jour.vacances && <span className="pv2-vac" aria-hidden="true" />}
      {/* Le couloir de nuit, dessiné EN FOND et non entre les lignes : c'est ce
          qui lui donne sa continuité verticale dans le design V2. */}
      {depliee && vue.gardesVisibles && <span className="pv2-couloir" aria-hidden="true" />}

      <div className="pv2-jour-tete">
        <span className={jour.date === today ? 'pv2-num aujourdhui' : 'pv2-num'}>
          {d.getUTCDate()}
        </span>
        {ferie && <span className="pv2-ferie">Férié</span>}
        <span className="pv2-tete-espace" />
        {trous > 0 && <span className="pv2-jour-flag" aria-hidden="true" />}
      </div>

      {!depliee ? (
        <CaseRepliee
          jour={jour}
          vue={vue}
          prenomEnAvant={prenomEnAvant}
          onOuvrirJournee={onOuvrirJournee}
        />
      ) : (
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

/**
 * B-159 ③ — resserre les lignes d'une case repliee (option « B », 11/10).
 *
 * Pure, et volontairement separee du rendu : c'est la seule forme qui se teste
 * sans monter un composant, et aucun test de ce projet n'en monte (B-144b).
 */
type LigneCompacte = ReturnType<typeof lignesCaseRepliee>[number] & {
  /** La liste complete, pour l'infobulle — les pastilles ne la portent plus. */
  resume?: string
}

function compacterLignes(
  lignes: ReturnType<typeof lignesCaseRepliee>,
): LigneCompacte[] {
  return lignes.map((l) => {
    if (l.genre === 'absents') {
      const n = l.pastilles.length
      // ⚠️ On repart des pastilles DEJA limitees par `lignesCaseRepliee` (qui
      //    resume au-dela de 3 par un « +N »). Le compte affiche peut donc
      //    etre inferieur au nombre reel d'absents — d'ou « au moins » dans
      //    l'infobulle, plutot qu'un chiffre qui se donnerait pour exact.
      const resume = l.pastilles.map((p) => p.texte).join(', ')
      return {
        ...l,
        etiquette: '',
        pastilles: [{ texte: n > 1 ? `${n} abs.` : '1 abs.', couleur: null, creux: true }],
        resume,
      }
    }
    if (l.genre === 'nuit') {
      // Deux noms entiers valent mieux que trois coupes.
      return l.pastilles.length <= 2
        ? l
        : {
            ...l,
            pastilles: [
              l.pastilles[0],
              { texte: `+${l.pastilles.length - 1}`, couleur: null, creux: true },
            ],
          }
    }
    return l
  })
}

/** Une case repliée : le chiffre en grand, puis les pastilles. */
function CaseRepliee({
  jour,
  vue,
  prenomEnAvant,
  onOuvrirJournee,
}: {
  jour: JourGrille
  vue: { gardesVisibles: boolean; journeeVisible: boolean }
  /** Voir `ProprietesGrille.prenomEnAvant` : on compare ce qui est AFFICHE. */
  prenomEnAvant?: string | null
  onOuvrirJournee?: (date: string) => void
}) {
  return (
    <>
      {/* B-159 ③ — LA CASE REPLIEE, VERSION « B » retenue par MiKL le 11/10.
          Avant : quatre lignes dans 96px, dont des prenoms COUPES EN PLEIN
          MILIEU (« Anne-S », « Jea »). Un nom tronque est pire qu'une absence
          de nom : il a l'air d'un nom et ne designe personne.

          Ce que la case repliee doit repondre, c'est « est-ce que ce jour va
          bien ? » — pas « qui est absent ? », qui se lit en depliant. Donc :
            · l'effectif reste en grand ;
            · les ABSENCES deviennent un simple compteur (« 2 abs. »), la liste
              passant au survol — plus aucune troncature ;
            · la NUIT garde ses prenoms mais n'en montre que DEUX, pour qu'ils
              tiennent en entier ;
            · « a pourvoir » ne sort que s'il manque reellement quelqu'un.

          ⚠️ LA TRANSFORMATION SE FAIT ICI, PAS DANS `lignesCaseRepliee` : cette
          fonction vit dans `lib/planning/grilleSemaines.ts`, partage avec
          l'ecran du client. On adapte sa SORTIE, on ne touche pas sa source. */}
      {compacterLignes(lignesCaseRepliee(jour, vue)).map((l, i) => {
        // 🔴 LA LIGNE « N PRÉSENTS » OUVRE LA FENÊTRE DE DÉTAIL, et c'est le
        //    seul chemin vers elle en vue repliée. Au premier jet de B-145, la
        //    fenêtre livrée le matin même était encore montée et PLUS
        //    ATTEIGNABLE — un chemin disparu, qu'aucun test ne voit.
        const ouvrable = l.genre === 'presents' && Boolean(onOuvrirJournee)
        const dedans = (
          /* `title` sur la ligne, pas sur la pastille : c'est la ligne entiere
             qu'on survole pour savoir QUI est absent, maintenant que le
             compteur a remplace les prenoms. */
          <span className="pv2-ligne-in" title={l.resume || undefined}>
            {l.etiquette && <span className="pv2-etq">{l.etiquette}</span>}
            {l.genre === 'presents' && (
              <>
                <span className="pv2-grand">{l.nombre}</span>
                <span className="pv2-sub">{l.nombre === 1 ? 'présent' : 'présents'}</span>
              </>
            )}
            {l.genre === 'pourvoir' && <span className="pv2-grand manque">{l.nombre}</span>}
            {l.pastilles.map((p, j) => (
              <span
                key={`${p.texte}-${j}`}
                className={[
                  'pv2-chip',
                  p.creux ? 'creux' : '',
                  // Rien d'attenue tant que personne n'est mis en avant.
                  prenomEnAvant && p.texte !== prenomEnAvant ? 'attenue' : '',
                ].filter(Boolean).join(' ')}
                style={p.couleur ? { color: p.couleur } : undefined}
              >
                {p.couleur && (
                  <span
                    className="pv2-chip-dot"
                    style={stylePoint(p.couleur)}
                    aria-hidden="true"
                  />
                )}
                {p.texte}
              </span>
            ))}
          </span>
        )

        return ouvrable ? (
          <button
            key={`${l.genre}-${i}`}
            type="button"
            className={`pv2-ligne ${l.genre} ouvrable`}
            onClick={(e) => {
              // La semaine repliée est elle-même cliquable : sans ça, le clic
              // la déplierait au lieu d'ouvrir le détail.
              e.stopPropagation()
              onOuvrirJournee?.(jour.date)
            }}
            aria-label={`${l.nombre} présent${(l.nombre ?? 0) > 1 ? 's' : ''} — voir le détail`}
          >
            {dedans}
          </button>
        ) : (
          <div key={`${l.genre}-${i}`} className={`pv2-ligne ${l.genre}`}>
            {dedans}
          </div>
        )
      })}
    </>
  )
}

/** Le dedans d'une case dépliée : titres, places à pourvoir, lignes, présents. */
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
  // B-159 ② — LA GARDE QUI PORTE LE TROU, pas la premiere du jour.
  //
  // `jour.gardes[0]` ouvrait le PREMIER creneau quoi qu'il arrive. Sur un jour
  // a plusieurs creneaux, le trou pouvait appartenir au second : la fenetre
  // s'ouvrait alors sur un creneau COMPLET, ou ne s'ouvrait pas du tout si ce
  // premier creneau n'etait pas cliquable. C'est ce que MiKL a vu le 11/10 —
  // « quand on clique sur le point d'interrogation il ne se passe rien ».
  // Repli sur la premiere garde : mieux vaut ouvrir le mauvais creneau que
  // rien, et `trous > 0` garantit qu'il y en a au moins un a pourvoir.
  const gardeDuJour = jour.gardes.find((g) => g.manque > 0) ?? jour.gardes[0] ?? null
  const effectifs = effectifsDemiJournee(lignes)
  const cliquable = Boolean(onOuvrirCellule) && vue.journeeVisible

  return (
    <>
      <div className="pv2-titres" aria-hidden="true">
        <div className="pv2-t-journee">
          {/* B-159 ① — LES BORNES DU RAIL SONT RETIRÉES, le 11/10 : « le 8h-18h
              n'a pas à être là, il bloque le visuel ».

              Elles répétaient dans CHAQUE case du mois une information qui ne
              change jamais — les horaires d'ouverture du cabinet — et, dans une
              case étroite, elles s'empilaient sur deux lignes en écrasant le
              titre. Une constante affichée 31 fois n'informe plus personne : ce
              qui se lit ici, c'est QUI est là, pas de quand à quand le cabinet
              ouvre. L'information reste disponible là où elle se règle, dans
              les tranches horaires de l'écran « Journée ». */}
          {vue.journeeVisible && <span>Journée</span>}
        </div>
        {vue.gardesVisibles && <div className="pv2-t-nuit">Nuit</div>}
      </div>

      {vue.gardesVisibles && (
        <div className="pv2-pourvoir">
          <div className="pv2-pourvoir-piste">
            {/* B-111 — avant génération, une période n'a AUCUNE garde : sans ce
                bouton, nulle part où cliquer pour fixer une date à l'avance. */}
            {jour.gardes.length === 0 && !jour.horsPeriode && rendrePoseJourVide?.(jour.date)}
          </div>
          <div className="pv2-pourvoir-nuit">
            {trous > 0 && gardeDuJour && (
              <button
                type="button"
                className="pv2-trou"
                onClick={() => onOuvrirGarde(gardeDuJour.id)}
                title={`${trous} place${trous > 1 ? 's' : ''} a pourvoir — cliquer pour choisir qui`}
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

        const pisteClasses = ['pv2-piste']
        // ⚠️ B-163f — LA HACHURE NE COUVRE LA PISTE QUE SI TOUT EST PRIS.
        //    Sans `moitiesAbsentes.length === 2`, une absence « le matin »
        //    hachurait la journée entière et contredisait le demi-voile posé
        //    plus bas : deux marques pour deux moitiés différentes, et la plus
        //    large gagnait. Le périmètre décide, pas le seul statut.
        const toutLeJour = ligne.moitiesAbsentes.length === 2
        if (ligne.absence === 'valide' && toutLeJour) pisteClasses.push('conge')
        if (ligne.absence === 'souhait' && toutLeJour) pisteClasses.push('souhait')
        if (cliquable) pisteClasses.push('cliquable')

        return (
          <div
            key={ligne.vetId}
            className={survol === ligne.vetId ? 'pv2-rangee survol' : 'pv2-rangee'}
            onMouseEnter={() => onSurvol(ligne.vetId)}
            onMouseLeave={() => onSurvol(null)}
          >
            <div
              className={pisteClasses.join(' ')}
              onClick={cliquable ? () => onOuvrirCellule?.(jour.date, ligne.vetId) : undefined}
              role={cliquable ? 'button' : undefined}
              tabIndex={cliquable ? 0 : undefined}
              onKeyDown={
                cliquable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOuvrirCellule?.(jour.date, ligne.vetId)
                      }
                    }
                  : undefined
              }
              aria-label={libelleCellule(personne?.prenom ?? '', ligne)}
            >
              {vue.journeeVisible && <span className="pv2-mi" aria-hidden="true" />}

              {/* Le congé se LIT, il ne se devine pas à la hachure seule.
                  B-163a ③ — et il se nomme : une ABSENCE déclarée n'est pas un
                  congé, et les confondre ferait chercher une demande qui
                  n'existe pas. */}
              {/* LA CASE VIDE DIT CE QU'ELLE PEUT DIRE DE PLUS PRÉCIS.
                  B-163e ① — `ligne.mention` d'abord : « absent matin » vaut
                  mieux que « absent » tout court, et il y a la place de
                  l'écrire quand aucune barre n'occupe la piste. Le mot
                  générique reste pour le cas sans précision (congé, ou absence
                  « journée et nuit », où `mention` est nul par construction).
                  ⚠️ Cette ligne et la pastille plus bas ne peuvent plus laisser
                     de trou : l'une couvre la piste vide, l'autre la piste
                     occupée. C'est le défaut de B-163d, et il ne doit pas
                     revenir par l'autre bout. */}
              {/*
                🔴 B-163f — « pour la journée complète tu gardes le même visuel
                   que congé sauf que tu mets absence ».

                   Un seul mot, jamais une phrase : « absent journée » passait
                   sur deux lignes dans 96 px et devenait illisible. Le détail
                   (journée seule ou journée + nuit) vit dans l'infobulle et
                   dans la fenêtre de la cellule — pas dans la case.

                ⚠️ La condition est `moitiesAbsentes.length === 2` et non plus
                   `journee.length === 0` : c'est le PÉRIMÈTRE qui décide, pas
                   l'absence de barre. Une personne sans présence posée et
                   absente seulement le matin n'a rien d'une journée entière.
              */}
              {ligne.absence === 'valide' && ligne.moitiesAbsentes.length === 2 && (
                <span className="pv2-conge-txt">
                  {ligne.origineAbsence === 'absence' ? 'absence' : 'congé'}
                </span>
              )}

              {/*
                B-163a ③ / B-163b ② — LA PASTILLE « A », SEULE TRACE DE CE QUI
                NE RETIRE RIEN.

                ⚠️ CE FUT D'ABORD UNE PHRASE, ET C'ÉTAIT TROP. MiKL, 14/10 :
                   « c'est écrit trop petit et ça empiète sur le visuel du
                   matin… il faudrait juste une pastille genre "A" et si l'admin
                   veut en savoir plus elle clique dessus ». La mention faisait
                   9px sur 72 % de la piste : elle recouvrait la barre de
                   présence qu'elle était censée NUANCER, et se lisait mal.
                   Une case de 96 px ne porte pas une phrase — elle porte un
                   signal, et le détail vit un clic plus loin.

                Le clic n'a demandé aucun code : la piste entière ouvre déjà la
                fenêtre de la cellule (`onOuvrirCellule`), qui dit le détail.
                La phrase complète reste en infobulle et en `aria-label` — la
                lettre seule n'informerait personne au lecteur d'écran.

                MiKL, 14/10, après avoir posé une indisponibilité de 14h à 16h :
                « et du coup ça n'a rien changé ». Rien n'avait changé au
                planning — c'est la décision du 13/10, et elle est tenue. Mais
                rien ne le DISAIT non plus, et une absence que personne ne voit
                est pire que pas de champ du tout : on croit la personne
                disponible toute la journée.

                🔴 B-163d ⑤ — LA CONDITION ÉTAIT `ligne.absence === null`, ET
                   C'ÉTAIT LE BUG. MiKL, 15/10 : « j'ai créé plusieurs absences
                   pour Jean dont le 28 au matin, ça me dit que c'est fait mais
                   y a rien qui apparaît sur le planning ». Les 7 absences
                   étaient bien en base (vérifié) : c'est l'affichage qui avait
                   un trou.

                   J'avais écrit DEUX conditions mutuellement exclusives :
                     • le mot « absent » — seulement si AUCUNE présence
                     • la pastille « A »  — seulement si l'absence ne retire rien
                   Une absence « le matin » sur quelqu'un qui a une présence
                   8h-18h ne satisfait NI l'une NI l'autre. Elle tombait entre
                   les deux, et c'est le cas le PLUS FRÉQUENT : la personne est
                   là en partie, ce qui est exactement l'information à donner.

                🔴 B-163e ① — ET LA PASTILLE REVIENT À SON CAS : LE PONCTUEL.
                   MiKL, 15/10 : « l'histoire de la pastille A c'était pour les
                   absences ponctuelles qui ne changeaient pas l'horaire de
                   présence et qui ne nécessitaient pas de remplacement ».
                   La demande du 14/10 était CONTEXTUELLE, et je l'avais prise
                   pour une règle générale — puis B-163d l'a étendue à TOUS les
                   périmètres pour réparer le trou d'affichage. Le trou était
                   réel ; la réparation était trop large.

                   Une indisponibilité ponctuelle ne change rien : elle a besoin
                   d'un signal À CÔTÉ de la barre. Un bloc AMPUTE la présence :
                   son information appartient à la barre elle-même, juste en
                   dessous. Les deux cas ne demandent pas le même dessin parce
                   qu'ils ne disent pas la même chose.
              */}
              {ligne.mention && ligne.absencePonctuelle && (
                <span
                  className="pv2-pastille-abs"
                  title={ligne.mentionDetail ?? ligne.mention}
                  aria-label={ligne.mentionDetail ?? ligne.mention}
                >
                  A
                </span>
              )}

              {/*
                🔴 B-163e ① — « quand c'est un bloc type matin, apres-midi ou
                   journee, ca doit etre indique SUR LA BARRE ».

                   La barre REPRÉSENTE la présence. Quand un bloc d'absence
                   l'ampute, c'est elle qui doit le dire : un signal posé à côté
                   laisserait croire que la présence tient entière. Elle porte
                   donc la hachure du périmètre et NOMME ce qui est retiré, à la
                   place de ses heures — « absent matin » est l'information du
                   jour ; « 8h-18h » ne l'est plus vraiment.

                ⚠️ On ne découpe PAS la barre aux heures du bloc. Il faudrait
                   les horaires réels des tranches du cabinet, que cette brique
                   n'a pas, et les deviner (« matin = première moitié »)
                   dessinerait une précision fausse. La hachure dit « entamée »
                   sans prétendre dire où — ce qui est exactement ce qu'on sait.
              */}
              {ligne.journee.map(({ presence, position }) =>
                position ? (
                  <span
                    key={presence.id}
                    className={presence.anomalie ? 'pv2-barre anomalie' : 'pv2-barre'}
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

              {/*
                🔴 B-163f — LE MIXTE PRÉSENCE / ABSENCE SUR LA MÊME BARRE.

                MiKL, 15/10 : « tu as une barre verticale qui partage en 2 la
                barre horizontale de la journée, donc on peut très bien dire que
                la 1ère partie c'est le matin et la 2ème l'après-midi, PEU
                IMPORTE LES HORAIRES… pas avec une écriture qu'on ne voit même
                pas bien ».

                ⚠️ MA LIVRAISON PRÉCÉDENTE ÉCRIVAIT « absent matin » DANS la
                   barre : le texte débordait et devenait illisible. Une case de
                   96 px ne porte pas de phrase — 3e fois sur cet écran.

                ⚠️ ET J'AVAIS DÉCLARÉ CE DÉCOUPAGE IMPOSSIBLE en B-163e, faute
                   de connaître les horaires réels des tranches. L'obstacle
                   était réel du côté des DONNÉES, sans objet du côté du DESSIN :
                   le trait `.pv2-mi` partage déjà la piste, et gauche/droite est
                   une CONVENTION DE LECTURE, pas une mesure.

                Posé APRÈS les barres, donc par-dessus : le voile assombrit la
                moitié concernée sans effacer la couleur de la personne.
              */}
              {ligne.moitiesAbsentes.length === 1 && (
                <span
                  className={
                    ligne.moitiesAbsentes[0] === 'matin'
                      ? 'pv2-abs-moitie gauche'
                      : 'pv2-abs-moitie droite'
                  }
                  title={ligne.mentionDetail ?? ligne.mention ?? undefined}
                  aria-label={ligne.mentionDetail ?? ligne.mention ?? undefined}
                />
              )}
            </div>

            {vue.gardesVisibles && (
              <div className={rendreCadenas ? 'pv2-nuit avec-cadenas' : 'pv2-nuit'}>
                {/* B-111 — le cadenas est À GAUCHE de la pastille. À droite, il
                    chevauchait le rôle (« 1er », « 2e ») dans une colonne
                    étroite — constaté par MiKL en recette le 04/09. */}
                {ligne.nuit && garde && rendreCadenas?.(garde, ligne.vetId, figee)}
                {ligne.nuit && garde && (
                  <button
                    type="button"
                    className={[
                      'pv2-garde',
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

      {/* La ligne « Présents » qui ferme la case dépliée.
          ⚠️ DEUX CHIFFRES NEUTRES, SANS SEUIL : le minimum d'effectif n'existe
             pas au schéma et MiKL l'a écarté le 06/10 (voir l'en-tête). */}
      {vue.journeeVisible && (
        <div className="pv2-presents">
          <div className="pv2-presents-piste">
            <span className="pv2-eff matin">{effectifs.matin}</span>
            <span className="pv2-eff aprem">{effectifs.apresMidi}</span>
          </div>
          {vue.gardesVisibles && <div className="pv2-presents-nuit" />}
        </div>
      )}
    </>
  )
}

/* `minutesEnTime` et `heureCourte` vivaient ici : ils ne servaient QU'À
   réafficher les bornes du rail, retirées le 11/10 (B-159 ①). Code mort dès
   lors — on le retire dans le même geste plutôt que de le laisser attendre un
   usage qui ne viendra pas. */

/**
 * La teinte d'une barre de présence.
 *
 * `2E` (18 %) avait été jugé invisible par MiKL en recette (B-145c) et relevé à
 * `4D` (30 %). Le design V2 garde ce niveau : une présence de journée n'a pas
 * le poids d'une garde, qui reste l'information qu'on cherche en ouvrant le
 * planning (B-047) — mais elle doit se VOIR.
 */
function teinte(couleur: string | null): string {
  if (!couleur) return 'rgba(124, 106, 85, 0.30)'
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
