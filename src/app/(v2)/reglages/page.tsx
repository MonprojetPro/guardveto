// ============================================================
// GUARDVETO V2 — Réglages
// ============================================================
// L'onglet Réglages refondu (B-202, maquette validée par MiKL le 10/11 :
// `docs/maquettes/B-202-reglages.html`) : un sommaire, cinq sections. Les
// vétos et le secrétariat n'ont que « Pour moi » (leurs e-mails, leur agenda
// Google) ; l'administratrice voit aussi le cabinet, la messagerie, les
// connexions et le journal des e-mails.
//
// Il a remplacé partout, le 11/11, l'écran « Réglages & connexions » (grille
// de cartes) et les deux pages `/reglages/notifications` et `/reglages/agenda`,
// qui ne font plus que renvoyer ici. L'ancien écran est retiré du code depuis
// B-202b (12/11) : il n'y a plus de second rendu vers lequel revenir.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { exigerIdentite, exigerVeterinaire } from '@/lib/identite'
// `v2-reglages.css` : il ne porte plus que les styles de « Mon agenda »
// (`MonAgendaCorps`, posé dans la section « Pour moi »).
import '@/styles/v2-reglages.css'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { ReglagesOnglet } from '@/components/v2/reglages/ReglagesOnglet'
import { agendaDeRepliPour, nomLisibleAgenda } from '@/lib/google-calendar'
import { chargerDock } from '@/data/v2/dock'
import { chargerMesNotifications, chargerMonAgenda } from '@/data/v2/mesReglages'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { sectionDemandee } from '@/lib/reglages/coquille'
import {
  libellePeriode, type CreneauAgenda, type LigneEmail, type ValeursCabinet,
} from '@/lib/reglages/libelles'
import type { Periode, Veterinaire } from '@/types'

export const dynamic = 'force-dynamic'
// L'onglet montre « Mon agenda », dont l'ouverture peut lancer une mise à
// jour qui tourne après la réponse (voir `chargerMonAgenda`).
export const maxDuration = 300
export const metadata = { title: 'GuardVeto — Réglages' }

interface EmailLogRow {
  id: string
  type: string
  destinataire: string
  veterinaire_id: string | null
  statut: string
  erreur: string | null
  created_at: string
}

