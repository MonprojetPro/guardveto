'use client'

// ============================================================
// GUARDVETO V2 — Mon agenda (B-173)
// ============================================================
// Porté de la maquette validée par MiKL le 26/10
// (`docs/maquettes/B-173-mon-agenda.html`) : l'interrupteur, « ce que vous
// recevez », la personnalisation, et les états qui ne se taisent pas
// (invitation à accepter, mise à jour en cours, agenda du cabinet à masquer,
// adresse manquante, erreur).
//
// ⚠️ L'ÉCRAN DIT CE QUE L'AGENDA REÇOIT VRAIMENT — calculé par la même
//    fonction que la synchro (`contenuEffectif`). Un résumé recopié à la main
//    finirait par annoncer une chose et en envoyer une autre.
// ============================================================

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  basculerMonAgenda,
  personnaliserMonAgenda,
  renvoyerInvitationAgenda,
  revenirAuModeParDefaut,
} from '@/app/(v2)/reglages/agenda/actions'
import {
  contenuEffectif,
  type ChoixJournees,
  type ContenuAgendaPerso,
  type GenreMembre,
  type Placement,
  type ReglagesAgendaPerso,
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
  nomAgendaCabinet: string
}

/** Les lignes « ce que vous recevez », dans les mots de l'écran. */
export function lignesRecues(c: ContenuAgendaPerso, genre: GenreMembre, nomCabinet: string): { oui: boolean; texte: string; detail?: string }[] {
  const lignes: { oui: boolean; texte: string; detail?: string }[] = []
  const place = c.placement === 'heures' ? 'aux heures du créneau' : 'en haut du jour'
  if (c.journees === 'miennes') lignes.push({ oui: true, texte: `Vos journées, ${place}` })
  else if (c.journees === 'equipe') lignes.push({ oui: true, texte: `Les journées de toute l’équipe, ${place}`, detail: 'Un événement par créneau, avec les initiales' })
  else lignes.push({ oui: false, texte: 'Aucune journée' })

  if (c.gardesViaCabinet) {
    lignes.push({ oui: true, texte: 'Les gardes de toute l’équipe, en haut du jour', detail: `Par « ${nomCabinet} », comme aujourd’hui` })
    return lignes
  }
  if (genre === 'veto') lignes.push({ oui: c.mesGardes, texte: c.mesGardes ? 'Vos gardes, en haut du jour' : 'Vos gardes' })
  lignes.push({ oui: c.gardesAutres, texte: c.gardesAutres ? 'Les gardes des autres, en haut du jour' : 'Les gardes des autres' })
  return lignes
}

