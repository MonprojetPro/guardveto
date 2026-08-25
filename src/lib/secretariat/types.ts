// ============================================================
// GUARDVETO — Ce que répondent les actions du secrétariat
// ============================================================
// Ces types vivent ICI et pas dans `secretariat-actions.ts` : un fichier
// `'use server'` ne peut RIEN exporter d'autre que des fonctions asynchrones.
// Un type réexporté depuis un tel fichier compile, passe les tests, et rend la
// page blanche en production — incident déjà payé sur ce projet, et gardé par
// `tests/lib/use-server-exports.test.ts`.
//
// Les annoter explicitement sert aussi à autre chose : sans annotation,
// TypeScript infère un type d'union où `error` reste `string | undefined`, et
// le `if ('error' in res)` de l'appelant ne suffit plus à le rassurer.
// ============================================================

/** Le résultat d'une action qui réussit ou explique pourquoi elle refuse. */
export type ReponseSecretariat = { error: string } | { success: true }

/** Une invitation rend en plus l'adresse touchée : « envoyée à … » vaut mieux
 *  qu'un « c'est parti » qui ne dit pas où. */
export type ReponseInvitation = { error: string } | { success: true; email: string }
