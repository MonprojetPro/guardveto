'use client'

// ============================================================
// GUARDVETO V2 — Onglet 4 · Règles du moteur
// ============================================================
// Tout ce que le moteur doit respecter quand il fabrique un planning. C'est le
// plus gros des quatre onglets : il reprend l'INTÉGRALITÉ de l'ancienne page
// `/regles` V1, qui était éclatée en trois composants sans lien visuel entre
// eux (`ReglesClient`, `CompositionEquipeClient`, `ReglagesPlanningClient`).
//
// TROIS CARTES — ET POURQUOI PAS CINQ (étape 3 de la refonte Organisation)
//
// L'écran en portait cinq. Deux d'entre elles répondaient à une question déjà
// posée par une autre, et cette redite était le vrai coût : à cinq entrées,
// l'admin ne cherche plus un réglage, il cherche d'abord DANS QUELLE CARTE il
// vit.
//
//  1. RÈGLES DU CABINET ← a absorbé « Composition d'équipe ». C'est la même
//     question — *qui peut faire quoi ?* — posée deux fois : une fois en
//     nommant quelqu'un (« Fanny ne prend jamais le mardi »), une fois en
//     nommant une étiquette (« un junior n'est jamais seul »). Les deux
//     produisent une règle, avec la même échelle de fermeté, lue par le même
//     moteur. Elles sont donc rangées ENSEMBLE, dans les mêmes groupes de
//     fermeté : ce qui compte pour relire un cabinet, c'est ce que le moteur
//     s'interdit, pas la façon dont la personne a été désignée.
//     Deux boutons subsistent en tête, parce que ce sont deux gestes de
//     saisie différents (un formulaire nominatif riche · un petit panneau).
//
//  2. ÉQUILIBRAGE DES CHARGES ← a absorbé « Équilibrer entre certains
//     seulement ». Un équilibrage par étiquette n'est pas un autre sujet :
//     c'est un RÉGLAGE AVANCÉ du même équilibrage, qui s'ajoute à la ligne
//     générale (et qui ne se comprend qu'en la voyant). Séparées, les deux
//     cartes se contredisaient à distance — on mettait « Week-ends » sur
//     Essentielle en haut sans voir la cohorte qui la rejouait plus bas.
//
//  3. PRÉFÉRENCES DU PLANNING — inchangée : ni des interdictions, ni de
//     l'équilibrage. Des égards. Elle reste seule parce qu'elle est seule.
//
// CE QUI EST REPRIS TEL QUEL, ET POURQUOI
//
//  · `RegleFormDialog` — importé sans la moindre retouche. Ce formulaire porte
//    1120 lignes de validations métier (bornes, anti-doublon, anti-impasse,
//    briques souples qui refusent « Jamais »…) et il est déjà habillé V2 :
//    le redessiner, c'était perdre ses garde-fous pour gagner un dégradé.
//
//  · Le vocabulaire de fermeté vient UNIQUEMENT de `lib/regles/libelle.ts`
//    (`phraseRegle`, `choixForce`, `motForce`, `aideForce`, `symboleDe`). La V1
//    en avait TROIS versions divergentes — une par composant, plus une dans
//    l'assistant IA, qui datait d'avant la refonte des quatre niveaux. Une même
//    règle s'appelait donc « Ferme » ici et « Jamais » là. Rien n'est réécrit à
//    la main dans ce fichier : un libellé de force qu'on tape, c'est un
//    quatrième vocabulaire.
//
//  · La fusion des DUOS INTERDITS (`fusionnerDuos`). La base stocke deux lignes
//    symétriques (A→B et B→A) parce que le solver a besoin des deux sens ;
//    l'écran n'en montre qu'une, sinon chaque duo apparaît en double. Les
//    actions serveur traitent déjà le miroir au toggle et à la suppression.
//
// QUATRE DÉCISIONS D'INTERFACE, PRISES EN RECETTE
//
//  · AUCUN `<select>` NATIF. Un menu natif ouvre la liste du NAVIGATEUR :
//    carrée, bleue, étrangère au terrier, à côté de boutons en pilule. Tous les
//    choix passent donc par le `Select` du projet (`@/components/ui/select`),
//    habillé de bout en bout dans `v2-terrier.css` — déclencheur, cadre, items,
//    coche et focus. MiKL : « je veux que tout soit uniforme dans les
//    composants, appuie-toi sur ce qui existe et qui a déjà été validé ».
//
//  · LES ÉTIQUETTES SE CHOISISSENT DANS UNE LISTE. C'était un champ libre avec
//    des pastilles de suggestion en dessous : personne ne les voyait, et il
//    fallait deviner l'orthographe exacte d'une étiquette déjà posée. Le menu
//    liste ce que l'équipe porte réellement, et garde une dernière entrée
//    « + Une nouvelle étiquette… » pour le cas rare.
//
//  · LA CONSÉQUENCE D'UN CHOIX SE VOIT (`.consequence`). Deux paragraphes gris
//    superposés se lisent comme un seul pavé : on ne sait plus lequel répond au
//    menu. `.reglage-aide` dit de quoi parle la ligne ; `.consequence`, avec son
//    filet orange, dit ce que le moteur FERA du niveau choisi — et elle change
//    quand on change de niveau.
//
//  · FILOU EST EN HAUT À DROITE DES CARTES SANS « + AJOUTER ». Trois cartes
//    n'ont rien à ajouter (l'équilibrage a ses six charges câblées, les
//    préférences leurs quatre égards) : elles se retrouvaient muettes à
//    l'endroit exact où l'œil cherche quoi faire. Le composant `AideFilou` y
//    pose un bouton « Demander à Filou », à la place du « + Ajouter » absent.
//    Il NAVIGUE vers l'accueil, rien de plus : aucun appel, aucune écriture.
//
// CE QUI A ÉTÉ ÉCARTÉ, ET POURQUOI
//
//  · L'ASSISTANT IA INLINE. La V1 posait ici un encart « décris ta règle en
//    français ». C'est le travail de Filou, qui vit au rebord de la page et
//    sait en plus LIRE et MODIFIER les règles existantes. Deux portes pour la
//    même conversation, c'était deux mémoires séparées.
//
//  · LES BRIQUES DE LIAISON (`liaison_creneaux`, `inversion_role`). Elles ont
//    déménagé dans l'onglet « Enchaînements », auprès des liaisons qu'elles
//    règlent. En V1 on créait la liaison sur un écran et on réglait sa fermeté
//    sur un autre. La coquille redirige leurs ancres de `?focus=` toute seule.
//
//  · LE PLACEHOLDER « Réglementaires (pré-assemblées) ». C'était un encadré
//    vide annonçant du « bientôt ». Une section qui ne contient rien n'apprend
//    rien : elle occupe de la place et fait douter de ce qui est réellement
//    appliqué.
// ============================================================

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CalendarClock, Info, Pencil, Plus, Power, Trash2,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import {
  phraseRegle, fusionnerDuos, etageDe, symboleDe, motForce, choixForce, aideForce,
} from '@/lib/regles/libelle'
import { rendreRegle, IMPORTANCE_LABELS } from '@/engine/briques/catalogue'
import {
  EQUITY_DIMENSIONS, IMPORTANCE_LEVELS,
  type EquityDimension, type ImportanceLevel,
} from '@/engine/equity-weights'
import {
  setRegleActif, deleteRegle,
  setEquiteImportance, setCohorteEquite, deleteCohorteEquite,
  setStructureRegle, setRoleAvantageFinancier,
  upsertCompositionRegle, upsertRoleInterditRegle,
  poserEtiquetteSurVetos, verifierRegle,
  type CohorteEquiteUI, type CompositionReglePayload,
  type RoleInterditReglePayload,
} from '@/app/(protected)/regles/actions'
// Types depuis leur module : `actions.ts` est en `'use server'` et ne peut pas
// les réexporter (cf. le commentaire en tête de ce fichier-là).
import type { ForceFormulaire } from '@/lib/regles/paramsRegle'
import type { VerdictGardien } from '@/data/verifierRegleCandidate'
import { RegleFormDialog } from '@/components/regles/RegleFormDialog'
import { AideFilou } from './AideFilou'
import { useErreurBloquante, type ReponseAction } from './ErreurBloquante'
import { GardienFilou } from './GardienFilou'
import {
  BRIQUES_EDITABLES,
  type RegleRow, type PeriodeOption, type TypeCreneauOption,
} from '@/components/regles/ReglesClient'
import type { RegleEquipeUI } from '@/components/regles/CompositionEquipeClient'
import type { StructureRegleUI } from '@/components/regles/ReglagesPlanningClient'
import { ancresDeFocus } from '@/lib/regles/focusRegles'
import { GardienImpact } from '@/components/v2/GardienImpact'
import type { Impact } from '@/data/controleImpact'
import type { VetoUI } from './types'
import { nomVetoOuRetire } from '@/lib/regles/libelle'

// ════════════════════════════════════════════════════════════
// Référentiels d'affichage
// ════════════════════════════════════════════════════════════