export default async function ReglagesPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string | string[] }>
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // B-174 — « Réglages » est l'entrée de TOUS les rôles. Hors administratrice,
  // la page ne montre que les réglages personnels : aucune donnée du cabinet
  // n'est lue pour eux (tout ce qui suit est réservé à l'admin).
  const identite = await exigerIdentite(supabase)

  const param = (await searchParams).section
  const section = sectionDemandee(Array.isArray(param) ? param[0] : param, identite.role)
  const prenom = identite.genre === 'veto' ? identite.veto.prenom : identite.nomAffiche

  if (identite.role !== 'admin') {
    const [notifications, agenda, dockPerso] = await Promise.all([
      chargerMesNotifications(supabase, identite, user.id),
      chargerMonAgenda(identite),
      chargerDock(supabase, { role_app: identite.role }),
    ])
    return (
      <>
        <Satin />
        <div className="shell">
          <BarreV2
            prenom={prenom}
            estAdmin={false}
            estSecretaire={identite.role === 'secretaire'}
            dock={dockPerso}
          />
          <ReglagesOnglet
            role={identite.role}
            sectionDemandee={section}
            moi={{ notifications, agenda }}
            cabinet={null}
          />
        </div>
      </>
    )
  }

  // Le secretariat n'a pas de fiche veterinaire : `exigerVeterinaire` le
  // renvoie vers le planning au lieu de le deconnecter (B-017, 2026-08-25).
  // C'est ce refus SERVEUR qui ferme la porte -- le dock reduit n'est qu'un
  // confort d'affichage.
  const { veto: moi } = await exigerVeterinaire(supabase)

  const vet = moi as Veterinaire
  if (vet.role_app !== 'admin') redirect('/accueil')

  // ── Réglages du cabinet ────────────────────────────────────────────────
  // Chantier agenda Google (2026-08-27) — `agenda_journee_entiere` et
  // `agenda_afficher_horaires` viennent de la migration
  // `20260827180000_agenda_google_socle`, pas encore appliquée : tant
  // qu'elle ne l'est pas, Postgrest renvoie une erreur de colonne absente et
  // `cabinetDb` reste `null` — d'où les replis ci-dessous plutôt qu'un throw.
  const { data: cabinetDb } = await supabase
    .from('cabinets')
    .select(
      'google_calendar_id, brevo_from_email, brevo_from_name, adresse, code_postal, ville, zone_scolaire, region_feries, agenda_journee_entiere, agenda_afficher_horaires',
    )
    .limit(1)
    .maybeSingle()

  const cab = (cabinetDb ?? {}) as Record<string, string | boolean | null>
  const valeurs: ValeursCabinet = {
    googleCalendarId: (cab.google_calendar_id as string | null) ?? '',
    brevoFromEmail: (cab.brevo_from_email as string | null) ?? '',
    brevoFromName: (cab.brevo_from_name as string | null) ?? '',
    adresse: (cab.adresse as string | null) ?? '',
    codePostal: (cab.code_postal as string | null) ?? '',
    ville: (cab.ville as string | null) ?? '',
    zoneScolaire: (cab.zone_scolaire as string | null) ?? '',
    regionFeries: (cab.region_feries as string | null) ?? '',
  }
  // Replis fidèles aux DEFAULT de la migration (journée entière activée,
  // horaires masqués) : tant qu'elle n'est pas appliquée, l'écran se comporte
  // comme s'il l'était déjà, plutôt que d'afficher un état qui n'existe pas.
  const agendaJourneeEntiere = (cab.agenda_journee_entiere as boolean | null) ?? true
  const agendaAfficherHoraires = (cab.agenda_afficher_horaires as boolean | null) ?? false

  // ── Périodes publiées : seules resynchronisables vers l'agenda ─────────
  const { data: periodesDb } = await supabase
    .from('periodes')
    .select('*')
    .eq('statut', 'publie')
    .order('date_debut', { ascending: false })
    .limit(10)
  const periodesPubliees = (periodesDb as Periode[] | null) ?? []

  // ── Journal des e-mails ────────────────────────────────────────────────
  // `email_log` n'a pas de colonne cabinet_id : on borne EXPLICITEMENT la
  // lecture aux vétos du cabinet de l'admin, comme la page V1. Double
  // barrière — l'app filtre ET la RLS borne.
  let cabinetId: string | null = null
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch {
    cabinetId = null
  }

  // ── Les créneaux du socle, pour l'intitulé par créneau ──────────────────
  // `creneau_modele.libelle_agenda` vient de la même migration que les deux
  // booléens ci-dessus (pas encore appliquée) — le `.select` échoue alors
  // proprement et `creneauxDb` reste `null`, d'où le repli `[]`.
  interface CreneauModeleRow {
    id: string
    nom: string
    libelle_agenda: string | null
    heure_debut: string
    heure_fin: string
    roles: string[] | null
  }
  const { data: creneauxDb } = cabinetId
    ? await supabase
        .from('creneau_modele')
        .select('id, nom, libelle_agenda, heure_debut, heure_fin, roles')
        .eq('cabinet_id', cabinetId)
        .is('profil_id', null)
        .eq('actif', true)
        .order('ordre')
    : { data: null }
  const creneaux: CreneauAgenda[] = ((creneauxDb ?? []) as CreneauModeleRow[]).map((c) => ({
    id: c.id,
    nom: c.nom,
    libelleAgenda: c.libelle_agenda,
    // Postgres TIME rend 'HH:MM:SS' — l'écran (et l'aperçu) n'a besoin que de
    // 'HH:MM', même troncature que `chargerCreneauModele` (`hhmm()`).
    heureDebut: c.heure_debut.slice(0, 5),
    heureFin: c.heure_fin.slice(0, 5),
    // B-080 : mêmes rôles que ceux lus par `google-calendar.ts`
    // (`options.rolesParCode`) — l'aperçu doit refléter le même vocabulaire.
    roles: c.roles ?? [],
  }))

  const { data: vetsRaw } = cabinetId
    ? await supabase.from('veterinaires').select('id, nom, prenom').eq('cabinet_id', cabinetId)
    : { data: null }
  const vetsCabinet = (vetsRaw ?? []) as { id: string; nom: string; prenom: string }[]
  const nomParVet = new Map(vetsCabinet.map((v) => [v.id, `${v.prenom} ${v.nom}`]))

  let emails: LigneEmail[] = []
  if (vetsCabinet.length > 0) {
    const { data } = await supabase
      .from('email_log')
      .select('id, type, destinataire, veterinaire_id, statut, erreur, created_at')
      .in(
        'veterinaire_id',
        vetsCabinet.map((v) => v.id),
      )
      .order('created_at', { ascending: false })
      .limit(60)

    emails = ((data ?? []) as EmailLogRow[]).map((l) => ({
      id: l.id,
      type: l.type,
      destinataire: l.destinataire,
      statut: l.statut,
      erreur: l.erreur,
      created_at: l.created_at,
      vetNom: l.veterinaire_id ? (nomParVet.get(l.veterinaire_id) ?? null) : null,
    }))
  }

  // ── L'onglet de l'administratrice ───────────────────────────────────────
  // Ni clé ni variable d'environnement ne partent vers le navigateur : des
  // booléens et des noms. Seule exception : les trois champs partagés (agenda,
  // adresse et nom d'expéditeur), que `configurerPartagesCabinet` exige en
  // retour — l'admin de CE cabinet, qui les a réglés.
  //
  // Le repli est NOMINATIF (cabinet pilote seul, `agendaDeRepliPour`) : le
  // tester sur la seule variable d'environnement aurait annoncé « Branché »
  // à un cabinet dont la synchronisation n'écrit nulle part (CERBÈRE, 10/11).
  const repli = agendaDeRepliPour(cabinetId)
  const [dock, notifications, agenda, nomAgenda] = await Promise.all([
    chargerDock(supabase, vet),
    chargerMesNotifications(supabase, identite, user.id),
    chargerMonAgenda(identite),
    nomLisibleAgenda(valeurs.googleCalendarId || repli),
  ])
  return (
    <>
      <Satin />
      <div className="shell">
        <BarreV2 prenom={vet.prenom} estAdmin dock={dock} />
        <ReglagesOnglet
          role="admin"
          sectionDemandee={section}
          moi={{ notifications, agenda }}
          cabinet={{
            cabinet: {
              adresse: valeurs.adresse,
              codePostal: valeurs.codePostal,
              ville: valeurs.ville,
              zoneScolaire: valeurs.zoneScolaire,
              regionFeries: valeurs.regionFeries,
              envoiConfigure:
                !!process.env.BREVO_API_KEY?.trim()
                && !!(valeurs.brevoFromEmail.trim() || process.env.BREVO_FROM_EMAIL?.trim()),
              emailAdmin: vet.email ?? null,
            },
            connexions: {
              repliDisponible: repli !== null,
              nomAgenda,
              periodesPubliees: periodesPubliees.map((p) => ({ id: p.id, libelle: libellePeriode(p) })),
              agendaJourneeEntiere,
              agendaAfficherHoraires,
              creneaux,
            },
            partages: {
              googleCalendarId: valeurs.googleCalendarId,
              brevoFromEmail: valeurs.brevoFromEmail,
              brevoFromName: valeurs.brevoFromName,
            },
            messagerieAllumee: dock.modules.includes('chat'),
            emails,
          }}
        />
      </div>
    </>
  )
}
