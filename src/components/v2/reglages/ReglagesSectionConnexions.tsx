'use client'

// ============================================================
// GUARDVETO — Réglages refondus : la section « Connexions » (B-202)
// ============================================================
// Google Agenda : le branchement (quel agenda, renvoyer un planning publié) et
// la présentation des événements (aperçu en direct du titre, composé par
// `libelleGarde`, la même fonction que la synchronisation).
//
// L'ancien écran ouvrait la page sur une carte qui en occupait la moitié,
// alors qu'on la règle une fois : le branchement tient ici sur UNE ligne, et
// le champ d'adresse ne s'ouvre qu'à la demande (« Modifier »).
// ============================================================

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Calendar, Check, Info, Lock, RefreshCw, TriangleAlert } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { configurerPartagesCabinet } from '@/app/(protected)/admin/structure/actions'
import { configurerAgendaAffichage } from '@/app/(v2)/reglages/actions'
import { libelleGarde, roleCourt } from '@/lib/agenda/libelle'
import { EXEMPLE_NOM, formatHeureCourte, type CreneauAgenda } from '@/lib/reglages/libelles'
import { partagesAEnvoyer, type Partages } from '@/lib/reglages/coquille'
import { resynchroniserPeriode, type ResultatResync } from '@/lib/reglages/resynchroniser'
import { Bloc, Interrupteur, Pastille, Roue } from './ReglagesCommun'

export interface DonneesSectionConnexions {
  /**
   * Ce cabinet a-t-il droit à l'agenda de repli du serveur (`agendaDeRepliPour`) ?
   * Un BOOLÉEN, calculé côté serveur : le repli est nominatif (cabinet pilote
   * seul), et son identifiant n'a rien à faire dans le navigateur d'un autre
   * cabinet (CERBÈRE, 10/11). Le tester sur la seule variable d'environnement
   * affichait « Branché » à un bac à sable dont la synchro n'écrit nulle part.
   */
  repliDisponible: boolean
  /** Le NOM de l'agenda chez Google (« gardes véto »), jamais ses 64 caractères hexadécimaux. */
  nomAgenda: string | null
  periodesPubliees: { id: string; libelle: string }[]
  agendaJourneeEntiere: boolean
  agendaAfficherHoraires: boolean
  creneaux: CreneauAgenda[]
}

interface Props extends DonneesSectionConnexions {
  partages: Partages
  onPartagesEnregistres: (p: Partages) => void
}

