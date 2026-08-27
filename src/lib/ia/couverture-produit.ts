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
  'protected/admin/veterinaires#createVeterinaire': { outil: 'creer_veterinaire' },
  'protected/admin/veterinaires#updateVeterinaire': { outil: 'modifier_veterinaire' },
  'protected/admin/veterinaires#toggleVeterinaireActif': { outil: 'modifier_veterinaire' },
  // Comblé le 25/08, le jour même où le registre a rendu l'écart visible :
  // Filou savait inviter le secrétariat et pas l'équipe, sans qu'aucune raison
  // le justifie. C'est le rendement attendu de ce fichier.
  'protected/admin/veterinaires#inviterVeterinaire': { outil: 'inviter_veterinaire' },

  // ── LE SECRÉTARIAT (B-017) ──────────────────────────────────────────────
  'v2/equipe/secretariat-actions#creerSecretaire': { outil: 'creer_acces_secretariat' },
  'v2/equipe/secretariat-actions#modifierSecretaire': { outil: 'modifier_acces_secretariat' },
  'v2/equipe/secretariat-actions#inviterSecretaire': { outil: 'inviter_acces_secretariat' },
  'v2/equipe/secretariat-actions#supprimerSecretaire': { outil: 'supprimer_acces_secretariat' },
  'v2/equipe/secretariat-actions#basculerSecretaireActif': { outil: 'basculer_acces_secretariat' },

  // ── LES CONGÉS ET LES ABSENCES ──────────────────────────────────────────
  'protected/conges#createConge': { outil: 'poser_conge' },
  'protected/conges#updateConge': { outil: 'deplacer_conge' },
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
  // Les deux gestes destructeurs (supprimer, retirer la diffusion) ont été
  // ouverts à Filou le 2026-08-25. Ce qui l'a permis : leur bilan d'impact
  // existe déjà comme fonction (`bilanRetraitPlanning`), donc la proposition
  // affiche EXACTEMENT les chiffres de la modale — on ne remplace pas un
  // garde-fou par un bouton nu, on lui donne le même contenu dans l'autre
  // chemin. La seule sécurité non transposable, recopier le nom du planning,
  // fait refuser l'outil et renvoie à l'écran.
  'protected/admin/periodes#creerPeriode': { outil: 'creer_periode' },
  'protected/admin/periodes#setProfilPeriode': { outil: 'regler_periode' },
  'protected/admin/periodes#setEffectifPeriode': { outil: 'regler_periode' },
  'protected/admin/periodes#supprimerPeriode': { outil: 'supprimer_planning' },
  'protected/admin/periodes#depublierPeriode': { outil: 'retirer_diffusion_planning' },
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
  // `protected/assistance#signalerLimite` a été SUPPRIMÉE le 2026-08-26 (B-048).
  // Elle affichait « L'équipe GuardVeto a reçu ta situation » sans lire le retour
  // de `sendBrevoEmail` — donc sans qu'aucun envoi soit prouvé, et sans trace en
  // base. Le seul chemin de signalement est désormais l'onglet Assistance
  // (`v2/support#deposerDemandeSupport`, juste au-dessus), qui journalise.

  // ── LES RÉGLAGES ET LE COMPTE ───────────────────────────────────────────
  'v2/reglages#envoyerEmailDeTest': { outil: 'envoyer_email_de_test' },
  'protected/preferences#setColonnesCompteurs': {
    hors: 'Préférence d’affichage personnelle, sans effet sur le cabinet.',
  },
  'login#login': { hors: 'Connexion. Filou ne parle qu’à quelqu’un de déjà connecté.' },
  'login#logout': { hors: 'Déconnexion.' },
  'login#changerDeCompte': {
    hors: 'Déconnexion pour revenir sur le même lien avec le bon compte. Geste de session, pas de métier.',
  },
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

  // ══════════════════════════════════════════════════════════════════════════
  // LES ROUTES API — entrées au registre le 2026-08-26 (audit B-007, volet 2)
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Elles y manquaient toutes. Le recensement ne lisait que les `actions.ts`,
  // et personne ne s'en apercevait : le test passait au vert en ayant regardé
  // une partie du produit seulement. Or deux des gestes les plus courants du
  // cabinet vivent ici — se porter volontaire pour dépanner, et modifier une
  // garde à la main. Ce sont exactement deux des six trous que l'audit B-007
  // avait relevés « à combler », et on comprend maintenant pourquoi ils étaient
  // passés à travers : ils n'étaient pas oubliés, ils étaient invisibles.
  //
  // C'est la leçon de ce projet une fois de plus : un contrôle qui ne dit pas
  // ce qu'il ne regarde pas se lit comme un contrôle complet.

  // ── Ce que Filou sait déjà faire, par le même chemin que l'écran ──────────
  'api/absences#POST': { outil: 'declarer_absence' },
  'api/absences/[id]/appel-volontaires#POST': { outil: 'appeler_volontaires' },
  'api/absences/[id]/reparer#POST': { outil: 'reparer_absence' },
  'api/publish#POST': { outil: 'publier_periode' },
  'api/generate/pre-vol#GET': { outil: 'verifier_pre_vol_periode' },

  // ── LES MANQUES ASSUMÉS — la liste de travail du volet 2 ─────────────────
  'api/absences/[id]/volontaire#POST': {
    manque:
      'Se porter volontaire pour dépanner un collègue. C’est le geste le plus courant qu’un vétérinaire fasse depuis son téléphone, et le seul de ce niveau que Filou ne sache pas déclencher : il peut lire l’appel aux volontaires, expliquer qui manque, et doit ensuite dire « va sur l’écran ». Un outil d’écriture, avec la double barrière habituelle (proposition puis clic), rendrait le parcours complet.',
  },
  'api/gardes/[id]#PATCH': {
    manque:
      'Modifier l’attribution d’une garde à la main (admin). Filou sait réparer une absence et valider un échange, mais pas la retouche libre — « mets Camille en 1er ce samedi ». C’est le chemin d’écriture le mieux gardé du produit (règles dures, périmètre jour ou bloc, confirmation 409, trace d’audit) : l’outil devra repasser par la route, jamais réimplémenter ces contrôles.',
  },
  'api/export-pdf#GET': {
    manque:
      'Sortir le planning en PDF. Demande naturelle en conversation (« envoie-moi le planning de septembre »), et Filou n’a aujourd’hui aucun moyen de produire un fichier — il ne sait qu’écrire sur le tableau. À traiter le jour où l’on décide comment un fichier revient dans une conversation.',
  },
  'api/generate#POST': {
    manque:
      'Lancer la génération d’un planning. Filou sait créer une période, la régler, faire le pré-vol et publier — tout sauf l’étape du milieu. Écarté jusqu’ici pour une bonne raison (une génération est longue et se suit à l’écran, en cinq temps), mais le trou mérite d’être nommé : le parcours qu’il propose s’interrompt au moment décisif.',
  },
  'api/planning/relecture#POST': {
    hors:
      'C’est Filou LUI-MÊME qui exécute cette route : elle l’appelle pour relire un planning généré. Lui donner un outil pour la déclencher le mettrait en position de se convoquer, et une relecture est une étape du parcours de génération — elle se lance depuis l’écran, elle ne se demande pas en conversation. ⚠️ Mais la QUESTION reste ouverte côté chat : « qu’est-ce que tu penses de ce planning ? » est une demande naturelle, et il n’a aujourd’hui aucun moyen d’y répondre autrement qu’en relançant tout le parcours. À rouvrir si MiKL le constate à l’usage.',
  },
  'api/calendar-sync#POST': {
    manque:
      'Relancer la synchronisation vers l’agenda Google. Geste de dépannage rare mais réel (« les gardes n’apparaissent pas dans l’agenda »), aujourd’hui atteignable seulement depuis l’écran des périodes.',
  },
  'api/bilan#POST': {
    manque:
      'Calculer et enregistrer les bonus/malus de fin de période. Filou LIT les compteurs mais ne sait pas clore la période. Volontairement laissé de côté tant que la clôture n’est pas stabilisée côté produit — mais c’est un manque, pas un hors-périmètre.',
  },

  // ── Hors périmètre, et pourquoi ──────────────────────────────────────────
  'api/cron/lock-gardes#GET': {
    hors: 'Tâche planifiée, déclenchée par Vercel avec son propre secret. Personne ne la « demande » — la donner à Filou serait lui confier une horloge.',
  },
  'api/cron/rappels#GET': { hors: 'Tâche planifiée (rappels du matin), même raison.' },
  'api/cron/sync-calendrier#GET': { hors: 'Tâche planifiée (synchronisation agenda), même raison.' },
  'api/webhooks/brevo#POST': {
    hors: 'Point d’entrée appelé par Brevo pour dire ce qu’un e-mail est devenu. Ce n’est pas un geste du cabinet, c’est une notification entrante.',
  },
  'api/gardes/[id]/disponibilites#GET': {
    hors: 'Calcul de disponibilité affiché par la modale de garde. C’est ce que Filou obtient déjà autrement (règles + planning) ; l’exposer serait un doublon de lecture.',
  },
  'api/generate/replay#POST': {
    hors: 'Test de déterminisme du moteur : rejoue une génération sur son instantané de règles. Outil de diagnostic technique, sans signification pour le cabinet.',
  },
  'api/import/lire#POST': {
    hors: 'Lecture d’un fichier de planning à importer — même chantier éteint que les deux actions d’import ci-dessus (prestation payante depuis le 2026-08-18).',
  },
  'auth/confirm#GET': {
    hors: 'Confirmation d’un lien d’invitation ou de réinitialisation. Se joue hors session, avant que Filou existe pour cette personne.',
  },
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
