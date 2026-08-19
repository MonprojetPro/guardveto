'use client'

// ============================================================
// GUARDVETO V2 — Onglet 1 · Périodes types
// ============================================================
// Une PÉRIODE TYPE est une façon de tourner, réutilisable (« Hiver », « Été »,
// « Été 2 »…) : un catalogue de types de garde avec leurs horaires, qu'on
// applique ensuite à un planning. C'est l'objet le plus haut de cet écran —
// les trois onglets suivants ne décrivent QU'UNE période type, celle qu'on a
// désignée. Plusieurs plannings peuvent partager la même (« Hiver 1 », « Hiver
// 2 » tournent tous les deux sur « Hiver ») : c'est un MODÈLE, pas une tranche
// de calendrier.
//
// ⚠️ Côté base, l'objet s'appelle encore `profils_planning` et les actions
//    serveur `creerProfil` / `renommerProfil` / `supprimerProfil`. Frontière
//    assumée : on renomme ce que l'utilisateur lit, pas ce que Postgres
//    stocke. Le mot « profil » ne doit plus apparaître à l'écran.
//
// CET ONGLET EST LE SÉLECTEUR. Il y avait au départ un menu déroulant en tête
// de page, y compris ici : une case à droite pour choisir, et juste en dessous
// une grille qui montrait les mêmes cartes sans qu'on
// puisse en choisir aucune. Deux commandes pour un seul geste. Désormais la
// tête de page ne porte le menu que sur « Types de garde » et « Enchaînements »
// (là où la grille n'est pas visible), et ICI c'est la carte elle-même qu'on
// clique. Une carte = un choix, avec son `aria-pressed`.
//
// TROIS DÉCISIONS PORTÉES ICI :
//
//  · On CRÉE PAR DUPLICATION, jamais à partir de rien. Une période type vide ne
//    génère aucune garde — ce serait une coquille. La RPC `dupliquer_profil`
//    copie le catalogue de la source, donc la nouvelle est générable
//    dès sa création ; on l'ajuste ensuite dans « Types de garde ».
//
//  · La création s'ouvre en PANNEAU DÉPLIÉ, pas en modale. C'est le pattern de
//    cet écran : ce qu'on remplit reste dans le fil de ce qu'on regardait, et
//    on voit les périodes types existantes pendant qu'on choisit laquelle dupliquer.
//
//  · La suppression, elle, passe par une MODALE de confirmation qui dit la
//    conséquence réelle. La V1 posait un `window.confirm()` avec un texte faux
//    (« les périodes repasseront au profil par défaut ») : en base, elles
//    perdent simplement leur rattachement (`profil_id` → NULL) et le
//    catalogue part en cascade. On ne fait pas signer un geste destructeur sur
//    une phrase inexacte.
//
// AUCUN `<select>` NATIF ici : un select natif ouvre le menu du NAVIGATEUR
// (carré, bleu système), à côté de boutons en pilule et de champs aux coins
// arrondis. Tous les menus passent par le composant `ui/select` du projet, qui
// est habillé de bout en bout dans `v2-terrier.css` (le déclencheur à même
// l'écran ET la liste en portail). Sa contrainte : il refuse `value=""`, d'où
// la sentinelle `AUCUNE` pour dire « pas de valeur », traduite en `null` avant
// d'atteindre le serveur.
//
// Saison et effectif s'enregistrent AU CHANGEMENT, sans bouton « Enregistrer » :
// ce sont deux valeurs parmi trois, le geste est déjà la décision. L'affichage
// est optimiste et revient en arrière si le serveur refuse — sinon le menu
// montrerait la nouvelle valeur alors que la base a gardé l'ancienne.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CopyPlus, Pencil, Trash2, Check, X } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import {
  creerProfil, renommerProfil, supprimerProfil, setAffinagePeriodeType,
} from '@/app/(protected)/admin/structure/actions'
import type { ProfilUI, CreneauUI } from './types'
import { useErreurBloquante } from './ErreurBloquante'

interface Props {
  profils: ProfilUI[]
  /** LE SOCLE du cabinet : les gardes possibles, avec leur maximum de places. */
  socle: CreneauUI[]
  /** La période type regardée dans les autres onglets — à signaler visuellement (classe `courant`). */
  profilCourantId: string
  /** Désigne la période type que décriront les onglets suivants. */
  onChoisir: (id: string) => void
}