export function ReglagesSectionConnexions({
  repliDisponible, nomAgenda, periodesPubliees, agendaJourneeEntiere, agendaAfficherHoraires,
  creneaux, partages, onPartagesEnregistres,
}: Props) {
  const [enCours, demarrer] = useTransition()

  // ── Branchement ─────────────────────────────────────────────────────────
  const [modifier, setModifier] = useState(false)
  const [calendarId, setCalendarId] = useState(partages.googleCalendarId)
  const agendaSaisi = partages.googleCalendarId.trim() !== ''
  // Ce qui compte n'est pas « le cabinet a-t-il saisi un identifiant » mais
  // « les gardes partent-elles quelque part » : le repli serveur suffit.
  const agendaBranche = agendaSaisi || repliDisponible

  const enregistrerAgenda = () => {
    const envoi = partagesAEnvoyer(partages, 'agenda', calendarId)
    demarrer(async () => {
      const res = await configurerPartagesCabinet(envoi)
      if ('error' in res && res.error) {
        toast.error(res.error)
        return
      }
      onPartagesEnregistres(envoi)
      setModifier(false)
      toast.success('Adresse de l’agenda enregistrée')
    })
  }

  const annulerModification = () => {
    setCalendarId(partages.googleCalendarId)
    setModifier(false)
  }

  // ── Renvoyer un planning publié ──────────────────────────────────────────
  const [periode, setPeriode] = useState(periodesPubliees[0]?.id ?? '')
  const [syncEnCours, setSyncEnCours] = useState(false)
  const [resultat, setResultat] = useState<ResultatResync | null>(null)

  const resynchroniser = async () => {
    if (!periode) return
    setSyncEnCours(true)
    setResultat(null)
    try {
      setResultat(await resynchroniserPeriode(periode))
    } finally {
      setSyncEnCours(false)
    }
  }

  // ── Présentation des événements ──────────────────────────────────────────
  const [journeeEntiere, setJourneeEntiere] = useState(agendaJourneeEntiere)
  const [afficherHoraires, setAfficherHoraires] = useState(agendaAfficherHoraires)
  // Pré-rempli avec le `nom` du créneau tant que rien n'est personnalisé :
  // l'admin voit tout de suite ce qui sera affiché, plutôt qu'un champ vide.
  const [bases, setBases] = useState<Record<string, string>>(() =>
    Object.fromEntries(creneaux.map((c) => [c.id, c.libelleAgenda ?? c.nom])),
  )

  const enregistrerPresentation = () => {
    demarrer(async () => {
      try {
        const res = await configurerAgendaAffichage({
          journeeEntiere,
          afficherHoraires,
          libellesCreneaux: creneaux.map((c) => ({ creneauId: c.id, libelle: bases[c.id] ?? '' })),
        })
        if ('error' in res && res.error) {
          toast.error(res.error)
          return
        }
        toast.success('Présentation de l’agenda enregistrée')
      } catch {
        toast.error('L’appel n’a pas abouti. Réessayez dans un instant.')
      }
    })
  }

  const libelleDePeriode = (id: string) => periodesPubliees.find((p) => p.id === id)?.libelle ?? 'Choisir une période…'

  return (
    <div className="rg-panneau">
      <Bloc
        titre="Google Agenda"
        etat={agendaBranche ? <Pastille ton="ok">Branché</Pastille> : <Pastille ton="warn">Non branché</Pastille>}
      >
        <div className="rg-sous-tete">Branchement</div>
        <div className="rg-resume-agenda">
          <Calendar className="rg-ico" aria-hidden="true" />
          {agendaBranche ? (
            <>
              {/* Le NOM chez Google : c'est ce que le cabinet voit dans sa propre
                  interface, le seul repère partagé avec lui. Sans nom (agenda
                  injoignable), on montre l'adresse saisie. */}
              <span className="rg-resume-nom">{nomAgenda ?? (agendaSaisi ? partages.googleCalendarId : 'Agenda du cabinet')}</span>
              <span className="rg-resume-src">{agendaSaisi ? 'adresse saisie' : 'agenda par défaut'}</span>
            </>
          ) : (
            <span className="rg-resume-nom">Aucun agenda branché</span>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => (modifier ? annulerModification() : setModifier(true))}>
            {modifier ? 'Fermer' : agendaBranche ? 'Modifier' : 'Brancher'}
          </button>
        </div>
        <p className="rg-ligne-info">
          <Lock className="rg-ico sm" aria-hidden="true" />
          <span>Cet agenda doit être <b>partagé en écriture</b> avec GuardVeto.</span>
        </p>

        {modifier && (
          <>
            <div className="rg-champ">
              <label htmlFor="rg-cal">Adresse de l’agenda Google</label>
              <input id="rg-cal" type="text" className="rg-mono" value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)} placeholder="cabinet@group.calendar.google.com" />
            </div>
            <p className="rg-aide">
              Dans Google Agenda : paramètres de l’agenda → « Intégrer l’agenda » → <b>ID de l’agenda</b>.
              Ce n’est pas l’adresse d’un compte Google.
            </p>
            {calendarId.trim() === '' && repliDisponible && (
              <p className="rg-ligne-info">
                <Info className="rg-ico sm" aria-hidden="true" />
                <span>
                  Ce champ est vide, mais les gardes partent bien vers l’agenda par défaut
                  {nomAgenda && !agendaSaisi ? <>, <b>« {nomAgenda} »</b></> : null}. Renseignez une adresse pour en
                  utiliser un autre.
                </span>
              </p>
            )}
            <div className="rg-actions">
              <button type="button" className="btn btn-valider" onClick={enregistrerAgenda} disabled={enCours}>
                Enregistrer l’adresse
              </button>
              <button type="button" className="btn btn-ghost" onClick={annulerModification} disabled={enCours}>
                Annuler
              </button>
            </div>
          </>
        )}

        <div className="rg-sous-tete">Renvoyer un planning publié</div>
        {periodesPubliees.length === 0 ? (
          <p className="rg-vide">Aucun planning publié à renvoyer pour l’instant.</p>
        ) : (
          <div className="rg-resync">
            <div className="rg-champ">
              <label htmlFor="rg-per">Période</label>
              <Select value={periode} onValueChange={(v) => v && setPeriode(v)}>
                <SelectTrigger id="rg-per" className="w-full">
                  <span className="flex-1 text-left truncate text-sm">{libelleDePeriode(periode)}</span>
                </SelectTrigger>
                <SelectContent>
                  {periodesPubliees.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.libelle}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <button
              type="button"
              className="btn btn-outline"
              onClick={resynchroniser}
              disabled={syncEnCours || !agendaBranche}
              title={!agendaBranche ? 'Branchez d’abord un agenda' : undefined}
            >
              {syncEnCours ? <Roue /> : <RefreshCw className="rg-ico sm" aria-hidden="true" />}
              {syncEnCours ? 'Envoi…' : 'Resynchroniser'}
            </button>
          </div>
        )}
        {resultat && (
          <p className={resultat.ok ? 'rg-ligne-info ok' : 'rg-ligne-info bad'} role="status">
            {resultat.ok
              ? <Check className="rg-ico sm" aria-hidden="true" />
              : <TriangleAlert className="rg-ico sm" aria-hidden="true" />}
            <span>{resultat.message}</span>
          </p>
        )}

        <div className="rg-sous-tete">Présentation des événements</div>
        <div className="rg-rang">
          <span className="rg-rang-lib">
            <span>
              <b>Événements en journée entière</b>
              <small>Un bandeau léger en haut de la grille, plutôt qu’un bloc sur toute la colonne.</small>
            </span>
          </span>
          <Interrupteur actif={journeeEntiere} onBasculer={setJourneeEntiere} libelle="Événements en journée entière" />
        </div>
        <div className="rg-rang">
          <span className="rg-rang-lib">
            <span>
              <b>Horaires dans le titre</b>
              <small>Ajoute « 18h/08h » à la fin du titre.</small>
            </span>
          </span>
          <Interrupteur actif={afficherHoraires} onBasculer={setAfficherHoraires} libelle="Horaires dans le titre" />
        </div>

        <div className="rg-libelle">Base du titre, par créneau</div>
        {creneaux.length === 0 ? (
          <p className="rg-vide">Aucun créneau réglé pour l’instant. La structure des gardes se configure dans Règles.</p>
        ) : (
          creneaux.map((c) => {
            const base = (bases[c.id] ?? '').trim() || c.nom
            const apercu = libelleGarde({
              base,
              nom: EXEMPLE_NOM,
              // Même chemin que `google-calendar.ts` (B-080) : le rôle RÉEL du
              // créneau, abrégé — jamais « 1er » écrit en dur.
              role: roleCourt(c.roles?.[0], 0),
              horaires: { debut: formatHeureCourte(c.heureDebut), fin: formatHeureCourte(c.heureFin) },
              afficherHoraires,
            })
            return (
              <div className="rg-creneau" key={c.id}>
                <div className="rg-champ">
                  <label htmlFor={`rg-cr-${c.id}`}>
                    {c.nom}{' '}
                    <span className="rg-creneau-h">
                      {formatHeureCourte(c.heureDebut)} → {formatHeureCourte(c.heureFin)}
                    </span>
                  </label>
                  <input id={`rg-cr-${c.id}`} type="text" value={bases[c.id] ?? ''} placeholder={c.nom}
                    onChange={(e) => setBases((b) => ({ ...b, [c.id]: e.target.value }))} />
                </div>
                <div className="rg-apercu">
                  <span>Aperçu</span>
                  <code>{apercu}</code>
                </div>
              </div>
            )
          })
        )}
        <div className="rg-actions">
          <button type="button" className="btn btn-valider" onClick={enregistrerPresentation} disabled={enCours}>
            Enregistrer la présentation
          </button>
        </div>
      </Bloc>
    </div>
  )
}
