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
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import {
  configurerPartagesCabinet,
  configurerAdresseCabinet,
} from '@/app/(protected)/admin/structure/actions'
import { envoyerEmailDeTest, configurerAgendaAffichage } from '@/app/(v2)/reglages/actions'
import { useErreurBloquante } from '@/components/v2/regles/ErreurBloquante'
import { raisonEchec } from '@/lib/emails/echec'
import type { Periode } from '@/types'
import { libelleGarde } from '@/lib/agenda/libelle'
import { initialesVeto } from '@/lib/agenda/initiales'

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

/**
 * Un créneau du SOCLE (profil_id NULL), tel qu'il vit dans Google Agenda.
 * `heureDebut`/`heureFin` au format `'HH:MM'` (Postgres TIME déjà tronqué
 * côté page) — VRAIS horaires du cabinet, jamais une valeur en dur : c'est
 * exactement le bug 20h/10h vs 18h/08h qu'un autre chantier corrige en ce
 * moment, et le graver ici le propagerait dans l'aperçu.
 */
export interface CreneauAgenda {
  id: string
  nom: string
  /** `null` = pas encore personnalisé, le champ repart du `nom`. */
  libelleAgenda: string | null
  heureDebut: string
  heureFin: string
}

/** 'HH:MM' → '18h' (minutes nulles) ou '18h30'. Purement pour L'AFFICHAGE de
 *  l'aperçu ; `libelleGarde` (agenda/libelle.ts), lui, reste pur et ne
 *  formate rien — il reçoit ces chaînes déjà faites. */
function formatHeureCourte(hhmm: string): string {
  const [h, m] = hhmm.split(':')
  return m && m !== '00' ? `${h}h${m}` : `${h}h`
}

/** Le véto d'exemple de l'aperçu — celui du cahier des charges (« garde-ACB-1er »). */
const EXEMPLE_NOM = initialesVeto('Anne-Catherine', 'Bernard')

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
  email_test: 'Essai d’envoi',
}

/**
 * L'état d'un e-mail, en français.
 *
 * « Parti » est volontairement modeste : c'est tout ce qu'on sait au moment de
 * l'envoi — le service d'expédition a accepté le message. « Remis » n'apparaît
 * que lorsque Brevo nous rappelle pour le confirmer (`/api/webhooks/brevo`).
 * Tant que ce webhook n'est pas branché côté Brevo, toutes les lignes restent
 * « Parti » : c'est honnête, et c'était tout l'objet du correctif du
 * 2026-08-21, où « Envoyé » désignait des messages rejetés.
 */
const LIBELLE_STATUT: Record<string, string> = {
  envoye: 'Parti',
  remis: 'Remis',
  differe: 'En attente',
  spam: 'Indésirable',
  rejete: 'Rejeté',
  erreur: 'Refusé',
}

/** Le ton de la pastille. Tout ce qui n'est pas arrivé se voit en rouge. */
const TON_STATUT: Record<string, string> = {
  envoye: 'envoye',
  remis: 'remis',
  differe: 'attente',
  spam: 'echec',
  rejete: 'echec',
  erreur: 'echec',
}

function libellePeriode(p: Periode): string {
  return p.libelle ?? `${p.saison === 'ete' ? 'Été' : 'Hiver'} ${p.date_debut.slice(0, 4)}`
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
  /**
   * Agenda de repli défini côté serveur (variable d'environnement), utilisé
   * quand le cabinet n'a pas renseigné le sien. Le navigateur ne peut pas le
   * connaître : sans cette prop, l'écran annonçait « Non branché » alors que
   * les gardes s'écrivaient bel et bien dans Google.
   */
  agendaParDefaut?: string
  /**
   * Le nom de l'agenda chez Google (« gardes véto »). L'identifiant technique
   * d'un agenda secondaire est une suite de 64 caractères hexadécimaux :
   * illisible, impossible à reconnaître, et inquiétant dans un écran de
   * réglages. Le nom est le seul repère partagé avec le cabinet, qui le voit
   * dans sa propre interface Google. null = agenda injoignable.
   */
  nomAgenda?: string | null
  /**
   * L'envoi d'e-mails est-il réellement possible (clé + adresse d'expédition
   * connues du serveur) ? Le navigateur ne peut pas le savoir, et un voyant
   * qui ment envoie chercher une panne qui n'existe pas — c'est exactement ce
   * qu'avait fait celui de l'agenda.
   */
  envoiConfigure?: boolean
  /** Chantier agenda Google (2026-08-27) — réglages d'affichage lus en base. */
  agendaJourneeEntiere: boolean
  agendaAfficherHoraires: boolean
  /** Les créneaux du socle (profil_id NULL), pour l'intitulé par créneau. */
  creneaux: CreneauAgenda[]
}

