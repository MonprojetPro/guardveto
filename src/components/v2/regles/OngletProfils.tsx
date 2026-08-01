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
  creerProfil, renommerProfil, setProfilMeta, supprimerProfil,
} from '@/app/(protected)/admin/structure/actions'
import type { ProfilUI } from './types'
import { useErreurBloquante } from './ErreurBloquante'

interface Props {
  profils: ProfilUI[]
  /** La période type regardée dans les autres onglets — à signaler visuellement (classe `courant`). */
  profilCourantId: string
  /** Désigne la période type que décriront les onglets suivants. */
  onChoisir: (id: string) => void
}

/** Ce qu'une action serveur de cet écran peut répondre. */
type Reponse = { error?: string; success?: boolean } | undefined

/** Les deux réglages qu'on peut avoir modifiés en optimiste, en attendant le serveur. */
interface MetaLocale {
  saisonSuggeree?: string | null
  effectifSoirSemaine?: number | null
}

/** Le composant de menu refuse la valeur vide : sentinelle pour « aucune valeur ». */
const AUCUNE = '__aucune__'

/**
 * Un clic parti d'un de ces éléments ne choisit PAS la période type : on manipulait
 * un réglage de la carte, pas la carte. Le déclencheur de menu est visé par son
 * `data-slot` — c'est un `button`, mais la liste qu'il ouvre part en portail,
 * donc les clics sur les options ne remontent jamais jusqu'ici.
 */
const ZONES_NEUTRES = 'button, input, a, [data-slot="select-trigger"]'

function saisonClair(s: string | null): string {
  return s === 'ete' ? 'Été' : s === 'hiver' ? 'Hiver' : 'Aucune'
}

/** Les effectifs proposables le soir en semaine (miroir du CHECK 1..4). */
const EFFECTIFS = [1, 2, 3, 4]

function effectifClair(n: number | null): string {
  if (n === null || !EFFECTIFS.includes(n)) return 'Selon la saison'
  return n === 1 ? '1 véto' : `${n} vétos`
}

