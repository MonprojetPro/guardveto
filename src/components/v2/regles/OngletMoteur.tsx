'use client'

// ============================================================
// GUARDVETO V2 — Onglet 4 · Règles du moteur
// ============================================================
// Tout ce que le moteur doit respecter quand il fabrique un planning. C'est le
// plus gros des quatre onglets : il reprend l'INTÉGRALITÉ de l'ancienne page
// `/regles` V1, qui était éclatée en trois composants sans lien visuel entre
// eux (`ReglesClient`, `CompositionEquipeClient`, `ReglagesPlanningClient`).
// Cinq cartes ici, de la plus concrète à la plus abstraite : les règles qui
// nomment quelqu'un, celles qui parlent d'étiquettes, l'équilibrage, ses
// équilibrages par étiquette, puis les préférences de confort.
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
  type CohorteEquiteUI, type CompositionReglePayload,
  type RoleInterditReglePayload, type ForceFormulaire,
} from '@/app/(protected)/regles/actions'
import { RegleFormDialog } from '@/components/regles/RegleFormDialog'
import { AideFilou } from './AideFilou'
import {
  BRIQUES_EDITABLES,
  type RegleRow, type PeriodeOption, type TypeCreneauOption,
} from '@/components/regles/ReglesClient'
import type { RegleEquipeUI } from '@/components/regles/CompositionEquipeClient'
import type { StructureRegleUI } from '@/components/regles/ReglagesPlanningClient'
import type { VetoUI } from './types'

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
 *  déroulante du projet refuse la valeur vide, d'où une valeur nommée. */
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
    titre: 'Soirs de semaine — 1er',
    aide: 'Équilibrer les soirs de semaine assurés en 1er.',
  },
  semaine_second: {
    titre: 'Soirs de semaine — 2nd',
    aide: 'Équilibrer les soirs de semaine assurés en 2nd.',
  },
  semaine_renfort: {
    titre: 'Soirs de semaine — renfort',
    aide: 'Équilibrer les soirs de semaine tenus à partir de la 3ᵉ place. Sans objet tant qu’un type de garde n’a que deux places.',
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
  semaine_premier: 'Soirs de semaine — 1er',
  semaine_second: 'Soirs de semaine — 2nd',
  semaine_renfort: 'Soirs de semaine — renfort',
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

/** Ce qu'une action serveur de cet écran peut répondre. */
type Reponse = { error?: string; success?: boolean } | undefined

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

  // ── Carte 1 : règles du cabinet ──
  const [aSupprimer, setASupprimer] = useState<RegleRow | null>(null)
  const [formOuvert, setFormOuvert] = useState(false)
  const [aEditer, setAEditer] = useState<RegleRow | null>(null)

  // ── Carte 2 : composition d'équipe ──
  const [compoOuvert, setCompoOuvert] = useState(false)
  const [compoType, setCompoType] = useState<TypeRegleEquipe>('au_moins_un')
  // L'étiquette se choisit dans la liste de ce que l'équipe porte ; la
  // sentinelle ouvre le champ libre à côté (cas rare, mais il doit rester
  // possible : on pose parfois la règle avant l'étiquette).
  const [compoTagChoix, setCompoTagChoix] = useState<string>(
    tagsEquipe[0] ?? NOUVELLE_ETIQUETTE,
  )
  const [compoTagLibre, setCompoTagLibre] = useState('')
  const [compoRole, setCompoRole] = useState(rolesCabinet[0] ?? 'premier')
  const [compoCreneaux, setCompoCreneaux] = useState<string[]>([])
  const [compoForce, setCompoForce] = useState<string>('jamais')

  // ── Cartes 3 et 5 : réglages optimistes (affichés avant la réponse serveur,
  //    repris en arrière si elle refuse — sinon le menu montrerait une valeur
  //    que la base n'a pas). ──
  const [eq, setEq] = useState(equite)
  const [ps, setPs] = useState(penalitesSouples)
  const [roleAv, setRoleAv] = useState(roleAvantage)

  // ── Carte 4 : cohortes d'équité ──
  const [cohorteOuverte, setCohorteOuverte] = useState(false)
  const [coDim, setCoDim] = useState<EquityDimension>('weekend')
  const [coTag, setCoTag] = useState(tagsEquipe[0] ?? '')
  const [coImp, setCoImp] = useState<ImportanceLevel>('important')

  /**
   * Le halo de `?focus=`. On arrive ici depuis un diagnostic d'impasse qui
   * désigne UN réglage : sans repère, on atterrit dans une longue liste et on
   * cherche. Purement cosmétique et défensif — une ancre inconnue ne casse
   * rien, elle ne fait simplement rien.
   */
  useEffect(() => {
    if (!focus) return
    const safe =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(focus)
        : focus.replace(/["\\]/g, '\\$&')
    const el = document.querySelector<HTMLElement>(
      `[data-regle-cible="${safe}"], [data-regle-cible-alt="${safe}"]`,
    )
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('cible-focus')
    const timer = window.setTimeout(() => el.classList.remove('cible-focus'), 2600)
    return () => window.clearTimeout(timer)
  }, [focus])

  const nomVeto = (id: string) => vets.find((v) => v.id === id)?.prenom ?? id

  const labelPeriode = (id?: string | null) =>
    id ? (periodes.find((p) => p.id === id)?.label ?? 'période supprimée') : null

  const nomCreneau = (code: string) =>
    typesCreneaux.find((t) => t.code === code)?.nom ?? code

  // Une seule ligne par duo : la base en stocke deux sens (A→B et B→A), le
  // moteur a besoin des deux, l'écran n'en montre qu'un.
  const actives = useMemo(() => fusionnerDuos(regles.filter((r) => r.actif)), [regles])
  const inactives = useMemo(() => fusionnerDuos(regles.filter((r) => !r.actif)), [regles])

  /** L'étiquette réellement retenue par le panneau d'ajout de règle d'équipe. */
  const compoTag = compoTagChoix === NOUVELLE_ETIQUETTE ? compoTagLibre : compoTagChoix

  // ── Carte 1 — actions ──────────────────────────────────────

  const ouvrirCreation = () => {
    setAEditer(null)
    setFormOuvert(true)
  }

  const ouvrirEdition = (regle: RegleRow) => {
    // Certaines briques (équité, liaisons…) n'ont pas de formulaire : on le dit
    // plutôt que d'ouvrir une fenêtre qui ne saurait pas les remplir.
    if (!BRIQUES_EDITABLES.has(regle.brique_id)) {
      toast.info("Ce type de règle ne s'édite pas depuis le formulaire.")
      return
    }
    setAEditer(regle)
    setFormOuvert(true)
  }

  const basculer = (regle: RegleRow) => {
    startTransition(async () => {
      const res: Reponse = await setRegleActif(regle.id, !regle.actif)
      if (res?.error) {
        toast.error(res.error)
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
        toast.error(res.error)
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
          toast.error(res.error)
          return
        }
        toast.success('Règle mise en pause.')
        router.refresh()
        return
      }
      const res: Reponse = await reecrireEquipe(r, choix as ForceFormulaire)
      if (res?.error) {
        toast.error(res.error)
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
        toast.error(res.error)
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
    setCompoRole(rolesCabinet[0] ?? 'premier')
    setCompoCreneaux([])
    setCompoForce('jamais')
    setCompoOuvert(true)
  }

  const creerEquipe = () => {
    const tag = compoTag.trim().toLowerCase()
    if (tag === '') {
      toast.error('Indique l’étiquette concernée (junior, senior…).')
      return
    }
    startTransition(async () => {
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
      if (res?.error) {
        toast.error(res.error)
        return
      }
      toast.success('Règle d’équipe créée — appliquée à la prochaine génération.')
      setCompoOuvert(false)
      router.refresh()
    })
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
        toast.error(res.error)
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
        toast.error(res.error)
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
        toast.error(res.error)
        return
      }
      toast.success('Équilibrage par étiquette retiré.')
      router.refresh()
    })
  }

  const ajouterCohorte = () => {
    const tag = coTag.trim().toLowerCase()
    if (tag === '') {
      toast.error('Choisis une étiquette.')
      return
    }
    startTransition(async () => {
      const res: Reponse = await setCohorteEquite(coDim, tag, coImp)
      if (res?.error) {
        toast.error(res.error)
        return
      }
      toast.success('Équilibrage par étiquette ajouté — appliqué à la prochaine génération.')
      setCohorteOuverte(false)
      router.refresh()
    })
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
        toast.error(res.error)
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
        toast.error(res.error)
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

  const lignesDuGroupe = (key: GroupeKey) =>
    actives
      .filter((r) => groupeDe(r.force) === key)
      .sort(
        (a, b) =>
          etageDe(a.force) - etageDe(b.force) || a.brique_id.localeCompare(b.brique_id),
      )

  return (
    <>
      {/* ══════════════ Carte 1 · Les règles du cabinet ══════════════ */}
      <section className="card">
        <div className="card-head">
          <h2>Règles du cabinet</h2>
          <span className={`section-count${actives.length === 0 ? ' zero' : ''}`}>
            {actives.length}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-accent btn-sm"
            onClick={ouvrirCreation}
            disabled={isPending}
          >
            <Plus size={15} aria-hidden="true" /> Nouvelle règle
          </button>
          <p className="sub">
            Ce que le moteur doit respecter pour telle ou telle personne : un jour de repos fixe,
            une indisponibilité qui revient, deux vétérinaires qu&apos;on ne met pas seuls
            ensemble, une préférence de confort. Elles sont rangées par ce que le moteur en fait —
            d&apos;une interdiction qu&apos;il ne franchira jamais, à un souhait qu&apos;il honore
            si ça n&apos;embête personne.
          </p>
        </div>

        {actives.length === 0 && inactives.length === 0 ? (
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
                  {lignes.map((r) => (
                    <LigneRegle key={r.id} regle={r} />
                  ))}
                </div>
              )
            })}

            {/* Les règles en pause restent LISIBLES : on doit pouvoir décider de
                les rallumer, ce qui suppose de les relire. */}
            {inactives.length > 0 && (
              <div>
                <div className="card-head">
                  <h3>Désactivées</h3>
                  <span className="section-count zero">{inactives.length}</span>
                  <p className="sub">
                    Le moteur ne les lit plus du tout, comme si elles n&apos;existaient pas. Elles
                    restent là pour être rallumées d&apos;un clic.
                  </p>
                </div>
                {[...inactives]
                  .sort((a, b) => etageDe(a.force) - etageDe(b.force))
                  .map((r) => (
                    <LigneRegle key={r.id} regle={r} />
                  ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* ══════════════ Carte 2 · Composition d'équipe ══════════════ */}
      <section className="card">
        <div className="card-head">
          <h2>Composition d&apos;équipe</h2>
          <span className={`section-count${reglesEquipe.length === 0 ? ' zero' : ''}`}>
            {reglesEquipe.length}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={ouvrirCompo}
            disabled={isPending || compoOuvert}
          >
            <Plus size={15} aria-hidden="true" /> Ajouter
          </button>
          <p className="sub">
            Des règles qui ne nomment personne : elles parlent des{' '}
            <strong>étiquettes</strong> de l&apos;équipe (junior, senior…). « Au moins un senior
            par week-end », « un junior jamais seul », « un junior jamais 1er ». Les étiquettes se
            posent sur les fiches, page Équipe.
          </p>
        </div>

        {compoOuvert && (
          <div className="panneau">
            <p className="panneau-titre">Nouvelle règle d&apos;équipe</p>

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

              {/* L'étiquette : une liste de ce que l'équipe porte réellement.
                  Le champ libre n'apparaît que si on demande une étiquette
                  inédite — et il est seul quand l'équipe n'en porte aucune. */}
              {tagsEquipe.length > 0 ? (
                <div>
                  <label id="compo-tag-lbl">Étiquette</label>
                  <Select
                    value={compoTagChoix}
                    onValueChange={(v) => setCompoTagChoix(String(v))}
                    disabled={isPending}
                  >
                    <SelectTrigger className="w-full" aria-labelledby="compo-tag-lbl">
                      {compoTagChoix === NOUVELLE_ETIQUETTE
                        ? 'Une nouvelle étiquette…'
                        : compoTagChoix}
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
                    Aucune étiquette n&apos;est encore posée sur l&apos;équipe. Écris-la ici, puis
                    va la poser sur les fiches concernées, page Équipe : sans porteur, le serveur
                    refusera la règle.
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
                <label id="compo-creneaux-lbl">Créneaux concernés</label>
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
              L&apos;étiquette doit déjà être portée par au moins un vétérinaire actif : sinon la
              règle serait soit impossible à tenir, soit sans aucun effet. Le serveur la refusera
              en le disant.
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
        )}

        {reglesEquipe.length === 0 ? (
          <p className="empty-row">
            Aucune règle d&apos;équipe. Le moteur compose donc librement, sans regarder qui est
            junior ni qui est senior.
          </p>
        ) : (
          reglesEquipe.map((r) => {
            const courant = r.actif ? r.force : DESACTIVEE
            return (
              <div key={r.id} className="reg-ligne" data-regle-cible={r.id}>
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
          })
        )}
      </section>

      {/* ══════════════ Carte 3 · Équilibrage des charges ══════════════ */}
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
      </section>

      {/* ═══════ Carte 4 · Équilibrage entre certains seulement ═══════ */}
      <section className="card">
        <div className="card-head">
          <h2>Équilibrer entre certains seulement</h2>
          <span className={`section-count${cohortes.length === 0 ? ' zero' : ''}`}>
            {cohortes.length}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => {
              setCoTag(tagsEquipe[0] ?? '')
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

        {cohorteOuverte &&
          (tagsEquipe.length === 0 ? (
            <div className="panneau">
              <p className="note">
                Aucune étiquette n&apos;est posée sur l&apos;équipe : cet équilibrage n&apos;aurait
                personne à équilibrer. Ajoute d&apos;abord des étiquettes sur les fiches, page
                Équipe.
              </p>
              <div className="panneau-pied">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setCohorteOuverte(false)}
                >
                  Fermer
                </button>
              </div>
            </div>
          ) : (
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

                <div>
                  <label id="co-tag-lbl">Entre les vétérinaires…</label>
                  <Select
                    value={coTag}
                    onValueChange={(v) => setCoTag(String(v))}
                    disabled={isPending}
                  >
                    <SelectTrigger className="w-full" aria-labelledby="co-tag-lbl">
                      {coTag || 'Choisir…'}
                    </SelectTrigger>
                    <SelectContent>
                      {tagsEquipe.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

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
                  {isPending ? 'Un instant…' : 'Ajouter la cohorte'}
                </button>
              </div>
            </div>
          ))}

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
                    aria-label={`Importance de la cohorte « ${c.tag} »`}
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
                  aria-label={`Retirer la cohorte « ${c.tag} »`}
                  title="Retirer la cohorte"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      {/* ══════════════ Carte 5 · Préférences du planning ══════════════ */}
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
    </>
  )
}
