'use client'

// B-153 lot 1 — L'etendue a TROIS etats dans le design V2, contre deux en
// B-145. Le type est declare ICI, local au chantier : elargir `AxeEtendue`
// dans `lib/planning/grilleSemaines` toucherait un type partage avec l'ecran
// du client, pour un besoin qui n'appartient qu'au chantier.
type EtendueV2 = 'replie' | 'semaine' | 'mois'

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

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2, CalendarX2 } from 'lucide-react'
import { RetirerPlanningModale, type GesteRetrait } from '@/components/planning/RetirerPlanningModale'
import { FilouEdge } from '@/components/v2/FilouEdge'
import type { PeriodeApplicable } from '@/components/v2/GenererJournee'
// B-157 — la barre d'outils du chantier est une COPIE, sous `chantier/`.
// L'original (`v2/outils-planning.tsx`) sert aussi l'écran du client : y
// toucher serait parti chez Val d'Allier sans passer par la porte. Le fichier
// de chantier porte le récit complet de cette duplication.
import {
  useOutilsPlanningChantier,
  type EntreeOutil,
} from '@/components/chantier/outils-planning-chantier'
import { GardeDetailModal, peutProposerUnEchange } from '@/components/planning/GardeDetailModal'
import { CriseModal, type VetCrise } from '@/components/planning/CriseModal'
import { estJourFerie } from '@/engine/utils'
// B-157a — la pastille de couleur du filtre « Mettre en avant » se dessine avec
// la MÊME fonction que celles de la grille : deux recettes de point coloré
// finiraient par ne plus désigner la même personne.
import { stylePoint } from '@/lib/couleurs'
// La grille part du lundi de la semaine du 1er et couvre des semaines pleines.
// ⚠️ Elle vient du MÊME module que les bornes de chargement des données
// (`app/(v2)/planning/page.tsx`) : les deux doivent se déplacer ensemble, sinon
// la semaine à cheval se dessine sans son contenu.
import { genererGrille } from '@/lib/planning/bornes-grille'
import { placesDeGarde, labelDonneeDePlace } from '@/lib/gardes/places'
// B-111 — le cadenas de l'admin sur la grille.
import {
  BoutonCadenas, FixerUneGarde, BandeauCadenas, type ResultatCadenas,
} from '@/components/v2/CadenasPlaces'
import { creneauPosableDuJour } from '@/lib/planning/creneauDuJour'
import {
  calculerApercuCreneaux,
  type ApercuCreneau,
  type PlaceProposee,
} from '@/lib/planning/apercuPropositions'
import { CompteursPanel } from '@/components/v2/CompteursPanel'
import { AbsencesAVenirPanel, type AbsenceAVenir } from '@/components/v2/AbsencesAVenirPanel'
import { ImprimerPourSecretariat } from '@/components/v2/ImprimerPourSecretariat'
// B-122/B-123 — les propositions de Filou en attente, directement sur la grille.
import { PropositionsPlanning, DetailProposition } from '@/components/v2/PropositionsPlanning'
import type { PropositionAffichee } from '@/lib/planning/propositionsAffichage'
import type { CompteursRow } from '@/hooks/useCompteurs'
import type { BilanVet } from '@/engine/bilan'
import type { CleColonne } from '@/lib/planning/colonnesCompteurs'
import type { GardeDenormalisee, Periode, ProfilPlanning } from '@/types'
import { nomPeriode } from '@/lib/periodes/libelle'
// B-150 — la composition des présences est PURE et testée
// (`tests/lib/presences-du-jour.test.ts`) : aucun test de ce projet ne monte un
// composant (B-144b), donc toute règle d'affichage laissée dans le JSX n'est
// jamais vérifiée.
import type { JourneeAffichee } from '@/lib/planning/presencesDuJour'
import { JourneeDuJourModale } from '@/components/v2/JourneeDuJourModale'
// B-145 lots 2b+2c — la grille en semaines, et tout ce qui la compose. La
// DÉCISION vit dans `lib/planning/grilleSemaines` (35 tests) ; ce composant ne
// fait que dessiner. Séparés, c'est vérifiable ; mélangés, ça ne l'est pas —
// aucun test de ce projet ne monte un composant (B-144b).
import { GrilleSemainesV2 } from './GrilleSemainesV2'
import '@/styles/chantier-planning-v2.css'
import { CellulePresenceModale, type TranchePosable } from './CellulePresenceModale'
import { AbsencesModale, CompteursModale } from './PanneauxEnModale'
import {
  bornesRail,
  choixContenu,
  contenuParDefaut,
  decouperEnSemaines,
  visibilite,
  type AxeContenu,
  type PersonneGrille,
} from '@/lib/planning/grilleSemaines'

/** Ce que chaque choix d'affichage dit à l'écran. */
const LIBELLE_CONTENU: Record<AxeContenu, string> = {
  gardes: 'Gardes',
  journee: 'Journées',
  'les-deux': 'Les deux',
}

