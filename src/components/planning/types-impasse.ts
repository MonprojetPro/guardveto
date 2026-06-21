// ============================================================
// GUARDVETO — Forme client d'un créneau non couvert (impasse)
// ============================================================
// Forme telle qu'elle arrive sur le fil JSON depuis /api/generate(/replay).
// On ne réutilise PAS le type moteur (JourNonCouvert de solver.ts) côté client
// car ses champs `type`/`role` sont des unions strictes, alors que le JSON
// désérialisé livre des `string` simples. Ce type décrit le contrat réseau.
// ============================================================

export interface JourNonCouvert {
  date: string
  type: string
  role: string
  contrainteBloquante?: string
}
