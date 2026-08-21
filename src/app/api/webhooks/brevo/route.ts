// ============================================================
// GUARDVETO — POST /api/webhooks/brevo
// ============================================================
// CE QUE CETTE ROUTE RÉPARE — incident du 2026-08-21
//
// Le journal des e-mails n'enregistrait que le DÉPART : le moment où Brevo
// accepte le message. Il n'apprenait jamais ce qu'il en advenait. Ce jour-là,
// trois essais s'affichaient « Envoyé » alors que Brevo les avait rejetés dans
// la seconde (« the sender you used contact@monprojet-pro.com is not valid »),
// et trois messages de la veille étaient « Envoyé » vers `@guardveto.local`,
// un domaine qui n'existe pas. Il a fallu ouvrir le tableau de bord Brevo pour
// le découvrir — c'est-à-dire sortir du produit.
//
// Brevo rappelle ici à chaque étape de la vie d'un message. On retrouve la
// ligne par l'identifiant qu'il nous avait rendu à l'envoi (`resend_id`, nom
// historique de la colonne) et on met le statut à jour.
//
// SÉCURITÉ — Brevo ne signe pas ses webhooks. La parade est un secret dans
// l'URL, comparé à `BREVO_WEBHOOK_TOKEN` : sans lui, n'importe qui pourrait
// marquer les e-mails du cabinet comme remis. La comparaison est à durée
// constante, et la route ne dit jamais POURQUOI elle refuse.
//
// ⚠️ Cette route répond TOUJOURS 200 quand le jeton est bon, même si
// l'événement ne concerne aucune ligne connue. Un webhook qui renvoie une
// erreur est retenté puis désactivé par Brevo — on ne veut ni la tempête de
// reprises, ni le silence définitif qui suit.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'

// ── Client service role (webhook non authentifié, aucun cookie) ──
function getServiceClient() {
  // `.trim()` : une variable collée dans l'interface Vercel embarque souvent un
  // retour à la ligne invisible, qui rend l'URL ou la clé inutilisable.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('Variables Supabase manquantes.')
  return createServiceClient(url, key)
}

/** Comparaison à durée constante — une égalité `===` sur un secret fuit sa
 *  longueur et son préfixe à qui mesure le temps de réponse. */
