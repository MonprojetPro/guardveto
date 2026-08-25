// ============================================================
// GUARDVETO — Ce que Filou couvre du produit, et ce qu'il ne couvre pas
// ============================================================
// POURQUOI CE FICHIER EXISTE — exigence de MiKL, le 2026-08-25 :
//
//   « Je veux absolument que ce soit systématiquement fait. Dès qu'une
//    fonctionnalité est ajoutée ou retirée, quoi que ce soit qui concerne
//    Filou, je veux qu'il soit automatiquement configuré pour. Ça devrait
//    déjà être le cas depuis le début, et je m'aperçois que non. »
//
// Il a raison sur les deux points. Le secrétariat et l'assistance ont été
// livrés le matin ; Filou ne l'a su que le soir, parce que MiKL a demandé de
// vérifier. Et le symptôme n'était pas « il ne sait pas faire » : à « qui a
// accès au planning ? », il répondait la liste des vétérinaires, sans le
// secrétariat et SANS QUE RIEN NE SIGNALE L'ABSENCE.
//
// ── POURQUOI UNE CONSIGNE NE SUFFIT PAS ─────────────────────────────────────
//
// « Penser à mettre Filou à jour » est une consigne, et une consigne
// s'oublie — la preuve, elle l'a été depuis le début. Ce fichier ne demande
// donc à personne de penser : il fait ÉCHOUER le test tant qu'une capacité
// nouvelle du produit n'a pas été confrontée à Filou.
//
// Ce qu'il force n'est pas la COUVERTURE — obliger Filou à tout savoir faire
// bloquerait la moindre livraison. Ce qu'il force est la DÉCISION : pour
// chaque capacité, quelqu'un a dû écrire ce que Filou en fait. Trois réponses
// sont admises, et une seule est interdite : le silence.
//
//   `outil`  — Filou sait le faire, voici l'outil.
//   `manque` — capacité réelle que Filou ne couvre pas ENCORE. Assumé, daté,
//              visible. C'est la liste de travail de l'audit B-007.
//   `hors`   — Filou n'a rien à y faire, et voici pourquoi.
//
// ── COMMENT ON S'EN SERT ────────────────────────────────────────────────────
//
// On n'ouvre pas ce fichier « pour le tenir à jour » : c'est le test qui vous
// y envoie, le jour où vous ajoutez une action serveur. Il vous dira laquelle
// manque, et vous écrirez une ligne. Trente secondes, au moment exact où l'on
// a la réponse en tête — au lieu de trois semaines plus tard, quand plus
// personne ne sait si l'oubli était volontaire.
// ============================================================

/** Ce qu'on a décidé pour une capacité du produit. */
export type Couverture =
  /** Filou sait le faire : le nom de l'outil, tel qu'il est enregistré. */
  | { outil: string }
  /** Filou ne le couvre pas encore. La raison dit ce qui manquerait. */
  | { manque: string }
  /** Hors de son périmètre, définitivement. La raison dit pourquoi. */
  | { hors: string }

/**
 * Chaque action serveur du produit, et ce que Filou en fait.
 *
 * La clé est `<dossier sous src/app, sans parenthèses>#<nom de la fonction>` —
 * c'est exactement ce que le test recompose depuis les sources, donc rien à
 * deviner : en cas d'écart, il affiche la clé attendue.
 */
