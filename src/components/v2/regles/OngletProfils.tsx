'use client'

// ============================================================
// GUARDVETO V2 — Onglet 1 · Profils de planning
// ============================================================
// Un profil est une ORGANISATION DE GARDES réutilisable (« Hiver », « Été »,
// « Vacances »…) : un catalogue de types de garde avec leurs horaires, qu'on
// applique ensuite à une période. C'est l'objet le plus haut de cet écran —
// les trois onglets suivants ne décrivent qu'UN profil, celui qu'on a désigné.
//
// CET ONGLET EST LE SÉLECTEUR DE PROFIL. Il y avait au départ un menu déroulant
// « Profil » en tête de page, y compris ici : une case à droite pour choisir,
// et juste en dessous une grille qui montrait les mêmes profils sans qu'on
// puisse en choisir aucun. Deux commandes pour un seul geste. Désormais la
// tête de page ne porte le menu que sur « Types de garde » et « Enchaînements »
// (là où la grille n'est pas visible), et ICI c'est la carte elle-même qu'on
// clique. Une carte = un choix, avec son `aria-pressed`.
//
// TROIS DÉCISIONS PORTÉES ICI :
//
//  · On CRÉE PAR DUPLICATION, jamais à partir de rien. Un profil vide ne
//    génère aucune garde — ce serait une coquille. La RPC `dupliquer_profil`
//    copie le catalogue de la source, donc le nouveau profil est générable
//    dès sa création ; on l'ajuste ensuite dans « Types de garde ».
//
//  · La création s'ouvre en PANNEAU DÉPLIÉ, pas en modale. C'est le pattern de
//    cet écran : ce qu'on remplit reste dans le fil de ce qu'on regardait, et
//    on voit les profils existants pendant qu'on choisit lequel dupliquer.
//
//  · La suppression, elle, passe par une MODALE de confirmation qui dit la
//    conséquence réelle. La V1 posait un `window.confirm()` avec un texte faux
//    (« les périodes repasseront au profil par défaut ») : en base, elles
//    perdent simplement leur profil (`profil_id` → NULL) et le catalogue du
//    profil part en cascade. On ne fait pas signer un geste destructeur sur
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

