'use client'

// ============================================================
// GUARDVETO V2 — Le parcours de génération, du départ au planning
// ============================================================
// Demande MiKL du 2026-08-02 : « je veux une succession de pop-ups qui
// accompagnent tout au long du processus jusqu'à la création d'un planning
// opérationnel […] on touche le cœur de l'application, la génération du
// planning !! faut que ça pète ».
//
// LES CINQ TEMPS
//
//   ① Quel planning   — nouveau, ou on en refait un existant
//   ② Avant de lancer — ce qui coince, RÉGLABLE SUR PLACE (`PointPreVol`).
//                       Ce qui est bloquant barre la route ; ce qui est à
//                       surveiller laisse passer. Décision MiKL : ne jamais
//                       lancer une génération qu'on sait perdue d'avance.
//   ③ Ça tourne       — le moteur travaille, on dit quoi.
//   ④ Voilà le résultat — ce qui a été posé, ou pourquoi ça a échoué, avec
//                       le chemin de retour vers ② pour corriger.
//   ⑤ (hors de ce fichier) Publier — `DialogPublication`.
//
// POURQUOI LA GÉNÉRATION VIT ICI, ET PLUS DANS `outils-planning`
// Le parcours doit enchaîner contrôle → travail → résultat sans que l'écran
// reprenne la main entre deux : la génération est une ÉTAPE du parcours, pas
// une action isolée déclenchée par un bouton. Les garde-fous d'origine sont
// tous conservés — confirmation avant d'écraser un planning publié, diagnostic
// d'impasse, créneaux ignorés — mais deviennent des temps du parcours.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CalendarPlus, RotateCcw, Wand2, Loader2, ShieldAlert, CheckCircle2, AlertTriangle,
  RefreshCw, Trash2, CalendarClock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { DiagnosticImpasse, NoteDernierRecoursExclus } from '@/components/planning/DiagnosticImpasse'
// B-111 — ce que les cadenas ont, ou n'ont pas, protege.
import { NoteCadenas } from '@/components/planning/NoteCadenas'
import { CasesAPourvoir, type CaseVide } from '@/components/planning/CasesAPourvoir'
import { RapportRelecture, type DonneesRelecture } from '@/components/v2/RapportRelecture'
import { CreneauxIgnoresAlert } from '@/components/planning/CreneauxIgnoresAlert'
import { PointPreVol, type VetEtiquette } from '@/components/planning/PointPreVol'
import { SignalerLimite } from '@/components/planning/SignalerLimite'
import { creerPeriode, setProfilPeriode } from '@/app/(protected)/admin/periodes/actions'
import { RetirerPlanningModale, type GesteRetrait } from '@/components/planning/RetirerPlanningModale'
import { estLundi, lundiDeLaSemaine, dureeProposee, finApres } from '@/lib/planning/duree'
import type { AvertissementPreVol } from '@/engine/pre-vol'
import type { CreneauIgnore } from '@/engine/creneau-modele'
import type { JourNonCouvert } from '@/components/planning/types-impasse'
import type { DiagnosticImpasse as DiagnosticImpasseData } from '@/engine/diagnostic'
import type { Periode, ProfilPlanning } from '@/types'

// ── LA PÉRIODE TYPE NE SE DEVINE PLUS (MiKL, 2026-08-04) ──────────────────
// Il y avait ici une sentinelle `AUTO` pour l'option « Selon la saison » :
// mai→août = été, sinon hiver, et on prenait la première période type de cette
// saison — à défaut la structure « par défaut » du cabinet.
//
// MiKL : « cette notion de selon la saison ne me plaît pas […] je ne veux pas
// qu'il y ait une période par défaut ». La raison est solide : la période type
// décide des gardes à couvrir et de l'effectif de tout le trimestre. Un
// automatisme qui la choisit à la place du cabinet produit un planning que
// personne n'a paramétré — et l'écart ne se voit qu'une fois les gardes posées.
//
// Ce qui remplace : le cabinet DOIT en avoir programmé au moins une, il DOIT
// dire laquelle, et Filou le lui fait CONFIRMER avant de lancer le moteur.
// Le champ démarre donc vide.
const AUCUN_TYPE = ''

/** Dernière entrée du menu déroulant : « en créer une », pas une vraie valeur. */
const CREER_TYPE = '__creer__'