export const COUVERTURE_FILOU: Record<string, Couverture> = {
  // ── L'ÉQUIPE ────────────────────────────────────────────────────────────
  'protected/admin/veterinaires#createVeterinaire': {
    manque:
      'Créer une fiche vétérinaire depuis la conversation. Geste rare (une arrivée dans l’équipe) et lourd de conséquences : couleur, statut, étiquettes, place dans la rotation.',
  },
  'protected/admin/veterinaires#updateVeterinaire': { outil: 'modifier_veterinaire' },
  'protected/admin/veterinaires#toggleVeterinaireActif': { outil: 'modifier_veterinaire' },
  // Comblé le 25/08, le jour même où le registre a rendu l'écart visible :
  // Filou savait inviter le secrétariat et pas l'équipe, sans qu'aucune raison
  // le justifie. C'est le rendement attendu de ce fichier.
  'protected/admin/veterinaires#inviterVeterinaire': { outil: 'inviter_veterinaire' },

  // ── LE SECRÉTARIAT (B-017) ──────────────────────────────────────────────
  'v2/equipe/secretariat-actions#creerSecretaire': { outil: 'creer_acces_secretariat' },
  'v2/equipe/secretariat-actions#modifierSecretaire': {
    manque: 'Renommer un accès ou changer son adresse. Se fait en deux clics sur l’écran Équipe.',
  },
  'v2/equipe/secretariat-actions#inviterSecretaire': { outil: 'inviter_acces_secretariat' },
  'v2/equipe/secretariat-actions#supprimerSecretaire': { outil: 'supprimer_acces_secretariat' },
  'v2/equipe/secretariat-actions#basculerSecretaireActif': {
    manque:
      'Retirer un accès temporairement. Filou sait le supprimer définitivement ; l’extinction lui manque, et c’est justement le geste réversible.',
  },

  // ── LES CONGÉS ET LES ABSENCES ──────────────────────────────────────────
  'protected/conges#createConge': { outil: 'poser_conge' },
  'protected/conges#updateConge': {
    manque: 'Déplacer un congé déjà posé. Aujourd’hui il faut le supprimer et le reposer.',
  },
  'protected/conges#deleteConge': { outil: 'supprimer_conge' },
  'protected/conges#validerConge': { outil: 'valider_conge' },
  'protected/conges#refuserConge': { outil: 'refuser_conge' },

  // ── LES ÉCHANGES DE GARDE ───────────────────────────────────────────────
  'protected/echanges#proposerEchange': { outil: 'proposer_echange' },
  'protected/echanges#accepterEchange': { outil: 'accepter_echange' },
  'protected/echanges#refuserEchange': { outil: 'refuser_echange' },
  'protected/echanges#annulerEchange': { outil: 'annuler_echange' },
  'protected/echanges#validerEchangeAdmin': { outil: 'valider_echange_admin' },
  'protected/echanges#refuserEchangeAdmin': { outil: 'refuser_echange_admin' },
  'protected/echanges#previsualiserValidationEchange': {
    hors: 'Aperçu interne de l’écran d’échanges, appelé avant la validation. Ce n’est pas un geste, c’est un calcul intermédiaire.',
  },

  // ── LES PLANNINGS ───────────────────────────────────────────────────────
  'protected/admin/periodes#creerPeriode': { outil: 'creer_periode' },
  'protected/admin/periodes#setProfilPeriode': { outil: 'regler_periode' },
  'protected/admin/periodes#setEffectifPeriode': { outil: 'regler_periode' },
  'protected/admin/periodes#supprimerPeriode': {
    manque:
      'Supprimer un planning. Volontairement absent pour l’instant : c’est le geste le plus destructeur du produit, et il passe par une confirmation d’écran qui montre ce qu’on efface.',
  },
  'protected/admin/periodes#depublierPeriode': {
    manque:
      'Retirer un planning déjà diffusé. Même raison : l’écran montre l’impact (agenda, e-mails) avant de laisser faire.',
  },
  'protected/admin/periodes#bilanRetraitPlanning': {
    hors: 'Calcul d’impact affiché par la modale de retrait. Pas un geste.',
  },

  // ── LES RÈGLES ──────────────────────────────────────────────────────────
  'protected/regles#upsertRegle': { outil: 'creer_regle' },
  'protected/regles#setRegleActif': { outil: 'agir_sur_regles' },
  'protected/regles#mettreEnPauseRegle': { outil: 'agir_sur_regles' },
  'protected/regles#assouplirRegle': { outil: 'agir_sur_regles' },
  'protected/regles#deleteRegle': { outil: 'agir_sur_regles' },
  'protected/regles#proposerRegleDepuisTexte': {
    hors: 'C’est le moteur de rédaction que Filou utilise lui-même pour fabriquer une règle depuis une phrase. Lui donner comme outil serait le faire s’appeler.',
  },
  'protected/regles#verifierRegle': {
    hors: 'Contrôle interne appelé pendant la rédaction d’une règle, avant de la proposer.',
  },
  'protected/regles#appliquerActionRegles': {
    hors: 'Point d’exécution commun des propositions de Filou, après le clic humain. C’est le tuyau, pas un geste.',
  },
  'protected/regles#upsertCompositionRegle': { outil: 'creer_regle' },
  'protected/regles#upsertRoleInterditRegle': { outil: 'creer_regle' },
  'protected/regles#setStructureRegle': { outil: 'creer_regle' },
  'protected/regles#setEquiteImportance': { outil: 'regler_equite' },
  'protected/regles#setCohorteEquite': { outil: 'regler_equite' },
  'protected/regles#deleteCohorteEquite': { outil: 'regler_equite' },
  'protected/regles#setRoleAvantageFinancier': { outil: 'regler_equite' },
  'protected/regles#poserEtiquetteSurVetos': { outil: 'modifier_veterinaire' },
  'protected/regles#retirerEtiquetteDeVetos': { outil: 'modifier_veterinaire' },

  // ── LA STRUCTURE DES GARDES ─────────────────────────────────────────────
  'protected/admin/structure#creerCreneauSurMesure': { outil: 'creer_creneau_sur_mesure' },
  'protected/admin/structure#modifierCreneau': { outil: 'agir_sur_creneau' },
  'protected/admin/structure#setCreneauActif': { outil: 'agir_sur_creneau' },
  'protected/admin/structure#supprimerCreneauSurMesure': { outil: 'agir_sur_creneau' },
  'protected/admin/structure#setHorairesProfilCreneau': { outil: 'regler_horaires_creneau' },
  'protected/admin/structure#setAffinagePeriodeType': { outil: 'regler_vetos_sur_periode_type' },
  'protected/admin/structure#creerProfil': { outil: 'creer_profil_planning' },
  'protected/admin/structure#creerProfilComplet': { outil: 'creer_profil_planning' },
  'protected/admin/structure#renommerProfil': { outil: 'creer_profil_planning' },
  'protected/admin/structure#setProfilMeta': { outil: 'creer_profil_planning' },
  'protected/admin/structure#supprimerProfil': { outil: 'supprimer_profil_planning' },
  'protected/admin/structure#creerRelationCreneau': { outil: 'creer_relation_creneaux' },
  'protected/admin/structure#setRelationActive': { outil: 'agir_sur_relation' },
  'protected/admin/structure#supprimerRelation': { outil: 'agir_sur_relation' },
  'protected/admin/structure#proposerProfilDepuisTexte': {
    hors: 'Moteur de rédaction utilisé par Filou lui-même, comme pour les règles.',
  },
  'protected/admin/structure#proposerRelationDepuisTexte': {
    hors: 'Moteur de rédaction utilisé par Filou lui-même.',
  },
  'protected/admin/structure#configurerAdresseCabinet': { outil: 'configurer_adresse_cabinet' },
  'protected/admin/structure#configurerPartagesCabinet': { outil: 'configurer_partages_cabinet' },

  // ── LES DÉPANNAGES ──────────────────────────────────────────────────────
  'protected/admin/depannages#changerStatutCompensation': { outil: 'marquer_compensation' },

  // ── L'ASSISTANCE (B-016) ────────────────────────────────────────────────
  'v2/support#deposerDemandeSupport': {
    hors: 'Signaler un défaut de GuardVeto passe par l’onglet Assistance, avec capture d’écran et contexte technique. Filou y ORIENTE (son prompt le dit) mais ne dépose pas : une demande écrite par un intermédiaire perd ce qui la rend utile — les mots de la personne et sa capture.',
  },
  'protected/assistance#signalerLimite': {
    hors: 'Trace interne posée quand Filou bute sur une limite. Il l’alimente, il ne l’appelle pas.',
  },

  // ── LES RÉGLAGES ET LE COMPTE ───────────────────────────────────────────
  'v2/reglages#envoyerEmailDeTest': {
    manque:
      'Envoyer un e-mail d’essai. Utile en dépannage (« mes vétos ne reçoivent rien »), et Filou pourrait le proposer au lieu de décrire où cliquer.',
  },
  'protected/preferences#setColonnesCompteurs': {
    hors: 'Préférence d’affichage personnelle, sans effet sur le cabinet.',
  },
  'login#login': { hors: 'Connexion. Filou ne parle qu’à quelqu’un de déjà connecté.' },
  'login#logout': { hors: 'Déconnexion.' },
  'login#resetPassword': { hors: 'Réinitialisation de mot de passe, hors session.' },

  // ── FILOU LUI-MÊME ET SES BANCS D'ESSAI ─────────────────────────────────
  'protected/filou#parlerAFilou': { hors: 'C’est Filou. Il ne s’appelle pas lui-même.' },
  'protected/filou#appliquerActionFilou': {
    hors: 'Exécution d’une proposition après le clic humain — le tuyau, pas un geste.',
  },
  // ── L'IMPORT DE PLANNING — éteint volontairement ────────────────────────
  // Le code est intact derrière `IMPORT_PLANNING_ACTIF` : décision produit de
  // MiKL du 2026-08-18, la reprise d'historique devient une prestation payante.
  // Ces deux actions restent donc dans le dépôt sans être atteignables. Filou
  // n'y touche pas — lui donner l'outil rouvrirait par la conversation une
  // porte fermée à l'écran, ce qui est précisément le contournement que ce
  // projet traque.
  'protected/filou/import-actions#enregistrerPlanningImporte': {
    hors: 'Import de planning éteint depuis le 2026-08-18 (prestation payante). Ne pas rouvrir par la conversation une porte fermée à l’écran.',
  },
  'protected/filou/import-actions#supprimerPlanningImporte': {
    hors: 'Même chantier éteint que ci-dessus.',
  },

  'protected/admin/banc-ia#lancerBanc': { hors: 'Outil de développement interne.' },
  'protected/admin/banc-ia#lancerRecetteFilou': { hors: 'Outil de développement interne.' },
  'protected/admin/banc-ia#lancerControleCoherence': { hors: 'Outil de développement interne.' },
}

/**
 * Les capacités du produit que Filou ne couvre pas encore, avec leur raison.
 *
 * Ce n'est pas une dette honteuse : c'est la liste de travail de l'audit
 * B-007, tenue à jour par construction plutôt que par relecture. Elle sert à
 * répondre en une seconde à « qu'est-ce que Filou ne sait pas faire ? ».
 */
export function trousDeCouverture(): Array<{ capacite: string; raison: string }> {
  return Object.entries(COUVERTURE_FILOU)
    .filter((e): e is [string, { manque: string }] => 'manque' in e[1])
    .map(([capacite, c]) => ({ capacite, raison: c.manque }))
}
