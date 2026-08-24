// ============================================================
// GUARDVETO — Retirer une période de l'agenda Google, puis de la base
// ============================================================
// `supprimerPeriode` (admin/periodes/actions.ts:319) efface les lignes et
// laisse les événements Google orphelins : seule la RÉgénération purge
// l'agenda (generate/route.ts:491). Ce script comble ce trou à la main, le
// temps que la suppression le fasse d'elle-même.
//
//   node scripts/nettoyer-periode-agenda.mjs <periode_id>            → inspecte
//   node scripts/nettoyer-periode-agenda.mjs <periode_id> --supprimer → agit
//
// Sans `--supprimer`, RIEN n'est touché : on liste seulement ce qui partirait.
// Une sauvegarde JSON des gardes est écrite dans `_backups/` (gitignoré)
// AVANT toute suppression, y compris en mode inspection.
//
// Les secrets sont lus au runtime depuis `.env.local`. Ils ne sont jamais
// affichés ni recopiés ailleurs.
// ============================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'

const periodeId = process.argv[2]
const agir = process.argv.includes('--supprimer')

if (!periodeId) {
  console.error('Usage : node scripts/nettoyer-periode-agenda.mjs <periode_id> [--supprimer]')
  process.exit(1)
}

// ── Les secrets, lus directement depuis .env.local ──────────────────────────
// Next.js charge ce fichier tout seul ; un `node` nu, non.
// Le `.trim()` n'est pas cosmétique : un `\n` parasite hérité du dashboard
// Vercel a déjà mis Filou à terre (leçon du 2026-07-27).
const env = {}
for (const ligne of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (!m) continue
  env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

// ── 1. La période et ses gardes ─────────────────────────────────────────────
const { data: periode, error: errP } = await supabase
  .from('periodes')
  .select('id, libelle, date_debut, date_fin, statut, cabinet_id')
  .eq('id', periodeId)
  .maybeSingle()

if (errP) { console.error('Lecture période :', errP.message); process.exit(1) }
if (!periode) { console.error('Période introuvable :', periodeId); process.exit(1) }

const { data: gardes, error: errG } = await supabase
  .from('gardes')
  .select('*')
  .eq('periode_id', periodeId)
  .order('date')

if (errG) { console.error('Lecture gardes :', errG.message); process.exit(1) }

console.log(`\nPériode  : ${periode.libelle}`)
console.log(`Dates    : ${periode.date_debut} → ${periode.date_fin}`)
console.log(`Statut   : ${periode.statut}`)
console.log(`Gardes   : ${gardes.length}`)

const avecEvent = gardes.filter((g) => g.google_event_id)
console.log(`Dont posées dans l'agenda Google : ${avecEvent.length}`)

// ── 2. Sauvegarde AVANT tout ────────────────────────────────────────────────
const horodatage = new Date().toISOString().replace(/[:.]/g, '-')
const dossier = `_backups/periode-${periodeId.slice(0, 8)}-${horodatage}`
mkdirSync(dossier, { recursive: true })
writeFileSync(`${dossier}/periode.json`, JSON.stringify(periode, null, 2))
writeFileSync(`${dossier}/gardes.json`, JSON.stringify(gardes, null, 2))
console.log(`\nSauvegarde écrite : ${dossier}`)

// ── 3. Quel agenda ? ────────────────────────────────────────────────────────
const { data: cab } = await supabase
  .from('cabinets')
  .select('nom, google_calendar_id')
  .eq('id', periode.cabinet_id)
  .maybeSingle()

const calendarId =
  (cab?.google_calendar_id ?? '').trim() || (env.GOOGLE_CALENDAR_ID ?? '').trim()

if (!calendarId) {
  console.error('\nAucun agenda cible : ni cabinets.google_calendar_id, ni GOOGLE_CALENDAR_ID.')
  console.error('Les événements ne peuvent pas être retrouvés. On s’arrête.')
  process.exit(1)
}

const origine = (cab?.google_calendar_id ?? '').trim() ? 'colonne du cabinet' : 'variable d’environnement (repli)'
console.log(`Agenda cible : ${calendarId}  (${origine})`)

if (!agir) {
  console.log(`\nMode inspection. Rien n’a été touché.`)
  console.log(`Pour agir : node scripts/nettoyer-periode-agenda.mjs ${periodeId} --supprimer`)
  process.exit(0)
}

// ── 4. Suppression des événements Google ────────────────────────────────────
const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL
const key = (env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')

if (!email || !key) {
  console.error('\nIdentifiants Google absents. Impossible de nettoyer l’agenda.')
  console.error('On s’arrête AVANT de toucher la base : supprimer les lignes maintenant')
  console.error('laisserait les événements orphelins chez le client.')
  process.exit(1)
}

const auth = new google.auth.JWT({
  email,
  key,
  scopes: ['https://www.googleapis.com/auth/calendar'],
})
const calendar = google.calendar({ version: 'v3', auth })

let effaces = 0
let dejaAbsents = 0
const echecs = []

for (const g of avecEvent) {
  try {
    await calendar.events.delete({ calendarId, eventId: g.google_event_id })
    effaces++
    process.stdout.write('.')
  } catch (e) {
    const code = e?.code ?? e?.response?.status
    // 404 / 410 : l'événement n'existe déjà plus. Ce n'est pas un échec.
    if (code === 404 || code === 410) { dejaAbsents++; process.stdout.write('o') }
    else { echecs.push({ date: g.date, eventId: g.google_event_id, code, message: e?.message }); process.stdout.write('X') }
  }
}

console.log(`\n\nAgenda — effacés : ${effaces} · déjà absents : ${dejaAbsents} · échecs : ${echecs.length}`)

if (echecs.length) {
  console.error('\nÉCHECS — la base ne sera PAS touchée :')
  for (const e of echecs) console.error(`  ${e.date}  ${e.eventId}  [${e.code}] ${e.message}`)
  writeFileSync(`${dossier}/echecs-agenda.json`, JSON.stringify(echecs, null, 2))
  console.error(`\nDétail : ${dossier}/echecs-agenda.json`)
  console.error('Supprimer les lignes maintenant laisserait ces événements orphelins.')
  process.exit(1)
}

// ── 5. Vérification : l'agenda ne doit plus rien porter ─────────────────────
let restants = 0
for (const g of avecEvent) {
  try {
    const r = await calendar.events.get({ calendarId, eventId: g.google_event_id })
    // Google garde les événements annulés en lecture ; seul un statut vivant compte.
    if (r.data.status !== 'cancelled') { restants++; console.error(`  reste : ${g.date} ${g.google_event_id} (${r.data.status})`) }
  } catch { /* absent = ce qu'on veut */ }
}

if (restants) {
  console.error(`\n${restants} événement(s) encore vivant(s) dans l’agenda. La base n’est PAS touchée.`)
  process.exit(1)
}
console.log('Vérifié : plus aucun événement vivant dans l’agenda.')

// ── 6. La base ──────────────────────────────────────────────────────────────
// Les gardes tombent par cascade avec la période. On passe par service_role,
// donc ni la RLS ni le garde-fou « brouillon seulement » de l'action serveur
// ne s'appliquent : c'est voulu, la demande vient de MiKL et cette fonction
// n'existe pas côté client.
await supabase.from('attributions').delete().eq('planning_id', periodeId)

const { error: errDel } = await supabase.from('periodes').delete().eq('id', periodeId)
if (errDel) { console.error('\nSuppression base :', errDel.message); process.exit(1) }

const { count } = await supabase
  .from('gardes')
  .select('id', { count: 'exact', head: true })
  .eq('periode_id', periodeId)

console.log(`\nBase — période supprimée. Gardes restantes pour cet id : ${count ?? 0}`)
console.log(`Sauvegarde conservée : ${dossier}`)
