// ============================================================
// GUARDVETO V2 — Ce qu'on voit quand on atterrit sur un module éteint
// ============================================================
// B-120a ② — reste-à-faire du chantier 1, dû « dans le même lot que le
// premier écran éteignable ». Cet écran-là est arrivé (le planning journée),
// donc cette page arrive avec lui.
//
// ── POURQUOI PAS UN 404, ET POURQUOI PAS UNE REDIRECTION ────────────────────
//
// Un 404 dit « cette page n'existe pas », ce qui est FAUX : elle existe, elle
// n'est pas ouverte pour ce cabinet. Une personne qui lit « page introuvable »
// cherche un lien cassé, prévient l'assistance, et personne ne comprend rien
// avant d'avoir regardé la base.
//
// Une redirection silencieuse vers l'accueil est pire : le clic ne fait
// « rien », et un bouton qui ne fait rien est le défaut n°1 de la liste des
// INTERDITS du KIT COMPLET.
//
// Donc on dit la vérité, en une phrase, avec un chemin de retour. Même esprit
// que « un lien qui quitte un parcours le DÉTRUIT » : on cale, on n'éjecte pas.
//
// ⚠️ CE COMPOSANT NE PROTÈGE RIEN. C'est un message. La porte est fermée par
//    `exigerModule()` côté action et par la RLS côté base.
// ============================================================

import Link from 'next/link'
import { MODULES } from '@/lib/produit/modules'

interface Props {
  /** L'identifiant du module, tel qu'il figure dans `MODULES`. */
  module: string
  /**
   * `true` pour l'administratrice : elle, on peut lui dire quoi faire pour
   * l'obtenir. Un vétérinaire n'a pas à être renvoyé vers une démarche
   * commerciale qui ne le concerne pas.
   */
  estAdmin?: boolean
}

export function ModuleEteint({ module, estAdmin = false }: Props) {
  // Repli sur l'identifiant : un module absent du catalogue est une faute de
  // frappe d'appelant, et afficher « planning-journeee » aide à la trouver.
  // Inventer un nom générique (« ce module ») l'aurait masquée.
  const nom = MODULES[module]?.nom ?? module
  const quoi = MODULES[module]?.description

  return (
    <div className="card module-eteint">
      <div className="card-head">
        <h2>{nom}</h2>
      </div>
      <p className="me-phrase">
        Cette partie de GuardVeto n’est pas activée pour votre cabinet.
      </p>
      {quoi && <p className="me-quoi">{quoi}</p>}
      <p className="me-suite">
        {estAdmin
          ? 'Pour l’ouvrir, contactez MonProjetPro — l’activation est un réglage, elle prend effet immédiatement.'
          : 'Si vous pensez qu’elle devrait l’être, parlez-en à l’administratrice du cabinet.'}
      </p>
      <div className="me-sortie">
        <Link className="btn btn-outline" href="/accueil">
          Revenir à l’accueil
        </Link>
      </div>
    </div>
  )
}