export function ReglagesV2({
  valeurs, periodesPubliees, emails, agendaParDefaut = '', nomAgenda = null,
  envoiConfigure = false, agendaJourneeEntiere, agendaAfficherHoraires, creneaux,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const { ouvrirErreur, dialogueErreur } = useErreurBloquante()

  // Agenda + expéditeur passent par la même action : un seul état de saisie.
  const [calendarId, setCalendarId] = useState(valeurs.googleCalendarId)
  // Plus de setter : l'adresse d'envoi n'est plus saisissable ici (elle piégeait
  // le cabinet, cf. la carte « E-mails aux vétos »). On garde la VALEUR pour la
  // renvoyer inchangée à l'enregistrement — sans quoi une simple modification du
  // nom affiché effacerait l'adresse réglée par l'assistance.
  const [fromEmail] = useState(valeurs.brevoFromEmail)
  const [fromName, setFromName] = useState(valeurs.brevoFromName)

  const [adresse, setAdresse] = useState(valeurs.adresse)
  const [codePostal, setCodePostal] = useState(valeurs.codePostal)
  const [ville, setVille] = useState(valeurs.ville)

  const [testEnCours, setTestEnCours] = useState(false)

  // ── Chantier agenda Google — présentation ───────────────────────────────
  const [journeeEntiere, setJourneeEntiere] = useState(agendaJourneeEntiere)
  const [afficherHoraires, setAfficherHoraires] = useState(agendaAfficherHoraires)
  // Un texte par créneau, PRÉ-REMPLI avec son `nom` quand rien n'a encore été
  // personnalisé — même logique que le nom d'un véto sur la fiche Équipe :
  // l'admin voit tout de suite ce qui sera affiché, plutôt qu'un champ vide.
  const [libellesCreneaux, setLibellesCreneaux] = useState<Record<string, string>>(() =>
    Object.fromEntries(creneaux.map((c) => [c.id, c.libelleAgenda ?? c.nom])),
  )
  const [enregistrementAgendaEnCours, setEnregistrementAgendaEnCours] = useState(false)

  const enregistrerAgendaAffichage = async () => {
    setEnregistrementAgendaEnCours(true)
    try {
      const res = await configurerAgendaAffichage({
        journeeEntiere,
        afficherHoraires,
        libellesCreneaux: creneaux.map((c) => ({
          creneauId: c.id,
          libelle: libellesCreneaux[c.id] ?? '',
        })),
      })
      if ('error' in res && res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Présentation de l’agenda enregistrée')
    } catch {
      toast.error("L'appel n'a pas abouti. Réessaie dans un instant.")
    } finally {
      setEnregistrementAgendaEnCours(false)
    }
  }

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

  // Ce qui compte n'est pas « le cabinet a-t-il saisi un identifiant » mais
  // « les gardes partent-elles quelque part ». Le repli serveur suffit à
  // l'assurer — c'est d'ailleurs par lui que ça fonctionne aujourd'hui.
  const agendaSaisi = valeurs.googleCalendarId.trim() !== ''
  const agendaBranche = agendaSaisi || agendaParDefaut !== ''

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

  // ── Envoyer un e-mail d'essai ───────────────────────────────────────────
  // Le destinataire n'est pas saisissable : c'est l'adresse de l'admin
  // connecté, lue en base par l'action. Un champ libre serait un relais de
  // spam, et un champ de plus à rater en démonstration.
  const envoyerTest = async () => {
    setTestEnCours(true)
    try {
      const res = await envoyerEmailDeTest()
      if ('error' in res) {
        // Un échec d'envoi n'est pas une vignette qui s'efface toute seule :
        // c'est le moment précis où l'on découvre que la tuyauterie est
        // bouchée. Modale pour les refus, toast pour les succès.
        ouvrirErreur(res.error, {
          titre: 'L’e-mail d’essai n’est pas parti',
          explication:
            'Rien n’est cassé dans GuardVeto : c’est le service qui expédie les e-mails qui a refusé. Tant que ce point n’est pas réglé, les plannings publiés et les réponses aux congés ne partiront pas non plus.',
        })
        return
      }
      toast.success(`E-mail d’essai envoyé à ${res.destinataire}`)
    } catch {
      ouvrirErreur("L’appel n’a pas abouti. Réessaie dans un instant.", {
        titre: 'L’essai n’a pas pu être lancé',
      })
    } finally {
      setTestEnCours(false)
    }
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
        // Le serveur dit POURQUOI il n'a rien envoyé. « Aucun agenda branché »
        // était le seul motif imaginé, et il est faux depuis qu'un planning non
        // publié est refusé : on enverrait chercher une panne de réglage là où
        // il n'y a qu'un planning encore en brouillon.
        setResultatSync({
          ok: false,
          message:
            data?.raison
            ?? "Rien n'a été envoyé : aucun agenda n'est branché pour ce cabinet.",
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

  // Tout ce qui n'est pas arrivé compte comme un échec — pas seulement le refus
  // au moment de l'envoi. Un rejet annoncé par le webhook une minute plus tard
  // est exactement le même problème pour le cabinet.
  const nbEchecs = emails.filter(
    (e) => e.statut === 'erreur' || e.statut === 'rejete' || e.statut === 'spam',
  ).length

  return (
    <>
      {/* ── Tête de page ─────────────────────────────────────────────── */}
      <div className="page-head rise">
        <div>
          <h1>Réglages &amp; connexions</h1>
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
              {/* « Identifiant » se lisait comme « ton adresse Gmail ». C'en est
                  une, mais celle DE L'AGENDA, pas du compte : Google la donne
                  dans les paramètres de l'agenda, et elle finit toujours par
                  `@group.calendar.google.com`. Le libellé le dit maintenant,
                  plutôt que de laisser chercher. */}
              <label htmlFor="cn-cal">Adresse de l&apos;agenda Google</label>
              <input
                id="cn-cal"
                type="text"
                className="mono"
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                placeholder="cabinet@group.calendar.google.com"
                style={{ width: '100%', minHeight: 42 }}
              />
              <p className="field-aide">
                Dans Google Agenda : paramètres de l&apos;agenda → « Intégrer l&apos;agenda » →
                <b> ID de l&apos;agenda</b>. Ce n&apos;est pas l&apos;adresse d&apos;un compte
                Google, et elle ne sert pas à envoyer les e-mails.
              </p>
            </div>
            {/* Un champ vide et un voyant vert, c'est incompréhensible sans
                explication : on DIT sur quel agenda les gardes partent, et
                d'où vient ce réglage. */}
            {!agendaSaisi && agendaParDefaut !== '' && (
              <p className="conn-line">
                Ce champ est vide, mais les gardes partent bien — vers
                l&apos;agenda{' '}
                {/* Le NOM, pas l'identifiant. Un agenda secondaire Google a
                    pour adresse 64 caractères hexadécimaux : les afficher
                    n'apprend rien et donne l'impression d'un réglage cassé.
                    Sans nom (agenda injoignable), on reste vague plutôt que
                    de désigner un agenda dont on n'est plus sûr. */}
                {nomAgenda
                  ? <><b>«&nbsp;{nomAgenda}&nbsp;»</b>, configuré au niveau du serveur.</>
                  : <>configuré au niveau du serveur.</>}
                <br />
                Renseignez un identifiant ci-dessus pour utiliser un autre agenda.
              </p>
            )}
            <p className="conn-line">
              Cet agenda doit être <b>partagé en écriture</b> avec GuardVeto.
            </p>

            {periodesPubliees.length > 0 && (
              <div className="field">
                <label htmlFor="cn-per">Période à renvoyer</label>
                <Select value={periodeSync} onValueChange={(v) => v && setPeriodeSync(v)}>
                  <SelectTrigger id="cn-per" className="w-full">
                    <span className="flex-1 text-left truncate text-sm">
                      {periodeSync
                        ? libellePeriode(periodesPubliees.find((p) => p.id === periodeSync)!)
                        : 'Choisir une période…'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {periodesPubliees.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {libellePeriode(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

        {/* ── E-mails aux vétos ──────────────────────────────────────────
            L'ADRESSE d'envoi a été retirée de cet écran le 2026-08-21, sur
            constat de MiKL (« je ne saurais pas l'expliquer aux clients »).
            Elle n'était pas seulement obscure, elle était PIÉGÉE : Brevo refuse
            d'expédier depuis un domaine qu'il ne connaît pas, et l'autoriser
            demande une intervention dans notre compte + le DNS du client. Un
            cabinet qui remplissait cette case tout seul coupait ses propres
            e-mails, avec pour tout retour « l'adresse ou le domaine d'envoi
            n'est pas validé chez lui » (cf. lib/emails/echec.ts).
            Le NOM affiché, lui, ne demande aucune validation : il reste, parce
            qu'il est immédiatement utile et sans risque.
            La valeur en base n'est pas perdue : `fromEmail` continue d'être
            renvoyé tel qu'il a été chargé, donc réglable par l'assistance. */}
        <section className="card conn-card" aria-label="E-mails aux vétos">
          <div className="conn-head">
            <span className="conn-ico" aria-hidden="true">
              ✉️
            </span>
            <div>
              <h3>E-mails aux vétos</h3>
              <p className="sub">Le nom qu&apos;ils verront comme expéditeur</p>
            </div>
            <span className={`conn-state ${envoiConfigure ? 'on' : 'off'}`}>
              <span className="cs-dot" aria-hidden="true" />
              {envoiConfigure ? 'Actif' : 'À configurer'}
            </span>
          </div>
          <div className="conn-body">
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
            <p className="field-aide">
              Laissé vide, les e-mails arrivent au nom de GuardVeto.
            </p>
            <p className="conn-line">
              Le bouton d&apos;essai t&apos;envoie un vrai e-mail : s&apos;il arrive, les
              plannings et les réponses aux congés arriveront aussi.
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
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={envoyerTest}
                disabled={testEnCours}
              >
                {testEnCours && <span className="sync-spin" aria-hidden="true" />}
                {testEnCours ? 'Envoi…' : 'Vérifier que les e-mails partent'}
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
              Le code postal donne la zone de vacances scolaires et la région des jours fériés
              utilisées par le moteur.
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

      {/* ── Présentation dans Google Agenda (2026-08-27) ─────────────────
          Le cœur de l'écran : l'aperçu se recompose EN DIRECT avec
          `libelleGarde`, la même fonction que celle qui composera le VRAI
          titre à la synchronisation — pas une réécriture approximative ici. */}
      <section className="card agenda-affichage-card rise rise-3" aria-label="Présentation dans Google Agenda">
        <div className="card-head">
          <div>
            <h3>Présentation dans Google Agenda</h3>
            <p className="sub">Ce que les vétos verront dans leur agenda, garde par garde</p>
          </div>
        </div>
        <div className="aa-body">
          <div className="aa-interrupteurs">
            <label className="aa-switch">
              <input
                type="checkbox"
                checked={journeeEntiere}
                onChange={(e) => setJourneeEntiere(e.target.checked)}
              />
              <span>
                <b>Événements en journée entière</b>
                <small>
                  Un bandeau léger en haut de la grille, plutôt qu&apos;un bloc qui occupe toute la
                  colonne.
                </small>
              </span>
            </label>
            <label className="aa-switch">
              <input
                type="checkbox"
                checked={afficherHoraires}
                onChange={(e) => setAfficherHoraires(e.target.checked)}
              />
              <span>
                <b>Afficher les horaires dans le titre</b>
                <small>Ajoute « 18h/08h » à la fin du titre de l&apos;événement.</small>
              </span>
            </label>
          </div>

          {creneaux.length === 0 ? (
            <p className="aa-vide">
              Aucun créneau réglé pour l&apos;instant — la structure des gardes se configure sur
              l&apos;écran Règles.
            </p>
          ) : (
            <div className="aa-creneaux">
              <p className="aa-creneaux-lede">
                La base du titre, pour chaque créneau. Un mot par créneau — pas un seul pour tout
                le cabinet — parce qu&apos;un planning de journée arrivera plus tard sans se
                confondre avec les gardes.
              </p>
              {creneaux.map((c) => {
                const base = (libellesCreneaux[c.id] ?? '').trim() || c.nom
                const apercu = libelleGarde({
                  base,
                  nom: EXEMPLE_NOM,
                  role: '1er',
                  horaires: {
                    debut: formatHeureCourte(c.heureDebut),
                    fin: formatHeureCourte(c.heureFin),
                  },
                  afficherHoraires,
                })
                return (
                  <div className="aa-creneau-ligne" key={c.id}>
                    <div className="field aa-creneau-champ">
                      <label htmlFor={`aa-cr-${c.id}`}>{c.nom}</label>
                      <input
                        id={`aa-cr-${c.id}`}
                        type="text"
                        value={libellesCreneaux[c.id] ?? ''}
                        onChange={(e) =>
                          setLibellesCreneaux((l) => ({ ...l, [c.id]: e.target.value }))
                        }
                        placeholder={c.nom}
                      />
                    </div>
                    <div className="aa-apercu">
                      <span className="aa-apercu-label">Aperçu</span>
                      <code className="aa-apercu-titre">{apercu}</code>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="conn-actions">
            <button
              type="button"
              className="btn btn-valider btn-sm"
              onClick={enregistrerAgendaAffichage}
              disabled={enregistrementAgendaEnCours}
            >
              {enregistrementAgendaEnCours ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </section>

      {/* ── Journal des e-mails ──────────────────────────────────────── */}
      <section className="card mail-card rise rise-3" aria-label="Journal des e-mails">
        <div className="card-head">
          <div>
            <h3>Journal des e-mails</h3>
            {/* ⚠️ « Parti », pas « Envoyé ». Ce journal enregistre le moment où
                le message quitte GuardVeto — c'est-à-dire le moment où le
                service d'expédition l'ACCEPTE. Il ne sait rien de la suite.
                Le 2026-08-21, trois essais affichaient « Envoyé » alors que
                Brevo les avait rejetés dans la seconde (expéditeur non validé),
                et trois e-mails de la veille étaient « Envoyé » vers des
                adresses `@guardveto.local`, qui n'existent pas. Un mot qui
                promet la remise là où on ne constate que le départ envoie
                chercher la panne partout sauf où elle est.
                ➡️ Le vrai correctif reste à venir : brancher le webhook Brevo
                   pour que ce journal apprenne ce que le message est devenu. */}
            <p className="sub">
              Ce que GuardVeto a réellement expédié. « Parti » veut dire que le message a bien
              quitté l&apos;application — si un véto ne reçoit rien malgré ça, la cause est chez
              le service d&apos;expédition.
            </p>
          </div>
          <div className="mail-resume">
            {/* Une pastille verte « 0 partis » est un contresens : on ne
                montre le succès que s'il y en a un. */}
            {emails.length - nbEchecs > 0 && (
              <span className="mr-chip ok">{emails.length - nbEchecs} partis</span>
            )}
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
                    <span className={`m-statut ${TON_STATUT[e.statut] ?? 'envoye'}`}>
                      <span className="msd" aria-hidden="true" />
                      {LIBELLE_STATUT[e.statut] ?? e.statut}
                    </span>
                    {e.erreur && (
                      <span className="m-erreur" title={e.erreur}>
                        {raisonEchec(e.erreur)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Le bloc « Le reste des réglages » a disparu d'ici : il renvoyait vers
          les deux écrans V1 « Structure des gardes » et « Règles du cabinet »,
          qui sont maintenant refaits et RÉUNIS dans `/regles`. Le dock y mène
          déjà ; deux liens vers le même écran se marchent dessus au clavier
          comme au lecteur d'écran. */}

      {dialogueErreur}
    </>
  )
}
