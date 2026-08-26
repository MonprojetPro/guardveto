'use client'

// ============================================================
// GUARDVETO — Formulaire guidé de règle (P1A-007)
// ============================================================
// Création / édition d'une règle de cabinet, en langage naturel.
// Étapes : QUI (véto) → QUOI (type de règle) → ses paramètres →
// FORCE → APERÇU live. Écrit via upsertRegle (params_json bâti côté
// serveur, frontière de confiance).
//
// ⚠️ NE PROPOSE QUE LES BRIQUES ÉVALUABLES par le moteur (interdire_creneau,
//    repos_conditionnel, alternance_ancre, duo_interdit, au_plus_n, espacement_min).
//    Proposer une brique sans évaluateur créerait une règle silencieusement
//    ignorée (coquille vide). Doit rester aligné avec BRIQUES_EVALUABLES (actions.ts).
//
// L'aperçu réutilise EXACTEMENT le rendu de la liste (catalogue P1A-005) :
// ce que l'admin lit en construisant = ce qui s'affichera ensuite.
// ============================================================

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { rendreRegle } from '@/engine/briques/catalogue'
import { choixForce, symboleDe, aideForce } from '@/lib/regles/libelle'
import '@/styles/regles-forces.css'
import { upsertRegle, verifierRegle } from '@/app/(protected)/regles/actions'
// Les TYPES viennent de leur module, jamais de `actions.ts` : ce fichier est en
// `'use server'`, et un type qu'il réexporte devient un export runtime fantôme
// (ReferenceError en production — incident du 2026-08-02).
import type { BriqueEvaluable, ForceFormulaire } from '@/lib/regles/paramsRegle'
// Valeurs runtime (constantes + lecteur pur) : `paramsRegle` n'est PAS 'use server',
// on peut donc les importer normalement — cf. la note ci-dessus sur actions.ts.
import {
  OWNER_TOUS, LIBELLE_OWNER_TOUS, BRIQUES_SANS_TOUS, lireOwner,
} from '@/lib/regles/paramsRegle'
import type { VerdictGardien } from '@/data/verifierRegleCandidate'
import { GardienFilou } from '@/components/v2/regles/GardienFilou'
import { useErreurBloquante } from '@/components/v2/regles/ErreurBloquante'
import type { RegleRow, VetoMini, PeriodeOption, TypeCreneauOption } from './ReglesClient'
import { nomVetoOuRetire } from '@/lib/regles/libelle'

/** Valeur sentinelle du sélecteur de validité = règle permanente (periode_id null). */
const PERMANENTE = '__permanente__'

// ── Référentiels d'affichage ─────────────────────────────────

const JOURS = [
  { value: 'lundi', label: 'Lundi' },
  { value: 'mardi', label: 'Mardi' },
  { value: 'mercredi', label: 'Mercredi' },
  { value: 'jeudi', label: 'Jeudi' },
  { value: 'vendredi', label: 'Vendredi' },
]

/** Parité des semaines pour un repos fixe (B-038). Au SINGULIER : c'est le mot
  * que lisent le moteur et le validateur dans la forme « tableau de règles ». */
const PARITES = [
  { value: 'toutes', label: 'Toutes les semaines' },
  { value: 'paire', label: 'Semaines paires seulement' },
  { value: 'impaire', label: 'Semaines impaires seulement' },
]

const BRIQUES: { value: BriqueEvaluable; label: string; aide: string }[] = [
  { value: 'interdire_creneau', label: 'Repos fixe un jour', aide: 'Ne fait jamais de garde un jour précis de la semaine — toutes les semaines, ou une semaine sur deux.' },
  { value: 'repos_conditionnel', label: 'Repos selon la garde du week-end', aide: 'Jour de repos différent selon que le véto est de garde le week-end ou non.' },
  { value: 'alternance_ancre', label: 'Indisponible une semaine sur deux', aide: 'Indisponible certains créneaux les semaines paires ou impaires.' },
  { value: 'duo_interdit', label: 'Jamais en duo avec…', aide: 'Deux vétos ne peuvent pas être de garde seuls ensemble (réglé dans les deux sens).' },
  { value: 'au_plus_n', label: 'Limite de gardes', aide: 'Au plus N gardes sur une fenêtre (semaine civile ou jours glissants).' },
  { value: 'espacement_min', label: 'Espacement minimal', aide: 'Au moins X jours de repos entre deux gardes du même véto.' },
  { value: 'espacement_weekend', label: 'Fréquence des week-ends', aide: 'Au plus un week-end de garde toutes les N semaines (« un week-end sur N »).' },
  // Desiderata (n°7) — préférences POSITIVES, toujours souples.
  { value: 'preferer_creneau', label: 'Préférence de jours / créneaux', aide: 'Le moteur essaie de placer ses gardes sur les jours ou créneaux qu’il préfère. Jamais bloquant.' },
  { value: 'preferer_avec', label: 'Préfère être de garde avec…', aide: 'Le moteur essaie de le mettre en binôme avec ce co-équipier. Jamais bloquant.' },
  { value: 'volume_gardes', label: 'Souhaite plus / moins de gardes', aide: 'Biais assumé sur la répartition : le moteur lui donne plus (ou moins) de gardes que la moyenne. Jamais bloquant.' },
  // Successions / séries / repos avancés (#13).
  { value: 'succession_interdite', label: 'Enchaînement interdit', aide: 'Ne fait jamais un type de garde le lendemain d’un autre (ex. pas de soir de semaine le lendemain d’un week-end).' },
  { value: 'serie_max', label: 'Jours de garde d’affilée (max)', aide: 'Jamais plus de N jours de garde consécutifs.' },
  { value: 'repos_apres_serie', label: 'Repos après une série', aide: 'Après N jours de garde d’affilée, imposer M jours sans garde.' },
  // Cadencement « 1 WE sur N ancré » (#20).
  { value: 'cadencement_weekend', label: 'Week-ends calés sur un cycle fixe', aide: 'Cas type : pompier volontaire de garde 1 week-end sur 3 à dates fixes. Ces week-ends lui sont interdits (ou au contraire ses gardes doivent tomber dessus).' },
  // Exclusion de dates / XOR « pas les deux » (#15a).
  // « XOR » est le nom technique de cette règle (ou exclusif) : il reste dans
  // le code, jamais dans ce que lit une vétérinaire.
  { value: 'exclusion_dates', label: 'L’une ou l’autre, jamais les deux (ex. 24 ou 31 déc)', aide: 'Le vétérinaire ne fait jamais de garde aux DEUX dates à la fois (mais peut en faire une). Cas type : Noël ou Nouvel An, pas les deux.' },
  { value: 'seulement_avec', label: 'De garde seulement avec…', aide: 'Le vétérinaire n’est de garde QUE si un binôme précis est de garde sur le même créneau (dans un seul sens). Cas type : un jeune véto accompagné d’un senior. L’inverse n’est PAS imposé.' },
]

/** Desiderata : préférences pures — le niveau « Interdiction ferme » est exclu. */
const BRIQUES_SOUPLES_SEULEMENT = new Set<BriqueEvaluable>([
  'preferer_creneau', 'preferer_avec', 'volume_gardes',
])

