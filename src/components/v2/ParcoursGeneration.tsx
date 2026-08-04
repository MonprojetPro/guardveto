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

import { useCallback, useMemo, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CalendarPlus, RotateCcw, Wand2, Loader2, ShieldAlert, CheckCircle2, AlertTriangle,
  RefreshCw, Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { DiagnosticImpasse } from '@/components/planning/DiagnosticImpasse'
import { CreneauxIgnoresAlert } from '@/components/planning/CreneauxIgnoresAlert'
import { PointPreVol, type VetEtiquette } from '@/components/planning/PointPreVol'
import { SignalerLimite } from '@/components/planning/SignalerLimite'
import { creerPeriode, supprimerPeriode, setProfilPeriode } from '@/app/(protected)/admin/periodes/actions'
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
      {type.saison_suggeree && (
        <div className="type-ligne">
          <dt>Saison</dt>
          <dd>{type.saison_suggeree === 'ete' ? '☀️ été' : '❄️ hiver'}</dd>
        </div>
      )}
      <div className="type-ligne">
        <dt>Gardes à couvrir</dt>
        <dd>
          {gardes.length > 0
            ? gardes.join(' · ')
            : <i>aucune garde réglée — le planning sortirait vide</i>}
        </dd>
      </div>
      {typeof type.nb_vetos_semaine_soir === 'number' && (
        <div className="type-ligne">
          <dt>Nuits de semaine</dt>
          <dd>{type.nb_vetos_semaine_soir} vétérinaire{type.nb_vetos_semaine_soir > 1 ? 's' : ''}</dd>
        </div>
      )}
    </dl>
  )
}

interface Resultat {
  ok: boolean
  nbGardes?: number
  dureeMs?: number
  creneauxIgnores: CreneauIgnore[]
  /** Impasse : le moteur a prouvé qu'aucun planning n'existe. */
  diagnostic?: DiagnosticImpasseData | null
  joursNonCouverts?: JourNonCouvert[]
  /** Coupe propre du calcul (trop long) — PAS une impasse prouvée. */
  interrompu?: boolean
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
  const [etape, setEtape] = useState<Etape>(etapeInitiale)
  const [creation, setCreation] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

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

