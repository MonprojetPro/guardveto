// ============================================================
// GUARDVETO — Retirer le code technique d'un message de règle
// ============================================================
// Les messages du moteur portent leur code en tête : « R16 : Manon est en congé
// du 14 au 27 septembre ». Utile dans les logs, illisible à l'écran — MiKL, le
// 26/08, devant le rapport d'impasse : « ouah le truc horrible !!!!! ».
//
// Déjà consigné le 19/08 : un bandeau est un SIGNAL, pas un rapport — et jamais
// un code machine sous les yeux de l'utilisateur.
//
// SOURCE UNIQUE. Deux écrans en avaient chacun leur copie (`GardeDetailModal`,
// `CriseModal`), toutes deux limitées à `/^R\d+ : /` — elles laissaient donc
// passer `ESPACEMENT : `, `FREQ_WE : ` et `R3/R5 : `, c'est-à-dire une bonne
// partie des refus réellement rencontrés. Une troisième copie aurait divergé de
// la même façon.
// ============================================================

/**
 * Retire le préfixe technique d'un message de règle.
 *
 * Reconnaît tout code en capitales, chiffres, `_` ou `/` suivi de « : » —
 * `R16 : `, `R3/R5 : `, `ESPACEMENT : `, `FREQ_WE : `. Un texte sans préfixe
 * ressort intact, et la première lettre est remise en majuscule (le message
 * commence par le prénom la plupart du temps, mais pas toujours).
 */
export function sansCodeTechnique(texte?: string | null): string {
  const brut = (texte ?? '').trim()
  const sansCode = brut.replace(/^[A-Z0-9_/]+\s*:\s*/, '')
  if (sansCode.length === 0) return ''
  return sansCode.charAt(0).toUpperCase() + sansCode.slice(1)
}
