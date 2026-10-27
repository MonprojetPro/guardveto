// ============================================================
// GUARDVETO V2 — ancienne adresse de l'écran « Journée »
// ============================================================
// B-175 (27/10) : MiKL — « l'onglet journée devrait appartenir à l'onglet
// organisation ». Les tranches horaires et les semaines types vivent désormais
// dans Organisation › Journées. Cette adresse ne fait plus que renvoyer là-bas,
// pour qu'aucun lien ancien (favori, e-mail, historique du navigateur) ne
// tombe dans le vide.
//
// Le module et le rôle ne sont plus vérifiés ICI : la page d'arrivée le fait
// (sans le module, elle retombe sur la partie Gardes). Les actions serveur de
// ce dossier gardent leur propre porte (`porteJournee` / `porteTrame`).
// ============================================================

import { redirect } from 'next/navigation'

export default function JourneePage() {
  redirect('/regles?partie=journees')
}
