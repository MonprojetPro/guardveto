'use client'

// ============================================================
// GUARDVETO — Réglages refondus : la section « Le cabinet » (B-202)
// ============================================================
// L'adresse (qui DÉDUIT la zone de vacances scolaires et la région des
// fériés) et le nom d'expéditeur des e-mails, avec l'essai d'envoi.
//
// Mêmes actions serveur que l'ancien écran (retiré par B-202b) : elles portent la garde admin,
// les RPC et la dérivation de zone, qui CONSERVE la zone existante quand le
// code postal ne permet pas de conclure.
//
// 🔴 UN « ENREGISTRER » PAR SUJET. `configurerPartagesCabinet` réécrit l'agenda
//    ET l'expéditeur d'un coup : on lui passe la dernière valeur ENREGISTRÉE de
//    l'agenda, jamais une saisie en cours ailleurs (`partagesAEnvoyer`).
// ============================================================

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import {
  configurerAdresseCabinet,
  configurerPartagesCabinet,
} from '@/app/(protected)/admin/structure/actions'
import { envoyerEmailDeTest } from '@/app/(v2)/reglages/actions'
import { useErreurBloquante } from '@/components/v2/regles/ErreurBloquante'
import { ZONE_LABEL, libelleZone } from '@/lib/reglages/libelles'
import { partagesAEnvoyer, type Partages } from '@/lib/reglages/coquille'
import { Bloc, Pastille, Roue } from './ReglagesCommun'

export interface DonneesSectionCabinet {
  adresse: string
  codePostal: string
  ville: string
  zoneScolaire: string
  regionFeries: string
  envoiConfigure: boolean
  /** L'adresse de l'admin connectée : c'est elle qui reçoit l'essai. */
  emailAdmin: string | null
}

interface Props extends DonneesSectionCabinet {
  /** La dernière valeur ENREGISTRÉE des trois champs partagés (agenda + expéditeur). */
  partages: Partages
  /** Appelé quand l'expéditeur a été enregistré : la section Connexions repart de cette valeur. */
  onPartagesEnregistres: (p: Partages) => void
}