interface Props {
  gardes: GardeDenormalisee[]
  periodes: Periode[]
  /** Période dont relève le mois affiché (celle dont on montre l'identité). */
  periodeAffichee: Periode | null
  /** Format « YYYY-MM ». */
  anneeMois: string
  isAdmin: boolean
  /**
   * Le SECRÉTARIAT (B-017, 2026-08-25) : il consulte, il n'agit sur rien.
   *
   * Ce n'est pas « un vétérinaire avec moins de droits ». Un vétérinaire a un
   * geste — proposer un échange sur SES gardes — et des compteurs qui le
   * concernent. Le secrétariat n'a ni gardes ni compteurs : lui montrer la
   * consigne d'échange, c'est lui promettre une action impossible, et lui
   * montrer les écarts d'équité, c'est lui ouvrir la vie interne de l'équipe.
   *
   * ⚠️ Cette prop ne PROTÈGE rien : elle évite d'afficher ce qui n'a pas de
   * sens. Ce qui protège, c'est la RLS (aucune écriture possible, HTTP 403
   * vérifié le 25/08) et le refus serveur des écrans qui ne le concernent pas.
   */
  lectureSeule?: boolean
  /**
   * Ce qui occupe la colonne de droite en lecture seule : les absences et
   * congés À VENIR, à la place des compteurs d'équité.
   *
   * La place existait déjà et n'avait plus d'occupant — MiKL, le 25/08 :
   * « remets le panneau, mais avec la liste des absences ». Le planning montre
   * les congés dans les cases du jour, donc en contexte ; ce panneau répond à
   * la question inverse, celle qu'on pose au téléphone : « il revient quand ? »
   */
  absencesAVenir?: AbsenceAVenir[]
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
  /**
   * B-122/B-123 — les propositions de Filou refusées par le moteur, encore
   * `en_attente` sur la période affichée. `undefined`/vide = rien à montrer,
   * la grille se comporte exactement comme avant ce chantier.
   */
  propositionsEnAttente?: PropositionAffichee[]
  /**
   * B-123 — les places que les propositions en attente veulent occuper, à
   * plat. La confrontation à l'état RÉEL de la grille se fait ICI, dans le
   * client : c'est le seul endroit qui connaisse les créneaux tels qu'ils
   * sont affichés (le `vendredi_soir` est dérivé du week-end, il n'existe pas
   * en base).
   */
  placesProposees?: PlaceProposee[]
  /**
   * B-125 — combien de personnes manquent sur chaque garde, par identifiant.
   * Une garde absente de cet objet n'a rien à signaler : soit elle est
   * complète, soit on ne SAIT PAS combien de places elle attend — et dans ce
   * second cas on se tait, plutôt que d'envoyer l'admin chercher un remplaçant
   * pour une garde qui n'en a pas besoin.
   */
  manquesParGarde?: Record<string, number>
  /**
   * B-148 — les modules allumés pour ce cabinet. Ils décident de ce que
   * « Générer » veut dire : sans gardes, il n'y a aucun moteur à lancer.
   */
  modules?: string[]
  /** Les plannings qui peuvent recevoir des présences de journée. */
  periodesJournee?: PeriodeApplicable[]
  /** Y a-t-il au moins une présence récurrente à appliquer ? */
  aDesTrames?: boolean
  /** Ce que l'encart Compteurs afficherait SI le lot en attente était appliqué. */
  compteursProjetes?: CompteursRow[]
  /**
   * B-150 — les présences de journée, par date (`AAAA-MM-JJ`).
   *
   * 🔴 LA MOITIÉ DE CHAÎNE QUI MANQUAIT. Le lot précédent savait POSER des
   *    présences et aucun écran ne les montrait : `grep -rn "presences_journee"`
   *    sur `src/` ne trouvait rien le 07/10, et c'est MiKL qui l'a vu. Poser 40
   *    présences était un geste sans résultat visible.
   *
   * Absent ou vide = le module journée est éteint, ou ce planning n'a aucune
   * présence : la grille se dessine exactement comme avant ce lot.
   */
  presencesParJour?: Record<string, JourneeAffichee>
  /**
   * B-145 lot 2b — l'équipe ACTIVE, dans l'ordre d'affichage.
   *
   * ⚠️ Chargée pour TOUT LE MONDE, contrairement à `vets` qui ne sert qu'à
   *    l'administratrice (réattribution, déclaration d'absence). La grille
   *    dépliée pose une ligne par personne : sans cette liste, un vétérinaire
   *    verrait une grille sans lignes, et le secrétariat aussi.
   */
  equipe?: PersonneGrille[]
  /**
   * Les tranches horaires ACTIVES du cabinet.
   *
   * Deux usages : borner le rail de la grille (jamais 8h–18h en dur — B-144 a
   * établi qu'une tranche peut couvrir autre chose que ce que son nom annonce)
   * et proposer ce qu'on peut poser sur une case.
   */
  tranches?: TranchePosable[]
}

/** Une période de vacances scolaires, telle que servie par la page. */
export interface PlageVacances {
  debut: string
  fin: string
  label: string
}

export interface CongeAffiche {
  id: string
  /** B-145 lot 2b — pour poser l'absence sur la LIGNE de la bonne personne. */
  vetId: string
  prenom: string
  couleur: string
  dateDebut: string
  dateFin: string
  statut: string
}

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

function initiale(prenom: string | null) {
  return (prenom ?? '?').slice(0, 1).toUpperCase()
}

function libelleStatut(statut: Periode['statut']) {
  if (statut === 'publie') return { classe: 'st-publiee', texte: '● Publiée' }
  if (statut === 'verrouille') return { classe: 'st-verrouillee', texte: '● Verrouillée' }
  return { classe: 'st-brouillon', texte: '● Brouillon · non publié' }
}


