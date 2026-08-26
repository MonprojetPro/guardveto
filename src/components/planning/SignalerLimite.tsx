'use client'

// ============================================================
// GUARDVETO — « Je ne m'en sors pas » : demander de l'aide (B-048 + B-050)
// ============================================================
// CE QUE CE BOUTON FAISAIT, ET POURQUOI C'ÉTAIT PIRE QUE RIEN
//
// Il ouvrait un champ libre FACULTATIF, envoyait un e-mail à l'éditeur, puis
// affichait « L'équipe GuardVeto a reçu ta situation ». Deux défauts, mesurés
// le 26/08 :
//
//  ① La confirmation était un MENSONGE. `signalerLimite` appelait
//     `sendBrevoEmail` dans un try/catch — or cette fonction ne LÈVE jamais,
//     elle RETOURNE `{ error }` (expéditeur manquant, clé absente, rejet Brevo).
//     La valeur de retour n'était pas lue : « C'est parti » s'affichait dans
//     tous les cas, y compris quand rien ne partait. Aucune trace en base non
//     plus — impossible de savoir après coup. MiKL : « il va où le message ?
//     je n'ai rien reçu comme mail ».
//
//  ② Le message pouvait être VIDE. MiKL : « s'il ne met rien dans le message,
//     comment je sais moi ce qui ne va pas ? ». Un signalement sans un mot ni
//     capture d'écran coûte plus cher qu'il ne rapporte.
//
// CE QU'IL FAIT MAINTENANT : il ORIENTE vers l'onglet Assistance, qui existe
// depuis le 25/08 et fait déjà tout ce qu'il faut — titre et description
// obligatoires, pièces jointes (donc la capture), envoi journalisé dans
// `demandes_support.email_envoye` / `email_erreur`, et statut affiché à l'écran.
//
// C'était d'ailleurs déjà la doctrine écrite du projet, dans la couverture de
// Filou : « Signaler un défaut de GuardVeto passe par l'onglet Assistance, avec
// capture d'écran et contexte technique ». Ce bouton la contredisait.
//
// Le contexte technique n'est pas perdu : il part dans la description
// pré-remplie, sous les yeux de la personne — qui peut le corriger, contrairement
// à un envoi silencieux.
// ============================================================

import Link from 'next/link'
import { LifeBuoy, Camera, PencilLine } from 'lucide-react'

interface Props {
  /** D'où vient le signalement : « génération de planning », « règles »… */
  origine: string
  /** Contexte technique déjà connu de l'écran (période, codes, diagnostic). */
  contexte?: Record<string, unknown>
}

/** Le contexte technique, en texte lisible — pas un JSON brut à l'écran. */
function contexteLisible(contexte?: Record<string, unknown>): string {
  const entrees = Object.entries(contexte ?? {})
  if (entrees.length === 0) return ''
  const lignes = entrees.map(([cle, valeur]) => {
    const v = typeof valeur === 'string' ? valeur : JSON.stringify(valeur)
    return `- ${cle} : ${v}`
  })
  return `\n\n---\nInformations techniques (laissées telles quelles, elles aident au diagnostic) :\n${lignes.join('\n')}`
}

export function SignalerLimite({ origine, contexte }: Props) {
  const titre = `Blocage sur : ${origine}`
  const description =
    `Ce que j'essayais de faire :\n\n` +
    `Ce qui s'est passé :\n\n` +
    contexteLisible(contexte)

  const lien =
    `/support?titre=${encodeURIComponent(titre)}&description=${encodeURIComponent(description)}`

  return (
    <div className="sig-orient">
      <p className="sig-titre">Tu veux qu’on regarde ?</p>
      <p className="sig-sous">
        Ça se passe dans l’onglet <strong>Assistance</strong>. Deux choses le rendent
        vraiment utile&nbsp;:
      </p>
      <ul className="sig-etapes">
        <li>
          <Camera className="sig-ico" aria-hidden />
          <span>
            <strong>Prends une capture d’écran</strong> de ce que tu as sous les yeux, avant
            de quitter cette fenêtre — elle se joint à la demande.
          </span>
        </li>
        <li>
          <PencilLine className="sig-ico" aria-hidden />
          <span>
            <strong>Décris la situation</strong> : ce que tu voulais faire, et ce qui s’est
            passé à la place. Le contexte technique est déjà rempli pour toi.
          </span>
        </li>
      </ul>
      <Link href={lien} className="ppv-btn fort">
        <LifeBuoy className="ppv-ico" aria-hidden />
        Ouvrir l’assistance
      </Link>
    </div>
  )
}