export function ReglagesSectionCabinet({
  adresse: adresseInit, codePostal: cpInit, ville: villeInit, zoneScolaire, regionFeries,
  envoiConfigure, emailAdmin, partages, onPartagesEnregistres,
}: Props) {
  const [enCours, demarrer] = useTransition()
  const { ouvrirErreur, dialogueErreur } = useErreurBloquante()

  const [adresse, setAdresse] = useState(adresseInit)
  const [codePostal, setCodePostal] = useState(cpInit)
  const [ville, setVille] = useState(villeInit)
  const [zone, setZone] = useState(libelleZone(zoneScolaire, regionFeries))

  const [expediteur, setExpediteur] = useState(partages.brevoFromName)
  const [essaiEnCours, setEssaiEnCours] = useState(false)

  const enregistrerAdresse = () => {
    demarrer(async () => {
      const res = await configurerAdresseCabinet({
        adresse: adresse.trim(),
        codePostal: codePostal.trim(),
        ville: ville.trim(),
      })
      if ('error' in res && res.error) {
        toast.error(res.error)
        return
      }
      const derive = 'derive' in res ? res.derive : null
      if (derive?.zone) {
        setZone(libelleZone(derive.zone, derive.region ?? regionFeries))
        toast.success(`Adresse enregistrée · ${ZONE_LABEL[derive.zone] ?? derive.zone}`)
      } else {
        toast.success('Adresse enregistrée. Zone non déduite du code postal : l’ancienne est conservée.')
      }
    })
  }

  const enregistrerExpediteur = () => {
    const envoi = partagesAEnvoyer(partages, 'expediteur', expediteur)
    demarrer(async () => {
      const res = await configurerPartagesCabinet(envoi)
      if ('error' in res && res.error) {
        toast.error(res.error)
        return
      }
      onPartagesEnregistres(envoi)
      toast.success('Nom d’expéditeur enregistré')
    })
  }

  // Le destinataire n'est pas saisissable : c'est l'adresse de l'admin
  // connectée, lue en base par l'action. Un champ libre serait un relais de spam.
  const envoyerEssai = async () => {
    setEssaiEnCours(true)
    try {
      const res = await envoyerEmailDeTest()
      if ('error' in res) {
        // Un échec d'envoi n'est pas une vignette qui s'efface : c'est le
        // moment où l'on découvre que la tuyauterie est bouchée.
        ouvrirErreur(res.error, {
          titre: 'L’e-mail d’essai n’est pas parti',
          explication:
            'Rien n’est cassé dans GuardVeto : c’est le service d’envoi qui refuse. Tant que cela dure, les plannings publiés et les réponses aux congés ne partiront pas non plus.',
        })
        return
      }
      toast.success(`E-mail d’essai envoyé à ${res.destinataire}`)
    } catch {
      ouvrirErreur('L’appel n’a pas abouti. Réessayez dans un instant.', {
        titre: 'L’essai n’a pas pu être lancé',
      })
    } finally {
      setEssaiEnCours(false)
    }
  }

  return (
    <div className="rg-panneau">
      <Bloc
        titre="Adresse du cabinet"
        etat={zone ? <Pastille ton="ok">Renseignée</Pastille> : <Pastille ton="warn">À renseigner</Pastille>}
      >
        <div className="rg-champ">
          <label htmlFor="rg-adr">Adresse</label>
          <input id="rg-adr" type="text" value={adresse} onChange={(e) => setAdresse(e.target.value)}
            placeholder="12 rue des Tilleuls" autoComplete="street-address" />
        </div>
        <div className="rg-duo">
          <div className="rg-champ">
            <label htmlFor="rg-cp">Code postal</label>
            <input id="rg-cp" type="text" inputMode="numeric" value={codePostal}
              onChange={(e) => setCodePostal(e.target.value)} placeholder="03200" autoComplete="postal-code" />
          </div>
          <div className="rg-champ">
            <label htmlFor="rg-ville">Ville</label>
            <input id="rg-ville" type="text" value={ville} onChange={(e) => setVille(e.target.value)}
              placeholder="Vichy" autoComplete="address-level2" />
          </div>
        </div>
        <div className="rg-zone">
          <span>Zone déduite du code postal (vacances scolaires, jours fériés) :</span>
          {zone ? <Pastille ton="ok">{zone}</Pastille> : <Pastille ton="warn">Zone à déduire</Pastille>}
        </div>
        <div className="rg-actions">
          <button type="button" className="btn btn-valider" onClick={enregistrerAdresse} disabled={enCours}>
            Enregistrer et déduire la zone
          </button>
        </div>
      </Bloc>

      <Bloc
        titre="E-mails aux vétérinaires"
        etat={envoiConfigure ? <Pastille ton="ok">Actif</Pastille> : <Pastille ton="warn">À configurer</Pastille>}
      >
        {/* L'ADRESSE d'envoi n'est pas saisissable ici (retirée le 21/08) :
            Brevo refuse d'expédier depuis un domaine qu'il ne connaît pas, et
            un cabinet qui la remplissait seul coupait ses propres e-mails. */}
        <div className="rg-champ">
          <label htmlFor="rg-exp">Nom affiché comme expéditeur</label>
          <input id="rg-exp" type="text" value={expediteur} onChange={(e) => setExpediteur(e.target.value)}
            placeholder="GuardVeto" />
        </div>
        <p className="rg-aide">Laissé vide, les e-mails arrivent au nom de « GuardVeto ».</p>
        <div className="rg-actions">
          <button type="button" className="btn btn-valider" onClick={enregistrerExpediteur} disabled={enCours}>
            Enregistrer
          </button>
        </div>

        <div className="rg-sous-tete">Essai d’envoi</div>
        <p className="rg-aide">
          Un vrai e-mail est envoyé {emailAdmin ? <>à {emailAdmin}</> : 'à votre adresse'}. S’il vous parvient,
          les plannings et les réponses aux congés partiront aussi.
        </p>
        <div className="rg-actions">
          <button type="button" className="btn btn-outline" onClick={envoyerEssai} disabled={essaiEnCours}>
            {essaiEnCours ? <Roue /> : <Send className="rg-ico sm" aria-hidden="true" />}
            {essaiEnCours ? 'Envoi…' : 'Vérifier que les e-mails partent'}
          </button>
        </div>
      </Bloc>

      {dialogueErreur}
    </div>
  )
}