/** Le regroupement en sections n'appartient QU'À cet écran (le reste vient de
 *  `libelle.ts`). Trois familles lisibles, pas six étages techniques. */
type GroupeKey = 'fermes' | 'sauf_crise' | 'confort' | 'reglementaires'

const GROUPE_PAR_FORCE: Record<string, GroupeKey> = {
  invariant: 'fermes',
  reglementaire: 'reglementaires',
  jamais: 'fermes',
  sauf_crise: 'sauf_crise',
  evitee: 'confort',
  si_possible: 'confort',
}

const GROUPES: { key: GroupeKey; titre: string; symbole: string }[] = [
  { key: 'fermes', titre: 'Interdictions fermes', symbole: '🔴' },
  { key: 'sauf_crise', titre: 'À éviter sauf crise', symbole: '🟠' },
  { key: 'confort', titre: 'Préférences de confort', symbole: '🟡' },
]

function groupeDe(force: string): GroupeKey {
  return GROUPE_PAR_FORCE[force] ?? 'confort'
}

/** Les 4 forces sélectionnables par l'admin, du plus dur au plus souple. Leurs
 *  libellés viennent de `libelle.ts` — jamais d'ici. */
const FORCES_CHOISISSABLES = ['jamais', 'sauf_crise', 'evitee', 'si_possible'] as const

/** Les briques structurellement SOUPLES refusent « Jamais » côté serveur
 *  (aucun gardien dur n'existe pour elles : ce serait une coquille vide). */
const FORCES_SOUPLES = ['sauf_crise', 'evitee', 'si_possible'] as const

/** Sentinelle des menus de fermeté : elle n'existe pas en base — c'est
 *  `actif = false` (cf. `setRegleActif`). */
const DESACTIVEE = 'desactivee'

/** Sentinelle du menu d'étiquettes : « celle que je vais écrire ». La liste
 *  déroulante du projet refuse la valeur vide, d'où une valeur nommée.
 *
 *  Choisir cette entrée ouvre DEUX champs : le nom de l'étiquette, et « qui la
 *  porte ? ». Le second n'est pas un confort — sans porteur, le serveur refuse
 *  la règle (cf. `poserEtiquetteSurVetos`), et l'option n'était qu'une impasse. */
const NOUVELLE_ETIQUETTE = '__nouvelle__'

/** Les 3 formes de règle d'équipe proposées au panneau (pour 2 briques). */
type TypeRegleEquipe = 'au_moins_un' | 'pas_seuls' | 'role_interdit'

const TYPE_REGLE_EQUIPE_LABELS: Record<TypeRegleEquipe, string> = {
  au_moins_un: 'Toujours au moins un vétérinaire portant cette étiquette',
  pas_seuls: 'Les vétérinaires portant cette étiquette ne sont jamais seuls',
  role_interdit: 'Les vétérinaires portant cette étiquette ne tiennent jamais un rôle',
}

const ROLE_LABELS: Record<string, string> = { premier: '1er', second: '2nd' }
const roleLisible = (r: string) => ROLE_LABELS[r] ?? r

const EQUITE_META: Record<EquityDimension, { titre: string; aide: string }> = {
  weekend: {
    titre: 'Week-ends',
    aide: 'Donner à chacun le même nombre de week-ends de garde.',
  },
  weekend_premier: {
    titre: 'Rôle de 1er le week-end',
    aide: 'Équilibrer qui est 1er le week-end (le rôle à l’avantage financier).',
  },
  ferie: {
    titre: 'Jours fériés',
    aide: 'Répartir équitablement les gardes des jours fériés.',
  },
  semaine_premier: {
    titre: 'Nuits de semaine — 1er',
    aide: 'Équilibrer les nuits de semaine assurés en 1er.',
  },
  semaine_second: {
    titre: 'Nuits de semaine — 2nd',
    aide: 'Équilibrer les nuits de semaine assurés en 2nd.',
  },
  semaine_renfort: {
    titre: 'Nuits de semaine — renfort',
    aide: 'Équilibrer les nuits de semaine tenus à partir de la 3ᵉ place. Sans objet tant qu’un type de garde n’a que deux places.',
  },
  grands_weekend: {
    titre: 'Grands week-ends (salariés)',
    aide: 'Répartir les grands week-ends perdus par les salariés.',
  },
}

/** Libellé court d'une charge, pour la liste des équilibrages par étiquette. */
const DIMENSION_LABELS: Record<EquityDimension, string> = {
  weekend: 'Week-ends',
  weekend_premier: 'Rôle de 1er le week-end',
  ferie: 'Jours fériés',
  semaine_premier: 'Nuits de semaine — 1er',
  semaine_second: 'Nuits de semaine — 2nd',
  semaine_renfort: 'Nuits de semaine — renfort',
  grands_weekend: 'Grands week-ends (salariés)',
}

/** Les crans proposés à un équilibrage PAR ÉTIQUETTE : « Ignorée » est exclu
 *  à dessein — un poids nul ne se stocke pas, on retire la ligne par la
 *  corbeille. (En base et côté moteur, ces lignes s'appellent des cohortes.) */
const IMPORTANCE_ACTIVES = IMPORTANCE_LEVELS.filter((n) => n !== 'ignoree')

/** Les 4 pénalités souples réglables (R10 / R10c / R10b / R8b). */
const PENALITES_SOUPLES = [
  'eviter_we_consecutifs',
  'eviter_we_avant_vacances',
  'eviter_fete_fin_annee',
  'inversion_role_ferie',
] as const
type PenaliteSouple = (typeof PENALITES_SOUPLES)[number]

const PENALITES_META: Record<PenaliteSouple, { titre: string; aide: string }> = {
  eviter_we_consecutifs: {
    titre: 'Éviter deux week-ends de garde de suite',
    aide: 'Le moteur évite de donner deux week-ends consécutifs au même vétérinaire.',
  },
  eviter_we_avant_vacances: {
    titre: 'Éviter la garde le week-end avant ses vacances',
    aide: 'Qui part en vacances la semaine suivante part reposé.',
  },
  eviter_fete_fin_annee: {
    titre: 'Éviter les gardes des soirs de réveillon',
    aide: 'Les soirs des 24 et 31 décembre sont évités autant que possible.',
  },
  inversion_role_ferie: {
    titre: 'Changer de rôle la veille d’un jour férié',
    aide: 'Le 1er de la veille devient si possible 2nd le jour férié, et inversement.',
  },
}

/** Force de repli quand on RALLUME une pénalité qui n'en avait plus de souple. */
const PENALITE_FORCE_REPLI: Record<PenaliteSouple, string> = {
  eviter_we_consecutifs: 'sauf_crise',
  eviter_we_avant_vacances: 'evitee',
  eviter_fete_fin_annee: 'evitee',
  inversion_role_ferie: 'si_possible',
}

/** R11b — quel rôle du week-end porte l'avantage financier. */
const ROLE_AVANTAGE_LABELS: Record<string, string> = {
  premier: 'Le 1er de garde',
  second: 'Le 2nd de garde',
  aucun: 'Aucun (pas d’équilibrage)',
}
const ROLE_AVANTAGE_OPTIONS = ['premier', 'second', 'aucun']

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Le libellé d'un cran d'importance, capitalisé (Ignorée / Faible / Normale /
 *  Importante / Essentielle) — source unique : le catalogue de briques. */
const libelleImportance = (n: string) => cap(IMPORTANCE_LABELS[n] ?? n)

/** Ce que le moteur fait d'une règle éteinte. Dit une fois, employé partout. */
const EFFET_ETEINTE =
  'Désactivée : le moteur ne la lit plus du tout, comme si elle n’existait pas. Elle reste là pour être rallumée d’un choix.'

/** Ce qu'une action serveur de cet écran peut répondre — `regleExistante`
 *  compris, l'identifiant de la règle qui fait doublon (cf. `ErreurBloquante`). */
type Reponse = ReponseAction | undefined

const MSG_ENREGISTRE = 'Réglage enregistré — appliqué à la prochaine génération.'

/**
 * Le déclencheur d'un menu de fermeté : la pastille de couleur, puis le MOT du
 * niveau (`motForce`). Les items, eux, portent la phrase de décision complète
 * (`choixForce`) : on choisit sur une phrase, on relit sur un mot. Les deux
 * viennent de `libelle.ts`, aucun n'est écrit ici — et le mot court garde tous
 * les déclencheurs d'une carte à la même largeur, sans texte tronqué.
 */
function EtiquetteForce({ force }: { force: string }) {
  if (force === DESACTIVEE) {
    return (
      <>
        <span aria-hidden="true">⚪</span> Désactivée
      </>
    )
  }
  return (
    <>
      <span aria-hidden="true">{symboleDe(force)}</span> {motForce(force)}
    </>
  )
}

/** Ce que le moteur fera du niveau choisi. `.consequence` — filet orange. */
function Consequence({ texte }: { texte: string }) {
  return (
    <p className="consequence">
      <Info size={15} aria-hidden="true" />
      <span>{texte}</span>
    </p>
  )
}

