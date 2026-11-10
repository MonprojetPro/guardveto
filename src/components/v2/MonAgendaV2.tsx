'use client'

// ============================================================
// GUARDVETO V2 — Mon agenda (B-173, refait par B-181)
// ============================================================
// Porté de la maquette validée par MiKL le 03/11
// (`docs/maquettes/B-181-mon-agenda.html`) : un interrupteur, puis UN choix —
// « Mon planning » ou « Tout le cabinet » —, chacun avec son réglage des
// journées. Le choix s'enregistre au clic : pas de mode « personnaliser »,
// pas de bouton « enregistrer » à oublier.
//
// Les états qui ne se taisent pas restent : invitation à accepter, mise à
// jour en cours, agenda du cabinet à masquer, adresse manquante, erreur.
//
// ⚠️ L'ÉCRAN DIT CE QUE L'AGENDA REÇOIT VRAIMENT — la vue est lue par la même
//    fonction que la synchro (`contenuEffectif`).
// ============================================================

import { useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  basculerMonAgenda,
  choisirMonAgenda,
  renvoyerInvitationAgenda,
} from '@/app/(v2)/reglages/agenda/actions'
import {
  contenuEffectif,
  placementParDefaut,
  type GenreMembre,
  type Placement,
  type ReglagesAgendaPerso,
  type VueAgenda,
} from '@/lib/agenda-perso/planifier'

export interface EtatMonAgenda {
  agendaCree: boolean
  email: string | null
  /** B-178 — le compte Google à qui l'agenda est partagé (alias « + » retiré). */
  compte: string | null
  /** B-178 — le lien « ajouter cet agenda » de Google Agenda, une fois l'agenda créé. */
  lienAjout: string | null
  /** Invitation envoyée il y a moins de 7 jours (calculé côté serveur). */
  invitationRecente: boolean
  partageCabinet: 'non_concerne' | 'retire' | 'absent' | 'impossible'
  enCours: boolean
  progressionFaite: number
  progressionTotal: number
  derniereSyncLe: string | null
  derniereErreur: string | null
}

interface Props {
  genre: GenreMembre
  reglages: ReglagesAgendaPerso
  etat: EtatMonAgenda
  /** « GuardVeto — Manon » : le nom que la personne lit dans Google Agenda. */
  nomAgenda: string
  nomAgendaCabinet: string
}

interface Option {
  vue: VueAgenda
  titre: string
  desc: string
  question: string
  aide: string
  placements: [Placement, string][]
}

/** Les deux choix, dans les mots de la maquette du 03/11. */
export const OPTIONS: readonly Option[] = [
  {
    vue: 'mon_planning',
    titre: 'Mon planning',
    desc: 'Mes gardes, avec la personne de garde avec moi, et mes journées au cabinet. Rien d’autre.',
    question: 'Mes journées au cabinet',
    aide: 'Aux heures, elles occupent votre agenda comme un rendez-vous. En haut du jour, elles restent discrètes.',
    placements: [['heures', 'Aux heures'], ['haut', 'En haut du jour']],
  },
  {
    vue: 'cabinet',
    titre: 'Tout le cabinet',
    desc: 'Les gardes de toute l’équipe, et chaque jour un bandeau qui dit qui est au cabinet.',
    question: 'Les journées de l’équipe',
    aide: 'En bandeau, une seule ligne par jour dit qui est au cabinet : l’agenda reste léger. Aux heures, chaque collègue apparaît sur son créneau.',
    placements: [['haut', 'Un bandeau en haut du jour'], ['heures', 'Aux heures, dans les cases']],
  },
]

/** Le secrétariat n'a ni garde ni journée à lui : « Tout le cabinet » seul. */
export function optionsPour(genre: GenreMembre): readonly Option[] {
  return genre === 'secretaire' ? OPTIONS.filter((o) => o.vue === 'cabinet') : OPTIONS
}

/** Ce que l'écran « Mon agenda » reçoit de son chargeur (`data/v2/monAgenda.ts`). */
export type DonneesMonAgenda = Props

/**
 * La page « Mon agenda » : sa tête, puis le contenu dans sa carte.
 *
 * B-202 — le contenu vit dans `MonAgendaCorps`, pour que l'onglet Réglages
 * refondu le pose dans sa section « Pour moi » sans le recopier.
 */
export function MonAgendaV2(props: Props) {
  return (
    <>
      <div className="page-head rise">
        <div>
          <h1>Mon agenda</h1>
          <p className="lede">Votre planning GuardVeto dans votre Google Agenda, mis à jour tout seul. Ces réglages ne valent que pour vous.</p>
        </div>
      </div>

      <section className="card conn-card rise rise-2 ma-carte" aria-label="Mon agenda Google">
        <MonAgendaCorps {...props} />
      </section>
    </>
  )
}

