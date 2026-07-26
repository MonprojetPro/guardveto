'use client'

// ============================================================
// GUARDVETO V2 — Écran « Réglages & connexions »
// ============================================================
// Porté de `maquette/m4-accueil-equipe-historique-connexions.html` (section 4).
//
// Trois branchements et un journal : agenda Google, expéditeur des e-mails,
// adresse du cabinet (qui DÉDUIT la zone de vacances scolaires et la région
// des fériés), plus la trace des e-mails partis.
//
// Ce qui est RÉUTILISÉ tel quel : les deux actions serveur de la V1
// (`configurerPartagesCabinet`, `configurerAdresseCabinet`) — elles portent la
// garde admin, les RPC et surtout la dérivation de zone, qui CONSERVE la zone
// existante quand le code postal ne permet pas de conclure.
//
// ÉCARTÉ de la maquette : « Dernière synchronisation : cette nuit à 02:14 ».
// Rien ne journalise les synchronisations d'agenda en base. On montre donc le
// résultat réel de celle qu'on vient de lancer, et rien avant : une date
// inventée dans un écran de réglages, c'est une panne qu'on ne voit pas venir.
// ============================================================

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  configurerPartagesCabinet,
  configurerAdresseCabinet,
} from '@/app/(protected)/admin/structure/actions'
import type { Periode } from '@/types'

export interface ValeursCabinet {
  googleCalendarId: string
  brevoFromEmail: string
  brevoFromName: string
  adresse: string
  codePostal: string
  ville: string
  zoneScolaire: string
  regionFeries: string
}

export interface LigneEmail {
  id: string
  type: string
  destinataire: string
  statut: string
  erreur: string | null
  created_at: string
  vetNom: string | null
}

const ZONE_LABEL: Record<string, string> = { A: 'Zone A', B: 'Zone B', C: 'Zone C' }
const REGION_LABEL: Record<string, string> = {
  metropole: 'Métropole',
  'alsace-moselle': 'Alsace-Moselle',
  guadeloupe: 'Guadeloupe',
  martinique: 'Martinique',
  guyane: 'Guyane',
  reunion: 'La Réunion',
  mayotte: 'Mayotte',
  polynesie: 'Polynésie',
}

const TYPE_EMAIL: Record<string, string> = {
  planning_publie: 'Planning publié',
  garde_modifiee: 'Garde modifiée',
  rappel_publication: 'Rappel de publication',
  appel_volontaires: 'Appel aux volontaires',
  depannage_confirme: 'Dépannage confirmé',
  conge_valide: 'Congé validé',
  conge_refuse: 'Congé refusé',
}