export function OngletProfils({ profils, profilCourantId, onChoisir }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Le panneau de création, replié par défaut : la page doit d'abord montrer
  // ce qui existe.
  const [creationOuverte, setCreationOuverte] = useState(false)
  const [nom, setNom] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [saisonNouveau, setSaisonNouveau] = useState<string>(AUCUNE)
  const [effectifNouveau, setEffectifNouveau] = useState<string>(AUCUNE)

  // Renommage en ligne : une seule période type à la fois en édition.
  const [renommeId, setRenommeId] = useState<string | null>(null)
  const [nomEdite, setNomEdite] = useState('')

  // Suppression : la période type visée par la modale de confirmation.
  const [aSupprimer, setASupprimer] = useState<ProfilUI | null>(null)

  // Réglages déjà appliqués à l'écran, pas encore confirmés par le serveur.
  const [meta, setMeta] = useState<Record<string, MetaLocale>>({})

  // Les refus s'affichent en modale (cf. `ErreurBloquante`) : une vignette de
  // quelques secondes en bas d'écran ne suffit pas à expliquer un refus.
  const { ouvrirErreur, dialogueErreur } = useErreurBloquante()

  const profilDefaut = profils.find((p) => p.estDefaut) ?? profils[0]

  /** La valeur à afficher : l'optimiste si elle existe, sinon celle du serveur. */
  const saisonDe = (p: ProfilUI): string | null => {
    const local = meta[p.id]
    return local && local.saisonSuggeree !== undefined ? local.saisonSuggeree : p.saisonSuggeree
  }

  const effectifDe = (p: ProfilUI): number | null => {
    const local = meta[p.id]
    return local && local.effectifSoirSemaine !== undefined
      ? local.effectifSoirSemaine
      : p.effectifSoirSemaine
  }

  const ouvrirCreation = () => {
    setNom('')
    setSourceId(profilDefaut?.id ?? '')
    setSaisonNouveau(AUCUNE)
    setEffectifNouveau(AUCUNE)
    setCreationOuverte(true)
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
      const res: Reponse = await creerProfil({
        nom: propre,
        source_profil_id: sourceId || null,
        saison_suggeree:
          saisonNouveau === 'ete' || saisonNouveau === 'hiver' ? saisonNouveau : null,
        nb_vetos_semaine_soir:
          EFFECTIFS.includes(Number(effectifNouveau)) ? Number(effectifNouveau) : null,
      })
      if (res?.error) {
        ouvrirErreur(res.error)
        return
      }
      toast.success(`Période type « ${propre} » créée, avec les types de garde de sa source.`)
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
   * Enregistre un réglage de carte (saison ou effectif) en affichant tout de
   * suite la nouvelle valeur, et en la reprenant si le serveur refuse.
   */
  const reglerMeta = (
    p: ProfilUI,
    optimiste: MetaLocale,
    patch: { saison_suggeree?: 'ete' | 'hiver' | null; nb_vetos_semaine_soir?: number | null },
    message: string,
  ) => {
    const avant = meta[p.id]
    setMeta((prev) => ({ ...prev, [p.id]: { ...prev[p.id], ...optimiste } }))
    startTransition(async () => {
      const res: Reponse = await setProfilMeta(p.id, patch)
      if (res?.error) {
        setMeta((prev) => {
          const suivant = { ...prev }
          if (avant) suivant[p.id] = avant
          else delete suivant[p.id]
          return suivant
        })
        ouvrirErreur(res.error)
        return
      }
      toast.success(message)
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
          <span className={`section-count${profils.length === 0 ? ' zero' : ''}`}>
            {profils.length}
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

              <div className="large">
                <label id="lbl-source">Copier la structure des gardes de</label>
                <Select value={sourceId} onValueChange={(v) => v && setSourceId(String(v))}>
                  <SelectTrigger aria-labelledby="lbl-source" className="w-full">
                    {profils.find((p) => p.id === sourceId)?.nom ?? 'Choisir…'}
                  </SelectTrigger>
                  <SelectContent>
                    {profils.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nom}
                        {p.estDefaut ? ' (par défaut)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label id="lbl-saison-neuf">Saison suggérée</label>
                <Select
                  value={saisonNouveau}
                  onValueChange={(v) => v && setSaisonNouveau(String(v))}
                >
                  <SelectTrigger aria-labelledby="lbl-saison-neuf" className="w-full">
                    {saisonClair(saisonNouveau === AUCUNE ? null : saisonNouveau)}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUCUNE}>Aucune</SelectItem>
                    <SelectItem value="ete">Été</SelectItem>
                    <SelectItem value="hiver">Hiver</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label id="lbl-effectif-neuf">Le soir en semaine</label>
                <Select
                  value={effectifNouveau}
                  onValueChange={(v) => v && setEffectifNouveau(String(v))}
                >
                  <SelectTrigger aria-labelledby="lbl-effectif-neuf" className="w-full">
                    {effectifClair(effectifNouveau === AUCUNE ? null : Number(effectifNouveau))}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUCUNE}>Selon la période</SelectItem>
                    {EFFECTIFS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {effectifClair(n)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="note">
              La nouvelle période type part avec les types de garde de celle qu&apos;on copie :
              elle est générable immédiatement. On ajuste ensuite ses horaires dans l&apos;onglet
              « Structure des gardes ». La saison suggérée sert juste à la proposer d&apos;office quand
              on crée un planning de cette saison-là.
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

        {profils.length === 0 ? (
          <p className="empty-row">
            Aucune période type pour ce cabinet. Une période type se crée en copiant une
            existante — il n&apos;y en a aucune à copier ici, c&apos;est le signe que
            l&apos;organisation du cabinet n&apos;a jamais été initialisée. Demande à Filou, il sait
            poser la première.
          </p>
        ) : (
          <div className="prof-grille">
            {profils.map((p) => {
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

                  <p className="note">
                    {p.creneaux.length} type{p.creneaux.length > 1 ? 's' : ''} de garde,{' '}
                    {actifs === 0 ? 'aucun actif' : `dont ${actifs} actif${actifs > 1 ? 's' : ''}`}.
                    {courant
                      ? ' C’est cette période type que décrivent les onglets suivants.'
                      : ' Clique la carte pour le décrire dans les onglets suivants.'}
                  </p>

                  <div className="prof-reglages">
                    <div className="prof-reglage">
                      <span id={`lbl-saison-${p.id}`}>Saison suggérée</span>
                      <Select
                        value={saisonDe(p) ?? AUCUNE}
                        disabled={isPending}
                        onValueChange={(v) => {
                          if (!v) return
                          const brut = String(v)
                          const valeur = brut === 'ete' || brut === 'hiver' ? brut : null
                          reglerMeta(
                            p,
                            { saisonSuggeree: valeur },
                            { saison_suggeree: valeur },
                            valeur
                              ? `« ${p.nom} » sera proposé pour les périodes d’${saisonClair(valeur).toLowerCase()}.`
                              : `« ${p.nom} » ne sera plus proposé d’office.`,
                          )
                        }}
                      >
                        <SelectTrigger
                          aria-labelledby={`lbl-saison-${p.id}`}
                          className="w-[150px]"
                        >
                          {saisonClair(saisonDe(p))}
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={AUCUNE}>Aucune</SelectItem>
                          <SelectItem value="ete">Été</SelectItem>
                          <SelectItem value="hiver">Hiver</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="prof-reglage">
                      <span id={`lbl-effectif-${p.id}`}>Le soir en semaine</span>
                      <Select
                        value={effectifDe(p) === null ? AUCUNE : String(effectifDe(p))}
                        disabled={isPending}
                        onValueChange={(v) => {
                          if (!v) return
                          const brut = String(v)
                          const valeur = EFFECTIFS.includes(Number(brut)) ? Number(brut) : null
                          reglerMeta(
                            p,
                            { effectifSoirSemaine: valeur },
                            { nb_vetos_semaine_soir: valeur },
                            valeur
                              ? `Le soir en semaine : ${effectifClair(valeur)} sur « ${p.nom} ».`
                              : `« ${p.nom} » suivra de nouveau l’effectif de la période.`,
                          )
                        }}
                      >
                        <SelectTrigger
                          aria-labelledby={`lbl-effectif-${p.id}`}
                          className="w-[150px]"
                        >
                          {effectifClair(effectifDe(p))}
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={AUCUNE}>Selon la période</SelectItem>
                          {EFFECTIFS.map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {effectifClair(n)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

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
