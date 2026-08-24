// ============================================================
// GUARDVETO — Cloner un cabinet vers un bac à sable
// ============================================================
// Duplique la configuration et le planning d'un cabinet vers un NOUVEAU
// cabinet, pour disposer d'un vrai cas d'usage sans jamais toucher au compte
// réel. Rejouable : on peut rafraîchir le bac à sable quand la source évolue.
//
//   node scripts/cloner-cabinet.mjs --source <cabinet_id> --nom "Démo MPP"
//   node scripts/cloner-cabinet.mjs --source <cabinet_id> --nom "Démo MPP" --creer
//
// Sans `--creer`, RIEN n'est écrit : on liste seulement ce qui serait copié,
// table par table, avec les compteurs.
//
// Pour RAFRAÎCHIR un bac à sable déjà existant quand la source a évolué,
// ajouter `--remplacer` : l'ancienne copie est sauvegardée puis retirée avant
// que la nouvelle ne soit posée. Sans ce drapeau, un bac à sable existant
// n'est jamais écrasé — le script refuse et le dit.
//
// Ce script ne connaît AUCUN client en particulier : la source et le nom de la
// cible sont des paramètres (doctrine FORGE). Aucun identifiant en dur.
//
// LES QUATRE PIÈGES, et comment ils sont désamorcés :
//
//   ① Adresses e-mail — jamais copiées. Sinon un test envoie un vrai message à
//     un vrai vétérinaire. Voir COLONNES_VIDEES.
//   ② `gardes.google_event_id` — jamais copié. Sinon supprimer une garde dans
//     le bac à sable effacerait l'événement dans l'agenda RÉEL de la source.
//   ③ `cabinets.google_calendar_id` — NULL ne suffit PAS à isoler : le code
//     retombe alors sur la variable d'environnement `GOOGLE_CALENDAR_ID`
//     (src/lib/google-calendar.ts:65). On pose donc une valeur volontairement
//     invalide, pour que le repli ne puisse pas s'appliquer.
//   ④ `veterinaires.user_id` — jamais copié. `get_user_role()` cherche le véto
//     par `user_id` SANS filtre de cabinet, avec un LIMIT 1 : deux fiches
//     partageant un `user_id` feraient basculer un vrai vétérinaire dans le
//     bac à sable, ou l'inverse, de façon arbitraire et silencieuse.
//
// Les secrets sont lus au runtime depuis `.env.local`. Ils ne sont jamais
// affichés ni recopiés ailleurs.
// ============================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// ── Arguments ───────────────────────────────────────────────────────────────
function arg(nom) {
  const i = process.argv.indexOf(`--${nom}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const sourceId = arg('source')
const nomCible = arg('nom')
const slugDemande = arg('slug')
const agir = process.argv.includes('--creer')
const remplacer = process.argv.includes('--remplacer')

if (!sourceId || !nomCible) {
  console.error('Usage : node scripts/cloner-cabinet.mjs --source <cabinet_id> --nom "<nom>" [--slug <slug>] [--creer]')
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

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('✖ NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absent de .env.local')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

// ============================================================
// LE PLAN DE COPIE
// ============================================================
// L'ordre des entrées EST l'ordre d'insertion : une table n'apparaît qu'après
// toutes celles dont elle dépend. Ne pas réordonner sans revoir les `refs`.
//
//   pk      — nom de la clé primaire à régénérer, ou null si la table n'a pas
//             d'identifiant propre (sa PK est alors une FK déjà remappée).
//   refs    — colonne → table visée. `null` = référentiel global partagé
//             (briques, catalogue de créneaux) : on garde la valeur telle
//             quelle, ces lignes ne sont pas clonées.
//   refsTab — colonne tableau d'uuid → table visée (remap élément par élément).
//   vider   — colonnes forcées à NULL sur la copie.
//   forcer  — colonnes forcées à une valeur fixe sur la copie.
const PLAN = [
  { table: 'veterinaires', pk: 'id', refs: {},
    // ① l'e-mail et ④ le compte auth ne suivent JAMAIS le clone.
    vider: ['email', 'user_id'],
    forcer: { invite_pending: false } },

  { table: 'profils_planning', pk: 'id', refs: {} },
  { table: 'creneau_modele', pk: 'id', refs: { profil_id: 'profils_planning' } },
  { table: 'relation_creneau', pk: 'id',
    refs: { profil_id: 'profils_planning', source_id: 'creneau_modele', cible_id: 'creneau_modele' } },
  { table: 'periode_type_creneau', pk: 'id',
    refs: { profil_id: 'profils_planning', creneau_id: 'creneau_modele' } },
  { table: 'roulement_place', pk: 'id', refs: {}, refsTab: { sequence_vets: 'veterinaires' } },

  { table: 'snapshots_regles', pk: 'id', refs: {} },
  { table: 'periodes', pk: 'id',
    refs: { profil_id: 'profils_planning', snapshot_id: 'snapshots_regles' } },
  { table: 'regles_cabinet', pk: 'id',
    refs: { periode_id: 'periodes', created_by: 'veterinaires', brique_id: null } },
  { table: 'regles_version_courante', pk: null, refs: {} },

  // ② `google_event_id` reste au vestiaire : sans lui, supprimer une garde du
  // bac à sable ne peut plus effacer un événement de l'agenda de la source.
  { table: 'gardes', pk: 'id',
    refs: { periode_id: 'periodes', premier_id: 'veterinaires', second_id: 'veterinaires' },
    vider: ['google_event_id'] },
  { table: 'garde_placements', pk: 'id',
    refs: { garde_id: 'gardes', veterinaire_id: 'veterinaires' } },

  { table: 'conges', pk: 'id',
    refs: { veterinaire_id: 'veterinaires', saisi_par: 'veterinaires', valide_par: 'veterinaires' } },
  { table: 'absences', pk: 'id',
    refs: { veterinaire_id: 'veterinaires', declaree_par: 'veterinaires' } },
  { table: 'gardes_exceptions', pk: 'id',
    refs: { garde_id: 'gardes', absence_id: 'absences', cree_par: 'veterinaires',
            remplace_id: 'veterinaires', veterinaire_id: 'veterinaires' } },
  { table: 'compensations', pk: 'id',
    refs: { absence_id: 'absences', garde_id: 'gardes',
            remplacant_id: 'veterinaires', remplace_id: 'veterinaires' } },
  { table: 'echanges_gardes', pk: 'id',
    refs: { garde_id: 'gardes', garde_contrepartie_id: 'gardes',
            demandeur_id: 'veterinaires', cible_id: 'veterinaires' } },

  { table: 'bonus_malus', pk: 'id',
    refs: { veterinaire_id: 'veterinaires', periode_id: 'periodes' } },
  { table: 'historique_fete', pk: 'id',
    refs: { veterinaire_id: 'veterinaires', periode_id: 'periodes' } },
  { table: 'attributions', pk: 'id',
    refs: { planning_id: 'periodes', veterinaire_id: 'veterinaires', creneau_id: null } },
  { table: 'preferences_affichage', pk: null, refs: { veterinaire_id: 'veterinaires' } },
]

// Écartées volontairement — chacune avec sa raison.
const ECARTEES = {
  notifications: 'trace d’événements passés : un bac à sable neuf n’a rien à notifier',
  email_log: 'journal d’envois réels ; le recopier ferait croire à des envois qui n’ont pas eu lieu',
  audit_log: 'journal d’audit : l’histoire appartient au cabinet source',
  contraintes_veto: 'table morte, plus lue par l’application (leçon du 2026-06)',
  briques_regles: 'référentiel partagé par tous les cabinets — non dupliqué, référencé tel quel',
  creneaux_catalogue: 'référentiel partagé — non dupliqué, référencé tel quel',
  jours_feries: 'référentiel national partagé — non dupliqué',
  vacances_scolaires: 'référentiel national partagé — non dupliqué',
}

// ③ Le repli `GOOGLE_CALENDAR_ID` s'applique dès que la colonne est vide
// (src/lib/google-calendar.ts:65). Un NULL enverrait donc le bac à sable dans
// l'agenda de repli — celui-là même qu'utilise un cabinet dont la colonne est
// vide. On pose une valeur qui ne peut désigner aucun agenda : le TLD
// `.invalid` est réservé par la RFC 2606 et n'appartient à personne.
const AGENDA_NEUTRE = 'aucun-agenda@guardveto.invalid'

// Idem pour l'expéditeur : un bac à sable ne réutilise pas l'identité
// d'expédition du cabinet réel.
const CABINET_VIDE = ['brevo_from_email', 'brevo_from_name']

// ============================================================

const map = new Map() // ancien uuid → nouveau uuid, toutes tables confondues
const inseres = [] // { table, pk, ids } — dans l'ordre, pour un rollback inverse

function remap(valeur, tableVisee, contexte) {
  if (valeur === null || valeur === undefined) return valeur
  if (tableVisee === null) return valeur // référentiel global : on garde
  const neuf = map.get(valeur)
  if (!neuf) {
    // Refuser plutôt que laisser passer : une FK non remappée ferait pointer
    // une ligne du bac à sable vers une ligne du cabinet réel. C'est ce qu'on
    // cherche précisément à rendre impossible.
    throw new Error(`${contexte} : ${valeur} devait être remappé vers ${tableVisee}, introuvable`)
  }
  return neuf
}

// ── 1. Le cabinet source ────────────────────────────────────────────────────
const { data: source, error: errSrc } = await supabase
  .from('cabinets').select('*').eq('id', sourceId).maybeSingle()

if (errSrc) { console.error('Lecture cabinet :', errSrc.message); process.exit(1) }
if (!source) { console.error('Cabinet introuvable :', sourceId); process.exit(1) }

const slug = (slugDemande ?? nomCible)
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '') // les accents ne passent pas en slug
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 40)

console.log(`\nSource   : ${source.nom}  (${source.slug})`)
console.log(`Cible    : ${nomCible}  (${slug})`)

if (slug === source.slug) {
  console.error(`\n✖ La cible porterait le slug de la source. Choisis un autre nom, ou passe --slug.`)
  process.exit(1)
}

// ── Un bac à sable existe-t-il déjà sous ce nom ? ───────────────────────────
const { data: existant } = await supabase
  .from('cabinets').select('id, nom').eq('slug', slug).maybeSingle()

if (existant && !remplacer) {
  console.error(`\n✖ Un cabinet porte déjà ce slug : ${existant.nom} (${existant.id})`)
  console.error(`  Pour le rafraîchir depuis la source, ajoute --remplacer.`)
  console.error(`  Pour créer un second bac à sable, change le --nom ou passe un --slug.`)
  process.exit(1)
}

// ── 2. Lecture de tout ce qui serait copié ──────────────────────────────────
const lu = {}
let total = 0
console.log(`\nCe qui serait copié :`)

for (const etape of PLAN) {
  const { data, error } = await supabase.from(etape.table).select('*').eq('cabinet_id', sourceId)
  if (error) { console.error(`  Lecture ${etape.table} : ${error.message}`); process.exit(1) }
  lu[etape.table] = data
  total += data.length
  console.log(`  ${String(data.length).padStart(4)} · ${etape.table}`)
}

console.log(`\n  ${total} lignes au total`)
console.log(`\nÉcartées :`)
for (const [t, pourquoi] of Object.entries(ECARTEES)) console.log(`       · ${t} — ${pourquoi}`)

// ── 3. Sauvegarde AVANT toute écriture ──────────────────────────────────────
// Y compris en mode inspection : disposer de l'état lu coûte peu et permet de
// comparer plus tard si le clone diverge.
const d = new Date()
const p = (n) => String(n).padStart(2, '0')
const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`
const dossier = `_backups/clone-${sourceId.slice(0, 8)}-${stamp}`
mkdirSync(dossier, { recursive: true })
writeFileSync(`${dossier}/cabinet-source.json`, JSON.stringify(source, null, 2))
for (const [t, rows] of Object.entries(lu)) {
  writeFileSync(`${dossier}/${t}.json`, JSON.stringify(rows, null, 2))
}
console.log(`\nSauvegarde de la source écrite : ${dossier}`)

if (existant) {
  console.log(`\nBac à sable existant à remplacer : ${existant.nom} (${existant.id})`)
  const { count } = await supabase
    .from('veterinaires').select('*', { count: 'exact', head: true })
    .eq('cabinet_id', existant.id).not('user_id', 'is', null)
  if (count) {
    console.log(`  ⚠ ${count} compte(s) de connexion y sont rattachés. Ils survivront côté auth,`)
    console.log(`    mais leurs fiches partant, il faudra les ré-inviter après le rafraîchissement.`)
  }
}

if (!agir) {
  console.log(`\nMode inspection. Rien n’a été écrit.`)
  console.log(`Pour agir : node scripts/cloner-cabinet.mjs --source ${sourceId} --nom "${nomCible}"${existant ? ' --remplacer' : ''} --creer`)
  process.exit(0)
}

// ── Retrait de l'ancien bac à sable ─────────────────────────────────────────
// Sauvegardé d'abord : même un bac à sable peut contenir un réglage qu'on
// voudra retrouver. Suppression dans l'ordre INVERSE du plan, pour que les
// clés étrangères tombent dans le bon sens.
if (existant) {
  const avant = `${dossier}/remplace`
  mkdirSync(avant, { recursive: true })
  for (const etape of [...PLAN].reverse()) {
    const { data } = await supabase.from(etape.table).select('*').eq('cabinet_id', existant.id)
    writeFileSync(`${avant}/${etape.table}.json`, JSON.stringify(data ?? [], null, 2))
    const { error } = await supabase.from(etape.table).delete().eq('cabinet_id', existant.id)
    if (error) {
      console.error(`\n✖ Retrait de l’ancien bac à sable — ${etape.table} : ${error.message}`)
      console.error(`  Il est à moitié vidé. Sauvegarde : ${avant}`)
      process.exit(1)
    }
  }
  const { error } = await supabase.from('cabinets').delete().eq('id', existant.id)
  if (error) { console.error(`\n✖ Retrait du cabinet : ${error.message}`); process.exit(1) }
  console.log(`\nAncien bac à sable retiré (sauvegardé dans ${avant}).`)
}

// ── 4. Le cabinet cible ─────────────────────────────────────────────────────
const cibleId = randomUUID()
map.set(sourceId, cibleId)

const cible = { ...source, id: cibleId, nom: nomCible, slug }
for (const c of CABINET_VIDE) cible[c] = null
cible.google_calendar_id = AGENDA_NEUTRE // ③
delete cible.cree_le
delete cible.mis_a_jour_le

// Rollback : tout ce qui a été écrit repart, dans l'ordre inverse. Une copie à
// moitié faite serait pire que pas de copie du tout.
async function rollback(raison) {
  console.error(`\n✖ ${raison}`)
  console.error(`Annulation — retrait de ce qui a été écrit :`)
  for (const bloc of [...inseres].reverse()) {
    if (bloc.pk) {
      await supabase.from(bloc.table).delete().in(bloc.pk, bloc.ids)
    } else {
      await supabase.from(bloc.table).delete().eq('cabinet_id', cibleId)
    }
    console.error(`  retiré · ${bloc.table}`)
  }
  await supabase.from('cabinets').delete().eq('id', cibleId)
  console.error(`  retiré · cabinets`)
  console.error(`\nLa base est revenue à son état d’avant. La source n’a jamais été touchée.`)
  process.exit(1)
}

const { error: errCab } = await supabase.from('cabinets').insert(cible)
if (errCab) { console.error(`\n✖ Création du cabinet : ${errCab.message}`); process.exit(1) }
console.log(`\nCabinet créé : ${cibleId}`)

// ── 5. Les tables, dans l'ordre ─────────────────────────────────────────────
console.log(`\nCopie :`)

for (const etape of PLAN) {
  const rows = lu[etape.table]
  if (rows.length === 0) { console.log(`     0 · ${etape.table}`); continue }

  // Deux passes : d'abord attribuer TOUS les nouveaux identifiants de la table,
  // puis remapper. Sans cela une ligne qui référence une sœur de la même table
  // (relation_creneau, echanges_gardes) échouerait selon l'ordre de lecture.
  if (etape.pk) for (const r of rows) map.set(r[etape.pk], randomUUID())

  const copies = []
  try {
    for (const r of rows) {
      const c = { ...r, cabinet_id: cibleId }
      if (etape.pk) c[etape.pk] = map.get(r[etape.pk])

      for (const [col, table] of Object.entries(etape.refs ?? {})) {
        c[col] = remap(r[col], table, `${etape.table}.${col}`)
      }
      for (const [col, table] of Object.entries(etape.refsTab ?? {})) {
        if (Array.isArray(r[col])) {
          c[col] = r[col].map((v) => remap(v, table, `${etape.table}.${col}[]`))
        }
      }
      for (const col of etape.vider ?? []) c[col] = null
      Object.assign(c, etape.forcer ?? {})

      copies.push(c)
    }
  } catch (e) {
    await rollback(`${etape.table} — ${e.message}`)
  }

  const { error } = await supabase.from(etape.table).insert(copies)
  if (error) await rollback(`Insertion ${etape.table} : ${error.message}`)

  inseres.push({ table: etape.table, pk: etape.pk, ids: etape.pk ? copies.map((c) => c[etape.pk]) : [] })
  console.log(`  ${String(copies.length).padStart(4)} · ${etape.table}`)
}

// ── 6. Vérification : compteurs, puis chasse aux FK non remappées ───────────
// Le contrôle qui compte vraiment. Compter ne prouve rien : une ligne clonée
// qui pointe encore vers une ligne de la source passerait le compte sans
// broncher, et c'est exactement l'accident redouté.
console.log(`\nVérification :`)

let ecart = 0
const idsSource = new Set()
for (const etape of PLAN) {
  const { count } = await supabase
    .from(etape.table).select('*', { count: 'exact', head: true }).eq('cabinet_id', cibleId)
  if ((count ?? 0) !== lu[etape.table].length) {
    console.error(`  ✖ ${etape.table} : ${count} copiées pour ${lu[etape.table].length} lues`)
    ecart++
  }
  if (etape.pk) for (const r of lu[etape.table]) idsSource.add(r[etape.pk])
}
idsSource.add(sourceId)
console.log(`  ${ecart === 0 ? '✔' : '✖'} compteurs — ${PLAN.length} tables`)

let fuites = 0
for (const etape of PLAN) {
  const colonnes = [...Object.keys(etape.refs ?? {}), ...Object.keys(etape.refsTab ?? {})]
  if (colonnes.length === 0) continue
  const { data } = await supabase.from(etape.table).select('*').eq('cabinet_id', cibleId)
  for (const r of data ?? []) {
    for (const col of colonnes) {
      const valeurs = Array.isArray(r[col]) ? r[col] : [r[col]]
      for (const v of valeurs) {
        if (v && idsSource.has(v)) {
          console.error(`  ✖ ${etape.table}.${col} pointe encore vers la source : ${v}`)
          fuites++
        }
      }
    }
  }
}
console.log(`  ${fuites === 0 ? '✔' : '✖'} aucune clé étrangère ne pointe vers la source`)

// Les trois pièges, contrôlés sur la copie plutôt que sur l'intention.
const { data: vetos } = await supabase
  .from('veterinaires').select('email, user_id').eq('cabinet_id', cibleId)
const { data: gardesC } = await supabase
  .from('gardes').select('google_event_id').eq('cabinet_id', cibleId)
const { data: cabC } = await supabase
  .from('cabinets').select('google_calendar_id, brevo_from_email').eq('id', cibleId).maybeSingle()

const emails = (vetos ?? []).filter((v) => v.email).length
const users = (vetos ?? []).filter((v) => v.user_id).length
const events = (gardesC ?? []).filter((g) => g.google_event_id).length

console.log(`  ${emails === 0 ? '✔' : '✖'} ① aucune adresse e-mail copiée (${emails})`)
console.log(`  ${events === 0 ? '✔' : '✖'} ② aucun google_event_id copié (${events})`)
console.log(`  ${cabC?.google_calendar_id === AGENDA_NEUTRE ? '✔' : '✖'} ③ agenda neutralisé (${cabC?.google_calendar_id})`)
console.log(`  ${users === 0 ? '✔' : '✖'} ④ aucun compte auth repris (${users})`)

if (ecart || fuites || emails || users || events) {
  await rollback('La copie n’a pas passé sa propre vérification.')
}

writeFileSync(`${dossier}/_correspondances.json`,
  JSON.stringify({ source: sourceId, cible: cibleId, correspondances: Object.fromEntries(map) }, null, 2))

console.log(`\n✔ Cabinet cloné : ${cibleId}`)
console.log(`  Correspondances anciens → nouveaux ids : ${dossier}/_correspondances.json`)
console.log(`\nIl reste à créer les comptes de connexion — le script n’en crée aucun.`)
console.log(`Voir le rapport : inviter depuis l’application, sur une adresse +suffixe.`)
