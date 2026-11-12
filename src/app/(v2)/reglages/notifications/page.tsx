// ============================================================
// GUARDVETO V2 — Mes notifications : l'ancienne adresse (B-134 → B-202b)
// ============================================================
// Cet écran a vécu ici du 26/09 (B-134) au 11/11. Depuis la refonte de
// l'onglet Réglages (B-202, bascule du 11/11), les e-mails que l'on reçoit se
// règlent dans sa section « Pour moi », ouverte aux trois rôles.
//
// L'adresse reste, et ne fait plus que renvoyer : un favori ou un onglet resté
// ouvert peut encore y mener. Aucun e-mail n'y a jamais pointé (vérifié dans
// l'historique de `src/lib` le 12/11). Une adresse qui tombe en 404 ferait
// croire que le réglage a disparu.
//
// `actions.ts` reste aussi : `setReceptionEmail` est l'enregistrement que la
// section « Pour moi » appelle (`useReceptionEmails`).
// ============================================================

import { redirect } from 'next/navigation'

export default function MesNotificationsPage(): never {
  redirect('/reglages?section=moi')
}