export function PlanningChantierV2({
  gardes,
  periodes,
  periodeAffichee,
  anneeMois,
  isAdmin,
  lectureSeule = false,
  absencesAVenir = [],
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
  propositionsEnAttente = [],
  placesProposees = [],
  manquesParGarde = {},
  compteursProjetes,
  modules,
  periodesJournee,
  aDesTrames,
  presencesParJour = {},
  equipe = [],
  tranches = [],
}: Props) {
  const router = useRouter()
  const [annee, mois] = anneeMois.split('-').map(Number)
  const [popOuvert, setPopOuvert] = useState(false)
  // B-157 — le menu « Outils » de la tête de page : il accueille les gestes
  // qui quittent la première ligne (PDF, absence, journées, compteurs) sans
  // quitter l'écran.
  const [outilsOuverts, setOutilsOuverts] = useState(false)
  // B-145 lot 2c — les compteurs ne sont plus une colonne de 262 px mais une
  // fenêtre : « que le client puisse le consulter comme une pop up afin de ne
  // pas encombrer l'écran du planning » (MiKL, 06/10). C'est cette largeur
  // libérée qui rend l'accordéon possible.
  const [compteursOuverts, setCompteursOuverts] = useState(false)
  const [absencesOuvertes, setAbsencesOuvertes] = useState(false)
  const [gardeModal, setGardeModal] = useState<GardeDenormalisee | null>(null)
  // B-122/B-123 — quelle proposition en attente est ouverte, pilotée à la
  // fois par un clic sur la grille et par le bandeau (`PropositionsPlanning`).
  const [propositionOuverte, setPropositionOuverte] = useState<string | null>(null)
  // B-150 — le jour dont le détail « au cabinet » est ouvert. Décision de MiKL
  // du 07/10 : la case porte le chiffre, une fenêtre porte le détail, « le même
  // principe que pour le compteur ».
  const [journeeOuverte, setJourneeOuverte] = useState<string | null>(null)
  const [criseOpen, setCriseOpen] = useState(false)
  const [criseDate, setCriseDate] = useState<string | undefined>()
  const [criseVetId, setCriseVetId] = useState<string | undefined>()
  // Retirer un planning depuis le menu de période (demande MiKL du 2026-08-03 :
  // le geste doit exister là où on choisit les plannings, pas seulement au fond
  // du parcours de génération).
  //
  // La rangée « Supprimer ? oui / non » qui vivait ici a disparu le 2026-08-22.
  // Elle convenait à un brouillon d'essai, mais depuis que la suppression
  // accepte un planning PUBLIÉ, il faut dire ce que le geste emporte — et le
  // dire sur des données lues en base, pas dans un « — Ses gardes seront
  // effacées » écrit une fois pour toutes. C'est le rôle de la fenêtre en deux
  // temps ; elle sert aussi la dépublication, l'issue qui n'existait nulle part.
  const [retrait, setRetrait] = useState<{
    id: string
    nom: string
    geste: GesteRetrait
  } | null>(null)

  const today = aujourdhuiISO()
  const grille = genererGrille(annee, mois)

  // ── B-145 lots 2b+2c — LES DEUX AXES, ET L'ACCORDÉON ───────────────────
  //
  // Le contenu par défaut montre tout ce que le cabinet possède : un cabinet
  // qui a les deux modules ouvre sur les deux. Le repli est FERMANT (les
  // gardes, le socle), jamais « tout allumé » — même grammaire que
  // `modulesDuCabinet` côté serveur.
  const choixDeContenu = useMemo(() => choixContenu(modules ?? []), [modules])
  const [contenu, setContenu] = useState<AxeContenu>(() => contenuParDefaut(modules ?? []))
  const [etendue, setEtendue] = useState<EtendueV2>('semaine')
  const { gardesVisibles, journeeVisible } = visibilite(contenu)

  const semaines = useMemo(() => decouperEnSemaines(grille), [grille])

  // Quelle semaine est ouverte au premier affichage : celle d'aujourd'hui si
  // elle est à l'écran, sinon la première. Ouvrir une semaine au hasard ferait
  // chercher la sienne à chaque arrivée.
  const semaineDuJour = useMemo(() => {
    const i = semaines.findIndex((s) => s.includes(today))
    return i >= 0 ? i : 0
  }, [semaines, today])

  const [semaineOuverte, setSemaineOuverte] = useState<number | null>(null)
  const ouverte = semaineOuverte ?? semaineDuJour

  // En « mois entier », tout est déplié : l'accordéon ne commande plus rien, et
  // c'est voulu — c'est l'autre bout de l'axe d'étendue.
  const semainesDepliees = useMemo(() => {
    // Trois états, et chacun répond à une question différente :
    //   · « replie » — tout le mois d'un coup d'œil, rien d'ouvert.
    //   · « semaine » — l'accordéon : une seule semaine détaillée.
    //   · « mois »   — tout détaillé, pour comparer deux semaines éloignées.
    if (etendue === 'mois') return new Set(semaines.map((_, i) => i))
    if (etendue === 'replie') return new Set<number>()
    return new Set([ouverte])
  }, [etendue, semaines, ouverte])

  function basculerSemaine(index: number) {
    // Cliquer une semaine la ramène seule à l'écran, depuis l'un comme l'autre
    // des deux états non-accordéon : c'est le geste naturel quand on veut se
    // concentrer après avoir regardé l'ensemble. Sans ce retour, « Mois replié »
    // serait un cul-de-sac — on verrait les semaines sans pouvoir en ouvrir une.
    if (etendue !== 'semaine') {
      setEtendue('semaine')
      setSemaineOuverte(index)
      return
    }
    setSemaineOuverte(index)
  }

  const [survol, setSurvol] = useState<string | null>(null)
  /**
   * B-157a — « METTRE EN AVANT », demandé par MiKL à la recette du 09/10.
   *
   * C'est le survol, ÉPINGLÉ. La grille sait déjà éclairer la ligne d'une
   * personne d'un bout à l'autre (`.pv2-rangee.survol`) ; ce filtre ne
   * réinvente donc rien, il rend cet éclairage persistant et estompe le reste.
   * Réutiliser le mécanisme existant plutôt qu'en écrire un second est ce qui
   * garantit que les deux ne divergeront pas.
   */
  const [enAvant, setEnAvant] = useState<string | null>(null)
  /** La cellule (jour × personne) dont la fenêtre de présences est ouverte. */
  const [cellule, setCellule] = useState<{ date: string; vetId: string } | null>(null)

  // Le rail suit les tranches RÉELLES du cabinet, jamais 8h–18h en dur : B-144
  // a établi qu'une tranche peut couvrir autre chose que ce que son nom annonce
  // (en base, « Matin » va de 8h à 18h chez ce cabinet-ci).
  const rail = useMemo(() => bornesRail(tranches), [tranches])

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

  // B-157 — le menu « Outils ». Il se referme exactement comme le panneau de
  // période : clic ailleurs ou Échap. Un menu dont la seule sortie est son
  // propre bouton est un piège (retour MiKL du 29/07, déjà payé juste
  // au-dessus) — on ne le réintroduit pas en en ouvrant un second.
  const outilsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!outilsOuverts) return
    function auClic(e: MouseEvent) {
      if (!outilsRef.current?.contains(e.target as Node)) setOutilsOuverts(false)
    }
    function auClavier(e: KeyboardEvent) {
      if (e.key === 'Escape') setOutilsOuverts(false)
    }
    document.addEventListener('mousedown', auClic)
    document.addEventListener('keydown', auClavier)
    return () => {
      document.removeEventListener('mousedown', auClic)
      document.removeEventListener('keydown', auClavier)
    }
  }, [outilsOuverts])

  // Les outils de la barre et leurs garde-fous. La période vient de la PILULE
  // — une seule source de vérité, là où la V1 embarquait un second sélecteur
  // qui la contredisait.
  //
  // B-157 — la barre ne rend plus une rangée de boutons : elle rend UNE action
  // principale (contextuelle), une liste d'outils que la tête range dans son
  // menu, et le nombre de points relevés par le pré-vol.
  const {
    actionPrincipale, actionGenerer, outils, pointsAVerifier,
    alertes, modales, ouvrirAssistant,
  } = useOutilsPlanningChantier({
    periode: periodeAffichee,
    aDesGardes: periodeAffichee ? periodesAvecGardes.includes(periodeAffichee.id) : false,
    isAdmin,
    periodes,
    periodesTypes,
    gardesParType,
    vets,
    periodesAvecGardes,
    modules,
    periodesJournee,
    aDesTrames,
    onNaviguerVersMois: (anneeMois) => router.push(`/planning?mois=${anneeMois}`),
    onSignalerAbsence: () => {
      setCriseDate(undefined)
      setCriseVetId(undefined)
      setCriseOpen(true)
    },
  })

  // Index par date : plusieurs créneaux peuvent coexister le même jour (P3b).
  //
  // ⚠️ MÉMORISÉ, et ce n'est pas de l'optimisation prématurée : cette carte est
  //    une dépendance du `useMemo` qui compose les semaines. Reconstruite à
  //    chaque rendu, elle changeait d'identité à chaque fois — la grille entière
  //    se recalculait à chaque survol de ligne, soit à chaque mouvement de
  //    souris. Signalé par le lint, pas trouvé à l'œil.
  const parDate = useMemo(() => {
    const index = new Map<string, GardeDenormalisee[]>()
    for (const g of gardes) {
      const liste = index.get(g.date)
      if (liste) liste.push(g)
      else index.set(g.date, [g])
    }
    return index
  }, [gardes])

  // B-123 — ce que les propositions en attente CHANGENT, créneau par créneau.
  //
  // Le calcul vit ici et pas sur le serveur parce qu'il a besoin des gardes
  // telles qu'elles sont AFFICHÉES. On confronte deux ensembles de personnes
  // sur un même (date, type) — jamais des rôles : la ligne du vendredi les
  // inverse (B-111, payé le 04/09), les personnes, elles, ne s'inversent pas.
  const apercuCreneaux = useMemo(() => {
    if (placesProposees.length === 0) return {}
    const creneaux = gardes.map((g) => ({
      date: g.date,
      type: g.type,
      // Le rôle de DONNÉES, jamais celui d'affichage : la proposition parle en
      // « premier »/« second », la grille dessine « 1er »/« 2e ». Confondre les
      // deux vocabulaires est le défaut du 04/09 (`labelDonneeDePlace`).
      occupants: placesDeGarde(g).map((p) => ({
        vetId: p.vetId,
        role: labelDonneeDePlace(p.index),
      })),
    }))
    return calculerApercuCreneaux(placesProposees, creneaux)
  }, [placesProposees, gardes])

  // La grille entre en mode aperçu : elle change d'aspect tant qu'il reste
  // quelque chose à trancher, et le reprend une fois le lot vidé (MiKL, 17/09 :
  // « on peut imaginer que le planning change complètement d'aspect, et une
  // fois que c'est validé ça reprend l'aspect normal »).
  const modeApercu = Object.keys(apercuCreneaux).length > 0

  // Les entrants sont désignés par leur `vetId` : la grille a besoin de leur
  // prénom et de leur couleur pour les dessiner comme n'importe quelle place.
  const vetsParId = useMemo(() => new Map(vets.map((v) => [v.id, v])), [vets])

  // La proposition dont la barre du bas est ouverte. On la relit dans la liste
  // à chaque rendu plutôt que de la stocker : après une application, la liste
  // rétrécit et la barre doit disparaître d'elle-même — pas rester ouverte sur
  // une proposition qui n'existe plus.
  const propositionDetaillee =
    propositionsEnAttente.find((p) => p.id === propositionOuverte) ?? null

  function naviguer(delta: number) {
    const d = new Date(Date.UTC(annee, mois - 1 + delta, 1))
    router.push(
      `/planning?mois=${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
    )
  }

  /**
   * B-157 — revenir au mois courant.
   *
   * La date du jour n'était qu'un REPÈRE TEXTE, au fond du panneau de période
   * (« 📌 Aujourd'hui : … »). Elle disait où l'on est, jamais comment y
   * retourner : après trois flèches, le seul chemin du retour était de
   * recompter les mois à l'envers. Le modèle du 09/10 en fait un bouton, et il
   * a raison — c'est la navigation la plus demandée d'un calendrier.
   */
  function allerAujourdhui() {
    router.push(`/planning?mois=${today.slice(0, 7)}`)
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

  // ── B-111 — les cadenas de l'admin ────────────────────────
  //
  // Ils n'ont de sens que sur un BROUILLON : ce qu'ils protègent, c'est une
  // régénération à venir. Publié, le planning ne se régénère plus — et les
  // cadenas sont d'ailleurs levés à la publication. Les afficher là serait
  // montrer un verrou qui ne verrouille rien.
  const cadenasActifs =
    isAdmin && !lectureSeule && periodeAffichee !== null && periodeAffichee.statut === 'brouillon'

  const [cadenasMessage, setCadenasMessage] = useState<string | null>(null)
  const [cadenasAvertissements, setCadenasAvertissements] = useState<string[]>([])

  /**
   * Les cadenas TELS QUE LE SERVEUR VIENT DE LES CONFIRMER, par garde.
   *
   * MiKL, 04/09 : « le délai entre le moment où je clique et le moment où ça
   * s'affiche est extrêmement long, plusieurs secondes ». La cause : on
   * rechargeait TOUT l'écran (une dizaine de requêtes) pour un changement d'une
   * case. La réponse du geste contenait pourtant déjà le résultat.
   *
   * On l'applique donc immédiatement, et le rechargement suit en arrière-plan.
   * Ce n'est PAS un affichage optimiste : rien n'est deviné, on affiche ce que
   * le serveur a répondu. En cas d'échec, cette carte n'est pas touchée.
   *
   * Des PERSONNES, pas des labels de place : la ligne du vendredi inverse les
   * rôles, un identifiant de vétérinaire non.
   */
  const [cadenasLocaux, setCadenasLocaux] = useState<Record<string, string[]>>({})

  function surResultatCadenas(r: ResultatCadenas) {
    setCadenasMessage(r.ok ? null : (r.erreur ?? 'Enregistrement impossible.'))
    setCadenasAvertissements(r.avertissements)

    // ⚠️ UN GESTE QUI RÉUSSIT DOIT SE VOIR, MÊME SI L'AFFICHAGE SE TROMPE.
    //
    // Le 04/09, le cadenas comparait deux vocabulaires différents : il restait
    // dessiné « ouvert » alors que la base enregistrait parfaitement. MiKL a
    // donc conclu « ça ne marche pas » sur un produit qui marchait — et il n'y
    // avait, à l'écran, strictement aucun moyen de faire la différence.
    //
    // La cause est corrigée. Ce toast, lui, protège de la PROCHAINE : il vient
    // de la réponse du serveur, pas de l'état dessiné. Si l'affichage se
    // remettait à mentir, le geste continuerait de se confirmer — et l'écart
    // entre les deux se verrait tout de suite, au lieu de coûter une recette.
    if (r.ok) {
      toast.success('C’est enregistré.')
      // Le résultat s'affiche TOUT DE SUITE — le rechargement complet, lui,
      // prend plusieurs secondes et n'apporte rien de plus sur cette case.
      if (r.gardeId) {
        setCadenasLocaux((prec) => ({ ...prec, [r.gardeId as string]: r.vetsFiges ?? [] }))
      }
    } else {
      toast.error(r.erreur ?? 'Enregistrement impossible.')
    }

    // On rafraîchit même en cas d'échec : l'écran peut être en retard sur la
    // base, et c'est justement l'une des causes de refus du serveur.
    router.refresh()
  }

  /**
   * Les personnes dont la garde est FIGÉE par un cadenas, pour une garde donnée.
   *
   * ⚠️ DES PERSONNES, JAMAIS DES LABELS DE PLACE. `places_figees` porte les
   *    labels de DONNÉES (« premier »), la vue les a déjà inversés pour le
   *    vendredi, et l'affichage dit « 1er ». Comparer deux vocabulaires
   *    différents est le défaut du 04/09 : le cadenas restait dessiné ouvert
   *    alors que la base enregistrait parfaitement — l'écriture marchait, elle
   *    ne se voyait simplement jamais. Un identifiant, lui, ne s'inverse pas.
   */
  function vetsFigesDeLaGarde(gardeId: string): ReadonlySet<string> {
    const confirmes = cadenasLocaux[gardeId]
    if (confirmes) return new Set(confirmes)

    const g = gardes.find((x) => x.id === gardeId)
    if (!g) return new Set()
    const labels = new Set(g.places_figees ?? [])
    return new Set(
      placesDeGarde(g)
        .filter((p) => {
          const label = labelDonneeDePlace(p.index)
          return label !== null && labels.has(label)
        })
        .map((p) => p.vetId)
        .filter((v): v is string => Boolean(v)),
    )
  }

  /** Les jours de la grille, groupés en semaines, prêts à dessiner. */
  const semainesGrille = useMemo(
    () =>
      semaines.map((jours) =>
        jours.map((date) => ({
          date,
          horsMois: new Date(date + 'T12:00:00Z').getUTCMonth() + 1 !== mois,
          horsPeriode:
            periodeAffichee !== null &&
            (date < periodeAffichee.date_debut || date > periodeAffichee.date_fin),
          gardes: (parDate.get(date) ?? []).map((g) => ({
            id: g.id,
            type: g.type,
            places: placesDeGarde(g).map((p) => ({
              vetId: p.vetId,
              prenom: p.prenom,
              couleur: p.couleur,
              role: p.role,
              index: p.index,
            })),
            manque: manquesParGarde?.[g.id] ?? 0,
          })),
          journee: presencesParJour[date],
          absences: conges
            .filter((c) => c.dateDebut <= date && c.dateFin >= date)
            .map((c) => ({ vetId: c.vetId, prenom: c.prenom, statut: c.statut })),
          vacances: vacances.find((v) => v.debut <= date && v.fin >= date)?.label ?? null,
        })),
      ),
    [semaines, mois, periodeAffichee, parDate, presencesParJour, conges, vacances, manquesParGarde],
  )

  const statut = periodeAffichee ? libelleStatut(periodeAffichee.statut) : null

  // B-157 — ce que le menu « Outils » contient.
  //
  // Les compteurs d'équité REJOIGNENT le menu : c'est une consultation, pas un
  // geste de préparation, et elle est déjà servie en fenêtre depuis le lot 2c.
  // Elle reste refusée au secrétariat — la vie interne de l'équipe n'est pas
  // une information de comptoir (MiKL, 25/08) —, et c'est pour ça qu'on la
  // compose ici plutôt que dans la barre, qui ne connaît pas ce partage.
  const entreesMenu: EntreeOutil[] = [
    ...(lectureSeule
      ? []
      : [{
          cle: 'compteurs',
          libelle: 'Compteurs d’équité',
          aide: 'Combien de week-ends chacun a faits, et son écart à sa juste part',
          icone: '⚖️',
          action: () => setCompteursOuverts(true),
        } satisfies EntreeOutil]),
    ...outils,
  ]

  /** Lance l'outil et referme le menu — sans quoi il resterait ouvert par-dessus. */
  function lancerOutil(e: EntreeOutil) {
    if (!e.action) return
    setOutilsOuverts(false)
    e.action()
  }

  const moisAffiche = `${annee}-${String(mois).padStart(2, '0')}`
  const dejaAujourdhui = moisAffiche === today.slice(0, 7)
  // Le bandeau « lecture seule » s'adresse à celle qui, d'habitude, PEUT
  // modifier : il explique une exception, et propose d'aller travailler
  // ailleurs. Pour un vétérinaire, tout est en lecture seule en permanence —
  // le bandeau n'annoncerait aucune exception, et « ouvre la période de travail
  // pour agir » lui désignerait un pouvoir qu'il n'a pas.
  const consultationSeule =
    isAdmin && periodeAffichee !== null && periodeAffichee.statut === 'verrouille'

  return (
    <div className="plan-scene">
      {/* Filou n'existe pas pour le secrétariat (arbitrage MiKL du 25/08).
          Son absence ici n'est que la moitié du travail : la conversation est
          aussi REFUSÉE côté serveur (`filou/actions.ts`), sans quoi il aurait
          suffi de connaître l'adresse. */}
      {!lectureSeule && <FilouEdge origine="planning" />}

      {/* La colonne de droite reste OUVERTE en lecture seule : elle porte les
          absences à venir, qui n'ont pas de bouton pour les replier — c'est la
          raison d'être de l'écran pour le secrétariat, pas un détail qu'on
          range. Pour l'équipe, le bouton « Compteurs » commande toujours. */}
      {/* ⚠️ PLUS DE COLONNE À REPLIER. `counters-closed` rétrécissait le plan de
          travail quand le panneau de 262 px était ouvert ; ce panneau est
          devenu une fenêtre (lot 2c), et la grille occupe désormais toute la
          largeur en permanence — c'est ce qui rend l'accordéon possible.
          Laisser la classe pilotée par `compteursOuverts` aurait fait changer
          la largeur de la grille à l'ouverture d'une MODALE : un effet de bord
          que personne n'aurait relié à son geste. */}
      <div className="workspace">
        {/* ============================================================
            B-157 — LA TÊTE DE PAGE, EN DEUX RANGÉES.
            ============================================================
            MiKL, le 09/10 : « il faut revoir tout le haut du planning […]
            réfléchis à faire un beau menu en haut […] pratique et efficace
            mais également esthétique ».

            CE QUI N'ALLAIT PAS : onze contrôles alignés sur UNE ligne, tous
            du même poids visuel, plus deux barres de réglage en dessous. Rien
            ne disait ce qu'on regarde, rien ne disait quoi faire ensuite —
            l'œil devait tout lire pour trouver un bouton.

            LE PARTAGE, et c'est tout le sujet :
              • rangée 1 = CE QU'ON REGARDE (le mois, la période, son état) et
                CE QU'ON DÉCIDE (une seule action accentuée) ;
              • rangée 2 = COMMENT ON LE REGARDE (les axes d'affichage).
            Deux questions différentes ne partagent plus la même ligne.

            Les gestes secondaires (impression, absence, journées, compteurs)
            descendent dans le menu « Outils ». Ils gardent leur capacité, ils
            perdent leur place en première ligne — aucune fonction n'est
            supprimée, et c'est la condition pour que « enlever le bouton
            absence » ne soit pas une perte. */}
        <div className="work-head pv2h">
          <div className="pv2h-r1">
          <div className="pv2h-identite">
            <p className="pv2h-surtitre">Planning de l’équipe</p>
            <div className="pv2h-mois">
              <h2>
                {MOIS[mois - 1]} {annee}
              </h2>
              <button
                type="button"
                className="mn-btn"
                onClick={() => naviguer(-1)}
                aria-label="Mois précédent"
              >
                ‹
              </button>
              <button
                type="button"
                className="mn-btn"
                onClick={() => naviguer(1)}
                aria-label="Mois suivant"
              >
                ›
              </button>
              {/* Inerte quand on y est déjà : un bouton qui ne changerait rien
                  se contente de le dire, au lieu de recharger la même page. */}
              <button
                type="button"
                className="pv2h-today"
                onClick={allerAujourdhui}
                disabled={dejaAujourdhui}
                title={
                  dejaAujourdhui
                    ? 'Tu es déjà sur le mois en cours'
                    : `Revenir au mois en cours (${dateCourte(today)})`
                }
              >
                Aujourd’hui
              </button>
            </div>
          </div>

          <div className="pv2h-reperes">

          {/* LA PASTILLE DU PRÉ-VOL. Elle compte ce que le moteur a relevé et
              les congés non tranchés — ⚠️ PAS les 48 incohérences de B-152a,
              qui restent un contrôle de publication. Elle ne s'affiche qu'avec
              un nombre : « 0 point à traiter » serait du bruit permanent, et
              une pastille toujours là cesse d'être lue. Le détail reste dans
              le bandeau, juste sous la tête — la pastille n'est qu'un signal,
              jamais un rapport (leçon du 2026-07). */}
            {pointsAVerifier > 0 && (
              <span className="pv2h-points" role="status">
                <b>{pointsAVerifier}</b>
                {pointsAVerifier > 1 ? ' points à traiter' : ' point à traiter'}
              </span>
            )}
          </div>

          <div className="pv2h-gestes">
            {/* Le secrétariat perd son panneau latéral (arbitrage du 06/10),
                mais pas sa question : « il revient quand ? » regarde DEVANT, et
                la grille par jour n'y répond pas. Même principe que les
                compteurs — le détail passe en fenêtre. */}
            {lectureSeule && (
              <button
                type="button"
                className="pv2h-outil-btn"
                onClick={() => setAbsencesOuvertes(true)}
              >
                Qui est absent
              </button>
            )}
            {/* La barre de l'équipe porte des gestes que le SERVEUR refuse au
                secrétariat. On ne lui sert donc pas la même barre en espérant
                que les boutons refusés ne soient pas cliqués — elle reçoit le
                seul geste qui la concerne, l'impression, avec le choix de la
                période au moment où la question se pose. */}
            {lectureSeule ? (
              <ImprimerPourSecretariat
                periodes={periodes.filter((p) => periodesAvecGardes.includes(p.id))}
              />
            ) : (
              <>
                {/* ⚠️ UN MENU POUR DEUX GESTES COÛTE PLUS QU'IL NE RANGE.
                    Un vétérinaire n'a ici que l'impression et les compteurs :
                    les enfermer derrière « Outils » lui ajouterait un clic sur
                    le seul geste qu'il possède. Le menu n'apparaît donc que
                    lorsqu'il y a vraiment une rangée à replier — c'est le cas
                    de l'admin, qui en a quatre ou cinq. */}
                {entreesMenu.length <= 2 ? (
                  entreesMenu.map((e) => (
                    <button
                      key={e.cle}
                      type="button"
                      className="pv2h-outil-btn"
                      disabled={!e.action}
                      title={e.empeche ?? e.aide}
                      onClick={() => lancerOutil(e)}
                    >
                      {e.libelle}
                    </button>
                  ))
                ) : (
                  /* LE MENU « OUTILS ». Il porte un libellé, pas seulement
                     trois points : un bouton muet oblige à l'ouvrir pour
                     savoir ce qu'il y a dedans, ce qui est exactement le clic
                     qu'on voulait économiser.

                     ⚠️ PAS DE `role="menu"` : ce rôle PROMET la navigation aux
                     flèches et le piège de focus du pattern ARIA complet, que
                     ce panneau n'implémente pas. Annoncer un contrat qu'on ne
                     tient pas dessert plus l'utilisateur au clavier qu'un
                     simple groupe de boutons, qui lui, se tabule. */
                  <div className="pv2h-menu-wrap" ref={outilsRef}>
                    <button
                      type="button"
                      className="pv2h-outil-btn"
                      aria-expanded={outilsOuverts}
                      aria-haspopup="true"
                      onClick={() => setOutilsOuverts((v) => !v)}
                    >
                      Outils
                      <span className="pv2h-caret" aria-hidden>▾</span>
                    </button>
                    {outilsOuverts && (
                      <div className="pv2h-menu" aria-label="Outils du planning">
                        {entreesMenu.map((e) => (
                          <button
                            key={e.cle}
                            type="button"
                            className="pv2h-menu-item"
                            disabled={!e.action}
                            onClick={() => lancerOutil(e)}
                          >
                            <span className="pv2h-menu-ico" aria-hidden>{e.icone}</span>
                            <span className="pv2h-menu-txt">
                              <b>{e.libelle}</b>
                              {/* Quand le geste est impossible, on dit POURQUOI
                                  à la place de l'aide : un geste grisé muet
                                  envoie chercher la raison ailleurs. */}
                              <small>{e.empeche ?? e.aide}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {/* B-157b — les DEUX gestes du planning, cote a cote :
                    celui qui le fabrique, celui qui le diffuse. */}
                {actionGenerer}
                {actionPrincipale}
              </>
            )}
          </div>
          </div>

          {/* RANGÉE 2 — DE QUOI ON PARLE, ET COMMENT ON LE REGARDE.
              MiKL, a la recette du 09/10 : « les periodes tu devrais les mettre
              en dessous du mois sur la meme ligne que les filtres, ya la
              place ». Il a raison, et pas seulement pour la place : la periode
              n'est pas une IDENTITE (le mois l'est), c'est un CADRE de lecture
              — exactement comme les deux axes a cote desquels elle se range. */}
          <div className="pv2h-r2">
          {/* ⚠️ PAS DE NOTION DE PÉRIODE POUR LE SECRÉTARIAT.
              MiKL, le 25/08, devant l'écran affichant « Hors période » :
              « pas besoin de notion de période — tous les plannings publiés et
              c'est tout ». La période est un outil de PRÉPARATION : on génère
              et on publie par période. Le secrétariat ne prépare rien, il
              regarde un calendrier. Pire, « Hors période » sur un mois sans
              garde se lit comme une anomalie, alors que ce n'est qu'un mois
              sans garde. Il navigue par mois, ce qui lui suffit — et le choix
              de la période réapparaît au seul endroit où il a un sens :
              l'impression. */}
          {!lectureSeule && (
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
                  // La corbeille tient désormais aussi sur les plannings
                  // PUBLIÉS — c'était le trou : le serveur les refusait en
                  // renvoyant vers une dépublication qui n'existait dans aucun
                  // écran, donc un planning publié ne pouvait être retiré par
                  // AUCUN chemin de l'application. Les deux confirmations sont
                  // dans la fenêtre ; ici on ne fait que l'ouvrir.
                  //
                  // Un planning VERROUILLÉ n'a ni l'un ni l'autre : il est
                  // l'historique du cabinet, et le serveur le refuse.
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
                      {isAdmin && p.statut === 'publie' && (
                        <button
                          type="button"
                          className="gen-suppr"
                          title={`Repasser « ${nomPeriode(p)} » en préparation`}
                          aria-label={`Repasser le planning ${nomPeriode(p)} en préparation`}
                          onClick={() =>
                            setRetrait({ id: p.id, nom: nomPeriode(p), geste: 'depublier' })
                          }
                        >
                          <CalendarX2 className="ppv-ico" aria-hidden />
                        </button>
                      )}
                      {isAdmin && p.statut !== 'verrouille' && (
                        <button
                          type="button"
                          className="gen-suppr"
                          title={`Supprimer « ${nomPeriode(p)} »`}
                          aria-label={`Supprimer le planning ${nomPeriode(p)}`}
                          onClick={() =>
                            setRetrait({ id: p.id, nom: nomPeriode(p), geste: 'supprimer' })
                          }
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
                {/* Le repère « 📌 Aujourd'hui : … » vivait ici. Il est devenu
                    un BOUTON dans la tête de page (B-157) : le garder aussi au
                    fond du panneau ferait dire deux fois la même chose, dont
                    une fois sans pouvoir agir. */}
              </div>
            )}
          </div>
          )}

            {/* 🔴 LE BANDEAU « METTRE EN AVANT » A VECU UNE HEURE — retire le
                09/10 a la demande de MiKL : « mets plutot la fonction
                directement sur les noms dans les colonnes du planning ».

                Il avait tort, et pour une raison qui vaut au-dela de ce cas :
                il RECOPIAIT en haut de l'ecran une liste de prenoms que la
                grille affiche deja dans sa marge. Deux endroits pour la meme
                information, donc deux endroits ou chercher — et une ligne
                entiere mangee, qui renvoyait la periode au-dessus alors
                qu'elle venait d'etre descendue ici.

                ➜ Le geste vit desormais SUR la donnee (`GrilleSemainesV2`,
                  la marge des prenoms). Un clic epingle, un second libere. */}

            <div className="pv2h-axes">
              {choixDeContenu.length > 1 && (
                <div className="pv2h-axe">
                  <span className="pv2h-axe-lbl">Afficher</span>
                  <div className="pv2h-seg" role="group" aria-label="Ce qui est affiché">
                    {choixDeContenu.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="pv2h-seg-btn"
                        aria-pressed={contenu === c}
                        onClick={() => setContenu(c)}
                      >
                        {LIBELLE_CONTENU[c]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="pv2h-axe">
                <span className="pv2h-axe-lbl">Étendue</span>
                <div className="pv2h-seg" role="group" aria-label="Étendue affichée">
                  <button
                    type="button"
                    className="pv2h-seg-btn"
                    aria-pressed={etendue === 'replie'}
                    onClick={() => setEtendue('replie')}
                  >
                    Mois replié
                  </button>
                  <button
                    type="button"
                    className="pv2h-seg-btn"
                    aria-pressed={etendue === 'semaine'}
                    onClick={() => setEtendue('semaine')}
                  >
                    Une semaine dépliée
                  </button>
                  <button
                    type="button"
                    className="pv2h-seg-btn"
                    aria-pressed={etendue === 'mois'}
                    onClick={() => setEtendue('mois')}
                  >
                    Mois déplié
                  </button>
                </div>
              </div>
            </div>
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
          {lectureSeule ? (
            /* Le secrétariat n'a AUCUN geste possible sur cette grille : ni
               échange (il n'a pas de gardes), ni réattribution. Lui servir la
               consigne d'un vétérinaire — « clique sur une de TES gardes » —
               lui ferait chercher pendant dix minutes un bouton qui n'existe
               pas, exactement le défaut relevé par MiKL le 20/08. La consigne
               dit donc ce qui EST vrai : elle consulte, et elle peut imprimer. */
            <p className="grid-hint">
              <span className="gh-ico" aria-hidden="true">
                👁️
              </span>
              <span>
                <b>Le planning diffusé du cabinet</b> — qui est de garde, et qui est absent.
              </span>
              <span className="gh-sep" aria-hidden="true">
                ·
              </span>
              <span className="gh-lock">Consultation seule · le PDF est imprimable</span>
            </p>
          ) : isAdmin ? (
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

          {/* B-123 — le bandeau ne parle QUE du lot entier (« tout appliquer »).
              Le détail d'un changement vit dans la barre du bas, ouverte par un
              clic sur une case mise en avant. Décidé par MiKL le 17/09. */}
          {isAdmin && periodeAffichee && propositionsEnAttente.length > 0 && (
            <PropositionsPlanning
              periodeId={periodeAffichee.id}
              propositions={propositionsEnAttente}
              creneauxTouches={Object.keys(apercuCreneaux).length}
            />
          )}

          {/* B-111 — ce qu'un cadenas vient d'enfreindre, ou pourquoi il n'a
              pas pu être posé. Au-dessus de la grille et non en toast : ces
              phrases se relisent pendant qu'on continue de cadenasser, et un
              message qui s'évapore au bout de trois secondes serait lu une fois
              sur deux. */}
          <BandeauCadenas
            message={cadenasMessage}
            avertissements={cadenasAvertissements}
            onFermer={() => {
              setCadenasMessage(null)
              setCadenasAvertissements([])
            }}
          />

          {/* ── B-145 lot 2c — LES DEUX AXES D’AFFICHAGE ────────────────────
              Ils vivaient ICI, entre le bandeau et la grille. B-157 les fait
              MONTER dans la tête de page, en rangée 2 : ce sont des réglages
              du regard, et leur place est avec le reste de ce qui règle le
              regard — pas dans le plan de travail, qu’ils repoussaient d’un
              cran vers le bas à chaque chargement. */}

          <div className="cal-scroll">
            {/* `survol={enAvant ?? survol}` — la personne ÉPINGLÉE prime sur le
                survol de souris. Sans cette priorité, passer la souris
                n'importe où défaisait la mise en avant qu'on venait de
                choisir. */}
            <GrilleSemainesV2
              semaines={semainesGrille}
              equipe={equipe}
              rail={rail}
              contenu={contenu}
              depliees={semainesDepliees}
              onBasculerSemaine={basculerSemaine}
              today={today}
              survol={enAvant ?? survol}
              onSurvol={setSurvol}
              epingleSur={enAvant}
              onEpingler={(vetId) => setEnAvant((a) => (a === vetId ? null : vetId))}
              prenomEnAvant={equipe.find((v) => v.id === enAvant)?.prenom ?? null}
              onOuvrirGarde={(gardeId) => {
                const g = gardes.find((x) => x.id === gardeId)
                // Le clic n'ouvre que là où il mène quelque part — même test que
                // celui qui décide du bouton dans la modale, donc pas de
                // divergence possible.
                if (g && estCliquable(g)) setGardeModal(g)
              }}
              // Poser ou retirer une présence : réservé à l'administratrice, et
              // seulement sur un planning qui se modifie encore. Le serveur
              // refuse de toute façon (`periodeModifiable`) — ici on évite
              // simplement de promettre un geste qui échouerait.
              onOuvrirCellule={
                isAdmin && !lectureSeule && periodeAffichee?.statut !== 'verrouille'
                  ? (date, vetId) => setCellule({ date, vetId })
                  : undefined
              }
              // B-150 / arbitrage ④ — la ligne « N présents » ouvre le détail.
              // C'est le seul chemin vers cette fenêtre en vue repliée : la
              // retirer la rendrait inatteignable, ce qui a bien failli
              // arriver au premier jet de ce portage.
              onOuvrirJournee={journeeVisible ? setJourneeOuverte : undefined}
              vetsFiges={vetsFigesDeLaGarde}
              // B-111 — les cadenas, bornés aux gardes (« pour le planning jour
              // pas besoin », MiKL le 06/10) et au seul cas où ils ont un sens :
              // l'administratrice, sur un brouillon. Publié, le planning ne se
              // régénère plus — montrer un verrou qui ne verrouille rien.
              //
              // ⚠️ Le composant est RÉUTILISÉ tel quel, avec son appel serveur
              //    et son `onFini`. Le réécrire pour la nouvelle grille aurait
              //    créé une seconde version du geste — et c'est la version
              //    oubliée qui se met à mentir (22/08).
              rendreCadenas={
                cadenasActifs
                  ? (garde, vetId, fige) => (
                      <BoutonCadenas
                        gardeId={garde.id}
                        vetId={vetId}
                        prenom={equipe.find((v) => v.id === vetId)?.prenom ?? null}
                        fige={fige}
                        onFini={surResultatCadenas}
                      />
                    )
                  : undefined
              }
              rendrePoseJourVide={
                cadenasActifs && periodeAffichee
                  ? (date) => (
                      <PoserSurJourVide
                        periodeId={periodeAffichee.id}
                        date={date}
                        ferie={estJourFerie(date)}
                        vets={vets}
                        onCadenas={surResultatCadenas}
                      />
                    )
                  : undefined
              }
            />
          </div>

          <div className="cal-legende-3a">
            {journeeVisible && (
              <span className="cl3-item">
                <span className="cl3-barre" aria-hidden="true" />
                Présence, posée sur l’horaire de la journée
              </span>
            )}
            {gardesVisibles && (
              <>
                <span className="cl3-item">
                  <span className="cl3-rond" aria-hidden="true" />
                  De garde, seul
                </span>
                <span className="cl3-item">
                  <span className="cl3-rang" aria-hidden="true">1er</span>
                  Rang, quand le créneau a plusieurs places
                </span>
                <span className="cl3-item">
                  <span className="cl3-trou" aria-hidden="true">?</span>
                  Place à pourvoir
                </span>
              </>
            )}
            {/* La légende des vacances n'apparaît QUE si le mois en contient :
                un repère sans mode d'emploi n'explique rien, et une légende
                permanente serait du bruit onze mois sur douze. */}
            {vacancesDuMois.length > 0 && (
              <span className="cl3-item">
                <span className="lg-vac" aria-hidden="true" />
                {vacancesDuMois.join(' · ')} — certaines règles changent pendant ces périodes.
              </span>
            )}
          </div>
        </div>

      </div>

      {/* B-123 — le détail du changement cliqué, ancré en bas de l'écran. Il
          ne recouvre pas la grille : les cases concernées restent visibles,
          c'est tout l'intérêt par rapport à une modale. */}
      {propositionDetaillee && (
        <DetailProposition
          proposition={propositionDetaillee}
          onFermer={() => setPropositionOuverte(null)}
        />
      )}

      {/* B-150 — le détail « qui est au cabinet » de la journée cliquée. Même
          principe que les compteurs : le chiffre sur la grille, le détail dans
          une fenêtre (arbitrage MiKL du 07/10). */}
      {/* B-145 lot 2c — les deux panneaux latéraux, devenus des fenêtres. Le
          CONTENU n'est pas réécrit : les composants d'origine sont montés tels
          quels, seule la porte change. */}
      <CompteursModale
        ouvert={compteursOuverts && !lectureSeule}
        lignes={compteurs}
        bilans={bilans}
        colonnes={colonnesCompteurs}
        projetees={compteursProjetes}
        onFermer={() => setCompteursOuverts(false)}
      />

      <AbsencesModale
        ouvert={absencesOuvertes}
        absences={absencesAVenir}
        onFermer={() => setAbsencesOuvertes(false)}
      />

      {/* B-145a — l'appelant qui manquait à `poserPresence` et
          `retirerPresence` depuis le 06/10. */}
      <CellulePresenceModale
        date={cellule?.date ?? null}
        personne={cellule ? (equipe.find((v) => v.id === cellule.vetId) ?? null) : null}
        journee={cellule ? presencesParJour[cellule.date] : undefined}
        periodeId={periodeAffichee?.id ?? null}
        tranches={tranches}
        onFermer={() => setCellule(null)}
      />

      <JourneeDuJourModale
        date={journeeOuverte}
        journee={journeeOuverte ? presencesParJour[journeeOuverte] : undefined}
        // Seule l'administratrice se voit renvoyer vers « Journée » : cet écran
        // refuse tout le monde d'autre côté serveur.
        isAdmin={isAdmin && !lectureSeule}
        onFermer={() => setJourneeOuverte(null)}
      />

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
          // ⚠️ CETTE `key` N'EST PAS COSMÉTIQUE — sans elle, le formulaire est
          // en retard d'un clic, et on peut déclarer absent le MAUVAIS véto.
          //
          // `CriseModal` est monté en permanence (dès qu'on est admin) : ses
          // `useState` prennent leur valeur au PREMIER montage, quand
          // `criseVetId` et `criseDate` valent encore `undefined`. Le seul
          // endroit qui les resynchronise est le `resetAll()` de la FERMETURE.
          // Constaté en recette le 26/08 : première ouverture vide, puis
          // chaque ouverture suivante pré-remplie avec la cible du clic
          // PRÉCÉDENT.
          //
          // Le danger n'est pas le formulaire vide — il se voit, on le
          // remplit. C'est le formulaire pré-rempli avec la mauvaise
          // personne : il a l'air juste. Déclarer Victor absent le 15 pouvait
          // ouvrir la fenêtre sur Manon le 10, sur un planning publié.
          //
          // Les DEUX autres écrans qui ouvrent cette fenêtre posent déjà cette
          // `key` (`CongesList.tsx`, `AbsencesV2.tsx`). Elle manquait ici.
          // Jamais `useEffect` + `setState` : ESLint le refuse sur ce projet.
          key={`crise-${criseVetId ?? 'sans-veto'}-${criseDate ?? 'sans-date'}`}
          open={criseOpen}
          onOpenChange={setCriseOpen}
          vets={vets}
          dateDefaut={criseDate}
          vetDefautId={criseVetId}
        />
      )}

      {retrait && (
        <RetirerPlanningModale
          periodeId={retrait.id}
          nomConnu={retrait.nom}
          geste={retrait.geste}
          onFerme={() => setRetrait(null)}
          onFait={(message) => {
            setRetrait(null)
            setPopOuvert(false)
            toast.success(message)
            // Le menu de période, la grille, les compteurs et la barre d'outils
            // lisent tous ce qui vient de disparaître : on repart du serveur.
            // Les autres écrans sont couverts par `revaliderPeriodes()`, et
            // ceux qui sont ouverts ailleurs par `RealtimeRefresh` (il écoute
            // `periodes` ET `gardes`).
            router.refresh()
          }}
        />
      )}

      {modales}
    </div>
  )
}

/**
 * Le pré-remplissage d'un jour vide.
 *
 * Tous les jours ne portent pas un créneau : le vendredi et le dimanche sont
 * couverts par la garde du samedi. Plutôt qu'un bouton qui créerait une ligne
 * que rien ne lit — et qui entrerait en collision avec le week-end au premier
 * calcul —, on n'affiche rien et on dit pourquoi au survol. Le découpage vient
 * de `creneauPosableDuJour`, jamais d'un `if` recopié ici.
 */
function PoserSurJourVide({
  periodeId,
  date,
  ferie,
  vets,
  onCadenas,
}: {
  periodeId: string
  date: string
  ferie: boolean
  vets: VetCrise[]
  onCadenas: (r: ResultatCadenas) => void
}) {
  const resultat = creneauPosableDuJour(date, ferie)

  if (!resultat.creneau) {
    return (
      <span className="fixer-inerte" title={resultat.raison}>
        —
      </span>
    )
  }

  return (
    <FixerUneGarde
      periodeId={periodeId}
      date={date}
      type={resultat.creneau.type}
      libelleCreneau={resultat.creneau.libelle}
      vets={vets}
      onFini={onCadenas}
    />
  )
}

// ── Le volet compteurs ──────────────────────────────────────