// ════════════════════════════════════════════════════════════
// Composant
// ════════════════════════════════════════════════════════════

interface Props {
  /** Faux pour un vétérinaire : aucune commande d'écriture n'est rendue. */
  estAdmin: boolean
  /** Toutes les règles nominatives du cabinet (actives ET désactivées). */
  regles: RegleRow[]
  /** Les règles d'équipe par étiquette (composition + rôle interdit). */
  reglesEquipe: RegleEquipeUI[]
  vets: VetoUI[]
  periodes: PeriodeOption[]
  typesCreneaux: TypeCreneauOption[]
  rolesCabinet: string[]
  tagsEquipe: string[]
  equite: Record<EquityDimension, ImportanceLevel>
  cohortes: CohorteEquiteUI[]
  penalitesSouples: Record<string, StructureRegleUI>
  roleAvantage: string
  /** `?focus=` — l'ancre d'un réglage précis, venue du diagnostic d'impasse. */
  focus?: string
}

export function OngletMoteur({
  estAdmin,
  regles,
  reglesEquipe,
  vets,
  periodes,
  typesCreneaux,
  rolesCabinet,
  tagsEquipe,
  equite,
  cohortes,
  penalitesSouples,
  roleAvantage,
  focus,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // ── Carte 1 : règles nominatives ──
  const [aSupprimer, setASupprimer] = useState<RegleRow | null>(null)
  const [formOuvert, setFormOuvert] = useState(false)
  const [aEditer, setAEditer] = useState<RegleRow | null>(null)

  // ── Carte 1 (suite) : règles par étiquette (ex-carte « Composition ») ──
  const [compoOuvert, setCompoOuvert] = useState(false)
  const [compoType, setCompoType] = useState<TypeRegleEquipe>('au_moins_un')
  // L'étiquette se choisit dans la liste de ce que l'équipe porte ; la
  // sentinelle ouvre le champ libre à côté (cas rare, mais il doit rester
  // possible : on pose parfois la règle avant l'étiquette).
  const [compoTagChoix, setCompoTagChoix] = useState<string>(
    tagsEquipe[0] ?? NOUVELLE_ETIQUETTE,
  )
  const [compoTagLibre, setCompoTagLibre] = useState('')
  /** Les fiches sur lesquelles poser l'étiquette inédite, avant de créer la
   *  règle. Ignoré quand l'étiquette vient de la liste : elle a déjà ses
   *  porteurs, et cet écran n'est pas l'endroit où l'on gère les fiches. */
  const [compoPorteurs, setCompoPorteurs] = useState<string[]>([])
  const [compoRole, setCompoRole] = useState(rolesCabinet[0] ?? 'premier')
  const [compoCreneaux, setCompoCreneaux] = useState<string[]>([])
  const [compoForce, setCompoForce] = useState<string>('jamais')

  // ── Cartes 2 et 3 : réglages optimistes (affichés avant la réponse serveur,
  //    repris en arrière si elle refuse — sinon le menu montrerait une valeur
  //    que la base n'a pas). ──
  const [eq, setEq] = useState(equite)
  const [ps, setPs] = useState(penalitesSouples)
  const [roleAv, setRoleAv] = useState(roleAvantage)

  // ── Carte 2 (suite) : équilibrages par étiquette (« cohortes » en base) ──
  const [cohorteOuverte, setCohorteOuverte] = useState(false)
  const [coDim, setCoDim] = useState<EquityDimension>('weekend')
  // Même mécanique que le panneau de règle : une liste de ce qui existe, plus
  // l'entrée « nouvelle étiquette » qui demande aussitôt ses porteurs. Avant,
  // un cabinet sans aucune étiquette n'avait ici qu'un panneau qui disait
  // d'aller voir ailleurs.
  const [coTagChoix, setCoTagChoix] = useState<string>(tagsEquipe[0] ?? NOUVELLE_ETIQUETTE)
  const [coTagLibre, setCoTagLibre] = useState('')
  const [coPorteurs, setCoPorteurs] = useState<string[]>([])
  const [coImp, setCoImp] = useState<ImportanceLevel>('important')

  // Les refus serveur de cet écran s'affichent en modale (titre + explication +
  // porte de sortie), pas en vignette éphémère : cf. `ErreurBloquante`.
  // Idem : le panneau de saisie se referme avant que la modale n'emmène voir
  // la règle en double, sinon il resterait ouvert par-dessus.
  const { ouvrirErreur, ouvrirRefus, dialogueErreur } = useErreurBloquante({
    avantDeQuitter: () => {
      setCompoOuvert(false)
      setCohorteOuverte(false)
    },
  })

  /**
   * Le gardien : ce que le moteur a trouvé sur la règle en cours, et l'écriture
   * qu'il retient en otage tant que l'admin n'a pas tranché. Garder la fonction
   * d'écriture ICI plutôt qu'un drapeau évite d'avoir à deviner, au moment du
   * « Enregistrer quand même », de QUELLE règle on parlait.
   */
  const [gardien, setGardien] = useState<{
    verdict: VerdictGardien
    ecrire: () => Promise<void>
  } | null>(null)

  /**
   * Le gardien est tombé en panne. La règle s'enregistre quand même (le
   * contrôle est facultatif par nature), mais on le DIT : un contrôle
   * silencieusement hors service laisserait croire que la règle a été vérifiée.
   * Le message technique est affiché tel quel — sans lui, une panne en
   * production se corrige au hasard.
   */
  const signalerGardienEnPanne = (diagnostic: string) => {
    toast.warning('Je n’ai pas pu vérifier cette règle avec les autres.', {
      description: diagnostic,
      duration: 20000,
    })
  }

  /**
   * Le halo de `?focus=`. On arrive ici depuis un diagnostic d'impasse ou d'un
   * point de pré-vol : sans repère, on atterrit dans une longue liste et on
   * cherche. Purement cosmétique et défensif — une ancre inconnue ne casse
   * rien, elle ne fait simplement rien.
   *
   * PLUSIEURS ANCRES, séparées par des virgules (2026-08-03). Un point de
   * pré-vol met souvent SIX règles en cause — « les limites cumulées de
   * week-end » les met toutes. N'en éclairer qu'une renverrait l'admin
   * chercher les cinq autres à la main, exactement ce qu'on voulait éviter.
   * Un id seul reste traité comme avant.
   */
  useEffect(() => {
    if (!focus) return
    const ancres = ancresDeFocus(focus)
    if (ancres.length === 0) return

    const echapper = (a: string) =>
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(a)
        : a.replace(/["\\]/g, '\\$&')

    const selecteur = ancres
      .map((a) => `[data-regle-cible="${echapper(a)}"], [data-regle-cible-alt="${echapper(a)}"]`)
      .join(', ')

    const els = Array.from(document.querySelectorAll<HTMLElement>(selecteur))
    if (els.length === 0) return

    // On défile vers la PREMIÈRE trouvée dans l'ordre du document (pas dans
    // l'ordre des ancres) : c'est celle du haut de l'écran, donc celle à
    // partir de laquelle les autres sont visibles en descendant.
    els[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
    for (const el of els) el.classList.add('cible-focus')
    const timer = window.setTimeout(() => {
      for (const el of els) el.classList.remove('cible-focus')
    }, 2600)
    return () => window.clearTimeout(timer)
  }, [focus])

  const nomVeto = nomVetoOuRetire(vets)

  /** Refus du contrôle d'impact sur une pose d'étiquette (palier 3). */
  const [impactTag, setImpactTag] = useState<Impact | null>(null)

  const labelPeriode = (id?: string | null) =>
    id ? (periodes.find((p) => p.id === id)?.label ?? 'période supprimée') : null

  const nomCreneau = (code: string) =>
    typesCreneaux.find((t) => t.code === code)?.nom ?? code

  // Une seule ligne par duo : la base en stocke deux sens (A→B et B→A), le
  // moteur a besoin des deux, l'écran n'en montre qu'un.
  const actives = useMemo(() => fusionnerDuos(regles.filter((r) => r.actif)), [regles])
  const inactives = useMemo(() => fusionnerDuos(regles.filter((r) => !r.actif)), [regles])

  /**
   * Les deux familles de règles réunies en UNE liste (étape 3). Le `kind` ne
   * sert qu'au rendu : une règle nominative s'édite dans le gros formulaire et
   * se met en pause au bouton, une règle par étiquette se règle au menu de
   * fermeté. Mais elles se RANGENT ensemble, par ce que le moteur en fait.
   */
  type LigneUnifiee =
    | { kind: 'nom'; id: string; force: string; tri: string; regle: RegleRow }
    | { kind: 'tag'; id: string; force: string; tri: string; regle: RegleEquipeUI }

  const toutesActives: LigneUnifiee[] = useMemo(
    () => [
      ...actives.map((r): LigneUnifiee => ({
        kind: 'nom', id: r.id, force: r.force, tri: r.brique_id, regle: r,
      })),
      ...reglesEquipe
        .filter((r) => r.actif)
        .map((r): LigneUnifiee => ({
          kind: 'tag', id: r.id, force: r.force, tri: r.brique, regle: r,
        })),
    ],
    [actives, reglesEquipe],
  )

  const toutesInactives: LigneUnifiee[] = useMemo(
    () => [
      ...inactives.map((r): LigneUnifiee => ({
        kind: 'nom', id: r.id, force: r.force, tri: r.brique_id, regle: r,
      })),
      ...reglesEquipe
        .filter((r) => !r.actif)
        .map((r): LigneUnifiee => ({
          kind: 'tag', id: r.id, force: r.force, tri: r.brique, regle: r,
        })),
    ],
    [inactives, reglesEquipe],
  )

  /** L'étiquette réellement retenue par le panneau d'ajout de règle d'équipe. */
  const compoTag = compoTagChoix === NOUVELLE_ETIQUETTE ? compoTagLibre : compoTagChoix
  /** Idem pour le panneau d'équilibrage par étiquette. */
  const coTag = coTagChoix === NOUVELLE_ETIQUETTE ? coTagLibre : coTagChoix

  /**
   * Une étiquette inédite se saisit au clavier — soit parce qu'on a choisi
   * « + Une nouvelle étiquette… », soit parce que l'équipe n'en porte aucune et
   * qu'il n'y a donc pas de liste à proposer. Dans les deux cas il faut
   * demander QUI la porte : c'est ce qui rend la règle acceptable.
   */
  const compoTagInedit = tagsEquipe.length === 0 || compoTagChoix === NOUVELLE_ETIQUETTE
  const coTagInedit = tagsEquipe.length === 0 || coTagChoix === NOUVELLE_ETIQUETTE

  /** Seules les fiches ACTIVES peuvent recevoir une étiquette (cf. `VetoUI`).
   *  `actif` est optionnel dans le type : un chargeur qui ne le fournirait pas
   *  ne doit pas vider la liste — d'où le `!== false` plutôt que `=== true`. */
  const vetsActifs = useMemo(() => vets.filter((v) => v.actif !== false), [vets])

  /** Les vétérinaires proposés comme porteurs : ceux de l'écran, dans l'ordre. */
  const basculerPorteur = (
    setter: (maj: (p: string[]) => string[]) => void,
    id: string,
  ) => setter((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  /**
   * Pose l'étiquette inédite sur les fiches cochées, AVANT l'écriture de la
   * règle. Renvoie `false` si ça a échoué (la modale est déjà ouverte) — dans
   * ce cas l'appelant renonce à écrire la règle, qui serait refusée juste après.
   */
  const poserSiInedit = async (inedit: boolean, tag: string, porteurs: string[]) => {
    if (!inedit) return true
    const res: Reponse = await poserEtiquetteSurVetos(tag, porteurs)
    if (res?.error) {
      // Un refus PORTEUR d'impact s'explique dans la fenêtre de Filou, qui
      // porte les gestes de correction (palier 3). Poser une étiquette change
      // qui peut tenir quel rôle : le refus vient du moteur, pas d'une faute
      // de saisie — une modale d'erreur sèche n'aurait rien à en dire.
      if ('impact' in res && res.impact) {
        setImpactTag(res.impact as Impact)
        return false
      }
      ouvrirErreur(res.error, {
        titre: 'L’étiquette n’a pas pu être posée',
        explication:
          'La règle n’a donc pas été créée non plus : sans porteur, le moteur la refuserait. Vérifie la sélection, ou pose l’étiquette directement sur les fiches depuis la page Équipe.',
      })
      return false
    }
    return true
  }

  // ── Carte 1 — actions ──────────────────────────────────────

  const ouvrirCreation = () => {
    setAEditer(null)
    setFormOuvert(true)
  }

  const ouvrirEdition = (regle: RegleRow) => {
    // Certaines briques (équité, liaisons…) n'ont pas de formulaire : on le dit
    // plutôt que d'ouvrir une fenêtre qui ne saurait pas les remplir.
    if (!BRIQUES_EDITABLES.has(regle.brique_id)) {
      // Un crayon qui ouvre une vignette et rien d'autre passe pour une panne :
      // on dit ce que c'est, et où ça se règle vraiment.
      ouvrirErreur("Ce type de règle ne s'édite pas depuis le formulaire.", {
        titre: 'Cette règle se règle ailleurs',
        explication:
          'Certaines règles (équilibrage, enchaînements entre types de garde) n’ont pas de formulaire : elles se modifient là où elles sont définies — la carte « Équilibrage des charges » ci-dessous, ou l’onglet « Enchaînements ». Tu peux en revanche changer sa fermeté ou la mettre en pause depuis sa ligne.',
      })
      return
    }
    setAEditer(regle)
    setFormOuvert(true)
  }

  const basculer = (regle: RegleRow) => {
    startTransition(async () => {
      const res: Reponse = await setRegleActif(regle.id, !regle.actif)
      if (res?.error) {
        ouvrirErreur(res.error)
        return
      }
      toast.success(
        regle.actif
          ? 'Règle mise en pause — le moteur ne la lira plus.'
          : 'Règle réactivée.',
      )
      router.refresh()
    })
  }

  const supprimer = () => {
    if (!aSupprimer) return
    const cible = aSupprimer
    startTransition(async () => {
      const res: Reponse = await deleteRegle(cible.id)
      if (res?.error) {
        ouvrirErreur(res.error)
        return
      }
      toast.success('Règle supprimée.')
      setASupprimer(null)
      router.refresh()
    })
  }

  // ── Carte 2 — actions ──────────────────────────────────────

  const phraseEquipe = (r: RegleEquipeUI) =>
    rendreRegle(r.brique, {
      mode: r.mode,
      tag: r.tag,
      role: r.role,
      creneaux: r.creneaux.length > 0 ? r.creneaux : undefined,
    })

  /** Réécrit une règle d'équipe existante avec une nouvelle fermeté. */
  const reecrireEquipe = async (r: RegleEquipeUI, force: ForceFormulaire) => {
    if (r.brique === 'role_interdit_tag') {
      const payload: RoleInterditReglePayload = {
        id: r.id, tag: r.tag, role: r.role ?? 'premier',
        creneaux: r.creneaux, force,
      }
      return upsertRoleInterditRegle(payload)
    }
    const payload: CompositionReglePayload = {
      id: r.id, mode: r.mode ?? 'au_moins_un', tag: r.tag,
      creneaux: r.creneaux, force,
    }
    return upsertCompositionRegle(payload)
  }

  /**
   * « Désactivée » n'est pas une fermeté : c'est `actif = false`. Choisir une
   * vraie fermeté réécrit la règle, puis la rallume si elle dormait — sinon on
   * réglerait le niveau d'une règle que le moteur ne lit pas.
   */
  const changerForceEquipe = (r: RegleEquipeUI, choix: string) => {
    startTransition(async () => {
      if (choix === DESACTIVEE) {
        const res: Reponse = await setRegleActif(r.id, false)
        if (res?.error) {
          ouvrirErreur(res.error)
          return
        }
        toast.success('Règle mise en pause.')
        router.refresh()
        return
      }
      const res: Reponse = await reecrireEquipe(r, choix as ForceFormulaire)
      if (res?.error) {
        ouvrirErreur(res.error)
        return
      }
      if (!r.actif) await setRegleActif(r.id, true)
      toast.success(MSG_ENREGISTRE)
      router.refresh()
    })
  }

  const supprimerEquipe = (r: RegleEquipeUI) => {
    startTransition(async () => {
      const res: Reponse = await deleteRegle(r.id)
      if (res?.error) {
        ouvrirErreur(res.error)
        return
      }
      toast.success('Règle d’équipe supprimée.')
      router.refresh()
    })
  }

  const ouvrirCompo = () => {
    setCompoType('au_moins_un')
    setCompoTagChoix(tagsEquipe[0] ?? NOUVELLE_ETIQUETTE)
    setCompoTagLibre('')
    setCompoPorteurs([])
    setCompoRole(rolesCabinet[0] ?? 'premier')
    setCompoCreneaux([])
    setCompoForce('jamais')
    setCompoOuvert(true)
  }

  const creerEquipe = () => {
    const tag = compoTag.trim().toLowerCase()
    if (tag === '') {
      ouvrirErreur('Indique l’étiquette concernée (junior, senior…).', {
        titre: 'Il manque l’étiquette',
        explication:
          'Une règle par étiquette vise un groupe, pas une personne : « senior », « junior », « chirurgien »… C’est ce mot qui relie la règle aux fiches de l’équipe.',
      })
      return
    }
    // Une étiquette inédite se pose AVANT la règle : dans l'autre ordre, le
    // serveur refuserait la règle parce que personne ne la porte encore.
    if (compoTagInedit && compoPorteurs.length === 0) {
      ouvrirErreur(`Personne ne porte encore l’étiquette « ${tag} ».`, {
        titre: 'Coche qui porte cette étiquette',
        explication:
          'Une étiquette n’existe qu’à travers ses porteurs. Coche les vétérinaires concernés juste en dessous du champ : ils la recevront sur leur fiche au moment où la règle sera créée.',
      })
      return
    }
    startTransition(async () => {
      if (!(await poserSiInedit(compoTagInedit, tag, compoPorteurs))) return

      // L'étiquette est posée AVANT le contrôle : sans porteur, le gardien
      // signalerait une « étiquette sans porteur » qui n'existera plus une
      // seconde plus tard — un avertissement pour un problème déjà résolu.
      const verdict = await verifierRegle(
        compoType === 'role_interdit'
          ? {
              genre: 'role_interdit',
              payload: {
                tag, role: compoRole, creneaux: compoCreneaux,
                force: compoForce as ForceFormulaire,
              },
            }
          : {
              genre: 'composition',
              payload: {
                mode: compoType, tag, creneaux: compoCreneaux,
                force: compoForce as ForceFormulaire,
              },
            },
      )
      if (verdict.diagnostic) signalerGardienEnPanne(verdict.diagnostic)
      if (verdict.verifie && verdict.avertissements.length > 0) {
        setGardien({ verdict, ecrire: ecrireEquipe })
        return
      }
      await ecrireEquipe()
    })
  }

  /**
   * L'écriture proprement dite — extraite pour être rejouable telle quelle
   * après « Enregistrer quand même ». Refaire la saisie depuis les états au
   * moment du clic garantit que ce qui s'écrit est bien ce que le gardien a
   * examiné (les états n'ont pas bougé entre-temps : le panneau est verrouillé).
   */
  const ecrireEquipe = async () => {
    const tag = compoTag.trim().toLowerCase()
    const res: Reponse =
      compoType === 'role_interdit'
        ? await upsertRoleInterditRegle({
            tag, role: compoRole, creneaux: compoCreneaux,
            force: compoForce as ForceFormulaire,
          })
        : await upsertCompositionRegle({
            mode: compoType, tag, creneaux: compoCreneaux,
            force: compoForce as ForceFormulaire,
          })
    // `ouvrirRefus` plutôt que `ouvrirErreur` : c'est ici qu'un doublon peut
    // remonter, et le serveur joint l'identifiant de la règle en cause.
    if (res?.error) {
      ouvrirRefus(res)
      return
    }
    toast.success(
      compoTagInedit
        ? `Étiquette « ${tag} » posée et règle créée — appliquée à la prochaine génération.`
        : 'Règle d’équipe créée — Filou l’a vérifiée avec les autres.',
    )
    setGardien(null)
    setCompoOuvert(false)
    router.refresh()
  }

  const basculerCreneauCompo = (code: string) => {
    setCompoCreneaux((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    )
  }

  // ── Carte 3 — équilibrage ──────────────────────────────────

  const changerEquite = (dim: EquityDimension, niveau: ImportanceLevel) => {
    const avant = eq[dim]
    setEq((p) => ({ ...p, [dim]: niveau }))
    startTransition(async () => {
      const res: Reponse = await setEquiteImportance(dim, niveau)
      if (res?.error) {
        ouvrirErreur(res.error)
        setEq((p) => ({ ...p, [dim]: avant }))
        return
      }
      toast.success(MSG_ENREGISTRE)
      router.refresh()
    })
  }

  // ── Carte 4 — cohortes ─────────────────────────────────────

  const changerImportanceCohorte = (c: CohorteEquiteUI, imp: string) => {
    startTransition(async () => {
      const res: Reponse = await setCohorteEquite(c.dimension, c.tag, imp)
      if (res?.error) {
        ouvrirErreur(res.error)
        return
      }
      toast.success(MSG_ENREGISTRE)
      router.refresh()
    })
  }

  const supprimerCohorte = (c: CohorteEquiteUI) => {
    startTransition(async () => {
      const res: Reponse = await deleteCohorteEquite(c.id)
      if (res?.error) {
        ouvrirErreur(res.error)
        return
      }
      toast.success('Équilibrage par étiquette retiré.')
      router.refresh()
    })
  }

  const ajouterCohorte = () => {
    const tag = coTag.trim().toLowerCase()
    if (tag === '') {
      ouvrirErreur('Choisis une étiquette.', {
        titre: 'Il manque l’étiquette',
        explication:
          'Un équilibrage « entre certains seulement » a besoin de savoir entre QUI : c’est l’étiquette qui désigne ce groupe.',
      })
      return
    }
    if (coTagInedit && coPorteurs.length === 0) {
      ouvrirErreur(`Personne ne porte encore l’étiquette « ${tag} ».`, {
        titre: 'Coche qui porte cette étiquette',
        explication:
          'Un équilibrage entre porteurs d’une étiquette que personne ne porte n’équilibrerait rien du tout. Coche les vétérinaires concernés juste en dessous du champ.',
      })
      return
    }
    startTransition(async () => {
      if (!(await poserSiInedit(coTagInedit, tag, coPorteurs))) return

      const verdict = await verifierRegle({
        genre: 'cohorte',
        payload: { dimension: coDim, tag, importance: coImp },
      })
      if (verdict.diagnostic) signalerGardienEnPanne(verdict.diagnostic)
      if (verdict.verifie && verdict.avertissements.length > 0) {
        setGardien({ verdict, ecrire: ecrireCohorte })
        return
      }
      await ecrireCohorte()
    })
  }

  /** L'écriture de l'équilibrage — rejouable après « Enregistrer quand même ». */
  const ecrireCohorte = async () => {
    const tag = coTag.trim().toLowerCase()
    const res: Reponse = await setCohorteEquite(coDim, tag, coImp)
    if (res?.error) {
      ouvrirErreur(res.error)
      return
    }
    toast.success('Équilibrage par étiquette ajouté — appliqué à la prochaine génération.')
    setGardien(null)
    setCohorteOuverte(false)
    router.refresh()
  }

  // ── Carte 5 — préférences ──────────────────────────────────

  /**
   * Les pénalités souples ne peuvent JAMAIS être fermes : le serveur refuse
   * `jamais` sur elles (aucun gardien dur n'existe → l'interdiction ne
   * bloquerait rien). Le menu ne le propose donc pas.
   */
  const changerPenalite = (brique: PenaliteSouple, choix: string) => {
    const avant = ps[brique] ?? { actif: true, force: PENALITE_FORCE_REPLI[brique] }
    const forceGardee = (FORCES_SOUPLES as readonly string[]).includes(avant.force)
      ? avant.force
      : PENALITE_FORCE_REPLI[brique]
    const suivant: StructureRegleUI =
      choix === DESACTIVEE
        ? { actif: false, force: forceGardee }
        : { actif: true, force: choix }
    setPs((p) => ({ ...p, [brique]: suivant }))
    startTransition(async () => {
      const res: Reponse = await setStructureRegle(brique, suivant.actif, suivant.force)
      if (res?.error) {
        ouvrirErreur(res.error)
        setPs((p) => ({ ...p, [brique]: avant }))
        return
      }
      toast.success(MSG_ENREGISTRE)
      router.refresh()
    })
  }

  const changerRoleAvantage = (role: string) => {
    const avant = roleAv
    setRoleAv(role)
    startTransition(async () => {
      const res: Reponse = await setRoleAvantageFinancier(role)
      if (res?.error) {
        ouvrirErreur(res.error)
        setRoleAv(avant)
        return
      }
      toast.success(MSG_ENREGISTRE)
      router.refresh()
    })
  }

  // ── Rendu d'une règle nominative ───────────────────────────

  const LigneRegle = ({ regle }: { regle: RegleRow }) => (
    <div
      className={`reg-ligne${regle.actif ? '' : ' eteinte'}`}
      data-regle-cible={regle.id}
    >
      <span className="reg-symbole" aria-hidden="true">
        {symboleDe(regle.force)}
      </span>

      <div className="reg-corps">
        <p className="reg-phrase">{phraseRegle(regle, nomVeto)}</p>
        <p className="reg-portee">
          {regle.periode_id ? (
            <span className="etiq neutre">
              <CalendarClock size={12} aria-hidden="true" /> {labelPeriode(regle.periode_id)}
            </span>
          ) : (
            <span>Toutes les périodes</span>
          )}
          {!regle.actif && <span className="etiq eteint">En pause</span>}
        </p>
      </div>

      <div className="reg-actions">
        {/* Variante douce : ces deux boutons-là ne détruisent rien. Un
            avertissement rouge sur « modifier » apprend à ne plus lire les
            avertissements rouges. */}
        <button
          type="button"
          className="icon-btn doux"
          onClick={() => basculer(regle)}
          disabled={isPending}
          aria-label={regle.actif ? 'Mettre cette règle en pause' : 'Réactiver cette règle'}
          title={regle.actif ? 'Mettre en pause' : 'Réactiver'}
        >
          <Power size={15} aria-hidden="true" />
        </button>

        {/* On ne modifie pas une règle en pause : on la rallume d'abord. Sans
            ça, on éditerait finement une règle que le moteur ne lit pas. */}
        {regle.actif && (
          <button
            type="button"
            className="icon-btn doux"
            onClick={() => ouvrirEdition(regle)}
            disabled={isPending}
            aria-label="Modifier cette règle"
            title="Modifier"
          >
            <Pencil size={15} aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          className="icon-btn"
          onClick={() => setASupprimer(regle)}
          disabled={isPending}
          aria-label="Supprimer cette règle"
          title="Supprimer"
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  )

  // ── Rendu d'une règle par étiquette ────────────────────────

  // Des FONCTIONS de rendu, pas des composants : un composant défini dans le
  // corps est un type neuf à chaque rendu, donc React démonte et remonte son
  // sous-arbre — un menu ouvert se refermerait, un champ perdrait le focus.
  const ligneEquipe = (r: RegleEquipeUI) => {
    const courant = r.actif ? r.force : DESACTIVEE
    return (
      <div
        key={r.id}
        className={`reg-ligne${r.actif ? '' : ' eteinte'}`}
        data-regle-cible={r.id}
      >
        <span className="reg-symbole" aria-hidden="true">
          {r.actif ? symboleDe(r.force) : '⚪'}
        </span>

        <div className="reg-corps">
          <p className="reg-phrase">{phraseEquipe(r)}</p>
          <p className="reg-portee">
            <span className="etiq neutre">{r.tag}</span>
            {r.role && <span>Rôle : {roleLisible(r.role)}</span>}
            <span>
              {r.creneaux.length > 0
                ? r.creneaux.map(nomCreneau).join(', ')
                : 'Tous les types de garde'}
            </span>
          </p>
          <Consequence texte={r.actif ? aideForce(r.force) : EFFET_ETEINTE} />
        </div>

        <div className="reg-actions">
          <Select
            value={courant}
            onValueChange={(v) => changerForceEquipe(r, String(v))}
            disabled={isPending}
          >
            <SelectTrigger
              className="w-44"
              aria-label={`Ce que le moteur fait de la règle : ${phraseEquipe(r)}`}
            >
              <EtiquetteForce force={courant} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DESACTIVEE}>
                <span aria-hidden="true">⚪</span> Désactivée
              </SelectItem>
              {FORCES_CHOISISSABLES.map((f) => (
                <SelectItem key={f} value={f}>
                  <span aria-hidden="true">{symboleDe(f)}</span> {choixForce(f)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            className="icon-btn"
            onClick={() => supprimerEquipe(r)}
            disabled={isPending}
            aria-label="Supprimer cette règle d’équipe"
            title="Supprimer"
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    )
  }

  /** Une ligne, quelle que soit sa famille. */
  const ligne = (l: LigneUnifiee) =>
    l.kind === 'nom' ? <LigneRegle key={l.id} regle={l.regle} /> : ligneEquipe(l.regle)

  const lignesDuGroupe = (key: GroupeKey) =>
    toutesActives
      .filter((l) => groupeDe(l.force) === key)
      .sort((a, b) => etageDe(a.force) - etageDe(b.force) || a.tri.localeCompare(b.tri))

  /**
   * « Qui porte cette étiquette ? » — la moitié manquante de l'étiquette
   * inédite. Rendu en `.chips` comme les types de garde : même geste, même
   * apparence, et la sélection reste visible d'un coup d'œil (une liste
   * déroulante multiple aurait caché le choix derrière un clic).
   */
  const selecteurPorteurs = (
    idLabel: string,
    porteurs: string[],
    setter: (maj: (p: string[]) => string[]) => void,
  ) => (
    <div className="large">
      <label id={idLabel}>Qui porte cette étiquette ?</label>
      <div className="chips" role="group" aria-labelledby={idLabel}>
        {vetsActifs.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={porteurs.includes(v.id)}
            onClick={() => basculerPorteur(setter, v.id)}
          >
            {v.prenom}
          </button>
        ))}
      </div>
      <p className="note">
        L&apos;étiquette sera posée sur leurs fiches (page Équipe) au moment où tu valides. Tu
        pourras l&apos;y ajouter ou l&apos;y retirer à tout moment ensuite.
      </p>
    </div>
  )

  /** Le panneau de saisie d'une règle par étiquette (bouton « + Par étiquette »). */
  const panneauEquipe = () => (
    <div className="panneau">
      <p className="panneau-titre">Nouvelle règle par étiquette</p>

      <div className="grille">
        <div className="large">
          <label id="compo-type-lbl">Type de règle</label>
          <Select
            value={compoType}
            onValueChange={(v) => setCompoType(String(v) as TypeRegleEquipe)}
            disabled={isPending}
          >
            <SelectTrigger className="w-full" aria-labelledby="compo-type-lbl">
              {TYPE_REGLE_EQUIPE_LABELS[compoType]}
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TYPE_REGLE_EQUIPE_LABELS) as TypeRegleEquipe[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_REGLE_EQUIPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* L'étiquette : une liste de ce que l'équipe porte réellement. Le
            champ libre n'apparaît que si on demande une étiquette inédite —
            et il est seul quand l'équipe n'en porte aucune. */}
        {tagsEquipe.length > 0 ? (
          <div>
            <label id="compo-tag-lbl">Étiquette</label>
            <Select
              value={compoTagChoix}
              onValueChange={(v) => setCompoTagChoix(String(v))}
              disabled={isPending}
            >
              <SelectTrigger className="w-full" aria-labelledby="compo-tag-lbl">
                {compoTagChoix === NOUVELLE_ETIQUETTE ? 'Une nouvelle étiquette…' : compoTagChoix}
              </SelectTrigger>
              <SelectContent>
                {tagsEquipe.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
                <SelectItem value={NOUVELLE_ETIQUETTE}>+ Une nouvelle étiquette…</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="large">
            <label htmlFor="compo-tag-libre">Étiquette</label>
            <input
              id="compo-tag-libre"
              type="text"
              maxLength={30}
              value={compoTagLibre}
              onChange={(e) => setCompoTagLibre(e.target.value)}
              placeholder={compoType === 'au_moins_un' ? 'senior' : 'junior'}
            />
            <p className="note">
              Aucune étiquette n&apos;est encore posée sur l&apos;équipe : écris-la ici, puis
              indique qui la porte juste en dessous.
            </p>
          </div>
        )}

        {tagsEquipe.length > 0 && compoTagChoix === NOUVELLE_ETIQUETTE && (
          <div>
            <label htmlFor="compo-tag-libre">Laquelle ?</label>
            <input
              id="compo-tag-libre"
              type="text"
              autoFocus
              maxLength={30}
              value={compoTagLibre}
              onChange={(e) => setCompoTagLibre(e.target.value)}
              placeholder={compoType === 'au_moins_un' ? 'senior' : 'junior'}
            />
          </div>
        )}

        {/* La moitié qui manquait : une étiquette inédite n'existe pour le
            moteur qu'une fois posée sur des fiches. */}
        {compoTagInedit && selecteurPorteurs('compo-porteurs-lbl', compoPorteurs, setCompoPorteurs)}

        {compoType === 'role_interdit' && (
          <div>
            <label id="compo-role-lbl">Rôle interdit</label>
            <Select
              value={compoRole}
              onValueChange={(v) => setCompoRole(String(v))}
              disabled={isPending}
            >
              <SelectTrigger className="w-full" aria-labelledby="compo-role-lbl">
                {roleLisible(compoRole)}
              </SelectTrigger>
              <SelectContent>
                {rolesCabinet.map((r) => (
                  <SelectItem key={r} value={r}>
                    {roleLisible(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="large">
          <label id="compo-creneaux-lbl">Types de garde concernés</label>
          <div className="chips" role="group" aria-labelledby="compo-creneaux-lbl">
            {typesCreneaux.map((t) => (
              <button
                key={t.code}
                type="button"
                aria-pressed={compoCreneaux.includes(t.code)}
                onClick={() => basculerCreneauCompo(t.code)}
              >
                {t.nom}
              </button>
            ))}
          </div>
          <p className="note">Aucun coché = la règle s&apos;applique à tous les types de garde.</p>
        </div>

        <div className="large">
          <label id="compo-force-lbl">Ce que le moteur en fait</label>
          <Select
            value={compoForce}
            onValueChange={(v) => setCompoForce(String(v))}
            disabled={isPending}
          >
            <SelectTrigger className="w-full" aria-labelledby="compo-force-lbl">
              <EtiquetteForce force={compoForce} />
            </SelectTrigger>
            <SelectContent>
              {FORCES_CHOISISSABLES.map((f) => (
                <SelectItem key={f} value={f}>
                  <span aria-hidden="true">{symboleDe(f)}</span> {choixForce(f)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Consequence texte={aideForce(compoForce)} />
        </div>
      </div>

      <p className="note">
        Une règle par étiquette a besoin d&apos;au moins un porteur : sans personne pour la porter,
        elle serait soit impossible à tenir, soit sans le moindre effet sur le planning.
      </p>

      <div className="panneau-pied">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setCompoOuvert(false)}
          disabled={isPending}
        >
          Annuler
        </button>
        <button
          type="button"
          className="btn btn-accent btn-sm"
          onClick={creerEquipe}
          disabled={isPending || compoTag.trim() === ''}
        >
          {isPending ? 'Un instant…' : 'Créer la règle'}
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Filou explique une pose d'étiquette que le moteur refuse, et porte les
          gestes pour la régler sur place (palier 3). */}
      <GardienImpact
        impact={impactTag}
        geste="poser cette étiquette"
        origine="regles"
        vets={vets.map((v) => ({ id: v.id, prenom: v.prenom, nom: v.nom ?? '' }))}
        onAnnuler={() => setImpactTag(null)}
        onCorrige={() => setImpactTag(null)}
      />

      {/* ══════════════ Carte 1 · Les règles des équipes ══════════════
          « Équipes » et non « cabinet » (MiKL, 2026-08-14) : ce que cette carte
          rassemble, ce sont les contraintes qui portent sur DES GENS — soit
          nommément (« Victor ne fait pas de nuit »), soit par étiquette
          (« les juniors ne sont jamais seuls »). Ce sont exactement les
          contraintes qu'on pose depuis l'onglet Équipe, vues d'ici. Les règles
          qui ne visent personne (équilibrage, préférences) ont leurs propres
          cartes plus bas. */}
      <section className="card">
        <div className="card-head">
          <h2>Règles des équipes</h2>
          <span className={`section-count${toutesActives.length === 0 ? ' zero' : ''}`}>
            {toutesActives.length}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={ouvrirCompo}
            disabled={isPending || compoOuvert}
            title="Une règle qui ne nomme personne : elle vise une étiquette (junior, senior…)"
          >
            <Plus size={15} aria-hidden="true" /> Par étiquette
          </button>
          <button
            type="button"
            className="btn btn-accent btn-sm"
            onClick={ouvrirCreation}
            disabled={isPending}
            title="Une règle qui vise une personne précise"
          >
            <Plus size={15} aria-hidden="true" /> Nouvelle règle
          </button>
          <p className="sub">
            Ce que le moteur doit respecter quand il compose une équipe. Soit pour{' '}
            <strong>quelqu&apos;un</strong> — un jour de repos fixe, une indisponibilité qui
            revient, deux vétérinaires qu&apos;on ne met pas seuls ensemble. Soit pour une{' '}
            <strong>étiquette</strong> de l&apos;équipe — « au moins un senior par week-end », « un
            junior jamais 1er » (les étiquettes se posent sur les fiches, page Équipe). Les deux
            sont rangées ici par ce que le moteur en fait : d&apos;une interdiction qu&apos;il ne
            franchira jamais, à un souhait qu&apos;il honore si ça n&apos;embête personne.
          </p>
        </div>

        {compoOuvert && panneauEquipe()}

        {toutesActives.length === 0 && toutesInactives.length === 0 ? (
          <p className="empty-row">
            Aucune règle pour ce cabinet. Le moteur ne s&apos;interdit donc rien d&apos;autre que
            ce que la structure impose — c&apos;est rarement ce qu&apos;on veut : commence par les
            jours de repos fixes de chacun.
          </p>
        ) : (
          <>
            {GROUPES.map((g) => {
              const lignes = lignesDuGroupe(g.key)
              // Un groupe vide ne s'affiche pas : un titre sans contenu se lit
              // comme un oubli, pas comme une information.
              if (lignes.length === 0) return null
              return (
                <div key={g.key}>
                  <div className="card-head">
                    <h3>
                      <span aria-hidden="true">{g.symbole}</span> {g.titre}
                    </h3>
                    <span className="section-count">{lignes.length}</span>
                  </div>
                  {lignes.map(ligne)}
                </div>
              )
            })}

            {/* Les règles en pause restent LISIBLES : on doit pouvoir décider de
                les rallumer, ce qui suppose de les relire. */}
            {toutesInactives.length > 0 && (
              <div>
                <div className="card-head">
                  <h3>Désactivées</h3>
                  <span className="section-count zero">{toutesInactives.length}</span>
                  <p className="sub">
                    Le moteur ne les lit plus du tout, comme si elles n&apos;existaient pas. Elles
                    restent là pour être rallumées d&apos;un clic.
                  </p>
                </div>
                {[...toutesInactives]
                  .sort((a, b) => etageDe(a.force) - etageDe(b.force))
                  .map(ligne)}
              </div>
            )}
          </>
        )}
      </section>

      {/* ══════════════ Carte 2 · Équilibrage des charges ══════════════ */}
      <section className="card">
        <div className="card-head">
          <h2>Équilibrage des charges</h2>
          <span className="section-count">{EQUITY_DIMENSIONS.length}</span>
          <span className="spacer" />
          {estAdmin && (
            <AideFilou sujet="ajuster l’équilibrage, ou comprendre pourquoi une charge penche" />
          )}
          <p className="sub">
            Ce que le moteur cherche à répartir également entre tout le monde. Chaque ligne a son
            propre poids : « Ignorée » revient à ne pas équilibrer cette charge du tout, «
            Essentielle » à en faire une priorité devant les autres.
          </p>
        </div>

        {EQUITY_DIMENSIONS.map((dim) => (
          <div className="reglage" key={dim} data-regle-cible={dim}>
            <div>
              <div className="reglage-titre">{EQUITE_META[dim].titre}</div>
              <p className="reglage-aide">{EQUITE_META[dim].aide}</p>
            </div>
            <Select
              value={eq[dim]}
              onValueChange={(v) => changerEquite(dim, String(v) as ImportanceLevel)}
              disabled={isPending}
            >
              <SelectTrigger
                className="w-44"
                aria-label={`Importance de l’équilibrage : ${EQUITE_META[dim].titre}`}
              >
                {libelleImportance(eq[dim])}
              </SelectTrigger>
              <SelectContent>
                {IMPORTANCE_LEVELS.map((n) => (
                  <SelectItem key={n} value={n}>
                    {libelleImportance(n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}

        {/* ── Réglage avancé : équilibrer entre certains seulement ──
            C'était une carte à part. Elle ne se comprend qu'en voyant les
            lignes ci-dessus (« ça s'AJOUTE à l'équilibrage général ») : à
            distance, on réglait « Week-ends » sur Essentielle sans voir la
            cohorte qui la rejouait. En base et côté moteur, ces lignes
            s'appellent des cohortes. */}
        <div className="card-head sous-section">
          <h3>Équilibrer entre certains seulement</h3>
          <span className={`section-count${cohortes.length === 0 ? ' zero' : ''}`}>
            {cohortes.length}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => {
              setCoTagChoix(tagsEquipe[0] ?? NOUVELLE_ETIQUETTE)
              setCoTagLibre('')
              setCoPorteurs([])
              setCoDim('weekend')
              setCoImp('important')
              setCohorteOuverte(true)
            }}
            disabled={isPending || cohorteOuverte}
          >
            <Plus size={15} aria-hidden="true" /> Ajouter
          </button>
          <p className="sub">
            Équilibrer une charge <strong>uniquement</strong> entre les vétérinaires portant une
            étiquette. Cela s&apos;ajoute à l&apos;équilibrage général ci-dessus ; pour une
            répartition strictement séparée, mets la ligne générale sur « Ignorée ».
          </p>
        </div>

        {cohorteOuverte && (
            <div className="panneau">
              <p className="panneau-titre">Nouvel équilibrage par étiquette</p>

              <div className="grille">
                <div>
                  <label id="co-dim-lbl">Charge à équilibrer</label>
                  <Select
                    value={coDim}
                    onValueChange={(v) => setCoDim(String(v) as EquityDimension)}
                    disabled={isPending}
                  >
                    <SelectTrigger className="w-full" aria-labelledby="co-dim-lbl">
                      {DIMENSION_LABELS[coDim]}
                    </SelectTrigger>
                    <SelectContent>
                      {EQUITY_DIMENSIONS.map((d) => (
                        <SelectItem key={d} value={d}>
                          {DIMENSION_LABELS[d]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {tagsEquipe.length > 0 ? (
                  <div>
                    <label id="co-tag-lbl">Entre les vétérinaires…</label>
                    <Select
                      value={coTagChoix}
                      onValueChange={(v) => setCoTagChoix(String(v))}
                      disabled={isPending}
                    >
                      <SelectTrigger className="w-full" aria-labelledby="co-tag-lbl">
                        {coTagChoix === NOUVELLE_ETIQUETTE ? 'Une nouvelle étiquette…' : coTagChoix}
                      </SelectTrigger>
                      <SelectContent>
                        {tagsEquipe.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                        <SelectItem value={NOUVELLE_ETIQUETTE}>
                          + Une nouvelle étiquette…
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div>
                    <label htmlFor="co-tag-libre">Entre les vétérinaires…</label>
                    <input
                      id="co-tag-libre"
                      type="text"
                      maxLength={30}
                      value={coTagLibre}
                      onChange={(e) => setCoTagLibre(e.target.value)}
                      placeholder="senior"
                    />
                  </div>
                )}

                {tagsEquipe.length > 0 && coTagChoix === NOUVELLE_ETIQUETTE && (
                  <div>
                    <label htmlFor="co-tag-libre">Laquelle ?</label>
                    <input
                      id="co-tag-libre"
                      type="text"
                      autoFocus
                      maxLength={30}
                      value={coTagLibre}
                      onChange={(e) => setCoTagLibre(e.target.value)}
                      placeholder="senior"
                    />
                  </div>
                )}

                <div>
                  <label id="co-imp-lbl">Importance</label>
                  <Select
                    value={coImp}
                    onValueChange={(v) => setCoImp(String(v) as ImportanceLevel)}
                    disabled={isPending}
                  >
                    <SelectTrigger className="w-full" aria-labelledby="co-imp-lbl">
                      {libelleImportance(coImp)}
                    </SelectTrigger>
                    <SelectContent>
                      {IMPORTANCE_ACTIVES.map((n) => (
                        <SelectItem key={n} value={n}>
                          {libelleImportance(n)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {coTagInedit && selecteurPorteurs('co-porteurs-lbl', coPorteurs, setCoPorteurs)}
              </div>

              <div className="panneau-pied">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setCohorteOuverte(false)}
                  disabled={isPending}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="btn btn-accent btn-sm"
                  onClick={ajouterCohorte}
                  disabled={isPending || coTag.trim() === ''}
                >
                  {isPending ? 'Un instant…' : 'Ajouter'}
                </button>
              </div>
            </div>
          )}

        {cohortes.length === 0 ? (
          <p className="empty-row">
            Rien ici. Les charges ci-dessus sont donc équilibrées entre tout le monde, sans
            distinction d&apos;étiquette.
          </p>
        ) : (
          cohortes.map((c) => (
            <div className="reglage" key={c.id} data-regle-cible={c.id}>
              <div>
                <div className="reglage-titre">
                  {DIMENSION_LABELS[c.dimension as EquityDimension] ?? c.dimension}
                </div>
                <p className="reglage-aide">
                  Équilibré uniquement entre les vétérinaires « {c.tag} ».
                </p>
              </div>
              <div className="reg-actions">
                {/* Pas de « Ignorée » ici : un poids nul ne se stocke pas. Pour
                    ne plus équilibrer ce groupe, on retire la ligne — c'est
                    plus franc qu'un cran qui ne fait rien. */}
                <Select
                  value={c.importance}
                  onValueChange={(v) => changerImportanceCohorte(c, String(v))}
                  disabled={isPending}
                >
                  <SelectTrigger
                    className="w-44"
                    aria-label={`Importance de l’équilibrage entre « ${c.tag} »`}
                  >
                    {libelleImportance(c.importance)}
                  </SelectTrigger>
                  <SelectContent>
                    {IMPORTANCE_ACTIVES.map((n) => (
                      <SelectItem key={n} value={n}>
                        {libelleImportance(n)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => supprimerCohorte(c)}
                  disabled={isPending}
                  aria-label={`Retirer l’équilibrage entre « ${c.tag} »`}
                  title="Retirer"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      {/* ══════════════ Carte 3 · Préférences du planning ══════════════ */}
      <section className="card">
        <div className="card-head">
          <h2>Préférences du planning</h2>
          <span className="spacer" />
          {estAdmin && (
            <AideFilou sujet="demander un égard que le moteur ne sait pas encore tenir" />
          )}
          <p className="sub">
            Des égards que le moteur essaie d&apos;avoir, jamais des interdictions : ils ne
            bloquent pas la génération. C&apos;est pourquoi le choix « Jamais » n&apos;est pas
            proposé ici — une interdiction sans gardien ne bloquerait rien, elle ferait seulement
            croire qu&apos;elle protège.
          </p>
        </div>

        {PENALITES_SOUPLES.map((brique) => {
          const v = ps[brique] ?? { actif: true, force: PENALITE_FORCE_REPLI[brique] }
          const courant = v.actif ? v.force : DESACTIVEE
          return (
            <div className="reglage" key={brique} data-regle-cible={brique}>
              <div>
                <div className="reglage-titre">{PENALITES_META[brique].titre}</div>
                <p className="reglage-aide">{PENALITES_META[brique].aide}</p>
                <Consequence texte={v.actif ? aideForce(v.force) : EFFET_ETEINTE} />
              </div>
              <Select
                value={courant}
                onValueChange={(val) => changerPenalite(brique, String(val))}
                disabled={isPending}
              >
                <SelectTrigger className="w-44" aria-label={PENALITES_META[brique].titre}>
                  <EtiquetteForce force={courant} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DESACTIVEE}>
                    <span aria-hidden="true">⚪</span> Désactivée
                  </SelectItem>
                  {FORCES_SOUPLES.map((f) => (
                    <SelectItem key={f} value={f}>
                      <span aria-hidden="true">{symboleDe(f)}</span> {choixForce(f)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        })}

        <div className="reglage" data-regle-cible="role_avantage_financier">
          <div>
            <div className="reglage-titre">Rôle payé du week-end</div>
            <p className="reglage-aide">
              Le rôle qui rapporte davantage le week-end. Le moteur équilibre qui l&apos;obtient —
              c&apos;est la charge « Rôle de 1er le week-end » de l&apos;équilibrage ci-dessus.
            </p>
          </div>
          <Select
            value={roleAv}
            onValueChange={(v) => changerRoleAvantage(String(v))}
            disabled={isPending}
          >
            <SelectTrigger className="w-44" aria-label="Rôle payé du week-end">
              {ROLE_AVANTAGE_LABELS[roleAv] ?? roleAv}
            </SelectTrigger>
            <SelectContent>
              {ROLE_AVANTAGE_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_AVANTAGE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Il n'y a pas de bouton « nouvelle préférence », et ce n'est pas un
            oubli : ces quatre égards-là sont câblés dans le moteur, on n'en
            écrit pas un cinquième depuis un écran. La porte de sortie est le
            bouton « Demander à Filou » posé EN HAUT de cette carte, là où les
            autres sections ont leur « + Ajouter » — et c'est tout. Il y avait
            ici un paragraphe qui redisait la même chose en quatre lignes :
            une fois le bouton remonté, il ne restait qu'un pavé de plus en bas
            de page. */}
      </section>

      {/* Confirmation de suppression. Elle RAPPELLE la règle concernée : on
          décide sur pièce, pas sur un « êtes-vous sûr ? ». `.gv-rappel` est
          écrite à la racine du CSS, exprès : la modale est rendue en portail,
          hors du conteneur `.v2` qui porte le vocabulaire de l'écran. */}
      <Dialog
        open={Boolean(aSupprimer)}
        onOpenChange={(o) => {
          if (!o && !isPending) setASupprimer(null)
        }}
      >
        <DialogContent className="gv-modale">
          <DialogHeader>
            <DialogTitle>Supprimer cette règle ?</DialogTitle>
            <DialogDescription>
              C&apos;est définitif. Dès la prochaine génération, le moteur ne s&apos;interdira plus
              rien de ce côté-là. Pour la suspendre sans la perdre, préfère la mettre en pause.
            </DialogDescription>
          </DialogHeader>

          {aSupprimer && (
            <div className="gv-rappel">
              <span className={`force-badge force-${aSupprimer.force}`}>
                <span aria-hidden="true">{symboleDe(aSupprimer.force)}</span>{' '}
                {motForce(aSupprimer.force)}
              </span>
              <p>{phraseRegle(aSupprimer, nomVeto)}</p>
              {aSupprimer.brique_id === 'duo_interdit' && (
                <p className="gv-appoint">
                  Cette règle lie deux personnes : la retirer la retire des deux côtés.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setASupprimer(null)} disabled={isPending}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={supprimer} disabled={isPending}>
              {isPending ? 'Un instant…' : 'Supprimer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Le formulaire de règle de la V1, importé TEL QUEL : il porte des
          validations métier qu'aucune refonte visuelle ne justifie de perdre.
          Monté seulement à l'ouverture — son état initial se recalcule à chaque
          fois (la règle éditée n'est jamais la précédente). */}
      {formOuvert && (
        <RegleFormDialog
          open
          onClose={() => setFormOuvert(false)}
          vets={vets}
          periodes={periodes}
          typesCreneaux={typesCreneaux}
          regle={aEditer}
        />
      )}

      {/* Le gardien. Il ne s'ouvre QUE si le moteur a trouvé quelque chose que
          cette règle-là apporte : une règle saine s'enregistre sans un clic de
          plus. `onAssouplir` n'est proposé que pour les règles par étiquette —
          ce sont les seules dont le panneau porte encore la fermeté au moment
          où le gardien parle. */}
      <GardienFilou
        verdict={gardien?.verdict ?? null}
        enCours={isPending}
        onAnnuler={() => setGardien(null)}
        onPasserOutre={() => {
          const ecrire = gardien?.ecrire
          if (!ecrire) return
          startTransition(async () => { await ecrire() })
        }}
        onAssouplir={
          compoOuvert
            ? (force) => {
                setCompoForce(force)
                toast.info('Fermeté ramenée à « sauf urgence ». Revalide quand tu veux.')
              }
            : undefined
        }
      />

      {dialogueErreur}
    </>
  )
}
