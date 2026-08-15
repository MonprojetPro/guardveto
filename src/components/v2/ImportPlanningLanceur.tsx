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
// DEUX ACTIONS DU MÊME NIVEAU. « Créer un planning » et « Importer un ancien
// planning », c'est « je pars de zéro » ou « je pars de ce que j'ai déjà » : le
// même choix, au même moment. Elles se présentent donc ENSEMBLE, dans les
// actions de la page (retour MiKL du 2026-08-15, sur capture). L'encart
// explicatif qui portait le geste auparavant a disparu : il repoussait le vrai
// bouton tout en bas, sous un pavé que personne ne lit deux fois.
//
// D'OÙ LE HOOK plutôt qu'un composant d'un seul tenant. Le bouton doit vivre
// dans la rangée d'actions, en haut à droite ; son résultat doit s'ouvrir sous
// le contenu de la page, pas dans un conteneur en flex de 38 pixels de haut.
// Les deux morceaux partagent le même état — un hook les rend séparément sans
// dupliquer quoi que ce soit.
//
// LE PANNEAU N'EST PAS DUPLIQUÉ. `ImportPlanning` est le même composant que
// celui de la conversation — c'est son point d'entrée qui change, pas lui. Il
// porte l'étape humaine (relire ligne par ligne) et ses garde-fous ; les
// redoubler ici les ferait diverger au premier correctif.
// ============================================================

import { useRef, useState } from 'react'
import Link from 'next/link'
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

/**
 * Les morceaux de l'import, prêts à être posés à deux endroits différents :
 * `bouton` dans la rangée d'actions, `attente` + `panneau` + `dialogueErreur`
 * sous le contenu de la page.
 */
export function useImportPlanning() {
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

  // Action SECONDAIRE : même forme et même hauteur que « Créer un planning »
  // (on ne fabrique pas un troisième traitement), mais moins appuyée — créer
  // un planning reste ce que fera l'immense majorité des cabinets.
  const bouton = (
    <>
      {champ}
      <button
        type="button"
        className="hist-vers-planning hist-vers-import"
        onClick={() => fichierRef.current?.click()}
        disabled={Boolean(enLecture)}
        title="Reprendre les gardes déjà faites depuis un ancien planning, pour que les compteurs démarrent avec le passé du cabinet au lieu de repartir de zéro."
      >
        {enLecture ? 'Lecture en cours…' : 'Importer un ancien planning'}
      </button>
    </>
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

  return { bouton, attente, panneau, dialogueErreur }
}

/**
 * L'en-tête de l'écran Compteurs quand aucune période n'existe encore.
 *
 * C'est le PREMIER écran d'un cabinet qui démarre, et le seul moment où les
 * compteurs sont à zéro et où on peut encore leur donner un passé. Les deux
 * actions y sont donc présentées ensemble, en haut à droite : partir de zéro
 * (« Créer un planning ») ou partir de ce qu'on a déjà (« Importer un ancien
 * planning »).
 *
 * L'explication tient en une demi-phrase dans le chapeau + l'infobulle du
 * bouton. L'encart qui la portait avant a disparu : il repoussait le geste
 * sous un pavé de texte, et le geste comptait plus que le pavé.
 */
export function EnteteHistoriqueVide({ estAdmin }: { estAdmin: boolean }) {
  const imp = useImportPlanning()

  return (
    <>
      <div className="page-head rise">
        <div>
          <p className="page-kicker">Historique &amp; compteurs</p>
          <h1>Rien à raconter pour l&apos;instant.</h1>
          <p className="lede">
            Aucune période de planification n&apos;existe encore. Les compteurs apparaîtront dès
            qu&apos;une période aura été créée et un planning généré
            {estAdmin
              ? ' — ou tout de suite, si tu importes un ancien planning : les compteurs démarrent alors avec le passé du cabinet au lieu de repartir de zéro.'
              : '.'}
          </p>
        </div>
        {estAdmin && (
          <div className="page-actions">
            <Link href="/planning" className="hist-vers-planning">
              Créer un planning →
            </Link>
            {imp.bouton}
          </div>
        )}
      </div>
      {imp.attente}
      {imp.panneau}
      {imp.dialogueErreur}
    </>
  )
}