function dateLongue(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function dateCourte(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function nomPlanning(p: Periode): string {
  return p.libelle ?? `${p.saison === 'ete' ? 'Été' : 'Hiver'} ${p.date_debut.slice(0, 4)}`
}

const STATUT: Record<Periode['statut'], string> = {
  brouillon: 'Brouillon',
  publie: 'Publié',
  verrouille: 'Verrouillé',
}

type Etape = 'choix' | 'nouveau' | 'existant' | 'controle' | 'travail' | 'resultat'

/**
 * « Période type = hiver = telles caractéristiques » (MiKL, 2026-08-04).
 *
 * Confirmer un NOM ne confirme rien : personne ne sait par cœur ce que contient
 * « hiver periode 1 ». La fiche montre ce sur quoi on s'engage — les gardes
 * couvertes et l'effectif de nuit — pour que le « oui » porte sur le contenu et
 * pas sur une étiquette.
 *
 * Les gardes viennent du SERVEUR (`creneau_modele`, descendu en props) plutôt
 * que d'être redécrites ici : deux descriptions de la même structure divergent
 * au premier réglage changé, et l'écart ne se verrait qu'après la génération.
 */
function FicheType({ type, gardes }: { type: ProfilPlanning; gardes: string[] }) {
  return (
    <dl className="type-fiche">
      <div className="type-ligne">
        <dt>Période type</dt>
        <dd><b>{type.nom}</b></dd>
      </div>
      {/* Ni « saison suggérée » ni « le soir en semaine » : les deux réglages
          ont disparu le 2026-08-04 (l'un ne pilotait plus rien, l'autre faisait
          doublon avec la structure des gardes). Les afficher ici les ferait
          survivre à l'écran alors qu'on ne peut plus les changer nulle part —
          le pire des deux mondes. Le nombre de vétérinaires se lit maintenant
          garde par garde, ci-dessous. */}
      <div className="type-ligne">
        <dt>Gardes à couvrir</dt>
        <dd>
          {gardes.length > 0
            ? gardes.join(' · ')
            : <i>aucune garde réglée — le planning sortirait vide</i>}
        </dd>
      </div>
    </dl>
  )
}

/**
 * Lit le flux NDJSON de `/api/generate` : chaque ligne `progres` est affichée au
 * fil de l'eau, la ligne `resultat` est renvoyée à l'appelant.
 *
 * Si le flux se termine SANS ligne de résultat (connexion coupée, fonction
 * serveur tuée), on le dit franchement au lieu de laisser l'écran tourner :
 * un parcours qui attend sans fin est pire qu'une erreur nommée.
 */
export async function lireLeFlux(
  res: Response,
  onProgres: (message: string) => void,
  /**
   * B-104 — le serveur annonce l'identifiant de sa trace en première ligne.
   * Sans lui, un incident constaté ICI (fenêtre fermée) et une génération morte
   * LÀ-BAS resteraient deux faits étrangers, impossibles à rapprocher.
   */
  onTrace?: (traceId: string) => void,
): Promise<Record<string, unknown>> {
  const lecteur = res.body?.getReader()
  if (!lecteur) return { error: 'Réponse illisible du serveur.' }

  const decodeur = new TextDecoder()
  let tampon = ''
  let resultat: Record<string, unknown> | null = null

  for (;;) {
    const { done, value } = await lecteur.read()
    if (done) break
    tampon += decodeur.decode(value, { stream: true })

    const lignes = tampon.split(String.fromCharCode(10))
    // La dernière peut être incomplète : elle attend le morceau suivant.
    tampon = lignes.pop() ?? ''

    for (const ligne of lignes) {
      if (!ligne.trim()) continue
      try {
        const objet = JSON.parse(ligne) as { type?: string; message?: string; corps?: unknown; status?: number; traceId?: string }
        if (objet.type === 'trace' && objet.traceId) onTrace?.(objet.traceId)
        if (objet.type === 'progres' && objet.message) onProgres(objet.message)
        if (objet.type === 'resultat') {
          resultat = { ...(objet.corps as Record<string, unknown>), __status: objet.status }
        }
      } catch {
        // Ligne tronquée ou corrompue : on l'ignore plutôt que de casser le
        // parcours. Le résultat final, lui, ne peut pas passer inaperçu.
      }
    }
  }

  return resultat ?? { error: 'La génération s’est interrompue avant d’avoir répondu. Relance-la.' }
}

// ============================================================
// B-104 — LE TÉMOIN CÔTÉ NAVIGATEUR
// ============================================================
// MiKL : « ça commence quelques secondes puis la fenêtre se ferme ». Le serveur
// ne peut rien en dire, et la lecture du code a montré que ce symptôme ne
// correspond à AUCUN chemin prévu : tous affichent un message, aucun ne ferme.
// Ce qui se passe est donc hors de ce que le parcours contrôle — démontage,
// navigation, ou erreur qui remonte à la frontière React.
//
// `sendBeacon` plutôt qu'un `fetch` : un `fetch` lancé pendant qu'un composant
// se démonte ou qu'une page navigue est ANNULÉ par le navigateur, c'est-à-dire
// au moment exact où on aurait besoin de lui. La balise, elle, est confiée au
// navigateur qui l'enverra même si la page a disparu.
//
// Ce module est un instrument de mesure : il ne doit jamais faire échouer ce
// qu'il observe. Toute erreur est avalée.

/** Ce qu'on rapporte : une raison courte, l'étape en cours, le temps écoulé. */
function signalerIncidentParcours(rapport: {
  traceId: string | null
  /** La période visée — c'est elle qui rattache un témoignage SANS trace. */
  periodeId: string | null
  raison: string
  etape?: string | null
  message?: string | null
  apresMs?: number | null
}) {
  // ── B-104 (2e passe) — ON PARLE MÊME SANS IDENTIFIANT DE TRACE ──────────
  //
  // Ce garde-fou disait : « sans traceId, le serveur n'a pas eu le temps
  // d'ouvrir sa ligne, le silence est exact ». Il était faux, et il a coûté la
  // soirée du 02/09 : la fenêtre de MiKL s'est fermée AVANT la première ligne
  // du flux, donc sans traceId — et le témoin s'est tu au moment précis où il
  // était le seul à savoir quelque chose.
  //
  // Le silence n'est jamais « exact » quand il porte sur un incident. Sans
  // trace côté serveur, la période suffit à rattacher le témoignage.
  if (!rapport.traceId && !rapport.periodeId) return
  try {
    const charge = JSON.stringify(rapport)
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(
        '/api/generate/incident',
        new Blob([charge], { type: 'application/json' }),
      )
      return
    }
    // Repli pour les navigateurs sans `sendBeacon` : `keepalive` demande au
    // navigateur de laisser partir la requête même si la page se ferme.
    void fetch('/api/generate/incident', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: charge,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Un témoin qui casse la scène qu'il observe ne sert à rien.
  }
}

interface Resultat {
  /** `ok` = planning COMPLET. Un planning partiel n'est pas un échec (B-053). */
  ok: boolean
  /**
   * B-053 — l'issue réelle de la génération :
   *   `complet` : rien à faire de plus ;
   *   `partiel` : le planning est EN BASE, il lui manque des cases ;
   *   `echec`   : rien n'a pu être attribué (cas rare, équipe absente…).
   * `ok` seul ne suffisait plus : il aurait rangé « partiel » avec « échec »,
   * et l'admin serait reparti en croyant n'avoir rien.
   */
  issue?: 'complet' | 'partiel' | 'echec'
  /** Les cases sans personne, avec le pourquoi de chaque véto écarté. */
  casesVides?: CaseVide[]
  nbGardes?: number
  dureeMs?: number
  creneauxIgnores: CreneauIgnore[]
  /** Impasse : le moteur a prouvé qu'aucun planning n'existe. */
  diagnostic?: DiagnosticImpasseData | null
  joursNonCouverts?: JourNonCouvert[]
  /** Coupe propre du calcul (trop long) — PAS une impasse prouvée. */
  interrompu?: boolean
  /**
   * B-046 — prénoms des « dernier recours » que le moteur n'a jamais eu le
   * droit d'utiliser. Affiché SEULEMENT sur un échec : sur un planning réussi,
   * c'est un réglage qui a fonctionné, il n'y a rien à signaler.
   */
  exclusDernierRecours?: string[]
  /**
   * B-111 — combien de places l'admin avait cadenassées. Affiché sur TOUTES les
   * issues, succès compris : une régénération contrainte à trois cases sur
   * quarante ne se juge pas comme une régénération libre, et sans ce chiffre
   * une contrainte volontaire passerait pour un moteur qui n'a rien trouvé.
   */
  placesFigees?: number
  /**
   * B-111 — les cadenas qui ne protègent RIEN : place vidée depuis, créneau
   * disparu, date hors bornes. C'est le plus important des deux : l'écran du
   * planning affiche encore un cadenas sur ces cases, et le moteur vient de les
   * rebattre. Sans cette liste, l'écart ne se découvre qu'en comparant deux
   * plannings — donc jamais.
   */
  cadenasInoperants?: string[]
  message?: string
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  periodes: Periode[]
  periodeAffichee: Periode | null
  periodesTypes: ProfilPlanning[]
  /** Les gardes que chaque période type fait couvrir, par id de période type. */
  gardesParType: Record<string, string[]>
  /** Vétérinaires actifs — pour régler un point d'étiquette sur place. */
  vets: VetEtiquette[]
  /** Plannings qui ont déjà des gardes — sert à repérer un brouillon en cours. */
  periodesAvecGardes: string[]
  onNaviguerVersMois: (anneeMois: string) => void
  etapeInitiale?: Etape
}

export function ParcoursGeneration({
  open,
  onOpenChange,
  periodes,
  periodeAffichee,
  periodesTypes,
  gardesParType,
  vets,
  periodesAvecGardes,
  onNaviguerVersMois,
  etapeInitiale = 'choix',
}: Props) {
  const router = useRouter()
  // B-053 — jamais un identifiant à l'écran : les raisons du moteur portent des
  // ids de vétérinaire, cette table les rend en prénoms.
  const prenomParVetId = useMemo(
    () => new Map(vets.map((v) => [v.id, v.prenom])),
    [vets],
  )
  // B-107 — pour regrouper les constats de Filou par personne. Les vides sont
  // écartés : un prénom vide serait trouvé dans tous les textes et rangerait
  // tous les constats dans un même faux groupe.
  const prenomsEquipe = useMemo(
    () => vets.map((v) => v.prenom).filter((p): p is string => Boolean(p)),
    [vets],
  )
  const [etape, setEtape] = useState<Etape>(etapeInitiale)
  // B-060 — ce que le SERVEUR dit être en train de faire. Jamais une phrase
  // choisie ici : l'écran relaie, il n'invente pas.
  const [etapeMoteur, setEtapeMoteur] = useState<string | null>(null)

  // ── B-104 — de quoi témoigner si cet écran disparaît ──────────────────
  //
  // Des `ref` et non des `useState` : ces valeurs sont lues dans le NETTOYAGE
  // d'un effet, quand le composant se démonte. Une valeur d'état y serait
  // figée à ce qu'elle valait au dernier rendu — donc fausse au moment précis
  // où l'on a besoin qu'elle soit juste.
  const traceIdRef = useRef<string | null>(null)
  const travailDepuisRef = useRef<number | null>(null)
  const etapeCouranteRef = useRef<string | null>(null)
  /**
   * La période visée, retenue pour le témoin (B-104, 2e passe).
   *
   * C'est elle qui rattache un témoignage quand le serveur n'a même pas eu le
   * temps d'ouvrir sa trace — le cas du 02/09, où la fenêtre s'est fermée
   * avant la première ligne du flux.
   */
  const periodeCibleRef = useRef<string | null>(null)
  const [creation, setCreation] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  // B-062 — la relecture de Filou. Elle vit à côté du résultat de génération,
  // jamais dedans : le planning est déjà en base quand elle commence, et un
  // échec de sa part ne doit rien retirer à ce que le moteur a livré.
  const [relecture, setRelecture] = useState<DonneesRelecture | null>(null)
  const [relectureEnCours, setRelectureEnCours] = useState(false)
  const [etapeRelecture, setEtapeRelecture] = useState<string | null>(null)

  // La cible du parcours : un planning existant, ou celui qu'on vient de créer.
  const [cible, setCible] = useState<string>('')
  const [nomCible, setNomCible] = useState<string>('')
  const [cibleEstPubliee, setCibleEstPubliee] = useState(false)

  // ── Voie « nouveau planning » ──────────────────────────
  const [libelle, setLibelle] = useState('')
  const [debut, setDebut] = useState('')
  const [semaines, setSemaines] = useState<string>('')
  const [datesPrecises, setDatesPrecises] = useState(false)
  const [finSaisie, setFinSaisie] = useState('')
  const [typeChoisi, setTypeChoisi] = useState<string>(AUCUN_TYPE)

  // ── Étape ② : le contrôle avant vol ────────────────────
  const [preVol, setPreVol] = useState<AvertissementPreVol[] | null>(null)
  const [souhaits, setSouhaits] = useState(0)
  const [chargementPreVol, setChargementPreVol] = useState(false)

  // La période type de la CIBLE, et la confirmation que Filou en demande.
  // Remise à zéro à chaque entrée dans le contrôle : on ne confirme jamais
  // pour un planning ce qu'on a confirmé pour un autre.
  const [typeCibleId, setTypeCibleId] = useState<string | null>(null)
  const [typeConfirme, setTypeConfirme] = useState(false)
  const [rattachement, setRattachement] = useState(false)

  // ── Étape ④ : le résultat ──────────────────────────────
  const [resultat, setResultat] = useState<Resultat | null>(null)

  // Retirer un planning depuis la liste. La confirmation sur la ligne a cédé
  // la place à la fenêtre en deux temps le 2026-08-22 : elle affirmait
  // « aucun agenda n'a été rempli » pour un brouillon, ce qui n'est plus vrai
  // depuis que le brouillon a fui dans l'agenda du client (Val d'Allier,
  // 2026-08-20). Une phrase écrite une fois pour toutes ne peut pas savoir ;
  // la fenêtre, elle, lit la base avant de parler.
  const [retrait, setRetrait] = useState<{
    id: string
    nom: string
    geste: GesteRetrait
  } | null>(null)

  // Tout le formulaire raisonne sur la date CALÉE : la durée annoncée, la date
  // de fin affichée et celle envoyée au serveur parlent du même planning.
  const debutCale = lundiDeLaSemaine(debut) ?? debut
  const semainesEffectives = semaines === '' ? dureeProposee(debutCale) : Number(semaines)
  const finCalculee = finApres(debutCale, semainesEffectives)
  const fin = datesPrecises ? (finSaisie || null) : finCalculee

  const typesProposables = useMemo(
    () => periodesTypes.filter((p) => !p.est_defaut),
    [periodesTypes],
  )

  /**
   * La saison du départ ne CHOISIT plus rien et ne suggère plus aucune période
   * type (le réglage « saison suggérée » a été supprimé le 2026-08-04, il ne
   * pilotait plus rien). Elle sert uniquement à situer le planning dans
   * l'année, à voix haute. La décision est entièrement à l'admin.
   */
  const saisonDuDepart = debutCale
    ? (Number(debutCale.slice(5, 7)) >= 5 && Number(debutCale.slice(5, 7)) <= 8 ? 'été' : 'hiver')
    : null

  /** Le cabinet n'a programmé AUCUNE période type : rien n'est générable. */
  const aucuneTypeProgrammee = typesProposables.length === 0

  const nomTypeCible = typeCibleId
    ? (periodesTypes.find((p) => p.id === typeCibleId)?.nom ?? null)
    : null
  /**
   * Un refus PÉRIMÉ est pire qu'un silence — retour MiKL du 2026-08-04 : le
   * champ affichait « hiver periode 1 » et le bandeau rouge continuait de dire
   * « Choisis la période type de ce planning ». Le message datait du clic
   * PRÉCÉDENT, avant la correction ; rien ne l'effaçait. On l'efface donc dès
   * que l'admin touche à quoi que ce soit dans le formulaire : ce qu'il vient
   * de changer a peut-être réglé le problème, et c'est au prochain « Créer et
   * vérifier » de trancher, pas à un message figé.
   */
  function modifie<T>(setter: (v: T) => void) {
    return (v: T) => {
      if (erreur) setErreur(null)
      setter(v)
    }
  }

  /** Rend la fiche de la période type `id`, ou rien si elle est introuvable. */
  function ficheDe(id: string | null | undefined) {
    const t = id ? periodesTypes.find((p) => p.id === id) : undefined
    if (!t) return null
    return <FicheType type={t} gardes={gardesParType[t.id] ?? []} />
  }

  /**
   * Un planning CRÉÉ mais jamais rempli — typiquement celui d'un parcours
   * abandonné en cours de route. MiKL, 2026-08-03 : « comment ça se fait que
   * l'été P1 soit créé alors que je ne suis pas allé au bout ? ». Le planning
   * doit bien être créé avant le contrôle (le pré-vol a besoin de ses dates et
   * de sa période type), mais on ne peut pas le laisser orphelin : on propose
   * de le REPRENDRE, en tête du choix. Le plus récent d'abord.
   */
  const vides = periodes.filter(
    (p) => p.statut === 'brouillon' && !periodesAvecGardes.includes(p.id),
  )
  // Le plus récemment CRÉÉ, pas le premier de la liste (qui est triée par date
  // de début). MiKL, 2026-08-03 : « il y en a qu'un de proposé ? c'est quoi,
  // le dernier consulté ? » — c'est le dernier créé, et la carte le dit
  // maintenant. Les autres restent accessibles dans la liste complète, où ils
  // portent le même marqueur « jamais rempli ».
  const brouillonEnCours = vides.length > 0
    ? [...vides].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
    : null
  const idsVides = new Set(vides.map((p) => p.id))

  const bloquants = (preVol ?? []).filter((a) => a.gravite === 'bloquant')
  const aSurveiller = (preVol ?? []).filter((a) => a.gravite !== 'bloquant')

  /** Relit le pré-vol de la cible. Rejoué après CHAQUE correction appliquée. */
  const chargerPreVol = useCallback(async (periodeId: string) => {
    setChargementPreVol(true)
    try {
      const res = await fetch(`/api/generate/pre-vol?periodeId=${encodeURIComponent(periodeId)}`)
      if (!res.ok) throw new Error('pré-vol indisponible')
      const data = await res.json()
      setPreVol((data.avertissements ?? []) as AvertissementPreVol[])
      setSouhaits(typeof data.souhaitsEnAttente === 'number' ? data.souhaitsEnAttente : 0)
    } catch {
      // Le pré-vol ne doit JAMAIS retenir l'admin en otage : s'il est
      // indisponible, on affiche « rien à signaler » et on laisse générer.
      setPreVol([])
      setSouhaits(0)
    } finally {
      setChargementPreVol(false)
    }
  }, [])

  /**
   * Entrer dans le contrôle : on relit TOUJOURS le pré-vol de la cible, jamais
   * un état hérité de la précédente.
   *
   * Déclenché à la main plutôt que par un `useEffect` sur l'étape : le lint du
   * projet interdit un setState synchrone dans un effet (cascades de rendus),
   * et les quatre portes d'entrée sont connues — les nommer vaut mieux que de
   * les deviner depuis une dépendance.
   */
  function allerAuControle(periodeId: string, profilId: string | null) {
    setEtape('controle')
    setTypeCibleId(profilId)
    setTypeConfirme(false) // la confirmation se redemande à chaque passage
    void chargerPreVol(periodeId)
  }

  function reinitialiser() {
    setEtape(etapeInitiale)
    setErreur(null)
    setCreation(false)
    setLibelle('')
    setDebut('')
    setSemaines('')
    setDatesPrecises(false)
    setFinSaisie('')
    setTypeChoisi(AUCUN_TYPE)
    setCible('')
    setNomCible('')
    setCibleEstPubliee(false)
    setPreVol(null)
    setSouhaits(0)
    setResultat(null)
    setTypeCibleId(null)
    setTypeConfirme(false)
  }

  function fermer(o: boolean) {
    if (creation || etape === 'travail') return // jamais pendant un calcul
    onOpenChange(o)
    if (!o) reinitialiser()
  }

  /** Voie « existant » : on vise, puis on passe au contrôle. */
  function viserExistant(p: Periode) {
    // On se place sur son mois DÈS le ciblage : à la fermeture du parcours,
    // l'écran montre le planning qu'on vient de remplir et pas celui d'où on
    // était parti (retour MiKL du 2026-08-03 : « il ne m'a pas renvoyé au bon
    // endroit sur l'agenda, il m'a laissé là où j'étais »).
    onNaviguerVersMois(p.date_debut.slice(0, 7))
    setCible(p.id)
    setNomCible(nomPlanning(p))
    setCibleEstPubliee(p.statut === 'publie')
    setErreur(null)
    // Un planning d'avant la règle du 2026-08-04 peut n'avoir aucune période
    // type : `profil_id` vaut alors NULL, et le contrôle le traitera comme un
    // point bloquant à régler sur place.
    allerAuControle(p.id, p.profil_id ?? null)
  }

  /** Voie « nouveau » : créer, puis passer au contrôle sur le planning créé. */
  async function creerPuisControler() {
    setErreur(null)

    const nom = libelle.trim()
    if (!nom) return setErreur('Donne un nom à ce planning (« Hiver 2027 », « Été P2 »…).')
    if (!debut) return setErreur('Indique la date de départ.')
    if (!fin) {
      return setErreur(datesPrecises ? 'Indique la date de fin.' : 'Indique une durée d’au moins une semaine.')
    }
    if (fin < debutCale) return setErreur('La date de fin doit venir après le lundi de départ.')
    // Le serveur refuse aussi — mais le dire ICI évite un aller-retour et
    // désigne le champ fautif au lieu d'un message générique en bas de modale.
    if (aucuneTypeProgrammee) {
      return setErreur('Ton cabinet n’a encore aucune période type. Il en faut au moins une avant de pouvoir ouvrir un planning.')
    }
    if (!typeChoisi) return setErreur('Choisis la période type de ce planning.')

    setCreation(true)
    const fd = new FormData()
    fd.set('libelle', nom)
    // On CALE sur le lundi plutôt que de refuser (retour MiKL du 2026-08-03 :
    // « d'où vient cette règle que les plannings commencent le lundi ? »).
    // Ce n'est pas une lubie d'interface : le moteur compte en semaines
    // PLEINES — les rythmes « 1 week-end sur N », les séries et l'équité
    // s'ancrent tous sur le lundi. Un départ en milieu de semaine ferait
    // remonter le calcul au lundi précédent, donc hors de la période affichée.
    // L'écran le dit avant, il n'y a pas de surprise.
    fd.set('date_debut', debutCale)
    fd.set('date_fin', fin)
    fd.set('profil_id', typeChoisi)

    const res = await creerPeriode(fd)
    setCreation(false)

    if ('error' in res && res.error) return setErreur(res.error)
    if (!('id' in res) || !res.id) {
      return setErreur('Le planning a été créé mais reste introuvable — recharge la page.')
    }

    // On se place sur son mois AVANT la suite : quand le parcours se refermera,
    // l'écran montrera le bon planning et pas celui d'où on était parti.
    onNaviguerVersMois(debutCale.slice(0, 7))
    setCible(res.id)
    setNomCible(nom)
    setCibleEstPubliee(false)
    allerAuControle(res.id, typeChoisi)
  }

  /**
   * Rattacher une période type à un planning qui n'en a pas — le cas des
   * plannings créés avant la règle du 2026-08-04. On le règle SUR PLACE,
   * comme tous les autres points du contrôle, plutôt que de renvoyer l'admin
   * dans un autre écran en lui faisant perdre son parcours.
   */
  async function rattacherType(profilId: string) {
    if (!cible) return
    setRattachement(true)
    const res = await setProfilPeriode(cible, profilId)
    setRattachement(false)
    if ('error' in res && res.error) {
      toast.error(res.error)
      return
    }
    setTypeCibleId(profilId)
    router.refresh()
  }

  /**
   * Le planning retiré vient d'être effacé (ou dépublié). S'il était la CIBLE
   * du parcours, on la relâche : continuer à viser un planning qui n'existe
   * plus enverrait le moteur travailler dans le vide.
   */
  function apresRetrait(id: string, message: string) {
    setRetrait(null)
    if (cible === id) setCible('')
    toast.success(message)
    router.refresh()
  }

  /**
   * ③bis — B-062. Filou relit le planning qui vient d'être enregistré.
   *
   * ── B-074 : ELLE SE DÉROULE DANS LE PARCOURS, PAS APRÈS ────────────────
   *
   * La première version rendait la main dès le résultat et laissait Filou
   * travailler en arrière-plan. MiKL, 27/08 : « tu livres quelque chose, puis
   * il y a un temps d'attente long avec juste une petite roue qui tourne, et
   * **la personne peut fermer avant d'avoir vu la conclusion** ».
   *
   * Il a raison, et le défaut est de conception, pas d'affichage : un parcours
   * qui rend la main pendant qu'il travaille encore annonce une fin qui n'en
   * est pas une. `lancer` l'ATTEND donc désormais, et l'écran d'attente
   * raconte ses étapes dans le même style que celles du moteur.
   *
   * Ce que ça ne change pas : le planning est déjà écrit en base quand elle
   * commence, donc un échec de Filou ne peut toujours rien lui retirer.
   */
  async function lancerRelecture(periodeId: string) {
    setRelecture(null)
    setEtapeRelecture(null)
    setRelectureEnCours(true)
    try {
      const res = await fetch('/api/planning/relecture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodeId }),
      })
      // Les étapes de Filou passent par le MÊME canal que celles du moteur :
      // l'écran d'attente ne fait pas la différence, et l'admin voit un seul
      // travail qui se poursuit plutôt que deux traitements qui se succèdent.
      const data = await lireLeFlux(res, (m) => {
        setEtapeRelecture(m)
        setEtapeMoteur(m)
      })
      const statut = typeof data.__status === 'number' ? data.__status : (res.ok ? 200 : res.status)

      if (statut >= 400 || data.issue === 'indisponible') {
        // Jamais un silence : sans ce bloc, l'absence de rapport se lirait
        // « rien à signaler » — et personne ne va vérifier une bonne nouvelle.
        setRelecture({
          issue: 'indisponible',
          error: (data.error as string) ?? undefined,
          detail: (data.detail as string) ?? undefined,
        })
        return
      }

      setRelecture(data as unknown as DonneesRelecture)
      // Des gardes ont pu changer : l'écran du planning doit les relire.
      if (data.planningModifie) router.refresh()
    } catch (e) {
      setRelecture({
        issue: 'indisponible',
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setRelectureEnCours(false)
    }
  }

  /**
   * B-104 — le témoin. Si cet écran disparaît PENDANT le travail, il le dit.
   *
   * Trois façons de disparaître, et le nettoyage d'effet les attrape toutes :
   * un démontage du composant, une navigation, une erreur remontée à la
   * frontière React. Aucune ne passe par les chemins prévus du parcours — qui
   * affichent tous un message — et c'est bien pour ça que le symptôme de MiKL
   * n'était explicable par aucune trace serveur.
   *
   * Le nettoyage ne s'exécute qu'au démontage réel (dépendances vides) : un
   * simple re-rendu, y compris déclenché par le `router.refresh()` du temps
   * réel, ne déclenche rien. Si une balise part quand même, c'est que le
   * composant a bel et bien été démonté — et ce serait la réponse cherchée.
   */
  useEffect(() => {
    return () => {
      if (!travailDepuisRef.current) return // pas en train de travailler : normal
      signalerIncidentParcours({
        traceId: traceIdRef.current,
        periodeId: periodeCibleRef.current,
        raison: 'ecran-demonte-pendant-le-travail',
        etape: etapeCouranteRef.current,
        apresMs: Date.now() - travailDepuisRef.current,
      })
    }
  }, [])

  /** ③ Le moteur travaille. `confirmRepublication` : cf. garde-fou Chantier B. */
  async function lancer(confirmRepublication: boolean) {
    if (!cible) return
    setEtape('travail')
    setResultat(null)
    setRelecture(null)
    setEtapeMoteur(null)
    // Le témoin s'arme ici et se désarme au premier résultat affiché.
    travailDepuisRef.current = Date.now()
    traceIdRef.current = null
    etapeCouranteRef.current = null
    periodeCibleRef.current = cible
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodeId: cible, confirmRepublication }),
      })

      // B-060 — deux formes de réponse, et c'est voulu.
      //
      // Les refus d'AVANT le travail (auth, période introuvable, verrou) restent
      // du JSON simple : ils sont immédiats, rien à raconter. Dès que le moteur
      // se met en marche, la réponse devient un FLUX (NDJSON) : une ligne par
      // étape, la dernière portant le résultat.
      //
      // MiKL, 26/08 : « je préfère prendre plus de temps et l'utilisateur le
      // comprendra si tu indiques en direct ce qu'il se passe ». D'où une règle
      // ferme : ce qui s'affiche vient du SERVEUR. Aucun message inventé ici,
      // aucun décompte décoratif — sinon l'écran raconterait une histoire pendant
      // que le moteur en vit une autre.
      const data = res.headers.get('content-type')?.includes('ndjson')
        ? await lireLeFlux(
            res,
            (m) => {
              // Mémorisé pour le témoin : savoir SUR QUELLE étape ça a lâché
              // vaut mieux que savoir que ça a lâché.
              etapeCouranteRef.current = m
              setEtapeMoteur(m)
            },
            (id) => { traceIdRef.current = id },
          )
        : await res.json()

      // B-104 — le flux s'est tu sans jamais livrer de résultat. Vu de la base,
      // ce cas est indiscernable d'une fonction tuée : dans les deux cas la
      // trace reste ouverte. Le dire ici les sépare — ici, le navigateur était
      // encore vivant et a vu la connexion se fermer.
      if (typeof data.error === 'string' && data.success === undefined && data.issue === undefined) {
        signalerIncidentParcours({
          traceId: traceIdRef.current,
          periodeId: periodeCibleRef.current,
          raison: 'flux-clos-sans-resultat',
          etape: etapeCouranteRef.current,
          message: data.error,
          apresMs: travailDepuisRef.current ? Date.now() - travailDepuisRef.current : null,
        })
      }

      // Le statut : `res.ok` ne suffit plus. Un flux répond TOUJOURS 200 —
      // l'entête part avant que le travail commence — et porte son vrai code
      // dans la dernière ligne (`__status`). S'en tenir à `res.ok` ferait passer
      // un refus 422 pour un succès.
      const statut = typeof data.__status === 'number' ? data.__status : (res.ok ? 200 : res.status)
      if (statut >= 400) {
        setResultat({
          ok: false,
          creneauxIgnores: [],
          message: (data.error as string) ?? 'Erreur pendant la génération.',
        })
        setEtape('resultat')
        return
      }
      // Filet serveur : période publiée sans confirmation → on revient au
      // contrôle, qui porte l'avertissement d'écrasement.
      if (data.requiresConfirmation) {
        setCibleEstPubliee(true)
        allerAuControle(cible, typeCibleId)
        return
      }

      if (data.success) {
        // B-074 — on ATTEND Filou avant d'afficher quoi que ce soit. Rendre la
        // main ici puis continuer à travailler laissait l'admin fermer l'écran
        // avant la conclusion. Le planning est déjà en base : attendre ne
        // risque rien, ça évite seulement d'annoncer une fin prématurée.
        await lancerRelecture(cible)
        setResultat({
          ok: true,
          issue: 'complet',
          nbGardes: data.nbGardes,
          dureeMs: data.dureeMs,
          creneauxIgnores: (data.creneauxIgnores ?? []) as CreneauIgnore[],
          placesFigees: (data.placesFigees ?? 0) as number,
          cadenasInoperants: (data.cadenasInoperants ?? []) as string[],
        })
        router.refresh()
      } else if (data.issue === 'partiel') {
        // B-053 — le planning EST écrit. On ne repart pas les mains vides :
        // il reste des cases à pourvoir, et on dit lesquelles.
        // B-074 — et c'est le cas où Filou sert le plus : on l'attend aussi.
        await lancerRelecture(cible)
        setResultat({
          ok: false,
          issue: 'partiel',
          nbGardes: data.nbGardes,
          dureeMs: data.dureeMs,
          casesVides: (data.creneauxVides ?? []) as CaseVide[],
          creneauxIgnores: (data.creneauxIgnores ?? []) as CreneauIgnore[],
          placesFigees: (data.placesFigees ?? 0) as number,
          cadenasInoperants: (data.cadenasInoperants ?? []) as string[],
          exclusDernierRecours: (data.exclusDernierRecours ?? []) as string[],
          interrompu: data.interrompu === true,
        })
        router.refresh()
      } else if (data.interrompu) {
        setResultat({
          ok: false,
          interrompu: true,
          creneauxIgnores: (data.creneauxIgnores ?? []) as CreneauIgnore[],
          placesFigees: (data.placesFigees ?? 0) as number,
          cadenasInoperants: (data.cadenasInoperants ?? []) as string[],
          exclusDernierRecours: (data.exclusDernierRecours ?? []) as string[],
          message: data.error ?? 'Génération interrompue : le planning est trop contraint (calcul trop long).',
        })
      } else {
        setResultat({
          ok: false,
          creneauxIgnores: (data.creneauxIgnores ?? []) as CreneauIgnore[],
          placesFigees: (data.placesFigees ?? 0) as number,
          cadenasInoperants: (data.cadenasInoperants ?? []) as string[],
          diagnostic: (data.diagnostic ?? null) as DiagnosticImpasseData | null,
          joursNonCouverts: (data.joursNonCouverts ?? []) as JourNonCouvert[],
          exclusDernierRecours: (data.exclusDernierRecours ?? []) as string[],
        })
      }
      setEtape('resultat')
    } catch (e) {
      // Un échec NOMMÉ : on le rapporte aussi, pour le distinguer dans la trace
      // d'une disparition inexpliquée. Les deux se ressemblent vues de la base ;
      // seul ce témoignage dit lequel des deux s'est produit.
      signalerIncidentParcours({
        traceId: traceIdRef.current,
        periodeId: periodeCibleRef.current,
        raison: 'serveur-injoignable',
        etape: etapeCouranteRef.current,
        message: e instanceof Error ? e.message : String(e),
        apresMs: travailDepuisRef.current ? Date.now() - travailDepuisRef.current : null,
      })
      setResultat({ ok: false, creneauxIgnores: [], message: 'Impossible de joindre le serveur.' })
      setEtape('resultat')
    } finally {
      // Le témoin se désarme : à partir d'ici, un démontage est normal (l'admin
      // ferme un écran de résultat). Le laisser armé produirait de fausses
      // alertes, et une alerte qui crie sans raison finit par être ignorée —
      // y compris le jour où elle a raison.
      travailDepuisRef.current = null
    }
  }

  function terminer() {
    onOpenChange(false)
    reinitialiser()
    router.refresh()
  }

  // ── Titres, par étape ────────────────────────────────────
  const TITRES: Record<Etape, { titre: string; sous: string }> = {
    choix: {
      titre: 'Quel planning veux-tu remplir ?',
      sous: 'Le moteur remplit une fenêtre de dates. Dis-moi laquelle.',
    },
    nouveau: {
      titre: 'Un nouveau planning',
      sous: 'Je le crée, puis on vérifie que tout est prêt avant de le remplir.',
    },
    existant: {
      titre: 'Refaire un planning existant',
      sous: 'Il sera recalculé de zéro, sauf les gardes verrouillées.',
    },
    controle: {
      titre: 'Avant de lancer',
      sous: `Je passe les règles en revue pour « ${nomCible} ». Tout ce qui coince se règle ici.`,
    },
    travail: {
      titre: 'Je remplis le planning…',
      sous: 'Le moteur essaie les combinaisons et garde la plus équitable.',
    },
    // B-053 — trois titres. Le planning partiel EST un résultat : le dire
    // « je n'ai pas pu remplir le planning » ferait paniquer pour rien alors
    // que tout est en base, à quelques cases près.
    resultat: {
      titre:
        resultat?.issue === 'partiel'
          ? 'Presque : il reste quelques cases'
          : resultat?.ok
            ? 'C’est prêt'
            : 'Je n’ai pas pu remplir le planning',
      sous:
        resultat?.issue === 'partiel'
          ? 'Le planning est enregistré en brouillon. Voici les cases sans personne, et ce sur quoi tu peux agir.'
          : resultat?.ok
            ? 'Regarde-le, ajuste ce que tu veux, puis publie quand il te convient.'
            : 'Voici ce qui bloque — tu peux le régler et relancer.',
    },
  }

  return (
    <>
    <Dialog open={open} onOpenChange={fermer}>
      <DialogContent className="gv-modale gv-parcours">
        <DialogHeader>
          <p className="gm-kicker">
            Planning · génération
            {etape !== 'choix' && etape !== 'nouveau' && etape !== 'existant' && nomCible && (
              <span className="gp-fil"> · {nomCible}</span>
            )}
          </p>
          <DialogTitle>{TITRES[etape].titre}</DialogTitle>
          <DialogDescription>{TITRES[etape].sous}</DialogDescription>
        </DialogHeader>

        {/* ── ① La question ─────────────────────────────── */}
        {etape === 'choix' && (
          <div className="gen-choix">
            {brouillonEnCours && (
              <button
                type="button"
                className="gen-carte reprise"
                onClick={() => viserExistant(brouillonEnCours)}
              >
                <RotateCcw className="gen-carte-ico" aria-hidden="true" />
                <span className="gen-carte-titre">
                  Reprendre « {nomPlanning(brouillonEnCours)} »
                </span>
                <span className="gen-carte-sous">
                  Le dernier que tu as créé, jamais rempli — on repart de là plutôt
                  que d’en créer un de plus.
                  {vides.length > 1 && (
                    <> {vides.length - 1} autre{vides.length > 2 ? 's' : ''} planning
                      {vides.length > 2 ? 's' : ''} vide{vides.length > 2 ? 's' : ''} t’
                      attend{vides.length > 2 ? 'ent' : ''} dans la liste complète.</>
                  )}
                </span>
              </button>
            )}

            <button
              type="button"
              className="gen-carte"
              onClick={() => { setEtape('nouveau'); setErreur(null) }}
            >
              <CalendarPlus className="gen-carte-ico" aria-hidden="true" />
              <span className="gen-carte-titre">Je fais un nouveau planning</span>
              <span className="gen-carte-sous">Des dates, une période type — et c’est parti.</span>
            </button>

            <button
              type="button"
              className="gen-carte"
              disabled={periodes.length === 0}
              onClick={() => { setEtape('existant'); setErreur(null) }}
            >
              <RotateCcw className="gen-carte-ico" aria-hidden="true" />
              <span className="gen-carte-titre">J’en refais un existant</span>
              <span className="gen-carte-sous">
                {periodes.length === 0
                  ? 'Aucun planning pour l’instant.'
                  : periodeAffichee
                    ? `Par exemple « ${nomPlanning(periodeAffichee)} », celui que tu regardes.`
                    : `${periodes.length} planning${periodes.length > 1 ? 's' : ''} au choix.`}
              </span>
            </button>
          </div>
        )}

        {/* ── ①b Le nouveau planning ────────────────────── */}
        {etape === 'nouveau' && (
          <div className="gen-form">
            <label className="gen-champ">
              <span className="gen-label">Nom du planning</span>
              <input
                type="text"
                className="gen-input"
                placeholder="ex. Hiver 2027 — P1"
                value={libelle}
                onChange={(e) => modifie(setLibelle)(e.target.value)}
                autoFocus
              />
            </label>

            <label className="gen-champ">
              <span className="gen-label">Il commence la semaine du</span>
              <input
                type="date"
                className="gen-input"
                value={debut}
                onChange={(e) => modifie(setDebut)(e.target.value)}
              />
              {debut && !estLundi(debut) && (
                <span className="gen-aide cale">
                  Les semaines de garde démarrent le lundi : je pars du{' '}
                  <b>{dateLongue(debutCale)}</b>.
                </span>
              )}
            </label>

            {!datesPrecises ? (
              <div className="gen-champ">
                <span className="gen-label">Il dure</span>
                <div className="gen-duree">
                  <input
                    type="number"
                    min={1}
                    max={104}
                    className="gen-input gen-input-nb"
                    value={semaines === '' ? String(dureeProposee(debutCale)) : semaines}
                    onChange={(e) => modifie(setSemaines)(e.target.value)}
                  />
                  <span className="gen-unite">semaines</span>
                </div>
                <span className="gen-aide">
                  {debut && finCalculee
                    ? <>→ jusqu’au <b>{dateLongue(finCalculee)}</b></>
                    : 'Choisis d’abord le lundi de départ.'}
                </span>
                <button
                  type="button"
                  className="gen-lien"
                  onClick={() => { setFinSaisie(finCalculee ?? ''); setDatesPrecises(true) }}
                >
                  Choisir une date de fin précise
                </button>
              </div>
            ) : (
              <div className="gen-champ">
                <span className="gen-label">Il se termine le</span>
                <input
                  type="date"
                  className="gen-input"
                  value={finSaisie}
                  onChange={(e) => modifie(setFinSaisie)(e.target.value)}
                />
                <button
                  type="button"
                  className="gen-lien"
                  onClick={() => { setDatesPrecises(false); setFinSaisie('') }}
                >
                  Revenir à une durée en semaines
                </button>
              </div>
            )}

            {/* ── LA PÉRIODE TYPE : un choix, jamais un défaut ──────────
                Sans période type programmée, on ne cache plus le champ (ce qui
                laissait croire qu'il n'y avait rien à décider) : on barre la
                route et on montre la porte. */}
            {aucuneTypeProgrammee ? (
              <div className="gen-champ">
                <span className="gen-label">Période type</span>
                <div className="gen-manque">
                  <p className="gen-manque-titre">Ton cabinet n’en a encore aucune</p>
                  <p className="gen-manque-txt">
                    La période type dit quelles gardes couvrir et avec combien de
                    vétérinaires — un hiver et un été ne se couvrent pas pareil. Sans
                    elle, je ne saurais pas quoi remplir. Programmes-en au moins une,
                    puis reviens : ça prend deux minutes.
                  </p>
                  <a className="gen-manque-lien" href="/regles?onglet=profils">
                    Créer une période type
                  </a>
                </div>
              </div>
            ) : (
              <div className="gen-champ">
                <span className="gen-label">Période type</span>
                <Select
                  value={typeChoisi}
                  onValueChange={(v) => {
                    if (!v) return
                    // « En créer une » vit DANS la liste, en dernière entrée —
                    // MiKL, 2026-08-04 : « pourquoi tu les mets pas dans le menu
                    // déroulant, comme ça c'est propre ». Deux liens posés sous
                    // le champ, mal alignés, faisaient du bruit pour un geste
                    // rare. Ici, la porte est là où on cherche déjà.
                    if (v === CREER_TYPE) {
                      window.open('/regles?onglet=profils', '_blank', 'noopener')
                      return // on ne sélectionne pas la sentinelle
                    }
                    modifie(setTypeChoisi)(v)
                  }}
                  // La liste se relit à chaque ouverture : celle créée dans
                  // l'autre onglet est là au retour, sans bouton « rafraîchir »
                  // à demander à l'admin.
                  onOpenChange={(ouvert) => { if (ouvert) router.refresh() }}
                >
                  <SelectTrigger className="w-full">
                    {typeChoisi
                      ? (typesProposables.find((p) => p.id === typeChoisi)?.nom ?? 'Choisis une période type')
                      : 'Choisis une période type'}
                  </SelectTrigger>
                  <SelectContent>
                    {typesProposables.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.nom}</SelectItem>
                    ))}
                    <SelectItem value={CREER_TYPE} className="gen-item-creer">
                      + Créer une période type…
                    </SelectItem>
                  </SelectContent>
                </Select>

                {/* Ce que la période type CHOISIE contient — dès le formulaire,
                    et plus seulement au moment de confirmer. Un nom ne dit rien
                    de ce qu'on est en train de décider. */}
                {ficheDe(typeChoisi)}

                <span className="gen-aide">
                  Elle décide des gardes à couvrir et du nombre de vétérinaires sur
                  chacune.{' '}
                  {saisonDuDepart && !typeChoisi && (
                    <>Ton planning démarre en {saisonDuDepart}.</>
                  )}
                </span>

              </div>
            )}

            {erreur && (
              <p className="gen-erreur">
                <span className="gen-erreur-titre">Je ne peux pas créer ce planning</span>
                {erreur}
              </p>
            )}
          </div>
        )}

        {/* ── ①c Reprendre un planning existant ─────────── */}
        {etape === 'existant' && (
          <div className="gen-liste">
            {periodes.map((p) => {
              const vide = idsVides.has(p.id)
              // Le verrouillé seul reste intouchable : c'est l'historique du
              // cabinet. Le publié se retire désormais, avec l'encadrement que
              // ça demande — porté par la fenêtre, pas par cette liste.
              const supprimable = p.statut !== 'verrouille'
              return (
                <div
                  key={p.id}
                  className={`gen-rangee${p.id === (periodeAffichee?.id ?? '') ? ' suggere' : ''}`}
                >
                  <button
                    type="button"
                    className="gen-ligne"
                    onClick={() => viserExistant(p)}
                  >
                    <span className="gen-ligne-nom">{nomPlanning(p)}</span>
                    <span className="gen-ligne-dates">
                      du {dateCourte(p.date_debut)} au {dateCourte(p.date_fin)}
                    </span>
                    <span className={`gm-badge ${p.statut === 'publie' ? 'publie' : p.statut === 'verrouille' ? 'lock' : 'brouillon'}`}>
                      {vide ? 'Jamais rempli' : STATUT[p.statut]}
                    </span>
                  </button>

                  {/* Depuis le 2026-08-22, un planning PUBLIÉ se retire aussi :
                      il n'existait aucun chemin pour le faire, et il a fallu
                      passer par un script à la main. Ce qui protège n'est plus
                      le statut, c'est ce que la fenêtre annonce et fait
                      recopier. Le verrouillé, lui, reste l'historique. */}
                  {supprimable && (
                    <button
                      type="button"
                      className="gen-suppr"
                      title={vide ? 'Supprimer ce planning vide' : `Supprimer « ${nomPlanning(p)} » et ses gardes`}
                      aria-label={`Supprimer le planning ${nomPlanning(p)}`}
                      onClick={() =>
                        setRetrait({ id: p.id, nom: nomPlanning(p), geste: 'supprimer' })
                      }
                    >
                      <Trash2 className="ppv-ico" aria-hidden />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── ② Avant de lancer ─────────────────────────── */}
        {etape === 'controle' && (
          <div className="gp-controle">
            {/* ── LA CONFIRMATION DE FILOU, AVANT LES VÉRIFICATIONS ──────
                Demande MiKL du 2026-08-04 : « juste avant les vérifs, que
                Filou lui demande de confirmer qu'il veut bien générer le
                planning avec les conditions paramétrées selon la période type
                hiver, ou été ». Elle passe DEVANT les points de contrôle parce
                qu'elle porte sur le socle : régler dix détails sur la mauvaise
                structure, c'est dix réglages perdus.

                Elle vient AUSSI cadenasser un vieux planning sans période type
                — et là, elle se règle sur place. */}
            {typeCibleId === null ? (
              <div className="gp-lot bloquant">
                <p className="gp-lot-titre">
                  <AlertTriangle className="gp-lot-ico" aria-hidden />
                  Ce planning n’a pas de période type
                </p>
                <div className="gp-type">
                  <p className="gp-type-txt">
                    Il a été créé avant que la période type devienne obligatoire.
                    Sans elle, je ne sais pas quelles gardes couvrir ni avec combien
                    de vétérinaires. Dis-moi laquelle s’applique :
                  </p>
                  {aucuneTypeProgrammee ? (
                    <a className="gen-manque-lien" href="/regles?onglet=profils">
                      Ton cabinet n’en a aucune — créer une période type
                    </a>
                  ) : (
                    <Select
                      value=""
                      onValueChange={(v) => {
                        if (!v) return
                        if (v === CREER_TYPE) {
                          window.open('/regles?onglet=profils', '_blank', 'noopener')
                          return
                        }
                        void rattacherType(v)
                      }}
                      onOpenChange={(ouvert) => { if (ouvert) router.refresh() }}
                    >
                      <SelectTrigger className="w-full" disabled={rattachement}>
                        {rattachement ? 'J’enregistre…' : 'Choisis une période type'}
                      </SelectTrigger>
                      <SelectContent>
                        {typesProposables.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.nom}</SelectItem>
                        ))}
                        <SelectItem value={CREER_TYPE} className="gen-item-creer">
                          + Créer une période type…
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            ) : (
              <div className={`gp-type-filou${typeConfirme ? ' confirme' : ''}`}>
                <Image
                  src="/filou/filou-tete.webp"
                  alt=""
                  width={34}
                  height={34}
                  className="gv-gardien-binette"
                />
                <div className="gp-type-corps">
                  {typeConfirme ? (
                    <p className="gp-type-phrase">
                      <CheckCircle2 className="gp-type-ok" aria-hidden />
                      <span>
                        C’est noté : je remplis <b>{nomCible}</b> avec{' '}
                        <b>{nomTypeCible ?? 'la période type choisie'}</b>.
                      </span>
                    </p>
                  ) : (
                    <>
                      <p className="gp-type-phrase">
                        Voilà avec quoi je vais remplir <b>{nomCible}</b>. On y va comme ça ?
                      </p>
                      {ficheDe(typeCibleId)}
                      <div className="gp-type-actions">
                        <button
                          type="button"
                          className="ppv-btn fort"
                          onClick={() => setTypeConfirme(true)}
                        >
                          Oui, c’est la bonne
                        </button>
                        <a
                          className="ppv-btn"
                          href="/regles?onglet=profils"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Changer ses réglages ↗
                        </a>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {chargementPreVol && (
              <p className="gp-attente">
                <Loader2 className="ppv-spin" aria-hidden /> Je passe les règles en revue…
              </p>
            )}

            {!chargementPreVol && preVol !== null && preVol.length === 0 && souhaits === 0 && (
              <div className="gp-feu-vert">
                <CheckCircle2 className="gp-feu-ico" aria-hidden />
                <div>
                  <p className="gp-feu-titre">Rien ne coince</p>
                  <p className="gp-feu-sous">
                    Les règles du cabinet sont cohérentes avec l’équipe en place. On peut y aller.
                  </p>
                </div>
              </div>
            )}

            {!chargementPreVol && souhaits > 0 && (
              <div className="gv-alerte attention">
                <div className="gva-tete">
                  <ShieldAlert className="gva-ico" aria-hidden />
                  <div className="gva-titres">
                    <p className="gva-titre">
                      {souhaits} demande{souhaits > 1 ? 's' : ''} de congé en attente
                    </p>
                    <p className="gva-sous">
                      Si tu les valides après coup, il faudra régénérer le planning.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!chargementPreVol && bloquants.length > 0 && (
              <div className="gp-lot bloquant">
                <p className="gp-lot-titre">
                  <AlertTriangle className="gp-lot-ico" aria-hidden />
                  {bloquants.length} point{bloquants.length > 1 ? 's' : ''} {bloquants.length > 1 ? 'bloquants' : 'bloquant'} — la génération échouerait
                </p>
                {bloquants.map((a, i) => (
                  <PointPreVol
                    key={`b-${a.code}-${i}`}
                    avertissement={a}
                    vets={vets}
                    onCorrige={() => void chargerPreVol(cible)}
                  />
                ))}
              </div>
            )}

            {!chargementPreVol && aSurveiller.length > 0 && (
              <div className="gp-lot">
                <p className="gp-lot-titre">
                  {aSurveiller.length} point{aSurveiller.length > 1 ? 's' : ''} à surveiller — le planning sortira quand même
                </p>
                {aSurveiller.map((a, i) => (
                  <PointPreVol
                    key={`s-${a.code}-${i}`}
                    avertissement={a}
                    vets={vets}
                    onCorrige={() => void chargerPreVol(cible)}
                  />
                ))}
              </div>
            )}

            {cibleEstPubliee && (
              <div className="gv-alerte danger">
                <div className="gva-tete">
                  <AlertTriangle className="gva-ico" aria-hidden />
                  <div className="gva-titres">
                    <p className="gva-titre">Ce planning est déjà publié</p>
                    <p className="gva-sous">
                      Le regénérer l’écrase (sauf les gardes verrouillées), le repasse en
                      brouillon — l’équipe ne le verra plus — et vide ses événements
                      d’agenda jusqu’à la republication.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ③ Ça tourne ───────────────────────────────── */}
        {etape === 'travail' && (
          <div className="gp-travail">
            <div className="gp-jauge"><span /></div>
            {/* B-060 — l'étape en cours, telle que le serveur l'annonce. Tant
                qu'il n'a rien dit, on décrit le travail sans prétendre savoir
                où il en est. */}
            <p className="gp-travail-txt">
              {etapeMoteur ?? 'Le moteur place les gardes une à une, revient sur ses pas quand une règle coince, et garde la répartition la plus équitable qu’il trouve.'}
            </p>
            <p className="gp-travail-note">
              Quelques secondes, parfois un peu plus : il reprend les cases restées vides
              avant de rendre son résultat.
            </p>
          </div>
        )}

        {/* ── ④ Le résultat ─────────────────────────────── */}
        {etape === 'resultat' && resultat && (
          <div className="gp-resultat">
            {/* ── B-074 · plus d'annonce d'attente ici ────────────────────
                Elle n'a plus lieu d'être : depuis que le parcours ATTEND la
                relecture avant d'afficher le résultat, l'avis de Filou est
                déjà présent quand cet écran apparaît. Annoncer « son avis
                s'affichera plus bas » quand il est déjà écrit plus bas serait
                du bruit. L'attente, elle, se raconte pendant l'étape ③. */}

            {/* ── B-053 · PARTIEL : le planning existe, il lui manque des cases ── */}
            {resultat.issue === 'partiel' ? (
              <>
                <div className="gp-feu-ambre">
                  <CalendarClock className="gp-feu-ico" aria-hidden />
                  <div>
                    <p className="gp-feu-titre">
                      {resultat.nbGardes} garde{(resultat.nbGardes ?? 0) > 1 ? 's' : ''} placée
                      {(resultat.nbGardes ?? 0) > 1 ? 's' : ''} ·{' '}
                      {resultat.casesVides?.length ?? 0} case
                      {(resultat.casesVides?.length ?? 0) > 1 ? 's' : ''} à pourvoir
                    </p>
                    <p className="gp-feu-sous">
                      Le planning est <strong>enregistré en brouillon</strong> : l’équipe ne le
                      voit pas encore, et rien n’est perdu. Complète les cases manquantes d’un
                      clic sur le planning — la publication attendra qu’elles soient toutes
                      pourvues.
                    </p>
                  </div>
                </div>

                <NoteDernierRecoursExclus prenoms={resultat.exclusDernierRecours ?? []} />

                <CasesAPourvoir
                  cases={resultat.casesVides ?? []}
                  nomParVet={(id) => prenomParVetId.get(id)}
                />

                {resultat.interrompu && (
                  <p className="gp-note-calcul">
                    Le calcul a été arrêté avant d’avoir tout exploré : ce qui est enregistré
                    est bon, mais une recherche plus longue aurait peut-être trouvé mieux.
                  </p>
                )}

                <NoteCadenas
                  placesFigees={resultat.placesFigees}
                  inoperants={resultat.cadenasInoperants}
                />
                <CreneauxIgnoresAlert creneaux={resultat.creneauxIgnores} />
              </>
            ) : resultat.ok ? (
              <>
                <div className="gp-feu-vert">
                  <CheckCircle2 className="gp-feu-ico" aria-hidden />
                  <div>
                    <p className="gp-feu-titre">
                      {resultat.nbGardes} garde{(resultat.nbGardes ?? 0) > 1 ? 's' : ''} placée{(resultat.nbGardes ?? 0) > 1 ? 's' : ''}
                    </p>
                    <p className="gp-feu-sous">
                      Le planning est en <strong>brouillon</strong> : l’équipe ne le voit pas
                      encore. Vérifie-le, change ce que tu veux d’un clic sur une case, puis
                      publie-le.
                    </p>
                  </div>
                </div>
                <NoteCadenas
                  placesFigees={resultat.placesFigees}
                  inoperants={resultat.cadenasInoperants}
                />
                <CreneauxIgnoresAlert creneaux={resultat.creneauxIgnores} />
              </>
            ) : (
              <>
                {resultat.message && (
                  <p className="gen-erreur">
                    <span className="gen-erreur-titre">
                      {resultat.interrompu ? 'Calcul interrompu' : 'Échec'}
                    </span>
                    {resultat.message}
                  </p>
                )}
                {/* Calcul interrompu : pas de diagnostic à afficher, mais
                    l'exclusion du dernier recours reste une piste à donner. */}
                {resultat.diagnostic === undefined && (
                  <NoteDernierRecoursExclus prenoms={resultat.exclusDernierRecours ?? []} />
                )}
                <NoteCadenas
                  placesFigees={resultat.placesFigees}
                  inoperants={resultat.cadenasInoperants}
                />
                <CreneauxIgnoresAlert creneaux={resultat.creneauxIgnores} />
                {resultat.diagnostic !== undefined && (
                  <DiagnosticImpasse
                    diagnostic={resultat.diagnostic ?? null}
                    joursNonCouverts={resultat.joursNonCouverts ?? []}
                    exclusDernierRecours={resultat.exclusDernierRecours ?? []}
                  />
                )}

                {/* Le filet du filet (palier 4) : on ne saura jamais tout
                    prévoir, et un cabinet coincé ne doit pas rester seul
                    devant un message. Montré UNIQUEMENT sur un échec réel — un
                    « signaler un problème » permanent dirait qu'on s'attend à
                    ce que ça casse. */}
                <div className="gp-secours">
                  <p className="gp-secours-txt">
                    Tu as réglé ce qu’on te proposait et ça bloque encore ? Ce n’est
                    pas de ta faute : certaines configurations n’ont pas encore été
                    prévues. Dis-le, et l’équipe corrigera à distance.
                  </p>
                  <SignalerLimite
                    origine="génération de planning"
                    contexte={{
                      planning: nomCible,
                      periodeId: cible,
                      interrompu: resultat.interrompu ?? false,
                      message: resultat.message ?? null,
                      // B-053 — le VRAI nombre de trous, pas `joursNonCouverts`
                      // (qui liste tout ce qui suit le point d'arrêt du moteur).
                      casesAPourvoir: (resultat.casesVides ?? []).length,
                      pointsPreVol: (preVol ?? []).map((a) => a.code),
                    }}
                  />
                </div>
              </>
            )}

            {/* ── B-062 · LA RELECTURE DE FILOU ────────────────
                Sous le résultat de génération, jamais à sa place : ce qui est
                au-dessus est acquis, ce qui suit est un avis. Ne s'affiche que
                quand un planning existe — sur un échec sec, il n'y a rien à
                relire, et un bloc vide se lirait comme un avis favorable. */}
            {resultat.issue !== 'echec' && relectureEnCours && (
              <p className="rl-attente">
                {etapeRelecture ?? 'Filou relit le planning…'}
              </p>
            )}
            {/* B-107 — les prénoms servent à GROUPER les constats par personne.
                Sans eux le rapport s'affiche à plat : moins lisible, jamais faux. */}
            {resultat.issue !== 'echec' && relecture && (
              <RapportRelecture donnees={relecture} prenoms={prenomsEquipe} />
            )}
          </div>
        )}

        {/* ── Le pied, par étape ────────────────────────── */}
        <DialogFooter>
          {etape === 'choix' && (
            <Button variant="outline" onClick={() => fermer(false)}>Annuler</Button>
          )}

          {etape === 'nouveau' && (
            <>
              <Button variant="outline" onClick={() => { setEtape('choix'); setErreur(null) }} disabled={creation}>
                Retour
              </Button>
              <Button
                onClick={creerPuisControler}
                disabled={creation || aucuneTypeProgrammee}
                title={aucuneTypeProgrammee ? 'Programme d’abord une période type' : undefined}
              >
                {creation ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {creation ? 'Création…' : 'Créer et vérifier'}
              </Button>
            </>
          )}

          {etape === 'existant' && (
            <Button variant="outline" onClick={() => setEtape('choix')}>Retour</Button>
          )}

          {etape === 'controle' && (
            <>
              <Button variant="outline" onClick={() => setEtape('choix')}>Retour</Button>
              {/* Après une correction faite dans l'autre onglet : on relit sans
                  refaire tout le parcours (retour MiKL du 2026-08-03).
                  Masqué quand rien ne coince : il n'y a rien à revérifier, et
                  un bouton actif à côté de « Rien ne coince » laisse croire
                  qu'il reste quelque chose à faire. */}
              {(preVol?.length ?? 0) > 0 && (
              <Button
                variant="outline"
                onClick={() => void chargerPreVol(cible)}
                disabled={chargementPreVol}
              >
                {chargementPreVol
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <RefreshCw className="w-4 h-4 mr-2" />}
                J’ai corrigé — revérifier
              </Button>
              )}
              <Button
                onClick={() => void lancer(cibleEstPubliee)}
                disabled={chargementPreVol || bloquants.length > 0 || !typeConfirme}
                title={
                  bloquants.length > 0
                    ? 'Règle d’abord les points bloquants — la génération échouerait'
                    : !typeConfirme
                      ? 'Confirme d’abord la période type'
                      : undefined
                }
              >
                <Wand2 className="w-4 h-4 mr-2" />
                {cibleEstPubliee ? 'Écraser et regénérer' : 'Générer le planning'}
              </Button>
            </>
          )}

          {etape === 'resultat' && (
            <>
              {!resultat?.ok && (
                <Button variant="outline" onClick={() => allerAuControle(cible, typeCibleId)}>
                  Revenir aux réglages
                </Button>
              )}
              <Button onClick={terminer}>
                {resultat?.ok ? 'Voir le planning' : 'Fermer'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Posée en FRÈRE du parcours, pas à l'intérieur : deux fenêtres imbriquées
        dans le même arbre se disputent le piège de focus et la touche Échap.
        Chacune s'affiche par son propre portail, la dernière ouverte devant. */}
    {retrait && (
      <RetirerPlanningModale
        periodeId={retrait.id}
        nomConnu={retrait.nom}
        geste={retrait.geste}
        onFerme={() => setRetrait(null)}
        onFait={(message) => apresRetrait(retrait.id, message)}
      />
    )}
    </>
  )
}