/** L'interrupteur, le choix « Mon planning / Tout le cabinet » et les états qui ne se taisent pas. */
export function MonAgendaCorps({ genre, reglages, etat, nomAgenda, nomAgendaCabinet }: Props) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()

  // Pendant une mise à jour, l'écran se relit seul : « en cours » ne doit pas
  // rester affiché sur un travail fini.
  useEffect(() => {
    if (!etat.enCours) return
    const t = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(t)
  }, [etat.enCours, router])

  const contenu = contenuEffectif(reglages, genre)

  const lancer = (action: () => Promise<{ success: true } | { error: string }>, ok: string) =>
    demarrer(async () => {
      const r = await action()
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(ok)
      router.refresh()
    })

  const choisir = (vue: VueAgenda, placement: Placement) => {
    if (vue === contenu.vue && placement === contenu.placement) return
    lancer(() => choisirMonAgenda({ vue, placement }), 'C’est noté — votre agenda se met à jour')
  }

  const adresseGoogle = !!etat.email && /@(gmail|googlemail)\.com$/.test(etat.email)

  return (
    <>
      <label className="aa-switch mn-ligne">
        <input
          type="checkbox"
          checked={reglages.actif}
          disabled={enCours}
          onChange={(e) =>
            lancer(
              () => basculerMonAgenda(e.target.checked),
              e.target.checked ? 'Votre planning va arriver dans Google Agenda' : 'Envoi coupé : votre agenda GuardVeto va être vidé',
            )
          }
        />
        <span>
          <b>Recevoir mon planning dans Google Agenda</b>
          <small>Éteint : plus rien n’y arrive, l’agenda est vidé.</small>
        </span>
      </label>

      {!etat.email && (
        <div className="ma-bandeau bad" role="alert">
          <b>Aucune adresse e-mail sur votre fiche</b>
          Sans adresse, GuardVeto ne peut partager aucun agenda avec vous. Demandez à l’administratrice d’en ajouter une.
        </div>
      )}

      {!reglages.actif ? (
        <p className="mn-note">
          {etat.agendaCree
            ? `Votre agenda GuardVeto est vidé. ${etat.partageCabinet === 'retire' ? `« ${nomAgendaCabinet} » vous est rendu.` : `« ${nomAgendaCabinet} » reste comme il est.`} Rien d’autre n’est touché.`
            : 'Rien n’est envoyé dans votre Google Agenda.'}
        </p>
      ) : (
        <div className="ma-corps">
          <span className="ma-q-t">Dans mon Google Agenda, je veux voir</span>
          <div className="ma-choix" role="radiogroup" aria-label="Ce que contient mon agenda">
            {optionsPour(genre).map((o) => {
              const on = contenu.vue === o.vue
              return (
                <div key={o.vue} className={`ma-option${on ? ' on' : ''}`}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className="ma-option-tete"
                    disabled={enCours}
                    onClick={() => choisir(o.vue, placementParDefaut(o.vue))}
                  >
                    <span className="ma-radio" aria-hidden="true" />
                    <span>
                      <b>{o.titre}</b>
                      <small>{o.desc}</small>
                    </span>
                  </button>
                  {on && (
                    <div className="ma-sous">
                      <span className="ma-q-t">{o.question}</span>
                      <div className="ma-seg" role="radiogroup" aria-label={o.question}>
                        {o.placements.map(([p, l]) => (
                          <button key={p} type="button" role="radio" aria-checked={contenu.placement === p}
                            className={contenu.placement === p ? 'sel' : ''}
                            disabled={enCours}
                            onClick={() => choisir(o.vue, p)}>{l}</button>
                        ))}
                      </div>
                      <small className="ma-aide">{o.aide}</small>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {etat.enCours && (
            <p className="ma-statut att">
              Votre agenda se met à jour
              {etat.progressionTotal > 0 ? ` (${etat.progressionFaite} sur ${etat.progressionTotal})` : ''}…
            </p>
          )}
          {!etat.enCours && etat.derniereErreur && (
            <div className="ma-bandeau bad" role="alert">
              <b>La dernière mise à jour n’est pas allée au bout</b>
              Elle sera reprise automatiquement. Détail : {etat.derniereErreur}
            </div>
          )}
          {!etat.enCours && !etat.derniereErreur && etat.agendaCree && etat.email && (
            <p className="ma-statut">Agenda « {nomAgenda} » · partagé avec {etat.compte ?? etat.email} · à jour</p>
          )}

          {etat.agendaCree && etat.invitationRecente && (
            <div className="ma-bandeau att">
              <b>Une étape de votre côté</b>
              Ajoutez l’agenda dans Google Agenda, connecté avec {etat.compte ?? etat.email}. Un e-mail GuardVeto vous a aussi été envoyé.
            </div>
          )}
          {/* « absent » = elle ne l'a pas : rien à faire. « impossible » =
              elle en est propriétaire, GuardVeto ne peut pas le lui retirer. */}
          {etat.partageCabinet === 'impossible' && (
            <div className="ma-bandeau att">
              <b>Masquez « {nomAgendaCabinet} »</b>
              Vos gardes arrivent par votre agenda GuardVeto. Dans Google Agenda, décochez l’agenda du cabinet, sinon vous les verrez en double.
            </div>
          )}
          {etat.email && !adresseGoogle && (
            <p className="ma-statut">
              Votre adresse ({etat.email}) doit être un compte Google pour ouvrir l’agenda. Si ce n’est pas le cas,
              demandez à l’administratrice de mettre une adresse Gmail sur votre fiche.
            </p>
          )}

          <div className="ma-actions">
            {etat.lienAjout && (
              <a className="btn btn-outline btn-sm" href={etat.lienAjout} target="_blank" rel="noopener noreferrer">
                Ouvrir dans Google Agenda
              </a>
            )}
            {etat.agendaCree && (
              <button type="button" className="btn btn-outline btn-sm" disabled={enCours}
                onClick={() => lancer(renvoyerInvitationAgenda, 'Invitation renvoyée — regardez vos e-mails')}>
                Renvoyer l’invitation
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
