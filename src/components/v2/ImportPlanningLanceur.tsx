'use client'

// ============================================================
// GUARDVETO V2 — Importer un ancien planning, depuis les Compteurs
// ============================================================
// POURQUOI ICI ET PLUS DANS LA CONVERSATION. Le geste vivait derrière un
// trombone dans la tablette de Filou. Retour de MiKL après l'avoir vu en vrai :
// « on comprend pas à quoi il sert ». Il avait raison — personne ne va chercher
// un compteur dans une conversation. Cette fonction sert à AMORCER LES
// COMPTEURS : sa place est là où on regarde les compteurs.
//
// LE RÉSULTAT S'AFFICHE ICI, sous le bouton qui l'a demandé. C'est tout
// l'intérêt du déplacement : le lien entre le geste et son résultat doit rester
// visible sans quitter l'écran.
//
// LE PANNEAU N'EST PAS DUPLIQUÉ. `ImportPlanning` est le même composant que
// celui de la conversation — c'est son point d'entrée qui change, pas lui. Il
// porte l'étape humaine (relire ligne par ligne) et ses garde-fous ; les
// redoubler ici les ferait diverger au premier correctif.
// ============================================================

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { lireDocumentPlanning } from '@/app/(protected)/filou/import-actions'
import { useErreurBloquante } from '@/components/v2/regles/ErreurBloquante'
import { ImportPlanning, type ContenuImport } from './ImportPlanning'

/** Ce que le sélecteur de fichiers propose, et ce que le serveur sait lire.
 *  Les deux listes doivent dire la même chose : proposer un format qui sera
 *  refusé deux secondes plus tard est une porte qui ne mène qu'au refus. */
const FORMATS_ACCEPTES = '.png,.jpg,.jpeg,.webp,.gif,.pdf,.csv,.txt'

/** Lit un fichier local et rend son contenu en base64, SANS le préfixe
 *  `data:…;base64,` — l'action serveur attend la charge nue. */
function enBase64(fichier: File): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader()
    lecteur.onerror = () => rejeter(new Error('Je n’ai pas réussi à ouvrir ce fichier.'))
    lecteur.onload = () => {
      const brut = String(lecteur.result ?? '')
      const virgule = brut.indexOf(',')
      resoudre(virgule >= 0 ? brut.slice(virgule + 1) : brut)
    }
    lecteur.readAsDataURL(fichier)
  })
}

/** Le type MIME du fichier, retrouvé par son extension quand le navigateur ne
 *  le donne pas (fréquent pour les CSV sous Windows, où le champ arrive vide
 *  ou vaut `application/vnd.ms-excel`). */
function formatDe(fichier: File): string {
  const nom = fichier.name.toLowerCase()
  if (nom.endsWith('.csv')) return 'text/csv'
  if (nom.endsWith('.txt')) return 'text/plain'
  if (nom.endsWith('.pdf')) return 'application/pdf'
  if (nom.endsWith('.jpg') || nom.endsWith('.jpeg')) return 'image/jpeg'
  if (nom.endsWith('.png')) return 'image/png'
  if (nom.endsWith('.webp')) return 'image/webp'
  if (nom.endsWith('.gif')) return 'image/gif'
  return fichier.type || ''
}

interface Props {
  /**
   * `evident` — l'écran est vide, c'est le geste à faire : une carte entière
   * qui explique à quoi ça sert. `discret` — l'écran est déjà rempli, le
   * bouton se range à côté des autres actions de la page.
   */
  variante?: 'discret' | 'evident'
}