export function MonAgendaV2({ genre, reglages, etat, nomAgendaCabinet }: Props) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [edition, setEdition] = useState(false)
  const [brouillon, setBrouillon] = useState(() => ({
    journees: (genre === 'secretaire' && reglages.journees === 'miennes' ? 'equipe' : reglages.journees) as ChoixJournees,
    placement: reglages.placement as Placement,
    mesGardes: reglages.mesGardes,
    gardesAutres: reglages.gardesAutres,
  }))

  // Pendant une mise à jour, l'écran se relit seul : « en cours » ne doit pas
  // rester affiché sur un travail fini.
  useEffect(() => {
    if (!etat.enCours) return
    const t = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(t)
  }, [etat.enCours, router])

  const contenu = contenuEffectif(reglages, genre)
  const apercu = useMemo(
    () => contenuEffectif({ ...reglages, ...brouillon, actif: true, personnalise: true }, genre),
    [reglages, brouillon, genre],
  )

  const lancer = (action: () => Promise<{ success: true } | { error: string }>, ok: string, apres?: () => void) =>
    demarrer(async () => {
      const r = await action()
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(ok)
      apres?.()
      router.refresh()
    })

  const adresseGoogle = !!etat.email && /@(gmail|googlemail)\.com$/.test(etat.email)

  return (
    <>
      <div className="page-head rise">
        <div>
          <h1>Mon agenda</h1>
          <p className="lede">Votre planning, dans votre Google Agenda. Ces réglages ne valent que pour vous.</p>
        </div>
      </div>

      <section className="card conn-card rise rise-2 ma-carte" aria-label="Mon agenda Google">
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
            <small>Si vous préférez n’utiliser que l’application, coupez-le.</small>
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
        ) : edition ? (
          <div className="ma-corps">
            <div className="ma-q">
              <span className="ma-q-t">Journées</span>
              <div className="ma-seg" role="radiogroup" aria-label="Journées">
                {([
                  ...(genre === 'veto' ? [['miennes', 'Les miennes']] : []),
                  ['equipe', 'Celles de toute l’équipe'],
                  ['aucune', 'Aucune'],
                ] as [ChoixJournees, string][]).map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={brouillon.journees === v}
                    className={brouillon.journees === v ? 'sel' : ''}
                    onClick={() => setBrouillon((b) => ({ ...b, journees: v }))}>{l}</button>
                ))}
              </div>
            </div>
            <div className="ma-q">
              <span className="ma-q-t">Placées<small>Aux heures, elles occupent votre agenda comme un rendez-vous. En haut du jour, elles restent discrètes.</small></span>
              <div className="ma-seg" role="radiogroup" aria-label="Placement des journées">
                {([['heures', 'Aux heures du créneau'], ['haut', 'En haut du jour']] as [Placement, string][]).map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={brouillon.placement === v}
                    disabled={brouillon.journees === 'aucune'}
                    className={brouillon.placement === v ? 'sel' : ''}
                    onClick={() => setBrouillon((b) => ({ ...b, placement: v }))}>{l}</button>
                ))}
              </div>
            </div>
            {genre === 'veto' && (
              <div className="ma-q">
                <span className="ma-q-t">Mes gardes</span>
                <div className="ma-seg" role="radiogroup" aria-label="Mes gardes">
                  {([[true, 'Oui'], [false, 'Non']] as [boolean, string][]).map(([v, l]) => (
                    <button key={l} type="button" role="radio" aria-checked={brouillon.mesGardes === v}
                      className={brouillon.mesGardes === v ? 'sel' : ''}
                      onClick={() => setBrouillon((b) => ({ ...b, mesGardes: v }))}>{l}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="ma-q">
              <span className="ma-q-t">{genre === 'veto' ? 'Les gardes des autres' : 'Les gardes de l’équipe'}</span>
              <div className="ma-seg" role="radiogroup" aria-label="Gardes des autres">
                {([[true, 'Oui'], [false, 'Non']] as [boolean, string][]).map(([v, l]) => (
                  <button key={l} type="button" role="radio" aria-checked={brouillon.gardesAutres === v}
                    className={brouillon.gardesAutres === v ? 'sel' : ''}
                    onClick={() => setBrouillon((b) => ({ ...b, gardesAutres: v }))}>{l}</button>
                ))}
              </div>
            </div>

            <div className="ma-bandeau info">
              <b>Vous recevrez</b>
              {lignesRecues(apercu, genre, nomAgendaCabinet).filter((l) => l.oui).map((l) => l.texte.toLowerCase()).join(' ; ') || 'rien'}.
            </div>
            <div className="ma-bandeau att">
              <b>« {nomAgendaCabinet} » vous sera retiré</b>
              Vos gardes arrivent désormais par votre agenda GuardVeto : le garder vous les montrerait en double.
            </div>
            <div className="ma-actions">
              <button type="button" className="btn btn-accent btn-sm" disabled={enCours}
                onClick={() => lancer(() => personnaliserMonAgenda(brouillon), 'Réglages enregistrés — votre agenda se met à jour', () => setEdition(false))}>
                Enregistrer
              </button>
              <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => setEdition(false)}>Annuler</button>
            </div>
          </div>
        ) : (
          <div className="ma-corps">
            <div className="ma-recu-tete">
              <span className="ma-q-t">Ce que vous recevez</span>
              <span className={`ma-etiquette ${reglages.personnalise ? 'perso' : ''}`}>
                {reglages.personnalise ? 'Personnalisé' : 'Mode par défaut'}
              </span>
            </div>
            <ul className="ma-recu">
              {lignesRecues(contenu, genre, nomAgendaCabinet).map((l) => (
                <li key={l.texte} className={l.oui ? '' : 'non'}>
                  <span>{l.texte}{l.detail && <small>{l.detail}</small>}</span>
                </li>
              ))}
            </ul>

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
              <p className="ma-statut">Partagé avec {etat.compte ?? etat.email} · à jour</p>
            )}

            {etat.agendaCree && etat.invitationRecente && (
              <div className="ma-bandeau att">
                <b>Une étape de votre côté</b>
                Ajoutez l’agenda dans Google Agenda, connecté avec {etat.compte ?? etat.email}. Un e-mail GuardVeto vous a aussi été envoyé.
              </div>
            )}
            {reglages.personnalise && (etat.partageCabinet === 'absent' || etat.partageCabinet === 'impossible') && (
              <div className="ma-bandeau att">
                <b>Masquez « {nomAgendaCabinet} »</b>
                GuardVeto n’a pas pu vous le retirer. Dans Google Agenda, décochez-le, sinon vos gardes apparaîtront en double.
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
                  Ajouter à mon Google Agenda
                </a>
              )}
              <button type="button" className="btn btn-accent btn-sm" disabled={enCours} onClick={() => setEdition(true)}>
                {reglages.personnalise ? 'Modifier' : 'Personnaliser'}
              </button>
              {reglages.personnalise && (
                <button type="button" className="btn btn-outline btn-sm" disabled={enCours}
                  onClick={() => lancer(revenirAuModeParDefaut, `Mode par défaut rétabli — « ${nomAgendaCabinet} » vous est rendu`)}>
                  Revenir au mode par défaut
                </button>
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
      </section>
    </>
  )
}