/** Jours proposés pour une PRÉFÉRENCE (7 jours — un week-end est daté samedi). */
const JOURS_TOUS = [
  ...JOURS,
  { value: 'samedi', label: 'Samedi' },
  { value: 'dimanche', label: 'Dimanche' },
]

/** Fenêtres de comptage pour « au plus N gardes » (alignées sur FENETRES_VALIDES). */
const FENETRES = [
  { value: 'semaine_civile', label: 'par semaine civile (lun→dim)' },
  { value: 'glissante_7_jours', label: 'sur 7 jours glissants' },
  { value: 'glissante_14_jours', label: 'sur 14 jours glissants' },
  { value: 'glissante_30_jours', label: 'sur 30 jours glissants' },
]

/** Les 4 niveaux proposables, dans l'ordre du plus dur au plus souple.
 *  Libellés, symboles et aides viennent de `lib/regles/libelle` — source unique
 *  partagée avec la fiche véto et l'écran Règles. */
const FORCES: { value: ForceFormulaire; label: string; symbole: string; aide: string }[] = (
  ['jamais', 'sauf_crise', 'evitee', 'si_possible'] as ForceFormulaire[]
).map((value) => ({
  value,
  label: choixForce(value),
  symbole: symboleDe(value),
  aide: aideForce(value),
}))

const SEMAINES = [
  { value: 'paires', label: 'Semaines paires' },
  { value: 'impaires', label: 'Semaines impaires' },
  { value: 'toutes', label: 'Toutes les semaines' },
]

const PERIODES = [
  { value: 'soir_semaine', label: 'Soirs de semaine' },
  { value: 'weekend', label: 'Week-ends' },
]

/** Force par défaut « naturelle » de chaque brique (alignée sur le pilote). */
const FORCE_DEFAUT: Record<BriqueEvaluable, ForceFormulaire> = {
  duo_interdit: 'jamais',
  alternance_ancre: 'sauf_crise',
  repos_conditionnel: 'sauf_crise',
  interdire_creneau: 'evitee',
  au_plus_n: 'sauf_crise',      // limite protectrice : ferme mais pliable en crise
  espacement_min: 'sauf_crise', // idem (trop dur → risque d'impasse)
  espacement_weekend: 'si_possible', // fréquence WE = préférence (ne jamais bloquer)
  preferer_creneau: 'si_possible',   // desiderata = préférences pures (n°7)
  preferer_avec: 'si_possible',
  volume_gardes: 'si_possible',
  // Successions / séries / repos avancés (#13) : sécurité de rythme, ferme
  // mais pliable en crise (comme espacement_min) — évite les impasses.
  succession_interdite: 'sauf_crise',
  serie_max: 'sauf_crise',
  repos_apres_serie: 'sauf_crise',
  // Cadencement WE (#20) : le cas « interdit » (pompier réellement pris) est
  // ferme par défaut — un engagement extérieur ne se plie pas à la crise.
  cadencement_weekend: 'jamais',
  // Exclusion « pas les deux » (#15a) : le cas métier (24 XOR 31 déc) est une
  // exigence forte mais pliable en dernier recours (ne pas casser une génération).
  exclusion_dates: 'sauf_crise',
  // Seulement avec B (#15b) : « accompagné d'un senior » est une exigence de
  // sécurité forte mais pliable en crise (comme au_plus_n) — évite les impasses.
  seulement_avec: 'sauf_crise',
}

// ── Composant ────────────────────────────────────────────────

interface RegleFormDialogProps {
  open: boolean
  onClose: () => void
  vets: VetoMini[]
  periodes: PeriodeOption[]
  /** Types de créneaux du cabinet — filtre optionnel de au_plus_n (n°19). */
  typesCreneaux: TypeCreneauOption[]
  regle?: RegleRow | null
  /**
   * Véto pré-sélectionné à la CRÉATION. Quand on ouvre le formulaire depuis la
   * fiche de quelqu'un (écran Équipe → « Ses contraintes »), la règle porte
   * évidemment sur cette personne-là : la proposer d'office évite le piège
   * classique — enregistrer une contrainte sur le premier véto de la liste.
   * Sans effet en édition, où le propriétaire vient de la règle elle-même.
   */
  ownerParDefaut?: string
}