export function ImportPlanningLanceur({ variante = 'discret' }: Props) {
  const fichierRef = useRef<HTMLInputElement>(null)
  const [enLecture, setEnLecture] = useState<string | null>(null)
  const [contenu, setContenu] = useState<ContenuImport | null>(null)
  const { ouvrirErreur, dialogueErreur } = useErreurBloquante()

  const deposer = async (fichier: File) => {
    if (enLecture) return
    setContenu(null)
    setEnLecture(fichier.name)
    try {
      const base64 = await enBase64(fichier)
      const reponse = await lireDocumentPlanning(fichier.name, formatDe(fichier), base64)
      if ('error' in reponse) {
        // Un refus barre la route : format non géré, fichier vide, trop lourd.
        // En toast, il défilerait pendant qu'on cherche encore le fichier.
        ouvrirErreur(reponse.error)
        return
      }
      setContenu(reponse)
    } catch (e) {
      ouvrirErreur(e instanceof Error ? e.message : 'Je n’ai pas réussi à lire ce fichier.')
    } finally {
      setEnLecture(null)
      // Le champ se vide : sans ça, redéposer LE MÊME fichier ne déclencherait
      // rien (le navigateur ne signale pas un changement vers la même valeur).
      if (fichierRef.current) fichierRef.current.value = ''
    }
  }

  const champ = (
    <input
      ref={fichierRef}
      type="file"
      className="vh"
      accept={FORMATS_ACCEPTES}
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) void deposer(f)
      }}
    />
  )

  const bouton = (
    <button
      type="button"
      className={variante === 'evident' ? 'btn btn-valider' : 'hist-vers-planning'}
      onClick={() => fichierRef.current?.click()}
      disabled={Boolean(enLecture)}
    >
      {enLecture ? 'Lecture en cours…' : 'Importer un ancien planning'}
    </button>
  )

  // L'attente se voit, et elle se justifie : la lecture d'un document prend
  // plusieurs dizaines de secondes. Un bouton grisé sans explication passerait
  // pour un écran figé, et on recliquerait.
  const attente = enLecture && (
    <p className="imp-lanceur-attente" role="status">
      <span className="imp-lanceur-point" aria-hidden="true" />
      Filou lit «&nbsp;{enLecture}&nbsp;»… Ça peut prendre un moment&nbsp;: il relit le document
      ligne par ligne avant de te montrer quoi que ce soit.
    </p>
  )

  const panneau = contenu && (
    <section className="card rise imp-lanceur-resultat" aria-label="Ce qui a été lu dans le document">
      <div className="card-head">
        <h2>Ce que Filou a lu dans «&nbsp;{contenu.fichier}&nbsp;»</h2>
        <span className="sub spacer">à vérifier ligne par ligne avant d’enregistrer</span>
      </div>
      <ImportPlanning
        contenu={contenu}
        onDire={(phrase) => toast.success(phrase)}
        onErreur={(message) => ouvrirErreur(message)}
        onFermer={() => setContenu(null)}
      />
    </section>
  )

  if (variante === 'evident') {
    return (
      <>
        <section className="card rise rise-3" aria-label="Importer un ancien planning">
          <div className="card-head">
            <h2>Tu as déjà un planning, sur papier ou dans un tableur&nbsp;?</h2>
          </div>
          <p className="count-vide">
            Dépose-le : Filou le lit et en tire l’historique des gardes déjà faites. Les compteurs
            démarrent alors avec le passé du cabinet au lieu de repartir de zéro — et la première
            génération rattrape les écarts au lieu de les ignorer. Une photo, un PDF ou un fichier
            CSV font l’affaire. Rien ne s’enregistre sans que tu aies relu.
          </p>
          <div className="imp-lanceur-actions">
            {champ}
            {bouton}
          </div>
          {attente}
        </section>
        {panneau}
        {dialogueErreur}
      </>
    )
  }

  // Variante discrète : le bouton s'aligne à droite comme une action de page,
  // et son résultat s'ouvre JUSTE EN DESSOUS. Il ne peut pas vivre dans
  // `.page-actions` : ce conteneur est une petite rangée de liens, un panneau
  // de relecture de soixante lignes y serait à l'étroit et loin du regard.
  return (
    <div className="imp-lanceur rise rise-2">
      <div className="imp-lanceur-barre">
        {champ}
        {bouton}
      </div>
      {attente}
      {panneau}
      {dialogueErreur}
    </div>
  )
}