  // Suppression d'un planning vide depuis la liste — en deux temps (on demande
  // confirmation sur la ligne), jamais sur un simple clic.
  const [aSupprimer, setASupprimer] = useState<string | null>(null)
  const [suppressionEnCours, setSuppressionEnCours] = useState(false)

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
   * La saison du départ ne CHOISIT plus rien — elle SUGGÈRE, à voix haute.
   * On garde le calcul (mai→août = été) uniquement pour aider l'admin à
   * reconnaître la bonne période type dans sa liste : « ton départ tombe en
   * hiver ». La décision reste la sienne, et le serveur refuse sans elle.
   */
  // Pas de `useMemo` : deux comparaisons de nombres et un `find` sur une liste
  // de trois éléments. Le mémoriser coûterait plus cher que le recalculer, et
  // le compilateur React refuse la mémo manuelle sur cette dépendance.
  const saisonDuDepart = debutCale
    ? (Number(debutCale.slice(5, 7)) >= 5 && Number(debutCale.slice(5, 7)) <= 8 ? 'été' : 'hiver')
    : null
  const typeSuggere = saisonDuDepart
    ? (periodesTypes.find(
        (p) => !p.est_defaut && p.saison_suggeree === (saisonDuDepart === 'été' ? 'ete' : 'hiver'),
      ) ?? null)
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
   * Supprimer un planning resté vide. Le serveur ne l'autorise que sur un
   * BROUILLON SANS GARDES — c'est ce garde-fou qui rend le bouton sûr : on ne
   * peut pas effacer un planning que l'équipe a déjà vu, ni un travail de
   * génération. Sans lui, les essais s'empilaient sans moyen de faire le
   * ménage (retour MiKL du 2026-08-03).
   */
  async function supprimer(id: string) {
    setSuppressionEnCours(true)
    const res = await supprimerPeriode(id)
    setSuppressionEnCours(false)
    setASupprimer(null)
    if ('error' in res && res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Planning supprimé.')
    if (cible === id) setCible('')
    router.refresh()
  }

  /** ③ Le moteur travaille. `confirmRepublication` : cf. garde-fou Chantier B. */
  async function lancer(confirmRepublication: boolean) {
    if (!cible) return
    setEtape('travail')
    setResultat(null)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodeId: cible, confirmRepublication }),
      })
      const data = await res.json()

      if (!res.ok) {
        setResultat({ ok: false, creneauxIgnores: [], message: data.error ?? 'Erreur pendant la génération.' })
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
        setResultat({
          ok: true,
          nbGardes: data.nbGardes,
          dureeMs: data.dureeMs,
          creneauxIgnores: (data.creneauxIgnores ?? []) as CreneauIgnore[],
        })
        router.refresh()
      } else if (data.interrompu) {
        setResultat({
          ok: false,
          interrompu: true,
          creneauxIgnores: (data.creneauxIgnores ?? []) as CreneauIgnore[],
          message: data.error ?? 'Génération interrompue : le planning est trop contraint (calcul trop long).',
        })
      } else {
        setResultat({
          ok: false,
          creneauxIgnores: (data.creneauxIgnores ?? []) as CreneauIgnore[],
          diagnostic: (data.diagnostic ?? null) as DiagnosticImpasseData | null,
          joursNonCouverts: (data.joursNonCouverts ?? []) as JourNonCouvert[],
        })
      }
      setEtape('resultat')
    } catch {
      setResultat({ ok: false, creneauxIgnores: [], message: 'Impossible de joindre le serveur.' })
      setEtape('resultat')
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
    resultat: {
      titre: resultat?.ok ? 'C’est prêt' : 'Je n’ai pas pu remplir le planning',
      sous: resultat?.ok
        ? 'Regarde-le, ajuste ce que tu veux, puis publie quand il te convient.'
        : 'Voici ce qui bloque — tu peux le régler et relancer.',
    },
  }

  return (
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
                  Elle décide des gardes à couvrir et de l’effectif.{' '}
                  {saisonDuDepart && typeSuggere && !typeChoisi && (
                    <>Ton départ tombe en {saisonDuDepart} — <b>{typeSuggere.nom}</b> est
                      réglée pour cette saison, mais c’est toi qui décides.</>
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
              const supprimable = p.statut === 'brouillon'
              // En confirmation, la rangée bascule ENTIÈREMENT : la question
              // et ses deux réponses occupent la place du planning. Glissées
              // à côté du nom, elles se chevauchaient et on ne savait plus à
              // quelle ligne elles se rapportaient (retour MiKL 2026-08-03).
              if (aSupprimer === p.id) {
                return (
                  <div key={p.id} className="gen-rangee confirmation">
                    <div className="gen-confirm-txt">
                      <p className="gen-confirm-titre">
                        Supprimer « {nomPlanning(p)} » ?
                      </p>
                      <p className="gen-confirm-sous">
                        {vide
                          ? 'Ce planning est vide — rien à perdre.'
                          : 'Ses gardes seront effacées. Personne ne les a vues : ce planning n’est pas publié, aucun e-mail n’est parti, aucun agenda n’a été rempli.'}
                      </p>
                    </div>
                    <div className="gen-confirm-actions">
                      <button
                        type="button"
                        className="ppv-btn"
                        disabled={suppressionEnCours}
                        onClick={() => setASupprimer(null)}
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        className="ppv-btn danger"
                        disabled={suppressionEnCours}
                        onClick={() => void supprimer(p.id)}
                      >
                        {suppressionEnCours && <Loader2 className="ppv-spin" aria-hidden />}
                        Supprimer
                      </button>
                    </div>
                  </div>
                )
              }
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

                  {/* Tous les BROUILLONS sont supprimables depuis le 2026-08-03,
                      remplis ou non : tant qu'un planning n'est pas publié,
                      l'équipe ne l'a jamais vu et rien n'a été envoyé. Publiés
                      et verrouillés restent intouchables. */}
                  {supprimable && (
                    <button
                      type="button"
                      className="gen-suppr"
                      title={vide ? 'Supprimer ce planning vide' : 'Supprimer ce brouillon et ses gardes'}
                      aria-label={`Supprimer le planning ${nomPlanning(p)}`}
                      onClick={() => setASupprimer(p.id)}
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
            <p className="gp-travail-txt">
              Le moteur place les gardes une à une, revient sur ses pas quand une règle
              coince, et garde la répartition la plus équitable qu’il trouve.
            </p>
            <p className="gp-travail-note">Quelques secondes, parfois un peu plus sur une longue période.</p>
          </div>
        )}

        {/* ── ④ Le résultat ─────────────────────────────── */}
        {etape === 'resultat' && resultat && (
          <div className="gp-resultat">
            {resultat.ok ? (
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
                <CreneauxIgnoresAlert creneaux={resultat.creneauxIgnores} />
                {resultat.diagnostic !== undefined && (
                  <DiagnosticImpasse
                    diagnostic={resultat.diagnostic ?? null}
                    joursNonCouverts={resultat.joursNonCouverts ?? []}
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
                      joursNonCouverts: (resultat.joursNonCouverts ?? []).length,
                      pointsPreVol: (preVol ?? []).map((a) => a.code),
                    }}
                  />
                </div>
              </>
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
  )
}