interface Props {
  profils: ProfilUI[]
  /** Le profil regardé dans les autres onglets — à signaler visuellement (classe `courant`). */
  profilCourantId: string
  /** Désigne le profil que décriront les onglets suivants. */
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
 * Un clic parti d'un de ces éléments ne choisit PAS le profil : on manipulait
 * un réglage de la carte, pas la carte. Le déclencheur de menu est visé par son
 * `data-slot` — c'est un `button`, mais la liste qu'il ouvre part en portail,
 * donc les clics sur les options ne remontent jamais jusqu'ici.
 */
const ZONES_NEUTRES = 'button, input, a, [data-slot="select-trigger"]'

function saisonClair(s: string | null): string {
  return s === 'ete' ? 'Été' : s === 'hiver' ? 'Hiver' : 'Aucune'
}

function effectifClair(n: number | null): string {
  return n === 1 ? '1 véto' : n === 2 ? '2 vétos' : 'Selon la période'
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

  // Renommage en ligne : un seul profil à la fois en édition.
  const [renommeId, setRenommeId] = useState<string | null>(null)
  const [nomEdite, setNomEdite] = useState('')

  // Suppression : le profil visé par la modale de confirmation.
  const [aSupprimer, setASupprimer] = useState<ProfilUI | null>(null)

  // Réglages déjà appliqués à l'écran, pas encore confirmés par le serveur.
  const [meta, setMeta] = useState<Record<string, MetaLocale>>({})

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
      toast.error('Donne un nom à ce profil (« Hiver », « Été », « Vacances »…).')
      return
    }
    if (propre.length > 60) {
      toast.error('Le nom du profil est trop long (60 caractères max).')
      return
    }
    startTransition(async () => {
      const res: Reponse = await creerProfil({
        nom: propre,
        source_profil_id: sourceId || null,
        saison_suggeree:
          saisonNouveau === 'ete' || saisonNouveau === 'hiver' ? saisonNouveau : null,
        nb_vetos_semaine_soir:
          effectifNouveau === '1' || effectifNouveau === '2' ? Number(effectifNouveau) : null,
      })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      toast.success(`Profil « ${propre} » créé, avec les types de garde de sa source.`)
      setCreationOuverte(false)
      router.refresh()
    })
  }

  const renommer = (p: ProfilUI) => {
    const propre = nomEdite.trim()
    if (!propre) {
      toast.error('Le nom du profil est obligatoire.')
      return
    }
    if (propre === p.nom) {
      setRenommeId(null)
      return
    }
    startTransition(async () => {
      const res: Reponse = await renommerProfil(p.id, propre)
      if (res?.error) {
        toast.error(res.error)
        return
      }
      toast.success('Profil renommé.')
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
        toast.error(res.error)
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
        toast.error(res.error)
        return
      }
      toast.success(`Profil « ${cible.nom} » supprimé.`)
      setASupprimer(null)
      router.refresh()
    })
  }

  /** Un clic sur la carte choisit le profil — sauf s'il visait un réglage. */
  const cliquerCarte = (p: ProfilUI, cible: EventTarget | null) => {
    if (p.id === profilCourantId) return
    if (cible instanceof Element && cible.closest(ZONES_NEUTRES)) return
    onChoisir(p.id)
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Profils de planning</h2>
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
            <CopyPlus size={15} aria-hidden="true" /> Nouveau profil
          </button>
          <p className="sub">
            Un profil, c&apos;est une façon d&apos;organiser les gardes : ses types de garde, leurs
            horaires et leurs enchaînements. On en applique un à chaque période — « Hiver » quand
            les nuits sont longues, « Été » quand l&apos;équipe est réduite. Choisis une carte pour
            que les trois onglets suivants décrivent ce profil-là.
          </p>
        </div>

        {creationOuverte && (
          <div className="panneau">
            <p className="panneau-titre">Nouveau profil de planning</p>

            <div className="grille">
              <div className="large">
                <label htmlFor="prof-nom">Nom du profil</label>
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
                <label id="lbl-source">Copier les types de garde de</label>
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
                    <SelectItem value="1">1 véto</SelectItem>
                    <SelectItem value="2">2 vétos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="note">
              Le nouveau profil part avec les types de garde du profil copié : il est générable
              immédiatement. On ajuste ensuite ses horaires dans l&apos;onglet « Types de garde ».
              La saison suggérée sert juste à le proposer d&apos;office quand on crée une période
              de cette saison-là.
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
                {isPending ? 'Un instant…' : 'Créer le profil'}
              </button>
            </div>
          </div>
        )}

        {profils.length === 0 ? (
          <p className="empty-row">
            Aucun profil de planning pour ce cabinet. Un profil se crée en copiant un profil
            existant — il n&apos;y en a aucun à copier ici, c&apos;est le signe que la structure du
            cabinet n&apos;a jamais été initialisée. Demande à Filou, il sait poser la première
            organisation de gardes.
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
                      ? `Profil ${p.nom}, actuellement décrit par les onglets suivants`
                      : `Voir le profil ${p.nom} dans les onglets suivants`
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
                      <label htmlFor={`renommer-${p.id}`}>Nom du profil</label>
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
                        <span className="etiq eteint">Voir ce profil</span>
                      )}
                    </div>
                  )}

                  <p className="note">
                    {p.creneaux.length} type{p.creneaux.length > 1 ? 's' : ''} de garde,{' '}
                    {actifs === 0 ? 'aucun actif' : `dont ${actifs} actif${actifs > 1 ? 's' : ''}`}.
                    {courant
                      ? ' C’est ce profil que décrivent les onglets suivants.'
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
                          const valeur = brut === '1' || brut === '2' ? Number(brut) : null
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
                          <SelectItem value="1">1 véto</SelectItem>
                          <SelectItem value="2">2 vétos</SelectItem>
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

                        {/* Le profil par défaut ne se supprime pas : c'est celui
                            sur lequel retombe toute période qui n'en désigne
                            aucun. On laisse le bouton visible mais éteint —
                            l'absence de bouton se lit comme un oubli. */}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setASupprimer(p)}
                          disabled={isPending || p.estDefaut}
                          title={
                            p.estDefaut
                              ? 'Le profil par défaut ne peut pas être supprimé : c’est celui qui sert quand une période n’en désigne aucun.'
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
                      Profil par défaut : il sert de repli pour toute période qui n&apos;en désigne
                      aucun. Il ne peut donc pas être supprimé.
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
            <DialogTitle>Supprimer le profil « {aSupprimer?.nom} » ?</DialogTitle>
            <DialogDescription>
              C&apos;est définitif, et ça ne touche pas qu&apos;à ce profil.
            </DialogDescription>
          </DialogHeader>

          {aSupprimer && (
            <ul className="gv-consequences">
              <li>
                Ses {aSupprimer.creneaux.length} type
                {aSupprimer.creneaux.length > 1 ? 's' : ''} de garde et leurs horaires disparaissent
                avec lui, ainsi que ses enchaînements.
              </li>
              <li>
                Les périodes qui l&apos;utilisaient se retrouvent <strong>sans profil</strong> : à
                leur prochaine génération, il faudra leur en désigner un.
              </li>
              <li>
                Les plannings <strong>déjà générés</strong> ne bougent pas — ce qui est publié
                reste publié.
              </li>
            </ul>
          )}

          <p className="gv-note">
            Pour garder cette organisation sous la main sans la voir partout, mieux vaut la laisser
            en place : un profil inutilisé ne coûte rien et ne s&apos;applique à aucune période
            tant qu&apos;on ne le choisit pas.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setASupprimer(null)} disabled={isPending}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={supprimer} disabled={isPending}>
              {isPending ? 'Un instant…' : 'Supprimer le profil'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
