// ============================================================
// GUARDVETO V2 — Réglages & connexions
// ============================================================
// Sixième écran de la bascule (maquette M4, section 4). Il porte les trois
// branchements du cabinet (agenda, expéditeur d'e-mails, adresse) et le
// journal des e-mails, qui vivaient dans `/admin/structure` et
// `/admin/journal-emails`.
//
// La structure des gardes elle-même (créneaux, profils, horaires, relations)
// n'est PAS reprise ici : c'est un écran entier, pas une connexion. Il reste
// en V1 et l'écran y renvoie explicitement — un lien honnête vaut mieux
// qu'une carte à moitié refaite.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { exigerVeterinaire } from '@/lib/identite'
import '@/styles/v2-reglages.css'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { ReglagesV2, type LigneEmail, type ValeursCabinet } from '@/components/v2/ReglagesV2'
import { nomLisibleAgenda } from '@/lib/google-calendar'
import { chargerDock } from '@/data/v2/dock'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import type { Periode, Veterinaire } from '@/types'

export const dynamic = 'force-dynamic'
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

export default async function ReglagesPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Le secretariat n'a pas de fiche veterinaire : `exigerVeterinaire` le
  // renvoie vers le planning au lieu de le deconnecter (B-017, 2026-08-25).
  // C'est ce refus SERVEUR qui ferme la porte -- le dock reduit n'est qu'un
  // confort d'affichage.
  const { veto: moi } = await exigerVeterinaire(supabase)

  const vet = moi as Veterinaire
  if (vet.role_app !== 'admin') redirect('/accueil')

  // ── Réglages du cabinet ────────────────────────────────────────────────
  const { data: cabinetDb } = await supabase
    .from('cabinets')
    .select(
      'google_calendar_id, brevo_from_email, brevo_from_name, adresse, code_postal, ville, zone_scolaire, region_feries',
    )
    .limit(1)
    .maybeSingle()

  const cab = (cabinetDb ?? {}) as Record<string, string | null>
  const valeurs: ValeursCabinet = {
    googleCalendarId: cab.google_calendar_id ?? '',
    brevoFromEmail: cab.brevo_from_email ?? '',
    brevoFromName: cab.brevo_from_name ?? '',
    adresse: cab.adresse ?? '',
    codePostal: cab.code_postal ?? '',
    ville: cab.ville ?? '',
    zoneScolaire: cab.zone_scolaire ?? '',
    regionFeries: cab.region_feries ?? '',
  }

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

  const dock = await chargerDock(supabase, vet)

  return (
    <>
      <Satin />
      <div className="shell">
        <BarreV2 prenom={vet.prenom} estAdmin dock={dock} />
        <ReglagesV2
          valeurs={valeurs}
          periodesPubliees={periodesPubliees}
          emails={emails}
          // L'agenda de repli, lu côté SERVEUR : le navigateur n'a aucun moyen
          // de connaître les variables d'environnement. Sans lui, l'écran
          // annonçait « Non branché » alors que les gardes s'écrivaient
          // réellement dans Google — un indicateur qui ment est pire que pas
          // d'indicateur du tout, il envoie chercher une panne qui n'existe pas.
          agendaParDefaut={(process.env.GOOGLE_CALENDAR_ID ?? '').trim()}
          // Son NOM chez Google (« gardes véto »). L'identifiant d'un agenda
          // secondaire est une suite de 64 caractères hexadécimaux : afficher
          // ça dans un écran de réglages ne renseigne personne et fait peur.
          // Le nom est ce que le cabinet voit dans sa propre interface Google,
          // donc le seul repère qu'on partage avec lui.
          nomAgenda={await nomLisibleAgenda(valeurs.googleCalendarId || null)}
          // Même raison que l'agenda : seul le serveur sait si l'envoi est
          // réellement possible (clé + adresse d'expédition). Un booléen, jamais
          // les valeurs elles-mêmes — le navigateur n'a rien à faire d'une clé.
          envoiConfigure={
            !!process.env.BREVO_API_KEY?.trim()
            && !!(valeurs.brevoFromEmail.trim() || process.env.BREVO_FROM_EMAIL?.trim())
          }
        />
      </div>
    </>
  )
}