function dateHeure(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface Props {
  valeurs: ValeursCabinet
  /** Périodes publiées, seules resynchronisables vers l'agenda. */
  periodesPubliees: Periode[]
  emails: LigneEmail[]
}

export function ReglagesV2({ valeurs, periodesPubliees, emails }: Props) {
  const [isPending, startTransition] = useTransition()

  // Agenda + expéditeur passent par la même action : un seul état de saisie.
  const [calendarId, setCalendarId] = useState(valeurs.googleCalendarId)
  const [fromEmail, setFromEmail] = useState(valeurs.brevoFromEmail)
  const [fromName, setFromName] = useState(valeurs.brevoFromName)

  const [adresse, setAdresse] = useState(valeurs.adresse)
  const [codePostal, setCodePostal] = useState(valeurs.codePostal)
  const [ville, setVille] = useState(valeurs.ville)

  const [periodeSync, setPeriodeSync] = useState(periodesPubliees[0]?.id ?? '')
  const [syncEnCours, setSyncEnCours] = useState(false)
  const [resultatSync, setResultatSync] = useState<
    { ok: boolean; message: string } | null
  >(null)

  const zoneActuelle = valeurs.zoneScolaire
    ? `${ZONE_LABEL[valeurs.zoneScolaire] ?? valeurs.zoneScolaire} · ${
        REGION_LABEL[valeurs.regionFeries] ?? valeurs.regionFeries
      }`
    : null

  const agendaBranche = valeurs.googleCalendarId.trim() !== ''
  const expediteurRegle = valeurs.brevoFromEmail.trim() !== ''

  // ── Enregistrer agenda + expéditeur ─────────────────────────────────────
  const enregistrerPartages = () => {
    startTransition(async () => {
      const res = await configurerPartagesCabinet({
        googleCalendarId: calendarId.trim(),
        brevoFromEmail: fromEmail.trim(),
        brevoFromName: fromName.trim(),
      })
      if ('error' in res && res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Branchement enregistré')
    })
  }

  // ── Enregistrer l'adresse et en déduire la zone ─────────────────────────
  const enregistrerAdresse = () => {
    startTransition(async () => {
      const res = await configurerAdresseCabinet({
        adresse: adresse.trim(),
        codePostal: codePostal.trim(),
        ville: ville.trim(),
      })
      if ('error' in res && res.error) {
        toast.error(res.error)
        return
      }
      const zone = 'derive' in res ? res.derive?.zone : null
      toast.success(
        zone
          ? `Adresse enregistrée. Zone déduite : ${ZONE_LABEL[zone] ?? zone}`
          : "Adresse enregistrée. Le code postal n'a pas permis de conclure sur la zone — l'ancienne est conservée.",
      )
    })
  }

  // ── Relancer une synchronisation d'agenda ───────────────────────────────
  const resynchroniser = async () => {
    if (!periodeSync) return
    setSyncEnCours(true)
    setResultatSync(null)
    try {
      const res = await fetch('/api/calendar-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodeId: periodeSync }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResultatSync({ ok: false, message: data?.error ?? 'La synchronisation a échoué.' })
        return
      }
      if (data?.skipped) {
        setResultatSync({
          ok: false,
          message: "Rien n'a été envoyé : aucun agenda n'est branché pour ce cabinet.",
        })
        return
      }
      const erreurs: string[] = data?.errors ?? []
      setResultatSync({
        ok: erreurs.length === 0,
        message:
          erreurs.length === 0
            ? `${data?.synced ?? 0} garde${(data?.synced ?? 0) > 1 ? 's' : ''} envoyée${
                (data?.synced ?? 0) > 1 ? 's' : ''
              } vers l'agenda.`
            : `${data?.synced ?? 0} envoyée(s), ${erreurs.length} en échec : ${erreurs[0]}`,
      })
    } catch {
      setResultatSync({ ok: false, message: "L'appel n'a pas abouti. Réessaie dans un instant." })
    } finally {
      setSyncEnCours(false)
    }
  }

  const nbEchecs = emails.filter((e) => e.statut === 'erreur').length

  return (
    <>
      {/* ── Tête de page ─────────────────────────────────────────────── */}
      <div className="page-head rise">
        <div>
          <p className="page-kicker">Réglages · la tuyauterie</p>
          <h1>Trois branchements, réglés une fois, puis oubliés.</h1>
          <p className="lede">
            Rien ici ne parle de gardes : uniquement ce qui relie GuardVeto au monde extérieur.
            Laissés vides, ces réglages retombent sur la configuration générale — c&apos;est
            volontaire, pas un oubli.
          </p>
        </div>
      </div>

      <div className="conn-grid rise rise-2">
        {/* ── Google Agenda ──────────────────────────────────────────── */}
        <section className="card conn-card" aria-label="Connexion Google Agenda">
          <div className="conn-head">
            <span className="conn-ico" aria-hidden="true">
              📆
            </span>
            <div>
              <h3>Google Agenda</h3>
              <p className="sub">Les gardes publiées y apparaissent</p>
            </div>
            <span className={`conn-state ${agendaBranche ? 'on' : 'off'}`}>
              <span className="cs-dot" aria-hidden="true" />
              {agendaBranche ? 'Branché' : 'Non branché'}
            </span>
          </div>
          <div className="conn-body">
            <div className="field">
              <label htmlFor="cn-cal">Identifiant de l&apos;agenda</label>
              <input
                id="cn-cal"
                type="text"
                className="mono"
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                placeholder="cabinet@group.calendar.google.com"
                style={{ width: '100%', minHeight: 42 }}
              />
            </div>
            <p className="conn-line">
              L&apos;agenda doit être <b>partagé en écriture</b> avec le compte de service
              GuardVeto, sinon rien ne s&apos;y écrira.
            </p>

            {periodesPubliees.length > 0 && (
              <div className="field">
                <label htmlFor="cn-per">Période à renvoyer</label>
                <select
                  id="cn-per"
                  value={periodeSync}
                  onChange={(e) => setPeriodeSync(e.target.value)}
                >
                  {periodesPubliees.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.libelle ?? `${p.saison === 'ete' ? 'Été' : 'Hiver'} ${p.date_debut.slice(0, 4)}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {resultatSync && (
              <p className={`conn-line ${resultatSync.ok ? 'ok' : 'bad'}`}>
                {resultatSync.ok ? '✓ ' : '⚠ '}
                {resultatSync.message}
              </p>
            )}

            <div className="conn-actions">
              <button
                type="button"
                className="btn btn-valider btn-sm"
                onClick={enregistrerPartages}
                disabled={isPending}
              >
                Enregistrer
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={resynchroniser}
                disabled={syncEnCours || !agendaBranche || periodesPubliees.length === 0}
                title={
                  !agendaBranche
                    ? "Branche d'abord un agenda"
                    : periodesPubliees.length === 0
                      ? 'Aucun planning publié à envoyer'
                      : undefined
                }
              >
                {syncEnCours && <span className="sync-spin" aria-hidden="true" />}
                {syncEnCours ? 'Envoi…' : 'Re-synchroniser'}
              </button>
            </div>
          </div>
        </section>

        {/* ── Expéditeur des e-mails ─────────────────────────────────── */}
        <section className="card conn-card" aria-label="Expéditeur des e-mails">
          <div className="conn-head">
            <span className="conn-ico" aria-hidden="true">
              ✉️
            </span>
            <div>
              <h3>Expéditeur des e-mails</h3>
              <p className="sub">Le nom que verront les vétos</p>
            </div>
            <span className={`conn-state ${expediteurRegle ? 'on' : 'off'}`}>
              <span className="cs-dot" aria-hidden="true" />
              {expediteurRegle ? 'Réglé' : 'Par défaut'}
            </span>
          </div>
          <div className="conn-body">
            <div className="field">
              <label htmlFor="cn-mail">Adresse d&apos;envoi</label>
              <input
                id="cn-mail"
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="contact@cabinet.fr"
              />
            </div>
            <div className="field">
              <label htmlFor="cn-nom">Nom affiché</label>
              <input
                id="cn-nom"
                type="text"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Cabinet vétérinaire"
              />
            </div>
            <p className="conn-line">
              Le domaine de cette adresse doit être <b>autorisé chez l&apos;expéditeur</b> ;
              sinon les e-mails partent en spam, ou ne partent pas du tout.
            </p>
            <div className="conn-actions">
              <button
                type="button"
                className="btn btn-valider btn-sm"
                onClick={enregistrerPartages}
                disabled={isPending}
              >
                Enregistrer
              </button>
            </div>
          </div>
        </section>

        {/* ── Adresse du cabinet ─────────────────────────────────────── */}
        <section className="card conn-card" aria-label="Adresse du cabinet et zones déduites">
          <div className="conn-head">
            <span className="conn-ico" aria-hidden="true">
              📍
            </span>
            <div>
              <h3>Adresse du cabinet</h3>
              <p className="sub">Elle décide des vacances et des fériés</p>
            </div>
            <span className={`conn-state ${zoneActuelle ? 'on' : 'off'}`}>
              <span className="cs-dot" aria-hidden="true" />
              {zoneActuelle ? 'Zone connue' : 'À renseigner'}
            </span>
          </div>
          <div className="conn-body">
            <div className="field">
              <label htmlFor="cn-adr">Adresse</label>
              <input
                id="cn-adr"
                type="text"
                value={adresse}
                onChange={(e) => setAdresse(e.target.value)}
                placeholder="12 rue des Tilleuls"
              />
            </div>
            <div className="conn-duo">
              <div className="field">
                <label htmlFor="cn-cp">Code postal</label>
                <input
                  id="cn-cp"
                  type="text"
                  value={codePostal}
                  onChange={(e) => setCodePostal(e.target.value)}
                  placeholder="03200"
                  inputMode="numeric"
                />
              </div>
              <div className="field">
                <label htmlFor="cn-ville">Ville</label>
                <input
                  id="cn-ville"
                  type="text"
                  value={ville}
                  onChange={(e) => setVille(e.target.value)}
                  placeholder="Vichy"
                />
              </div>
            </div>

            {zoneActuelle && (
              <div className="derived">
                <span className="dv">🎒 {zoneActuelle}</span>
              </div>
            )}
            <p className="derived-note">
              C&apos;est le code postal qui décide : il donne la zone de vacances scolaires et la
              région des jours fériés utilisées par le moteur. Si le code postal ne permet pas de
              conclure (Corse, outre-mer, saisie incomplète), la zone actuelle est conservée
              plutôt que remplacée par une valeur douteuse.
            </p>
            <div className="conn-actions">
              <button
                type="button"
                className="btn btn-valider btn-sm"
                onClick={enregistrerAdresse}
                disabled={isPending}
              >
                Enregistrer &amp; déduire la zone
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* ── Journal des e-mails ──────────────────────────────────────── */}
      <section className="card mail-card rise rise-3" aria-label="Journal des e-mails">
        <div className="card-head">
          <div>
            <h3>Journal des e-mails</h3>
            <p className="sub">
              Chaque e-mail parti aux vétos laisse une trace ici. Un échec déclenche aussi une
              alerte dans la cloche.
            </p>
          </div>
          <div className="mail-resume">
            <span className="mr-chip ok">{emails.length - nbEchecs} envoyés</span>
            {nbEchecs > 0 && <span className="mr-chip bad">{nbEchecs} en échec</span>}
          </div>
        </div>
        {emails.length === 0 ? (
          <p className="mail-vide">
            Aucun e-mail parti pour l&apos;instant. Ils apparaîtront ici dès la première
            publication de planning.
          </p>
        ) : (
          <table className="mail-table">
            <thead>
              <tr>
                <th>Quand</th>
                <th>Type</th>
                <th>Destinataire</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((e) => (
                <tr key={e.id}>
                  <td className="m-date">{dateHeure(e.created_at)}</td>
                  <td>
                    <span className="mail-type">{TYPE_EMAIL[e.type] ?? e.type}</span>
                  </td>
                  <td>
                    {e.vetNom ?? e.destinataire}
                    {e.vetNom && (
                      <small style={{ display: 'block', color: 'var(--soft)', fontSize: '0.72rem' }}>
                        {e.destinataire}
                      </small>
                    )}
                  </td>
                  <td>
                    <span className={`m-statut ${e.statut === 'erreur' ? 'echec' : 'envoye'}`}>
                      <span className="msd" aria-hidden="true" />
                      {e.statut === 'erreur' ? 'Échec' : 'Envoyé'}
                    </span>
                    {e.erreur && <span className="m-erreur">{e.erreur}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Ce qui n'est pas encore refait ───────────────────────────── */}
      <section className="card reste-v1 rise" aria-label="Réglages pas encore refaits">
        <div className="card-head">
          <div>
            <h3>Le reste des réglages</h3>
            <p className="sub">
              Ces écrans fonctionnent, mais n&apos;ont pas encore leur nouvelle allure. Le lien
              ouvre l&apos;ancienne version.
            </p>
          </div>
        </div>
        <ul className="reste-liste">
          <li>
            <div className="rl-quoi">
              <b>Structure des gardes</b>
              <small>
                Les créneaux, les profils de planning, les horaires et les liens entre créneaux.
              </small>
            </div>
            <a className="period-view" href="/admin/structure">
              Ouvrir
            </a>
          </li>
          <li>
            <div className="rl-quoi">
              <b>Règles du cabinet</b>
              <small>Ce que le moteur a le droit de faire, et ce qu&apos;il ne doit jamais faire.</small>
            </div>
            <a className="period-view" href="/regles">
              Ouvrir
            </a>
          </li>
        </ul>
      </section>
    </>
  )
}
