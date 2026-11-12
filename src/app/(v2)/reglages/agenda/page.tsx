// ============================================================
// GUARDVETO V2 — Mon agenda : l'ancienne adresse (B-173 → B-202b)
// ============================================================
// Cet écran a vécu ici du 26/10 (B-173, refait par B-181) au 11/11. Depuis la
// refonte de l'onglet Réglages (B-202, bascule du 11/11), l'agenda Google
// personnel se règle dans sa section « Pour moi » (`MonAgendaCorps`).
//
// L'adresse reste, et ne fait plus que renvoyer : un favori ou un onglet resté
// ouvert peut encore y mener (aucun e-mail n'y a jamais pointé, vérifié dans
// l'historique de `src/lib` le 12/11).
//
// `actions.ts` reste aussi : `basculerMonAgenda`, `choisirMonAgenda` et
// `renvoyerInvitationAgenda` sont appelés par `MonAgendaCorps`.
// ============================================================

import { redirect } from 'next/navigation'

export default function MonAgendaPage(): never {
  redirect('/reglages?section=moi')
}
