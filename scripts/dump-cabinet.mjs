// ============================================================
// GUARDVETO — Sauvegarde complète des données d'un cabinet
// ============================================================
// Écrit un dossier horodaté sous `_backups/` (gitignoré) contenant un fichier
// JSON par table, plus un manifeste qui compte les lignes. Lecture seule : ce
// script n'écrit JAMAIS dans la base.
//
// Pourquoi pas `pg_dump` : ni le client Postgres ni la CLI Supabase ne sont
// installés sur ce poste. On passe donc par l'API REST avec la clé de service,
// qui contourne la RLS et voit donc l'intégralité des lignes.
//
//   node scripts/dump-cabinet.mjs
//
// Les secrets sont lus au runtime depuis `.env.local` — ils ne transitent
// nulle part ailleurs et ne sont jamais affichés.
// ============================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ── Les secrets, lus directement depuis .env.local ──────────────────────────
// Next.js charge ce fichier tout seul ; un script `node` nu, non. On le lit
// donc à la main, sans dépendance supplémentaire.
const env = {}
for (const ligne of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (!m) continue
  // Le `.trim()` n'est pas cosmétique : un `\n` parasite hérité du dashboard
  // Vercel a déjà mis Filou à terre (leçon du 2026-07-27).
  env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('✖ NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absent de .env.local')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

// ── Ce qu'on sauvegarde ─────────────────────────────────────────────────────
// TOUTES les tables métier, y compris `contraintes_veto` : elle est en sursis,
// raison de plus pour l'avoir sur disque avant qu'on la débranche.
// Les référentiels partagés (jours fériés, vacances scolaires, catalogue de
// briques) sont inclus aussi : ils ne coûtent rien et rendent le dump
// rejouable tel quel dans une base vierge.
const TABLES = [
  'cabinets',
  'veterinaires',
  'periodes',
  'regles_cabinet',
  'contraintes_veto',
  'snapshots_regles',
  'regles_version_courante',
  'briques_regles',
  'profils_planning',
  'creneau_modele',
  'creneaux_catalogue',
  'relation_creneau',
  'roulement_place',
  'gardes',
  'garde_placements',
  'attributions',
  'echanges_gardes',
  'conges',
  'absences',
  'compensations',
  'bonus_malus',
  'compteurs_gardes',
  'planning_semaine',
  'historique_fete',
  'notifications',
  'email_log',
  'audit_log',
  'jours_feries',
  'vacances_scolaires',
]

// Horodatage local en `AAAA-MM-JJ_HHhMM` — lisible dans l'explorateur Windows,
// et triable alphabétiquement, ce qu'un format à la française ne serait pas.
const d = new Date()
const p = (n) => String(n).padStart(2, '0')
const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`
const dossier = `_backups/dump-${stamp}`
mkdirSync(dossier, { recursive: true })

const manifeste = { genere_le: d.toISOString(), source: url, tables: {} }
let total = 0
const absentes = []

for (const table of TABLES) {
  const { data, error } = await supabase.from(table).select('*')

  if (error) {
    // Une table qui n'existe pas (ou plus) ne doit pas interrompre le dump :
    // on la note et on continue. Un dump partiel vaut mieux que pas de dump.
    absentes.push(`${table} (${error.message})`)
    manifeste.tables[table] = { erreur: error.message }
    continue
  }

  writeFileSync(`${dossier}/${table}.json`, JSON.stringify(data, null, 2), 'utf8')
  manifeste.tables[table] = { lignes: data.length }
  total += data.length
  console.log(`  ${String(data.length).padStart(4)} · ${table}`)
}

manifeste.total_lignes = total
writeFileSync(`${dossier}/_manifeste.json`, JSON.stringify(manifeste, null, 2), 'utf8')

console.log(`\n✔ ${total} lignes sauvegardées dans ${dossier}`)
if (absentes.length > 0) {
  console.log(`⚠ tables non lues : ${absentes.join(', ')}`)
}