function memeJeton(recu: string, attendu: string): boolean {
  const a = Buffer.from(recu)
  const b = Buffer.from(attendu)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Ce que chaque événement Brevo veut dire pour nous.
 *
 * Volontairement absents : `opened`, `click`, `unique_opened`. Savoir QUAND un
 * vétérinaire ouvre son planning ne sert à rien au cabinet et transformerait un
 * journal technique en outil de surveillance.
 */
const EVENEMENTS: Record<string, string> = {
  delivered: 'remis',
  hard_bounce: 'rejete',
  blocked: 'rejete',
  invalid_email: 'rejete',
  error: 'rejete',
  spam: 'spam',
  complaint: 'spam',
  soft_bounce: 'differe',
  deferred: 'differe',
  request: 'envoye',
}

/**
 * Le rang d'un statut, pour ne JAMAIS reculer.
 *
 * Les événements n'arrivent pas dans l'ordre : un `delivered` peut atterrir
 * après un `soft_bounce`, et une plainte pour spam arrive forcément APRÈS la
 * remise. Sans ce classement, le dernier reçu gagnerait et un message rejeté
 * pourrait se réafficher « Remis ».
 *
 * Un ennui l'emporte toujours sur une bonne nouvelle : c'est ce qu'un
 * administrateur a besoin de voir.
 */
const RANG: Record<string, number> = {
  envoye: 0,
  differe: 1,
  remis: 2,
  spam: 3,
  rejete: 4,
  erreur: 4,
}

/** Brevo encadre ses identifiants de chevrons (`<…@smtp-relay.mailin.fr>`)
 *  selon l'endroit ; on compare donc toujours la forme nue. */
function idNu(v: string): string {
  return v.trim().replace(/^<|>$/g, '')
}

interface EvenementBrevo {
  event?: string
  'message-id'?: string
  messageId?: string
  email?: string
  reason?: string
}

export async function POST(req: NextRequest) {
  // ── Le jeton, avant toute lecture du corps ────────────────────────────
  const attendu = process.env.BREVO_WEBHOOK_TOKEN?.trim()
  if (!attendu) {
    console.error('[webhook brevo] BREVO_WEBHOOK_TOKEN absente — appel ignoré.')
    return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 })
  }

  const recu =
    req.nextUrl.searchParams.get('token')?.trim()
    ?? req.headers.get('x-guardveto-token')?.trim()
    ?? ''

  if (!recu || !memeJeton(recu, attendu)) {
    return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 })
  }

  // ── L'événement ───────────────────────────────────────────────────────
  let corps: EvenementBrevo
  try {
    corps = (await req.json()) as EvenementBrevo
  } catch {
    // Corps illisible : on l'acte sans rejouer. Voir l'avertissement en tête.
    console.error('[webhook brevo] Corps JSON illisible.')
    return NextResponse.json({ ok: true, ignore: 'corps illisible' })
  }

  const evenement = (corps.event ?? '').toLowerCase()
  const statut = EVENEMENTS[evenement]
  if (!statut) {
    // Événement hors périmètre (ouverture, clic…) : rien à faire, et surtout
    // pas d'erreur — Brevo désactive un webhook qui échoue trop souvent.
    return NextResponse.json({ ok: true, ignore: evenement || '(sans événement)' })
  }

  const messageId = corps['message-id'] ?? corps.messageId ?? ''
  if (!messageId) {
    return NextResponse.json({ ok: true, ignore: 'sans identifiant de message' })
  }

  const supabase = getServiceClient()
  const id = idNu(messageId)

  // ── La ligne concernée ────────────────────────────────────────────────
  // `ilike` sur les deux formes : selon l'appelant, la colonne contient
  // l'identifiant nu ou entre chevrons.
  const { data: lignes, error: erreurLecture } = await supabase
    .from('email_log')
    .select('id, statut')
    .or(`resend_id.eq.${id},resend_id.eq.<${id}>`)
    .limit(1)

  if (erreurLecture) {
    console.error('[webhook brevo] Lecture email_log échouée:', erreurLecture.message)
    return NextResponse.json({ ok: true, ignore: 'lecture impossible' })
  }

  const ligne = lignes?.[0] as { id: string; statut: string } | undefined
  if (!ligne) {
    // Cas normal et fréquent : les e-mails d'invitation partent par Supabase
    // Auth, pas par nous, et n'ont donc aucune ligne ici.
    return NextResponse.json({ ok: true, ignore: 'message inconnu du journal' })
  }

  // ── On n'écrase jamais une nouvelle plus grave ────────────────────────
  const rangActuel = RANG[ligne.statut] ?? 0
  const rangNouveau = RANG[statut] ?? 0
  if (rangNouveau <= rangActuel) {
    return NextResponse.json({ ok: true, ignore: `${ligne.statut} conservé` })
  }

  const { error: erreurEcriture } = await supabase
    .from('email_log')
    .update({
      statut,
      // Le motif BRUT, comme partout ailleurs dans ce journal : la traduction
      // est le travail de l'affichage (`lib/emails/echec.ts`). Stocker déjà
      // traduit ferait repasser le texte dans `raisonEchec`, qui ne
      // reconnaîtrait plus rien et le tronquerait.
      erreur: corps.reason?.trim() || null,
    })
    .eq('id', ligne.id)

  if (erreurEcriture) {
    console.error('[webhook brevo] Écriture email_log échouée:', erreurEcriture.message)
    return NextResponse.json({ ok: true, ignore: 'écriture impossible' })
  }

  return NextResponse.json({ ok: true, statut })
}