/** Ce qu'une action serveur de cet écran peut répondre. */
type Reponse = { error?: string; success?: boolean } | undefined

/**
 * Un clic parti d'un de ces éléments ne choisit PAS la période type : on manipulait
 * un réglage de la carte, pas la carte. Le déclencheur de menu est visé par son
 * `data-slot` — c'est un `button`, mais la liste qu'il ouvre part en portail,
 * donc les clics sur les options ne remontent jamais jusqu'ici.
 */
const ZONES_NEUTRES = 'button, input, a, [data-slot="select-trigger"]'

export function OngletProfils({
  profils, socle, profilCourantId, onChoisir,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Le panneau de création, replié par défaut : la page doit d'abord montrer
  // ce qui existe.
  const [creationOuverte, setCreationOuverte] = useState(false)
  const [nom, setNom] = useState('')
  const [sourceId, setSourceId] = useState('')
  /**
   * Ce que la NOUVELLE période type retiendra, garde par garde — réglable
   * AVANT de créer (MiKL, 2026-08-04 : « pourquoi quand je crée une période
   * type je ne peux pas la paramétrer ? »).
   *
   * Il fallait auparavant créer, puis régler sur la carte : deux gestes pour
   * une seule intention, et entre les deux une période type qui ne
   * correspondait à rien de ce qu'on voulait.
   */
  const [affinageNeuf, setAffinageNeuf] = useState<Record<string, number>>({})

  // Renommage en ligne : une seule période type à la fois en édition.
  const [renommeId, setRenommeId] = useState<string | null>(null)
  const [nomEdite, setNomEdite] = useState('')

  // Suppression : la période type visée par la modale de confirmation.
  const [aSupprimer, setASupprimer] = useState<ProfilUI | null>(null)

  // Affinages déjà appliqués à l'écran, pas encore confirmés par le serveur :
  // profilId → creneauId → nombre de vétérinaires.
  const [local, setLocal] = useState<Record<string, Record<string, number>>>({})

  // Les refus s'affichent en modale (cf. `ErreurBloquante`) : une vignette de
  // quelques secondes en bas d'écran ne suffit pas à expliquer un refus.
  const { ouvrirErreur, dialogueErreur } = useErreurBloquante()

  /**
   * « Supprime-moi cette configuration standard, elle ne veut rien dire »
   * (MiKL, 2026-08-04), puis « je veux bien qu'elle n'apparaisse JAMAIS »
   * (2026-08-19).
   *
   * Elle ne peut pas disparaître de la BASE : c'est le repli du moteur pour
   * tout planning qui ne désigne aucune période type, et plusieurs fonctions
   * SQL s'appuient dessus. Mais elle ne se montre plus comme une période type
   * du cabinet — jamais, quelles que soient les circonstances. Les conditions
   * qui la ramenaient (« un planning tourne encore dessus ») la faisaient
   * réapparaître au pire moment : juste après que le cabinet ait créé la
   * sienne, parce qu'une simple reprise d'historique laisse derrière elle une
   * période d'archive sans période type.
   *
   * Rien à craindre pour la CRÉATION, qui se fait pourtant en copiant une
   * période type existante : quand aucune source n'est transmise, le serveur
   * retombe de lui-même sur le profil par défaut du cabinet
   * (`admin/structure/actions.ts`). Le premier cabinet venu crée donc sa
   * première période type sans jamais voir « Configuration standard » — elle
   * travaille en coulisses, elle ne se montre plus. Et générer sans période
   * type reste impossible : « Générer » le refuse et renvoie ici.
   */
  const visibles = profils.filter((p) => !p.estDefaut)

  /** Ce que la source retient de chaque garde — le point de départ des réglages. */
  const affinageDe = (profilId: string): Record<string, number> => {
    const src = profils.find((p) => p.id === profilId)
    const r: Record<string, number> = {}
    for (const c of socle) r[c.id] = src?.affinage[c.id] ?? c.nbPlaces
    return r
  }

  const ouvrirCreation = () => {
    setNom('')
    // On copie depuis une période type VISIBLE : proposer comme source une
    // carte qu'on a masquée juste au-dessus serait incompréhensible. Le repli
    // sur la configuration standard ne joue que si le cabinet n'en a aucune.
    // Vide quand le cabinet n'a encore aucune période type : le serveur prend
    // alors le profil par défaut tout seul. On ne le nomme jamais ici.
    const source = visibles[0]?.id ?? ''
    setSourceId(source)
    setAffinageNeuf(affinageDe(source))
    setCreationOuverte(true)
  }

  /** Changer de source repart de SES réglages : c'est ce que « copier » veut dire. */
  const choisirSource = (id: string) => {
    setSourceId(id)
    setAffinageNeuf(affinageDe(id))
  }

  const creer = () => {
    const propre = nom.trim()
    if (!propre) {
      ouvrirErreur('Donne un nom à cette période type (« Hiver », « Été », « Vacances »…).')
      return
    }
    if (propre.length > 60) {
      ouvrirErreur('Le nom de la période type est trop long (60 caractères max).')
      return
    }
    startTransition(async () => {
      // La période type naît DÉJÀ réglée : le serveur reçoit ce que l'admin
      // vient de choisir garde par garde, pas seulement un nom.
      const res: Reponse = await creerProfil({
        nom: propre,
        source_profil_id: sourceId || null,
        affinage: affinageNeuf,
      })
      if (res?.error) {
        ouvrirErreur(res.error)
        return
      }
      const retirees = socle.filter((c) => (affinageNeuf[c.id] ?? c.nbPlaces) === 0).length
      toast.success(
        retirees > 0
          ? `Période type « ${propre} » créée — ${retirees} garde${retirees > 1 ? 's' : ''} en moins.`
          : `Période type « ${propre} » créée.`,
      )
      setCreationOuverte(false)
      router.refresh()
    })
  }

  const renommer = (p: ProfilUI) => {
    const propre = nomEdite.trim()
    if (!propre) {
      ouvrirErreur('Le nom de la période type est obligatoire.')
      return
    }
    if (propre === p.nom) {
      setRenommeId(null)
      return
    }
    startTransition(async () => {
      const res: Reponse = await renommerProfil(p.id, propre)
      if (res?.error) {
        ouvrirErreur(res.error)
        return
      }
      toast.success('Période type renommée.')
      setRenommeId(null)
      router.refresh()
    })
  }

  /**
   * Enregistre « cette période type veut N vétérinaires sur cette garde ».
   *
   * Affichage OPTIMISTE, repris si le serveur refuse : sans lui, le menu
   * reviendrait à sa valeur d'avant le temps de l'aller-retour, et on croirait
   * que le clic n'a pas pris.
   */
  const reglerAffinage = (p: ProfilUI, creneauId: string, nbVetos: number, nomGarde: string) => {
    const avant = local[p.id]?.[creneauId]
    setLocal((prev) => ({ ...prev, [p.id]: { ...prev[p.id], [creneauId]: nbVetos } }))
    startTransition(async () => {
      const res: Reponse = await setAffinagePeriodeType(p.id, creneauId, nbVetos)
      if (res?.error) {
        setLocal((prev) => {
          const suivant = { ...prev, [p.id]: { ...prev[p.id] } }
          if (avant === undefined) delete suivant[p.id][creneauId]
          else suivant[p.id][creneauId] = avant
          return suivant
        })
        ouvrirErreur(res.error)
        return
      }
      toast.success(
        nbVetos === 0
          ? `« ${nomGarde} » : aucune garde sur « ${p.nom} ».`
          : `« ${nomGarde} » : ${nbVetos} véto${nbVetos > 1 ? 's' : ''} sur « ${p.nom} ».`,
      )
      router.refresh()
    })
  }

  const supprimer = () => {
    if (!aSupprimer) return
    const cible = aSupprimer
    startTransition(async () => {
      const res: Reponse = await supprimerProfil(cible.id)
      if (res?.error) {
        ouvrirErreur(res.error)
        return
      }
      toast.success(`Période type « ${cible.nom} » supprimée.`)
      setASupprimer(null)
      router.refresh()
    })
  }

  /** Un clic sur la carte choisit la période type — sauf s'il visait un réglage. */
  const cliquerCarte = (p: ProfilUI, cible: EventTarget | null) => {
    if (p.id === profilCourantId) return
    if (cible instanceof Element && cible.closest(ZONES_NEUTRES)) return
    onChoisir(p.id)
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Périodes types</h2>
          <span className={`section-count${visibles.length === 0 ? ' zero' : ''}`}>
            {visibles.length}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-accent btn-sm"
            onClick={ouvrirCreation}
            disabled={isPending || creationOuverte || profils.length === 0}
          >
            <CopyPlus size={15} aria-hidden="true" /> Nouvelle période type
          </button>
          <p className="sub">
            Une période type, c&apos;est une façon d&apos;organiser les gardes : sa structure de gardes, leurs
            horaires et leurs enchaînements. On en applique un à chaque période — « Hiver » quand
            les nuits sont longues, « Été » quand l&apos;équipe est réduite. Choisis une carte pour
            que les trois onglets suivants décrivent cette période type-là.
          </p>
        </div>

        {creationOuverte && (
          <div className="panneau">
            <p className="panneau-titre">Nouvelle période type</p>

            <div className="grille">
              <div className="large">
                <label htmlFor="prof-nom">Nom de la période type</label>
                <input
                  id="prof-nom"
                  type="text"
                  autoFocus
                  maxLength={60}
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  placeholder="Hiver, Été, Vacances scolaires…"
                />
              </div>

              {/* La toute PREMIÈRE période type d'un cabinet n'a rien à
                  copier : on ne montre pas un choix à une seule option qu'on
                  refuse par ailleurs de nommer. Elle part des gardes du socle,
                  réglables juste en dessous avant même d'être créée. */}
              {visibles.length > 0 ? (
                <div className="large">
                  <label id="lbl-source">Partir des réglages de</label>
                  <Select value={sourceId} onValueChange={(v) => v && choisirSource(String(v))}>
                    <SelectTrigger aria-labelledby="lbl-source" className="w-full">
                      {visibles.find((p) => p.id === sourceId)?.nom ?? 'Choisir…'}
                    </SelectTrigger>
                    <SelectContent>
                      {visibles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.nom}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="large sub">
                  C&apos;est la première période type du cabinet : elle part des gardes du socle,
                  que tu ajustes ci-dessous.
                </p>
              )}

              {/* ── ON LA PARAMÈTRE AVANT DE LA CRÉER (2026-08-04) ──────────
                  MiKL : « pourquoi quand je crée une période type je ne peux
                  pas la paramétrer ? ». Il fallait créer d'abord, régler
                  ensuite sur la carte — deux gestes pour une seule intention,
                  et entre les deux une période type qui ne correspondait à
                  rien de ce qu'on voulait. Ce sont les mêmes menus que sur la
                  carte, pré-remplis depuis la source choisie. */}
              {socle.length > 0 && (
                <div className="large">
                  <label>Combien de vétérinaires sur chaque garde</label>
                  <div className="ptc-liste">
                    {socle.map((c) => {
                      const max = c.nbPlaces
                      const valeur = affinageNeuf[c.id] ?? max
                      return (
                        <div className="ptc-ligne" key={c.id}>
                          <span className="ptc-garde">
                            <b>{c.nom}</b>
                            <small>{c.joursClair} · jusqu’à {max} véto{max > 1 ? 's' : ''}</small>
                          </span>
                          <Select
                            value={String(valeur)}
                            onValueChange={(v) => {
                              if (v === null || v === undefined) return
                              setAffinageNeuf((prev) => ({ ...prev, [c.id]: Number(v) }))
                            }}
                          >
                            <SelectTrigger
                              className="w-[140px]"
                              aria-label={`Vétérinaires sur « ${c.nom} »`}
                            >
                              {valeur === 0
                                ? 'Aucune garde'
                                : `${valeur} véto${valeur > 1 ? 's' : ''}`}
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">Aucune garde</SelectItem>
                              {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                                <SelectItem key={n} value={String(n)}>
                                  {n} véto{n > 1 ? 's' : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <p className="note">
              Elle est générable dès sa création. Les jours et les horaires, eux, sont communs
              à toutes les périodes types : ils se règlent dans « Structure des gardes ».
              Tout reste modifiable ensuite.
            </p>

            <div className="panneau-pied">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setCreationOuverte(false)}
                disabled={isPending}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={creer}
                disabled={isPending}
              >
                {isPending ? 'Un instant…' : 'Créer la période type'}
              </button>
            </div>
          </div>
        )}

        {visibles.length === 0 ? (
          <p className="empty-row">
            Aucune période type pour ce cabinet. Crée la première avec «&nbsp;Nouvelle période
            type&nbsp;» : elle partira d&apos;une configuration de départ que tu ajusteras — quelles
            gardes couvrir, et combien de vétérinaires sur chacune.
          </p>
        ) : (
          <div className="prof-grille">
            {visibles.map((p) => {
              const actifs = p.creneaux.filter((c) => c.actif).length
              const enEdition = renommeId === p.id
              const courant = p.id === profilCourantId

              return (
                /* La carte EST le choix. Elle porte `role="button"` plutôt que
                   d'être un vrai `<button>` : elle contient déjà des boutons et
                   des menus, et un bouton dans un bouton est du HTML invalide.
                   Les clics partis de ces réglages sont filtrés (ZONES_NEUTRES),
                   et le clavier n'agit que si le focus est bien sur la carte. */
                <article
                  key={p.id}
                  className={`prof-carte${courant ? ' courant' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={courant}
                  aria-label={
                    courant
                      ? `Période type ${p.nom}, actuellement décrite par les onglets suivants`
                      : `Voir la période type ${p.nom} dans les onglets suivants`
                  }
                  onClick={(e) => cliquerCarte(p, e.target)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    cliquerCarte(p, null)
                  }}
                >
                  {enEdition ? (
                    <div className="field">
                      <label htmlFor={`renommer-${p.id}`}>Nom de la période type</label>
                      <input
                        id={`renommer-${p.id}`}
                        type="text"
                        autoFocus
                        maxLength={60}
                        value={nomEdite}
                        onChange={(e) => setNomEdite(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') renommer(p)
                          if (e.key === 'Escape') setRenommeId(null)
                        }}
                      />
                    </div>
                  ) : (
                    <div className="prof-tete">
                      <span className="prof-nom">{p.nom}</span>
                      {p.estDefaut && <span className="etiq">Par défaut</span>}
                      {courant ? (
                        <span className="etiq neutre">Affiché ici</span>
                      ) : (
                        <span className="etiq eteint">Voir cette période type</span>
                      )}
                    </div>
                  )}

                  {/* ── CE QUE LA PÉRIODE TYPE AFFINE (2026-08-04) ───────────
                      Le cœur de la carte : pour chaque garde du SOCLE, combien
                      de vétérinaires cette période-là veut réellement.
                      MiKL : « si jamais il y a marqué vendredi 2 places, dans
                      période type l'utilisateur a le choix de ne programmer
                      qu'un des 2 vétos sur la période hiver, et pour le
                      week-end 2, et pour les soirs de semaine 1 ».
                      « Aucune » est un choix à part entière : la garde n'existe
                      pas sur cette période, et le moteur n'en pose aucune. */}
                  {socle.length === 0 ? (
                    <p className="note">
                      Aucune garde dans la structure du cabinet — commence par l’onglet
                      « Structure des gardes », il n’y a rien à affiner ici pour l’instant.
                    </p>
                  ) : (
                    <div className="ptc-liste">
                      {socle.map((c) => {
                        const max = c.nbPlaces
                        // L'optimiste l'emporte sur le serveur tant qu'il vit.
                        const valeur = local[p.id]?.[c.id] ?? p.affinage[c.id] ?? max
                        return (
                          <div className="ptc-ligne" key={c.id}>
                            <span className="ptc-garde">
                              <b>{c.nom}</b>
                              <small>{c.joursClair} · jusqu’à {max} véto{max > 1 ? 's' : ''}</small>
                            </span>
                            <Select
                              value={String(valeur)}
                              disabled={isPending}
                              onValueChange={(v) => {
                                if (v === null || v === undefined) return
                                reglerAffinage(p, c.id, Number(v), c.nom)
                              }}
                            >
                              <SelectTrigger
                                className="w-[140px]"
                                aria-label={`Vétérinaires sur « ${c.nom} » pour ${p.nom}`}
                              >
                                {valeur === 0
                                  ? 'Aucune garde'
                                  : `${valeur} véto${valeur > 1 ? 's' : ''}`}
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="0">Aucune garde</SelectItem>
                                {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                                  <SelectItem key={n} value={String(n)}>
                                    {n} véto{n > 1 ? 's' : ''}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )
                      })}
                      <p className="note">
                        {actifs === 0
                          ? 'Aucune garde retenue : cette période type ne produirait aucun planning.'
                          : `${actifs} garde${actifs > 1 ? 's' : ''} sur cette période.`}
                        {' '}Les jours et les horaires se règlent dans « Structure des gardes »,
                        pour tout le cabinet.
                      </p>
                    </div>
                  )}

                  <div className="prof-actions">
                    {enEdition ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-accent btn-sm"
                          onClick={() => renommer(p)}
                          disabled={isPending}
                        >
                          <Check size={15} aria-hidden="true" /> Enregistrer
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setRenommeId(null)}
                          disabled={isPending}
                        >
                          <X size={15} aria-hidden="true" /> Annuler
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => {
                            setRenommeId(p.id)
                            setNomEdite(p.nom)
                          }}
                          disabled={isPending}
                        >
                          <Pencil size={15} aria-hidden="true" /> Renommer
                        </button>

                        {/* La période type par défaut ne se supprime pas :
                            c'est celle sur laquelle retombe tout planning qui
                            n'en désigne aucune. Bouton visible mais éteint —
                            l'absence de bouton se lit comme un oubli. */}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setASupprimer(p)}
                          disabled={isPending || p.estDefaut}
                          title={
                            p.estDefaut
                              ? 'La période type par défaut ne peut pas être supprimée : c’est celle qui sert quand un planning n’en désigne aucune.'
                              : undefined
                          }
                        >
                          <Trash2 size={15} aria-hidden="true" /> Supprimer
                        </button>
                      </>
                    )}
                  </div>

                  {p.estDefaut && !enEdition && (
                    <p className="note">
                      Période type par défaut : elle sert de repli pour tout planning qui n&apos;en
                      désigne aucune. Elle ne peut donc pas être supprimée.
                    </p>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>

      {/* Confirmation de suppression : elle DIT ce qui se passe réellement en
          base, parce que le geste est irréversible et qu'il touche des périodes
          déjà créées. */}
      <Dialog
        open={Boolean(aSupprimer)}
        onOpenChange={(o) => {
          if (!o && !isPending) setASupprimer(null)
        }}
      >
        <DialogContent className="gv-modale">
          <DialogHeader>
            <DialogTitle>Supprimer la période type « {aSupprimer?.nom} » ?</DialogTitle>
            <DialogDescription>
              C&apos;est définitif, et ça ne touche pas qu&apos;à cette période type.
            </DialogDescription>
          </DialogHeader>

          {aSupprimer && (
            <ul className="gv-consequences">
              <li>
                Ses {aSupprimer.creneaux.length} type
                {aSupprimer.creneaux.length > 1 ? 's' : ''} de garde et leurs horaires disparaissent
                avec elle, ainsi que ses enchaînements.
              </li>
              <li>
                Les plannings qui l&apos;utilisaient se retrouvent <strong>sans période
                type</strong> : à leur prochaine génération, il faudra leur en désigner une.
              </li>
              <li>
                Les plannings <strong>déjà générés</strong> ne bougent pas — ce qui est publié
                reste publié.
              </li>
            </ul>
          )}

          <p className="gv-note">
            Pour garder cette organisation sous la main sans la voir partout, mieux vaut la laisser
            en place : une période type inutilisé ne coûte rien et ne s&apos;applique à aucune période
            tant qu&apos;on ne le choisit pas.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setASupprimer(null)} disabled={isPending}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={supprimer} disabled={isPending}>
              {isPending ? 'Un instant…' : 'Supprimer la période type'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dialogueErreur}
    </>
  )
}
