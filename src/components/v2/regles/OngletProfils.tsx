'use client'

// ============================================================
// GUARDVETO V2 — Onglet 1 · Profils de planning
// ============================================================
// Un profil est une ORGANISATION DE GARDES réutilisable (« Hiver », « Été »,
// « Vacances »…) : un catalogue de types de garde avec leurs horaires, qu'on
// applique ensuite à une période. C'est l'objet le plus haut de cet écran —
// les trois onglets suivants ne parlent que du profil sélectionné en tête de
// page. D'où sa place en premier, et le repère visuel sur la carte du profil
// courant (`.prof-carte.courant`) : sans lui, le sélecteur du haut et cette
// grille racontent deux histoires différentes.
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
// Saison et effectif s'enregistrent AU CHANGEMENT, sans bouton « Enregistrer » :
// ce sont deux valeurs parmi trois, le geste est déjà la décision. L'affichage
// est optimiste et revient en arrière si le serveur refuse — sinon le select
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
  creerProfil, renommerProfil, setProfilMeta, supprimerProfil,
} from '@/app/(protected)/admin/structure/actions'
import type { ProfilUI } from './types'

interface Props {
  profils: ProfilUI[]
  /** Le profil regardé dans les autres onglets — à signaler visuellement (classe `courant`). */
  profilCourantId: string
}

/** Ce qu'une action serveur de cet écran peut répondre. */
type Reponse = { error?: string; success?: boolean } | undefined

/** Les deux réglages qu'on peut avoir modifiés en optimiste, en attendant le serveur. */
interface MetaLocale {
  saisonSuggeree?: string | null
  effectifSoirSemaine?: number | null
}

/** Le select natif interdit `null` : sentinelle pour « pas de valeur ». */
const AUCUNE = ''

function saisonClair(s: string | null): string {
  return s === 'ete' ? 'Été' : s === 'hiver' ? 'Hiver' : 'Aucune'
}

function effectifClair(n: number | null): string {
  return n === 1 ? '1 véto' : n === 2 ? '2 vétos' : 'Selon la période'
}

export function OngletProfils({ profils, profilCourantId }: Props) {
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
            les nuits sont longues, « Été » quand l&apos;équipe est réduite. Les trois onglets
            suivants décrivent le profil choisi en haut de page.
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
                <label htmlFor="prof-source">Copier les types de garde de</label>
                <select
                  id="prof-source"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                >
                  {profils.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nom}
                      {p.estDefaut ? ' (par défaut)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="prof-saison">Saison suggérée</label>
                <select
                  id="prof-saison"
                  value={saisonNouveau}
                  onChange={(e) => setSaisonNouveau(e.target.value)}
                >
                  <option value={AUCUNE}>Aucune</option>
                  <option value="ete">Été</option>
                  <option value="hiver">Hiver</option>
                </select>
              </div>

              <div>
                <label htmlFor="prof-effectif">Le soir en semaine</label>
                <select
                  id="prof-effectif"
                  value={effectifNouveau}
                  onChange={(e) => setEffectifNouveau(e.target.value)}
                >
                  <option value={AUCUNE}>Selon la période</option>
                  <option value="1">1 véto</option>
                  <option value="2">2 vétos</option>
                </select>
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
                <article
                  key={p.id}
                  className={`prof-carte${courant ? ' courant' : ''}`}
                  aria-label={`Profil ${p.nom}`}
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
                      {courant && !p.estDefaut && <span className="etiq neutre">Affiché ici</span>}
                    </div>
                  )}

                  <p className="note">
                    {p.creneaux.length} type{p.creneaux.length > 1 ? 's' : ''} de garde,{' '}
                    {actifs === 0 ? 'aucun actif' : `dont ${actifs} actif${actifs > 1 ? 's' : ''}`}.
                    {courant && ' C’est ce profil que décrivent les onglets suivants.'}
                  </p>

                  <div className="prof-reglages">
                    <div className="prof-reglage">
                      <span id={`lbl-saison-${p.id}`}>Saison suggérée</span>
                      <select
                        className="select-plat court"
                        aria-labelledby={`lbl-saison-${p.id}`}
                        value={saisonDe(p) ?? AUCUNE}
                        disabled={isPending}
                        onChange={(e) => {
                          const v = e.target.value
                          const valeur = v === 'ete' || v === 'hiver' ? v : null
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
                        <option value={AUCUNE}>Aucune</option>
                        <option value="ete">Été</option>
                        <option value="hiver">Hiver</option>
                      </select>
                    </div>

                    <div className="prof-reglage">
                      <span id={`lbl-effectif-${p.id}`}>Le soir en semaine</span>
                      <select
                        className="select-plat court"
                        aria-labelledby={`lbl-effectif-${p.id}`}
                        value={effectifDe(p) === null ? AUCUNE : String(effectifDe(p))}
                        disabled={isPending}
                        onChange={(e) => {
                          const v = e.target.value
                          const valeur = v === '1' || v === '2' ? Number(v) : null
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
                        <option value={AUCUNE}>Selon la période</option>
                        <option value="1">1 véto</option>
                        <option value="2">2 vétos</option>
                      </select>
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
