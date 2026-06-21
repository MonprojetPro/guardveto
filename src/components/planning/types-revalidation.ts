// ============================================================
// GUARDVETO — Forme client d'une violation de re-validation
// ============================================================
// Chantier B : re-validation continue du planning PUBLIÉ.
//
// `validerPlanning` (moteur) retourne des `Violation` dont `role` est une
// union stricte ('premier' | 'second'). Au passage par une Server Action
// (sérialisation JSON), on retombe sur des `string` simples. Ce type décrit
// le contrat réseau — il ne réutilise donc pas le type moteur.
// ============================================================

export interface ViolationRevalidation {
  /** Code de la règle violée (R1, R2, …, R16, COUVERTURE, R8/R9…) */
  regle: string
  /** Date ISO yyyy-mm-dd du créneau concerné */
  date: string
  /** Type de créneau (semaine_soir | vendredi_soir | weekend) */
  type: string
  /** Rôle concerné, si pertinent */
  role?: string
  /** Vétérinaire fautif, si identifiable */
  vetId?: string
  /** Détail concret lisible (déjà rédigé en français par le validateur) */
  detail: string
}
