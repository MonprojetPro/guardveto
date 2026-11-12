// ============================================================
// GUARDVETO — Le guichet du Hub MPP : qui a le droit d'entrer (B-207)
// ============================================================
// Le Hub MonProjetPro administre GuardVeto SANS jamais toucher sa base : il
// frappe a ce guichet (`/api/hub/*`) avec un secret partage, et ne recoit que
// du JSON. Meme modele que le guichet `admin-api` de MenuFacile.
//
// Trois regles, toutes testees (`tests/lib/guichet-hub.test.ts`) :
//   ① Pas de secret configure → PERSONNE n'entre. Un guichet sans serrure
//      parce qu'une variable manque est le pire des oublis : il ne se voit pas.
//   ② Un secret trop court est refuse comme s'il manquait : 32 caracteres au
//      moins, sinon il se devine.
//   ③ La comparaison est a temps constant : un `===` repond plus vite quand
//      le debut est faux, et laisse deviner le secret caractere par caractere.
// ============================================================

import { createHash, timingSafeEqual } from 'node:crypto'

/** En dessous, un secret se devine. */
export const LONGUEUR_SECRET_MIN = 32

export type VerdictAcces =
  | { ok: true }
  | { ok: false; statut: 401 | 503; raison: string }

/** Le secret configure, nettoye du retour a la ligne que colle l'interface Vercel. */
export function secretConfigure(): string | null {
  const brut = process.env.HUB_GUICHET_SECRET?.trim()
  return brut ? brut : null
}

/**
 * Verifie l'en-tete `Authorization: Bearer <secret>`.
 * Pure : le secret attendu est passe en parametre (testable sans variable d'env).
 */
export function verifierAcces(entete: string | null, attendu: string | null): VerdictAcces {
  if (!attendu || attendu.length < LONGUEUR_SECRET_MIN) {
    return { ok: false, statut: 503, raison: 'Guichet non configuré.' }
  }
  const prefixe = 'Bearer '
  if (!entete || !entete.startsWith(prefixe)) {
    return { ok: false, statut: 401, raison: 'Non autorisé.' }
  }
  const recu = entete.slice(prefixe.length).trim()
  // Hachage des deux cotes : `timingSafeEqual` exige deux tampons de MEME
  // longueur, et comparer les longueurs d'abord dirait la longueur du secret.
  const a = createHash('sha256').update(recu).digest()
  const b = createHash('sha256').update(attendu).digest()
  if (!timingSafeEqual(a, b)) {
    return { ok: false, statut: 401, raison: 'Non autorisé.' }
  }
  return { ok: true }
}
