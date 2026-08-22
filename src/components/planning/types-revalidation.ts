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
  /**
   * D'où vient la violation, quand le validateur regarde aussi ~10 jours en
   * arrière (lookback inter-périodes) : 'anterieure' = les dates en cause
   * appartiennent à la période PRÉCÉDENTE (historique saisi), pas au planning
   * courant qu'on est en train de publier/afficher — ce n'est pas une faute du
   * planning affiché, elle se corrige en déverrouillant l'historique.
   * Absent/'courante' : violation normale du planning en cours.
   *
   * ✅ CONFIRMÉ (Lot 1) : le moteur pose bien `origine: 'anterieure'`, et
   * UNIQUEMENT cette valeur — « courante » n'est jamais écrit, c'est l'absence
   * du champ. Blocs marqués : ESPACEMENT, FREQ_WE, AU_PLUS_N, SUCCESSION,
   * SERIE_MAX, REPOS_SERIE. R3 ne l'est jamais (sa garde fautive est toujours
   * dans la période — cf. commentaire dans `validerPlanning.ts`).
   */
  origine?: 'courante' | 'anterieure'
}
