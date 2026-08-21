// ============================================================
// GUARDVETO — Ce qu'un échec d'envoi VEUT DIRE
// ============================================================
// Même principe que `lib/regles/refus.ts`, appliqué aux e-mails : le serveur
// d'envoi répond en JSON HTTP, et ce JSON n'a rien à faire dans un écran de
// réglages. Ce fichier ne connaît ni React ni Supabase — c'est de la
// traduction de texte, donc c'est testable et c'est importable des deux côtés
// (l'action serveur pour formuler son refus, le composant pour le journal).
//
// L'INCIDENT QUI A RENDU CE FICHIER NÉCESSAIRE — audit du 2026-08-14
//
// Le journal des e-mails affichait la réponse brute de Brevo, telle quelle :
//
//   Brevo HTTP 401: {"message":"We have detected you are using an unrecognised
//   IP address 52.54.57.16. If you performed this action make sure to add the
//   new IP address in this link: https://app.brevo.com/security/authorised_ips",
//   "code":"unauthorized"}
//
// Trois lignes de JSON avec une URL de dashboard au milieu d'un tableau de
// gardes — illisible, et surtout : ça ne dit pas QUOI FAIRE. Or c'était la
// panne la plus grave du moment (plus aucun e-mail ne partait depuis 11 jours)
// et personne ne l'avait vue.
//
// RÈGLE : on traduit ce qu'on RECONNAÎT, on tronque ce qu'on ne reconnaît pas.
// Jamais « Une erreur est survenue » — un message inconnu reste plus utile que
// son effacement. On dégrade vers « moins riche », jamais vers « invisible ».
// ============================================================

/** Longueur au-delà de laquelle un message inconnu est coupé à l'affichage. */
const COUPE = 120

const MOTIFS: Array<{ quand: RegExp; alors: string }> = [
  {
    // Le cas du 2026-08-03 : Brevo restreint les IP autorisées, et Vercel n'a
    // pas d'IP de sortie fixe en offre standard — la restriction ne peut donc
    // pas être « réglée » par une liste, il faut la lever.
    quand: /unrecognised IP address|unauthorised IP|authorised_ips/i,
    alors:
      "L’adresse du serveur n’est pas autorisée chez l’expéditeur (Brevo) — la restriction d’adresses IP est à lever dans la sécurité du compte.",
  },
  {
    quand: /\b401\b|unauthorized|invalid.*api.?key/i,
    alors: "L’expéditeur a refusé la connexion — la clé d’envoi est invalide ou expirée.",
  },
  {
    quand: /\b403\b|sender.*not.*valid|unknown sender/i,
    alors: "L’expéditeur a refusé l’envoi — l’adresse ou le domaine d’envoi n’est pas validé chez lui.",
  },
  {
    quand: /\b429\b|rate.?limit|too many requests/i,
    alors: "Trop d’envois d’un coup — l’expéditeur a mis la suite en attente. Réessaie dans quelques minutes.",
  },
  {
    quand: /invalid.*(email|recipient)|recipient.*invalid|does not exist/i,
    alors: "L’adresse du destinataire a été refusée — vérifie l’e-mail de la fiche.",
  },
  {
    // Nos propres refus, avant même l'appel réseau (cf. lib/brevo.ts).
    quand: /Config email manquante/i,
    alors: "La clé d’envoi n’est pas configurée sur le serveur (BREVO_API_KEY).",
  },
  {
    // ⚠️ Ne renvoie plus vers un champ de l'écran : l'adresse d'expédition en a
    // été retirée le 2026-08-21 (elle exige une autorisation de domaine chez
    // Brevo, hors de portée du cabinet). C'est donc à l'assistance de la poser.
    quand: /Expéditeur email manquant/i,
    alors:
      "Aucune adresse d’expéditeur n’est configurée, ni pour le cabinet ni au niveau général — préviens l’assistance, ce réglage est de son ressort.",
  },
]

/**
 * Traduit une réponse d'échec d'envoi en une phrase qui dit quoi faire.
 *
 * Un motif inconnu retombe sur sa première ligne, tronquée : on préfère un
 * fragment technique lisible à un « une erreur est survenue » qui n'apprend
 * rien à personne.
 */
export function raisonEchec(brut: string): string {
  const t = (brut ?? '').trim()
  if (!t) return "L’envoi a échoué sans que le serveur en donne la raison."

  for (const { quand, alors } of MOTIFS) {
    if (quand.test(t)) return alors
  }

  const premiereLigne = t.split('\n')[0].trim()
  return premiereLigne.length > COUPE ? `${premiereLigne.slice(0, COUPE - 1)}…` : premiereLigne
}