export function RegleFormDialog({ open, onClose, vets, periodes: periodesDispo, typesCreneaux, regle, ownerParDefaut }: RegleFormDialogProps) {
  const router = useRouter()
  const isEdit = Boolean(regle)
  const [isPending, startTransition] = useTransition()

  /**
   * Filou gardien : ce que le moteur a trouvé sur cette règle, et le payload
   * qu'il retient tant que l'admin n'a pas tranché. On conserve le payload
   * EXAMINÉ plutôt que de le reconstruire au moment du « quand même » : entre
   * les deux, un champ pourrait avoir changé, et on écrirait alors une règle
   * que personne n'a vérifiée.
   */
  const [gardien, setGardien] = useState<{
    verdict: VerdictGardien
    payload: Parameters<typeof upsertRegle>[0]
  } | null>(null)

  // Les refus de saisie s'affichent en MODALE, plus en vignette de bas d'écran.
  // MiKL, 2026-08-02 : « on a dit qu'on arrêtait avec ces petites modales
  // pourries en bas de page ». Ce formulaire en avait vingt-et-une — il était
  // resté à l'écart de la bascule du 1er août parce qu'il vit hors du dossier
  // des onglets V2, alors qu'il s'ouvre depuis les mêmes écrans.
  // `avantDeQuitter` referme CE formulaire quand la modale emmène ailleurs
  // (« Voir la règle existante ») : il est rendu par-dessus l'écran, et une
  // navigation vers `/regles?focus=…` ne le démonte pas — il masquerait la
  // règle qu'on vient d'aller voir.
  const { ouvrirErreur, ouvrirRefus, dialogueErreur } = useErreurBloquante({
    avantDeQuitter: onClose,
  })

  const pj = (regle?.params_json ?? {}) as {
    qui?: { refs?: unknown }
    params?: Record<string, unknown>
  }
  // `lireOwner` rend OWNER_TOUS pour une règle collective : sans lui, rouvrir
  // une règle « tous » la ferait retomber sur le 1er véto de la liste et la
  // transformerait silencieusement en règle individuelle à l'enregistrement.
  const ownerInit = lireOwner(pj) ?? (ownerParDefaut ?? vets[0]?.id ?? '')
  const p = pj.params ?? {}

  const [briqueId, setBriqueId] = useState<BriqueEvaluable>(
    (regle?.brique_id as BriqueEvaluable) ?? 'interdire_creneau',
  )
  const [ownerId, setOwnerId] = useState(ownerInit)
  const [force, setForce] = useState<ForceFormulaire>(
    (regle?.force as ForceFormulaire) ?? FORCE_DEFAUT.interdire_creneau,
  )

  // interdire_creneau
  // Plusieurs jours possibles depuis B-041. `jour` (singulier) reste lu pour
  // les regles deja en base, qui sont toutes en forme simple.
  const [jours, setJours] = useState<string[]>(() => {
    const entrees = Array.isArray(p.regles) ? (p.regles as Array<Record<string, unknown>>) : []
    const depuisTableau = entrees
      .map((r) => r.jour)
      .filter((j): j is string => typeof j === 'string')
    if (depuisTableau.length > 0) return depuisTableau
    return typeof p.jour === 'string' ? [p.jour] : ['mercredi']
  })
  const toggleJour = (j: string) =>
    setJours((prev) => (prev.includes(j) ? prev.filter((x) => x !== j) : [...prev, j]))
  const [exVac, setExVac] = useState(Boolean(p.exception_vacances_scolaires))
  // Parité des semaines visées (B-038). Relue depuis la forme « tableau de
  // règles » — la seule que les deux gardiens savent évaluer avec une parité.
  const [parite, setParite] = useState<string>(() => {
    const entrees = Array.isArray(p.regles) ? (p.regles as Array<Record<string, unknown>>) : []
    const trouvee = entrees.find((r) => r.semaine === 'paire' || r.semaine === 'impaire')
    return typeof trouvee?.semaine === 'string' ? trouvee.semaine : 'toutes'
  })

  // repos_conditionnel
  const [siWe, setSiWe] = useState(typeof p.si_garde_we === 'string' ? p.si_garde_we : 'jeudi')
  const [sinon, setSinon] = useState(typeof p.sinon === 'string' ? p.sinon : 'vendredi')

  // alternance_ancre
  const [semaines, setSemaines] = useState<string>(typeof p.semaines === 'string' ? p.semaines : 'impaires')
  const [periodes, setPeriodes] = useState<string[]>(
    Array.isArray(p.periodes) ? (p.periodes as string[]).filter((x) => x === 'soir_semaine' || x === 'weekend') : ['weekend'],
  )

  // duo_interdit
  const autresVets = vets.filter((v) => v.id !== ownerId)
  const [avecId, setAvecId] = useState(
    typeof p.avec_veterinaire_id === 'string' ? p.avec_veterinaire_id : (autresVets[0]?.id ?? ''),
  )

  // au_plus_n
  const [n, setN] = useState<string>(
    typeof p.n === 'number' ? String(p.n) : typeof p.n === 'string' ? p.n : '2',
  )
  const [fenetre, setFenetre] = useState<string>(
    typeof p.fenetre === 'string' && FENETRES.some((f) => f.value === p.fenetre) ? p.fenetre : 'semaine_civile',
  )
  // au_plus_n — filtre optionnel par types de créneaux du cabinet (n°19).
  // Vide = toutes les gardes comptent (comportement historique).
  const [creneauxFiltre, setCreneauxFiltre] = useState<string[]>(
    Array.isArray(p.creneaux)
      ? (p.creneaux as unknown[]).filter(
          (x): x is string => typeof x === 'string' && typesCreneaux.some((t) => t.code === x),
        )
      : [],
  )

  // espacement_min
  const [ecartMin, setEcartMin] = useState<string>(
    typeof p.ecart_min_jours === 'number' ? String(p.ecart_min_jours)
      : typeof p.ecart_min_jours === 'string' ? p.ecart_min_jours : '3',
  )

  // espacement_weekend (« un week-end sur N »)
  const [nSemaines, setNSemaines] = useState<string>(
    typeof p.n_semaines === 'number' ? String(p.n_semaines)
      : typeof p.n_semaines === 'string' ? p.n_semaines : '2',
  )

  // preferer_creneau (n°7) : jours préférés + créneaux préférés (creneaux partagé
  // avec le filtre au_plus_n — même état creneauxFiltre, validé par brique).
  const [joursPref, setJoursPref] = useState<string[]>(
    Array.isArray(p.jours)
      ? (p.jours as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
  )

  // volume_gardes (n°7)
  const [sens, setSens] = useState<string>(p.sens === 'moins' ? 'moins' : 'plus')

  // succession_interdite (#13) — codes de créneaux du cabinet (défaut : 1ers dispos).
  const [typeAvant, setTypeAvant] = useState<string>(
    typeof p.type_avant === 'string' && typesCreneaux.some((t) => t.code === p.type_avant)
      ? p.type_avant : (typesCreneaux[0]?.code ?? ''),
  )
  const [typeApres, setTypeApres] = useState<string>(
    typeof p.type_apres === 'string' && typesCreneaux.some((t) => t.code === p.type_apres)
      ? p.type_apres : (typesCreneaux[0]?.code ?? ''),
  )

  // serie_max (#13) — n_jours (le filtre creneaux réutilise creneauxFiltre).
  const [nJoursSerie, setNJoursSerie] = useState<string>(
    typeof p.n_jours === 'number' ? String(p.n_jours)
      : typeof p.n_jours === 'string' ? p.n_jours : '3',
  )

  // repos_apres_serie (#13) — n_jours + repos_jours.
  const [nJoursRepos, setNJoursRepos] = useState<string>(
    typeof p.n_jours === 'number' ? String(p.n_jours)
      : typeof p.n_jours === 'string' ? p.n_jours : '2',
  )
  const [reposJours, setReposJours] = useState<string>(
    typeof p.repos_jours === 'number' ? String(p.repos_jours)
      : typeof p.repos_jours === 'string' ? p.repos_jours : '2',
  )

  // cadencement_weekend (#20) — cycle (n_semaines dédié), date d'ancrage, sens.
  const [nSemainesCadence, setNSemainesCadence] = useState<string>(
    typeof p.n_semaines === 'number' && briqueId === 'cadencement_weekend' ? String(p.n_semaines)
      : typeof p.n_semaines === 'string' && briqueId === 'cadencement_weekend' ? p.n_semaines : '3',
  )
  const [ancre, setAncre] = useState<string>(typeof p.ancre === 'string' ? p.ancre : '')
  const [sensCadence, setSensCadence] = useState<string>(
    p.sens === 'impose' ? 'impose' : 'interdit',
  )

  // exclusion_dates (#15a) — deux formes : « fêtes » (défaut) ou « dates libres ».
  const pFetes = Array.isArray(p.fetes)
    ? (p.fetes as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  const pDates = Array.isArray(p.dates)
    ? (p.dates as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  // Une règle en édition qui porte des dates → mode « dates » ; sinon « fetes ».
  const [formeExclusion, setFormeExclusion] = useState<'fetes' | 'dates'>(
    pDates.length === 2 ? 'dates' : 'fetes',
  )
  const [dateExcl1, setDateExcl1] = useState<string>(pDates[0] ?? '')
  const [dateExcl2, setDateExcl2] = useState<string>(pDates[1] ?? '')
  // La forme « fêtes » du cas métier dominant = paire fixe (Noël / Nouvel An).
  const FETES_FIN_ANNEE = ['noel', 'nouvel_an'] as const
  void pFetes // (paire fixe : pas de sélecteur à ce stade — cas métier unique)

  // Validité : PERMANENTE (par défaut) ou limitée à une période existante.
  const periodeInit = regle?.periode_id && periodesDispo.some((per) => per.id === regle.periode_id)
    ? regle.periode_id
    : PERMANENTE
  const [validite, setValidite] = useState<string>(periodeInit)

  const repliVeto = nomVetoOuRetire(vets)
  const nomVeto = (id: string) =>
    id === OWNER_TOUS ? LIBELLE_OWNER_TOUS : repliVeto(id)

  /** « Tous » n'a de sens que pour les règles qui ne nomment pas de partenaire. */
  const peutViserTous = !BRIQUES_SANS_TOUS.has(briqueId)

  const choisirBrique = (b: BriqueEvaluable) => {
    setBriqueId(b)
    setForce(FORCE_DEFAUT[b])
    // Passer sur une règle « avec un partenaire » alors que « tous » était
    // sélectionné laisserait un propriétaire que le serveur refuse. On retombe
    // sur un véto réel plutôt que de laisser l'admin buter sur une erreur.
    if (BRIQUES_SANS_TOUS.has(b) && ownerId === OWNER_TOUS) {
      setOwnerId(ownerParDefaut ?? vets[0]?.id ?? '')
    }
  }

  const togglePeriode = (p: string) =>
    setPeriodes((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))

  const toggleJourPref = (j: string) =>
    setJoursPref((prev) => (prev.includes(j) ? prev.filter((x) => x !== j) : [...prev, j]))

  const toggleCreneauFiltre = (code: string) =>
    setCreneauxFiltre((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]))

  // ── Aperçu live (mêmes params que ceux écrits côté serveur) ──
  const apercu = useMemo(() => {
    const sujet = ownerId ? nomVeto(ownerId) : ''
    let params: Record<string, unknown> = {}
    switch (briqueId) {
      case 'interdire_creneau':
        // L'aperçu doit montrer la forme qui sera RÉELLEMENT écrite : avec une
        // parité, la règle part en « tableau de règles », pas en forme simple.
        // Afficher l'autre forme donnerait à lire une phrase que la base ne
        // contiendra jamais.
        params =
          parite === 'paire' || parite === 'impaire' || jours.length > 1
            ? {
                regles: jours.map((j) => ({
                  jour: j,
                  ...(parite === 'paire' || parite === 'impaire' ? { semaine: parite } : {}),
                  ...(creneauxFiltre.length > 0 ? { creneaux: creneauxFiltre } : {}),
                })),
              }
            : {
                jour: jours[0],
                exception_vacances_scolaires: exVac,
                creneaux: creneauxFiltre.length > 0 ? creneauxFiltre : undefined,
              }
        break
      case 'repos_conditionnel':
        params = { si_garde_we: siWe, sinon }
        break
      case 'alternance_ancre':
        params = { semaines, periodes }
        break
      case 'duo_interdit':
        params = { avec_veterinaire_id: avecId }
        break
      case 'au_plus_n':
        params = { n: Number(n) || 0, fenetre, creneaux: creneauxFiltre.length > 0 ? creneauxFiltre : undefined }
        break
      case 'espacement_min':
        params = { ecart_min_jours: Number(ecartMin) || 0 }
        break
      case 'espacement_weekend':
        params = { n_semaines: Number(nSemaines) || 0 }
        break
      case 'preferer_creneau':
        params = {
          jours: joursPref.length > 0 ? joursPref : undefined,
          creneaux: creneauxFiltre.length > 0 ? creneauxFiltre : undefined,
        }
        break
      case 'preferer_avec':
        params = { avec_veterinaire_id: avecId }
        break
      case 'seulement_avec':
        params = {
          avec_veterinaire_id: avecId,
          creneaux: creneauxFiltre.length > 0 ? creneauxFiltre : undefined,
        }
        break
      case 'volume_gardes':
        params = { sens }
        break
      case 'succession_interdite':
        params = { type_avant: typeAvant, type_apres: typeApres }
        break
      case 'serie_max':
        params = {
          n_jours: Number(nJoursSerie) || 0,
          creneaux: creneauxFiltre.length > 0 ? creneauxFiltre : undefined,
        }
        break
      case 'repos_apres_serie':
        params = { n_jours: Number(nJoursRepos) || 0, repos_jours: Number(reposJours) || 0 }
        break
      case 'cadencement_weekend':
        params = { n_semaines: Number(nSemainesCadence) || 0, ancre, sens: sensCadence }
        break
      case 'exclusion_dates':
        params = formeExclusion === 'dates'
          ? { dates: [dateExcl1, dateExcl2] }
          : { fetes: [...FETES_FIN_ANNEE] }
        break
    }
    const predicat = rendreRegle(briqueId, params, { nomVeto })
    return sujet ? `${sujet} ${predicat}` : predicat
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // ⚠️ `parite` a manqué ici a la premiere ecriture (B-038) : le champ
    //    fonctionnait, la regle s'enregistrait juste, et l'apercu montrait
    //    obstinement la phrase SANS la parite. Le `eslint-disable` ci-dessus a
    //    desactive exactement le controle qui l'aurait dit. Toute variable lue
    //    dans ce memo doit figurer dans cette liste, a la main.
  }, [briqueId, ownerId, jours, exVac, parite, siWe, sinon, semaines, periodes, avecId, n, fenetre, creneauxFiltre, ecartMin, nSemaines, joursPref, sens, typeAvant, typeApres, nJoursSerie, nJoursRepos, reposJours, nSemainesCadence, ancre, sensCadence, formeExclusion, dateExcl1, dateExcl2, vets])

  const handleSubmit = () => {
    if (!ownerId) { ouvrirErreur('Sélectionnez le vétérinaire concerné.'); return }
    if (briqueId === 'alternance_ancre' && periodes.length === 0) {
      ouvrirErreur('Sélectionnez au moins une période.'); return
    }
    if (briqueId === 'duo_interdit') {
      if (!avecId) { ouvrirErreur('Sélectionnez le second vétérinaire.'); return }
      if (avecId === ownerId) { ouvrirErreur('Choisissez deux vétérinaires différents.'); return }
    }
    if (briqueId === 'au_plus_n') {
      const v = Number(n)
      if (!Number.isInteger(v) || v < 1) { ouvrirErreur('Indiquez un nombre de gardes valide (≥ 1).'); return }
    }
    if (briqueId === 'espacement_min') {
      const v = Number(ecartMin)
      if (!Number.isInteger(v) || v < 1) { ouvrirErreur('Indiquez un écart valide (≥ 1 jour).'); return }
    }
    if (briqueId === 'espacement_weekend') {
      const v = Number(nSemaines)
      if (!Number.isInteger(v) || v < 2) { ouvrirErreur('Indiquez une fréquence valide (un week-end sur 2 minimum).'); return }
    }
    if (briqueId === 'preferer_creneau' && joursPref.length === 0 && creneauxFiltre.length === 0) {
      ouvrirErreur('Sélectionnez au moins un jour ou un type de créneau préféré.'); return
    }
    if (briqueId === 'preferer_avec') {
      if (!avecId) { ouvrirErreur('Sélectionnez le co-équipier préféré.'); return }
      if (avecId === ownerId) { ouvrirErreur('Choisissez deux vétérinaires différents.'); return }
    }
    if (briqueId === 'seulement_avec') {
      if (!avecId) { ouvrirErreur('Sélectionnez le binôme requis.'); return }
      if (avecId === ownerId) { ouvrirErreur('Choisissez deux vétérinaires différents.'); return }
    }
    if (briqueId === 'succession_interdite') {
      if (!typeAvant || !typeApres) { ouvrirErreur('Choisissez les deux créneaux.'); return }
    }
    if (briqueId === 'serie_max') {
      const v = Number(nJoursSerie)
      if (!Number.isInteger(v) || v < 1) { ouvrirErreur('Indiquez un nombre de jours valide (≥ 1).'); return }
    }
    if (briqueId === 'repos_apres_serie') {
      const a = Number(nJoursRepos), b = Number(reposJours)
      if (!Number.isInteger(a) || a < 1) { ouvrirErreur('Indiquez une longueur de série valide (≥ 1).'); return }
      if (!Number.isInteger(b) || b < 1) { ouvrirErreur('Indiquez un nombre de jours de repos valide (≥ 1).'); return }
    }
    if (briqueId === 'cadencement_weekend') {
      const v = Number(nSemainesCadence)
      if (!Number.isInteger(v) || v < 2) { ouvrirErreur('Indiquez un cycle valide (un week-end sur 2 minimum).'); return }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ancre)) { ouvrirErreur('Choisissez la date de départ du cycle.'); return }
    }
    if (briqueId === 'exclusion_dates' && formeExclusion === 'dates') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateExcl1) || !/^\d{4}-\d{2}-\d{2}$/.test(dateExcl2)) {
        ouvrirErreur('Choisissez les deux dates.'); return
      }
      if (dateExcl1 === dateExcl2) { ouvrirErreur('Choisissez deux dates différentes.'); return }
    }

    // Le payload est bâti UNE fois : le gardien doit examiner exactement ce qui
    // sera écrit, pas une reconstitution approchante.
    const payload = {
        id: regle?.id,
        brique_id: briqueId,
        owner_id: ownerId,
        force,
        jour: jours[0],
        // La LISTE prime cote serveur (B-041) ; `jour` reste envoye pour les
        // briques qui n'en attendent qu'un.
        jours: briqueId === 'interdire_creneau' ? jours
          : briqueId === 'preferer_creneau' && joursPref.length > 0 ? joursPref : undefined,
        exception_vacances_scolaires: exVac,
        // Parité (B-038) : n'est envoyée que par le repos fixe. Ailleurs elle
        // n'a pas de sens, et `construireParams` l'ignore de toute façon.
        semaine: briqueId === 'interdire_creneau' ? parite : undefined,
        si_garde_we: siWe,
        sinon,
        semaines,
        periodes,
        avec_veterinaire_id: avecId,
        n: Number(n),
        fenetre,
        creneaux: (briqueId === 'au_plus_n' || briqueId === 'preferer_creneau' || briqueId === 'serie_max' || briqueId === 'seulement_avec' || briqueId === 'interdire_creneau') && creneauxFiltre.length > 0 ? creneauxFiltre : undefined,
        ecart_min_jours: Number(ecartMin),
        // n_semaines sert à espacement_weekend ET à cadencement_weekend (#20).
        n_semaines: briqueId === 'cadencement_weekend' ? Number(nSemainesCadence) : Number(nSemaines),
        // `sens` porte plus/moins (volume_gardes) OU interdit/impose (cadencement).
        sens: briqueId === 'cadencement_weekend' ? sensCadence : sens,
        // Successions / séries / repos avancés (#13).
        type_avant: typeAvant,
        type_apres: typeApres,
        n_jours: briqueId === 'serie_max' ? Number(nJoursSerie)
          : briqueId === 'repos_apres_serie' ? Number(nJoursRepos) : undefined,
        repos_jours: briqueId === 'repos_apres_serie' ? Number(reposJours) : undefined,
        // Cadencement WE (#20) : date d'ancrage du cycle.
        ancre: briqueId === 'cadencement_weekend' ? ancre : undefined,
        // Exclusion « pas les deux » (#15a) : une SEULE forme envoyée selon le choix.
        fetes: briqueId === 'exclusion_dates' && formeExclusion === 'fetes'
          ? [...FETES_FIN_ANNEE] : undefined,
        dates: briqueId === 'exclusion_dates' && formeExclusion === 'dates'
          ? [dateExcl1, dateExcl2] : undefined,
        periode_id: validite === PERMANENTE ? null : validite,
    }

    startTransition(async () => {
      // Filou gardien : le moteur rejoue son pré-vol avec et sans cette règle,
      // et on ne montre que ce qu'elle apporte. Un verdict `verifie: false`
      // (aucune période en base, chargement en échec) n'empêche jamais
      // d'enregistrer — il se tait, simplement.
      const verdict = await verifierRegle({ genre: 'nominative', payload })
      // Panne du contrôle : on l'annonce et on enregistre quand même — mais on
      // ne laisse jamais croire que la règle a été vérifiée.
      if (verdict.diagnostic) {
        toast.warning('Je n’ai pas pu vérifier cette règle avec les autres.', {
          description: verdict.diagnostic,
          duration: 20000,
        })
      }
      if (verdict.verifie && verdict.avertissements.length > 0) {
        setGardien({ verdict, payload })
        return
      }
      await ecrire(payload)
    })
  }

  /** L'écriture — rejouée telle quelle si l'admin passe outre l'avertissement. */
  const ecrire = async (aEcrire: Parameters<typeof upsertRegle>[0]) => {
    const res = await upsertRegle(aEcrire)
    // Un refus d'écriture peut être un DOUBLON : le serveur joint alors
    // l'identifiant de la règle existante, et la modale sait y emmener.
    if (res?.error) { ouvrirRefus(res); return }
    toast.success(isEdit ? 'Règle modifiée.' : 'Règle créée.')
    setGardien(null)
    onClose()
    router.refresh()
  }

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEdit ? 'Modifier la règle' : 'Nouvelle règle'}
          </DialogTitle>
          <DialogDescription>
            Seuls les types de règles appliqués par le moteur sont proposés.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* QUI */}
          <div className="space-y-1.5">
            <Label>Vétérinaire concerné</Label>
            <Select value={ownerId} onValueChange={(v) => v && setOwnerId(v)}>
              <SelectTrigger>
                {ownerId === OWNER_TOUS
                  ? LIBELLE_OWNER_TOUS
                  : ownerId
                    ? (() => { const v = vets.find((x) => x.id === ownerId); return v ? `${v.prenom} ${v.nom}` : '' })()
                    : <span className="text-muted-foreground">Sélectionner…</span>}
              </SelectTrigger>
              <SelectContent>
                {/* Une règle de rythme concerne en général TOUT le cabinet : la
                    poser une fois évite d'en créer sept — et évite surtout le
                    véto oublié, ou celui qui arrivera plus tard. Masquée pour
                    les règles qui désignent un partenaire nommé (un duo « avec
                    tout le monde » n'a pas de sens). */}
                {peutViserTous && (
                  <SelectItem value={OWNER_TOUS}>{LIBELLE_OWNER_TOUS}</SelectItem>
                )}
                {vets.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.prenom} {v.nom}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {ownerId === OWNER_TOUS && (
              <p className="text-xs text-muted-foreground">
                S’applique à chaque vétérinaire du cabinet, y compris à ceux qui
                arriveront plus tard.
              </p>
            )}
          </div>

          {/* QUOI */}
          <div className="space-y-1.5">
            <Label>Type de règle</Label>
            <Select value={briqueId} onValueChange={(v) => v && choisirBrique(v as BriqueEvaluable)} items={BRIQUES}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BRIQUES.map((b) => (
                  <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {BRIQUES.find((b) => b.value === briqueId)?.aide}
            </p>
          </div>

          {/* Paramètres dynamiques */}
          {briqueId === 'interdire_creneau' && (
            <div className="space-y-3">
              {/* Plusieurs jours (B-041). C'etait un choix UNIQUE : « lundi et
                  mardi » obligeait a creer deux regles, et Filou, qui ne peut en
                  proposer qu'une par reponse, en abandonnait une sans le dire.
                  Les gardiens, eux, evaluent la liste entree par entree depuis
                  l'origine. */}
              <div className="space-y-1.5">
                <Label>Jours de repos</Label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {JOURS.map((j) => {
                    const actif = jours.includes(j.value)
                    return (
                      <button
                        key={j.value}
                        type="button"
                        onClick={() => toggleJour(j.value)}
                        aria-pressed={actif}
                        className={
                          'rounded-full border px-3 py-1.5 text-sm transition-colors ' +
                          (actif
                            ? 'border-primary bg-primary text-primary-foreground font-medium'
                            : 'border-border bg-background text-muted-foreground hover:border-primary/40')
                        }
                      >
                        {j.label}
                      </button>
                    )
                  })}
                </div>
                {jours.length === 0 && (
                  <p className="text-xs text-destructive">Choisis au moins un jour.</p>
                )}
              </div>
              {/* Une semaine sur deux (B-038) — « repos le jeudi, mais une
                  semaine sur deux ». Le moteur ET le validateur savaient déjà
                  l'évaluer ; seule la saisie manquait. La parité est celle du
                  NUMÉRO DE SEMAINE du calendrier, comme la règle d'alternance :
                  l'admin peut la vérifier sur n'importe quel agenda. */}
              <div className="space-y-1.5">
                <Label>Quelles semaines ?</Label>
                <Select value={parite} onValueChange={(v) => v && setParite(v)} items={PARITES}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PARITES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* La case n'apparaît QUE sans parité : les gardiens ne lisent
                  l'exception vacances que sur la forme simple. L'afficher avec
                  une parité promettrait un assouplissement que le planning
                  n'applique jamais — le défaut déjà payé sur « après-midi ». */}
              {parite === 'toutes' ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={exVac} onChange={(e) => setExVac(e.target.checked)} className="rounded" />
                  <span className="text-sm">Sauf pendant les vacances scolaires</span>
                </label>
              ) : (
                <p className="text-xs text-muted-foreground">
                  L&apos;exception « sauf vacances scolaires » n&apos;est pas disponible sur un
                  repos une semaine sur deux.
                </p>
              )}

              {/* Ciblage par type de garde — n'apparaît QUE si le cabinet a
                  plusieurs gardes ce jour-là. Sur un cabinet qui n'en a qu'une
                  par jour (le cas courant), « le mercredi » et « la garde du
                  mercredi » sont la même chose : proposer un choix sans objet
                  ferait douter d'une portée qui n'existe pas.
                  Le jour où une garde de jour s'ajoute, la question devient
                  réelle — et sans ce champ, la règle interdirait les deux en
                  n'en annonçant qu'une. */}
              {typesCreneaux.length > 1 && (
                <div className="space-y-1.5">
                  <Label>Quelles gardes ce jour-là ? (optionnel)</Label>
                  <div className="space-y-2 mt-1">
                    {typesCreneaux.map((t) => (
                      <label key={t.code} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={creneauxFiltre.includes(t.code)}
                          onChange={() => toggleCreneauFiltre(t.code)}
                          className="rounded"
                        />
                        <span className="text-sm">{t.nom}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Rien de coché = toute la journée. À cocher seulement si le
                    vétérinaire est indisponible pour <em>certaines</em> gardes de ce
                    jour et pas pour les autres.
                  </p>
                </div>
              )}
            </div>
          )}

          {briqueId === 'repos_conditionnel' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Si garde le week-end</Label>
                <Select value={siWe} onValueChange={(v) => v && setSiWe(v)} items={JOURS}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JOURS.map((j) => <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Sinon</Label>
                <Select value={sinon} onValueChange={(v) => v && setSinon(v)} items={JOURS}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JOURS.map((j) => <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {briqueId === 'alternance_ancre' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Semaines concernées</Label>
                <Select value={semaines} onValueChange={(v) => v && setSemaines(v)} items={SEMAINES}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paires">Semaines paires</SelectItem>
                    <SelectItem value="impaires">Semaines impaires</SelectItem>
                    <SelectItem value="toutes">Toutes les semaines</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Créneaux indisponibles</Label>
                <div className="space-y-2 mt-1">
                  {PERIODES.map((per) => (
                    <label key={per.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={periodes.includes(per.value)}
                        onChange={() => togglePeriode(per.value)}
                        className="rounded"
                      />
                      <span className="text-sm">{per.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {briqueId === 'duo_interdit' && (
            <div className="space-y-1.5">
              <Label>Jamais de garde seul avec</Label>
              <Select value={avecId} onValueChange={(v) => v && setAvecId(v)}>
                <SelectTrigger>
                  {avecId
                    ? (() => { const v = autresVets.find((x) => x.id === avecId); return v ? `${v.prenom} ${v.nom}` : '' })()
                    : <span className="text-muted-foreground">Sélectionner…</span>}
                </SelectTrigger>
                <SelectContent>
                  {autresVets.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.prenom} {v.nom}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {autresVets.length === 0 && (
                <p className="text-xs text-muted-foreground">Aucun autre vétérinaire disponible.</p>
              )}
            </div>
          )}

          {briqueId === 'au_plus_n' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="au-plus-n">Nombre de gardes max</Label>
                  <input
                    id="au-plus-n"
                    type="number"
                    min={1}
                    max={14}
                    value={n}
                    onChange={(e) => setN(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Fenêtre de comptage</Label>
                  <Select value={fenetre} onValueChange={(v) => v && setFenetre(v)} items={FENETRES}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FENETRES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {/* Filtre de créneaux (n°19) : « max 2 week-ends par mois ». */}
              <div className="space-y-1.5">
                <Label>Ne compter que certains créneaux (optionnel)</Label>
                <div className="space-y-2 mt-1">
                  {typesCreneaux.map((t) => (
                    <label key={t.code} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={creneauxFiltre.includes(t.code)}
                        onChange={() => toggleCreneauFiltre(t.code)}
                        className="rounded"
                      />
                      <span className="text-sm">{t.nom}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Rien de coché = toutes les gardes comptent. Ex. cocher «&nbsp;Week-end&nbsp;»
                  avec «&nbsp;2 sur 30 jours glissants&nbsp;» = au plus 2 week-ends par mois.
                </p>
              </div>
            </div>
          )}

          {briqueId === 'espacement_min' && (
            <div className="space-y-1.5">
              <Label htmlFor="ecart-min">Jours de repos minimum entre deux gardes</Label>
              <input
                id="ecart-min"
                type="number"
                min={1}
                max={30}
                value={ecartMin}
                onChange={(e) => setEcartMin(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          )}

          {briqueId === 'preferer_creneau' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Jours préférés</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {JOURS_TOUS.map((j) => (
                    <button
                      key={j.value}
                      type="button"
                      onClick={() => toggleJourPref(j.value)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        joursPref.includes(j.value)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted text-muted-foreground border-border hover:border-primary'
                      }`}
                    >
                      {j.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Créneaux préférés</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {typesCreneaux.map((t) => (
                    <button
                      key={t.code}
                      type="button"
                      onClick={() => toggleCreneauFiltre(t.code)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        creneauxFiltre.includes(t.code)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted text-muted-foreground border-border hover:border-primary'
                      }`}
                    >
                      {t.nom}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Au moins un jour OU un créneau. Le moteur essaie de concentrer ses
                  gardes dessus — sans jamais bloquer la génération.
                </p>
              </div>
            </div>
          )}

          {briqueId === 'preferer_avec' && (
            <div className="space-y-1.5">
              <Label>Préfère être de garde avec</Label>
              <Select value={avecId} onValueChange={(v) => v && setAvecId(v)}>
                <SelectTrigger>
                  {avecId
                    ? (() => { const v = autresVets.find((x) => x.id === avecId); return v ? `${v.prenom} ${v.nom}` : '' })()
                    : <span className="text-muted-foreground">Sélectionner…</span>}
                </SelectTrigger>
                <SelectContent>
                  {autresVets.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.prenom} {v.nom}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Préférence dans UN sens (créez la règle symétrique si le souhait est partagé).
              </p>
            </div>
          )}

          {briqueId === 'seulement_avec' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>De garde seulement si ce binôme est de garde</Label>
                <Select value={avecId} onValueChange={(v) => v && setAvecId(v)}>
                  <SelectTrigger>
                    {avecId
                      ? (() => { const v = autresVets.find((x) => x.id === avecId); return v ? `${v.prenom} ${v.nom}` : '' })()
                      : <span className="text-muted-foreground">Sélectionner…</span>}
                  </SelectTrigger>
                  <SelectContent>
                    {autresVets.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.prenom} {v.nom}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Dans UN sens : le binôme, lui, peut être de garde sans ce vétérinaire.
                </p>
              </div>
              {/* Ciblage créneaux optionnel (comme au_plus_n). */}
              <div className="space-y-1.5">
                <Label>Uniquement sur certains créneaux (optionnel)</Label>
                <div className="space-y-2 mt-1">
                  {typesCreneaux.map((t) => (
                    <label key={t.code} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={creneauxFiltre.includes(t.code)}
                        onChange={() => toggleCreneauFiltre(t.code)}
                        className="rounded"
                      />
                      <span className="text-sm">{t.nom}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Rien de coché = tous les créneaux. En interdiction ferme, cible
                  des créneaux à plusieurs places (le binôme doit pouvoir y tenir une place).
                </p>
              </div>
            </div>
          )}

          {briqueId === 'volume_gardes' && (
            <div className="space-y-1.5">
              <Label>Souhait</Label>
              <Select value={sens} onValueChange={(v) => v && setSens(v)}>
                <SelectTrigger>
                  {sens === 'plus' ? 'Faire PLUS de gardes que la moyenne' : 'Faire MOINS de gardes que la moyenne'}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plus">Faire PLUS de gardes que la moyenne</SelectItem>
                  <SelectItem value="moins">Faire MOINS de gardes que la moyenne</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Biais assumé sur la répartition — les règles dures et l&apos;équilibre
                global restent prioritaires.
              </p>
            </div>
          )}

          {briqueId === 'espacement_weekend' && (
            <div className="space-y-1.5">
              <Label htmlFor="n-semaines">De garde au plus un week-end sur…</Label>
              <input
                id="n-semaines"
                type="number"
                min={2}
                max={26}
                value={nSemaines}
                onChange={(e) => setNSemaines(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                Ex. « 3 » = un week-end sur trois (les deux week-ends suivants sont libres).
              </p>
            </div>
          )}

          {briqueId === 'succession_interdite' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Créneau la veille</Label>
                <Select value={typeAvant} onValueChange={(v) => v && setTypeAvant(v)}>
                  <SelectTrigger>
                    {typesCreneaux.find((t) => t.code === typeAvant)?.nom ?? <span className="text-muted-foreground">Sélectionner…</span>}
                  </SelectTrigger>
                  <SelectContent>
                    {typesCreneaux.map((t) => <SelectItem key={t.code} value={t.code}>{t.nom}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Interdit le lendemain</Label>
                <Select value={typeApres} onValueChange={(v) => v && setTypeApres(v)}>
                  <SelectTrigger>
                    {typesCreneaux.find((t) => t.code === typeApres)?.nom ?? <span className="text-muted-foreground">Sélectionner…</span>}
                  </SelectTrigger>
                  <SelectContent>
                    {typesCreneaux.map((t) => <SelectItem key={t.code} value={t.code}>{t.nom}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="col-span-2 text-xs text-muted-foreground">
                  Le «&nbsp;lendemain&nbsp;» d&apos;un week-end est le lundi (il couvre samedi et dimanche).
                </p>
              </div>
            </div>
          )}

          {briqueId === 'serie_max' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="serie-n">Jours de garde d&apos;affilée maximum</Label>
                <input
                  id="serie-n"
                  type="number"
                  min={1}
                  max={31}
                  value={nJoursSerie}
                  onChange={(e) => setNJoursSerie(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Ne compter que certains créneaux (optionnel)</Label>
                <div className="space-y-2 mt-1">
                  {typesCreneaux.map((t) => (
                    <label key={t.code} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={creneauxFiltre.includes(t.code)}
                        onChange={() => toggleCreneauFiltre(t.code)}
                        className="rounded"
                      />
                      <span className="text-sm">{t.nom}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Rien de coché = tous les types de garde comptent dans la série.
                </p>
              </div>
            </div>
          )}

          {briqueId === 'repos_apres_serie' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="repos-n">Après … jours de garde d&apos;affilée</Label>
                <input
                  id="repos-n"
                  type="number"
                  min={1}
                  max={31}
                  value={nJoursRepos}
                  onChange={(e) => setNJoursRepos(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="repos-m">… jours de repos minimum</Label>
                <input
                  id="repos-m"
                  type="number"
                  min={1}
                  max={30}
                  value={reposJours}
                  onChange={(e) => setReposJours(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>
          )}

          {briqueId === 'cadencement_weekend' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Ce que dit ce cycle</Label>
                <Select value={sensCadence} onValueChange={(v) => v && setSensCadence(v)}>
                  <SelectTrigger>
                    {sensCadence === 'impose'
                      ? 'Ses gardes week-end doivent tomber sur ce cycle'
                      : 'Ces week-ends lui sont interdits (engagement extérieur)'}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="interdit">Ces week-ends lui sont interdits (engagement extérieur)</SelectItem>
                    <SelectItem value="impose">Ses gardes week-end doivent tomber sur ce cycle</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cadence-n">Un week-end sur…</Label>
                  <input
                    id="cadence-n"
                    type="number"
                    min={2}
                    max={12}
                    value={nSemainesCadence}
                    onChange={(e) => setNSemainesCadence(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cadence-ancre">Date de départ du cycle</Label>
                  <input
                    id="cadence-ancre"
                    type="date"
                    value={ancre}
                    onChange={(e) => setAncre(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Choisissez un samedi où le cycle tombe (un week-end « de référence »).
                {' '}Le cycle est calendaire strict : il ne se décale pas avec les vacances.
                {sensCadence === 'impose' && (
                  <> Attention : «&nbsp;imposé&nbsp;» ne force pas une garde à CHAQUE week-end du cycle — il empêche seulement les gardes week-end hors du cycle.</>
                )}
              </p>
            </div>
          )}

          {briqueId === 'exclusion_dates' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Type d&apos;exclusion</Label>
                <Select value={formeExclusion} onValueChange={(v) => v && setFormeExclusion(v as 'fetes' | 'dates')}>
                  <SelectTrigger>
                    {formeExclusion === 'fetes'
                      ? 'Fêtes de fin d’année (Noël / Nouvel An)'
                      : 'Deux dates précises'}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fetes">Fêtes de fin d’année (Noël / Nouvel An)</SelectItem>
                    <SelectItem value="dates">Deux dates précises</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formeExclusion === 'fetes' ? (
                <p className="text-xs text-muted-foreground">
                  Le vétérinaire ne sera jamais de garde à la fois pour Noël (24/25 déc)
                  {' '}ET le Nouvel An (31 déc / 1er janv) la même année. Il peut en faire
                  {' '}une, jamais les deux. Cette règle se reconduit chaque année.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="excl-date-1">Première date</Label>
                      <input
                        id="excl-date-1"
                        type="date"
                        value={dateExcl1}
                        onChange={(e) => setDateExcl1(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="excl-date-2">Seconde date</Label>
                      <input
                        id="excl-date-2"
                        type="date"
                        value={dateExcl2}
                        onChange={(e) => setDateExcl2(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Le vétérinaire ne sera jamais de garde à la fois sur ces deux dates
                    {' '}(il peut en faire une). Un week-end couvre le samedi et le dimanche.
                  </p>
                </>
              )}
            </div>
          )}

          {/* FORCE — les desiderata (préférences pures) excluent « Jamais ».
              Ce n'est plus une liste déroulante : quatre choix dont deux se
              ressemblaient beaucoup ne se comparent pas dans un menu qu'il faut
              ouvrir. Ici les quatre sont visibles ensemble, chacun avec ce que
              le moteur fera vraiment — c'est ça qui permet de trancher. */}
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium leading-none mb-1.5">
              Jusqu&apos;où le moteur doit-il aller pour la respecter ?
            </legend>
            <div className="gv-forces">
              {FORCES.filter(
                (f) => !(BRIQUES_SOUPLES_SEULEMENT.has(briqueId) && f.value === 'jamais'),
              ).map((f) => (
                <label key={f.value} className="gv-force" data-force={f.value} data-choisi={force === f.value}>
                  <input
                    type="radio"
                    name="gv-force"
                    value={f.value}
                    checked={force === f.value}
                    onChange={() => setForce(f.value)}
                  />
                  <span className="gvf-corps">
                    <span className="gvf-titre">
                      <span aria-hidden="true">{f.symbole}</span> {f.label}
                    </span>
                    <span className="gvf-aide">{f.aide}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* VALIDITÉ (permanente ou limitée à une période) */}
          <div className="space-y-1.5">
            <Label>Validité</Label>
            <Select value={validite} onValueChange={(v) => v && setValidite(v)}>
              <SelectTrigger>
                {validite === PERMANENTE
                  ? 'Permanente (toutes les générations)'
                  : (periodesDispo.find((per) => per.id === validite)?.label ?? 'Période')}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PERMANENTE}>Permanente (toutes les générations)</SelectItem>
                {periodesDispo.map((per) => (
                  <SelectItem key={per.id} value={per.id}>Limitée à : {per.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {periodesDispo.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Aucune période créée — la règle s&apos;appliquera à toutes les générations.
              </p>
            )}
          </div>

          {/* APERÇU — ce que l'admin s'apprête à écrire (B-039).
              Le cadre était en POINTILLÉS. Dans tout le reste du produit, le
              pointillé signale un état VIDE : « aucune règle », « aucun
              échange », « aucune notification ». Ici il encadrait du contenu
              réel, et le plus important de la fenêtre — la phrase sur laquelle
              on valide. Le cadre disait « rien ici » à l'endroit où il fallait
              lire « voilà ce que tu t'apprêtes à écrire ».
              Cadre PLEIN et teinte d'accent, donc : le même vocabulaire que
              partout ailleurs où le produit annonce ce qui va se passer. */}
          <div className="rounded-lg border-2 border-primary bg-primary/[0.08] px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-2">
              Ce que tu vas enregistrer
            </p>
            <p className="text-[0.95rem] font-medium text-foreground leading-7">
              {(() => { const f = FORCES.find((x) => x.value === force); return f?.symbole })()} {apercu}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Enregistrement…' : isEdit ? 'Modifier' : 'Créer la règle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {/* Filou gardien — FRÈRE du formulaire, pas son enfant : deux dialogues
          imbriqués se disputent le piège à focus, et le second se ferme en
          emportant le premier. Le formulaire reste ouvert DERRIÈRE, pour que
          « Revenir à ma règle » retrouve la saisie intacte. Le bouton
          d'assouplissement retombe sur le sélecteur de fermeté de ce
          formulaire : il n'écrit rien tout seul. */}
      <GardienFilou
        verdict={gardien?.verdict ?? null}
        enCours={isPending}
        onAnnuler={() => setGardien(null)}
        onPasserOutre={() => {
          const aEcrire = gardien?.payload
          if (!aEcrire) return
          // `confirmeImpact` : le serveur refuse désormais lui-même une règle
          // qui rend la génération impossible (contrôle d'impact du
          // 2026-08-03). L'admin a vu les conséquences dans cette modale — ce
          // drapeau porte SA décision jusqu'au serveur, sinon le « quand
          // même » se heurterait à un mur muet.
          startTransition(async () => { await ecrire({ ...aEcrire, confirmeImpact: true }) })
        }}
        onAssouplir={(f) => {
          setForce(f as ForceFormulaire)
          toast.info('Fermeté ramenée à « sauf urgence ». Revalide quand tu veux.')
        }}
      />

      {dialogueErreur}
    </>
  )
}
