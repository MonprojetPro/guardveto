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
import { useErreurBloquante } from '@/components/v2/regles/ErreurBloquante'
import { ImportPlanning, type ContenuImport } from './ImportPlanning'

/** Ce que le sélecteur de fichiers propose, et ce que le serveur sait lire.
 *  Les deux listes doivent dire la même chose : proposer un format qui sera
 *  refusé deux secondes plus tard est une porte qui ne mène qu'au refus. */
const FORMATS_ACCEPTES = '.png,.jpg,.jpeg,.webp,.gif,.pdf,.csv,.txt'

/* ============================================================
   RÉDUIRE LA PHOTO AVANT DE L'ENVOYER
   ============================================================
   LE PROBLÈME, tel qu'il s'est manifesté (2026-08-18) : déposer une photo de
   8 Mo affichait « An unexpected response was received from the server ».
   Ce refus n'est pas le nôtre — Vercel plafonne le corps d'une requête à
   4,5 Mo, quel que soit l'abonnement, et ce plafond agit AVANT la fonction :
   `bodySizeLimit` dans `next.config.ts` ne desserre que ce qui se passe
   dedans. En base64 (+33 %), la vraie limite est d'environ 3 Mo de fichier.

   POURQUOI ÇA COMPTE AU-DELÀ DU TEST : une photo de planning prise au
   téléphone pèse 2 à 5 Mo. C'est exactement la zone de casse, et c'est LE cas
   d'usage de cette fonction — un cabinet qui photographie sa feuille papier.

   Réduire côté navigateur est la vraie réponse : une photo ramenée à 2576 px
   passe sous la barre sans rien perdre de lisible. Les quatre décisions qui
   comptent, et pourquoi :

   ① 2576 px sur le GRAND CÔTÉ — pas sur la largeur. Un planning mural est en
      paysage, une liste imprimée en portrait ; borner la largeur laisserait
      une photo portrait à 3400 px de haut. C'est la résolution que le modèle
      exploite réellement : au-delà on transmet des octets pour rien, en deçà
      on jette de la finesse utile sur les grilles denses.
   ② `createImageBitmap` avec options de redimensionnement, JAMAIS
      `new Image()` + canvas. Le second matérialise l'image pleine taille :
      une photo de 48 Mpx, c'est ~190 Mo en mémoire et un onglet tué sur un
      téléphone d'entrée de gamme. Le premier décode et réduit en une passe et
      n'expose jamais le plein format au JavaScript.
   ③ `imageOrientation: 'from-image'` n'est PAS optionnel. Les navigateurs
      appliquent l'orientation EXIF au rendu d'une `<img>`, mais pas à
      `createImageBitmap` : sans ce réglage, une photo de téléphone part
      COUCHÉE, et le modèle lit un planning à 90°.
   ④ On ne ré-encode pas un PNG en JPEG. Une capture d'écran de tableur
      ré-encodée donne des contours baveux autour des chiffres — exactement ce
      qui fait rater une lecture. Photo → JPEG 0,85 ; capture ou export → PNG,
      redimensionnement seul.

   Et on ne touche à RIEN en dessous du seuil : un CSV de 268 octets ou un PNG
   de 13 Ko n'ont aucune raison de passer par un décodeur d'images.
   ============================================================ */

/** Le plafond réel d'un envoi. Même valeur que `TAILLE_MAX_OCTETS` côté
 *  serveur, et pour la même raison : le corps d'une requête ne dépasse pas
 *  4,5 Mo sur la plateforme. La valeur est recopiée plutôt qu'importée —
 *  `lirePlanningImporte` embarque le SDK Anthropic, qu'on ne tire pas dans le
 *  paquet envoyé au navigateur pour un seul nombre. Les deux commentaires se
 *  citent l'un l'autre ; si l'un bouge, l'autre doit suivre. */
const PLAFOND_ENVOI_OCTETS = 4 * 1024 * 1024

/** Au-delà de ce poids, on réduit l'image. Volontairement PLUS BAS que le
 *  plafond : viser le plafond tout juste laisserait passer des envois de
 *  3,9 Mo pour rien, alors qu'une photo ramenée à 2576 px pèse une fraction de
 *  ça sans rien perdre de lisible. L'écart entre les deux chiffres est la marge
 *  qui absorbe une réduction moins efficace que prévu — un scan photographique
 *  enregistré en PNG, typiquement. */
const SEUIL_REDUCTION_OCTETS = 3 * 1024 * 1024

/** Le grand côté visé après réduction. Voir ① ci-dessus. */
const COTE_MAX = 2576

/** Qualité du JPEG produit. 0,85 : au-dessus le gain visuel est nul sur du
 *  texte imprimé, en dessous les caractères fins commencent à baver. */
const QUALITE_JPEG = 0.85

/**
 * Réduit une image trop lourde. Rend `null` si le fichier n'a pas à être
 * touché (format non-image, taille sous le seuil) ou si la réduction a échoué
 * — dans ce dernier cas, l'appelant envoie l'original et c'est le contrôle de
 * taille du serveur qui rendra un refus en français. Cette fonction ne jette
 * jamais : un navigateur qui ne sait pas faire ne doit pas casser le dépôt.
 */
async function reduireImage(fichier: File, format: string): Promise<Blob | null> {
  if (!format.startsWith('image/')) return null
  if (fichier.size <= SEUIL_REDUCTION_OCTETS) return null
  if (typeof createImageBitmap !== 'function') return null

  let bitmap: ImageBitmap | null = null
  try {
    // Première passe : on borne la LARGEUR. Elle suffit pour une image
    // paysage, et elle nous apprend le rapport de forme sans avoir jamais
    // décodé le plein format.
    bitmap = await createImageBitmap(fichier, {
      resizeWidth: COTE_MAX,
      resizeQuality: 'high',
      imageOrientation: 'from-image',
    })

    // Portrait : c'est la HAUTEUR qu'il fallait borner. On repart de la
    // source pour une réduction propre en une seule passe, plutôt que de
    // réduire une réduction — deux rééchantillonnages successifs, ça se voit
    // sur des chiffres manuscrits.
    if (bitmap.height > COTE_MAX) {
      const premier = bitmap
      bitmap = await createImageBitmap(fichier, {
        resizeHeight: COTE_MAX,
        resizeQuality: 'high',
        imageOrientation: 'from-image',
      })
      premier.close()
    }

    const toile = document.createElement('canvas')
    toile.width = bitmap.width
    toile.height = bitmap.height
    const pinceau = toile.getContext('2d')
    if (!pinceau) return null
    pinceau.drawImage(bitmap, 0, 0)

    const encoder = (type: string) =>
      new Promise<Blob | null>((resoudre) => {
        toile.toBlob(resoudre, type, type === 'image/jpeg' ? QUALITE_JPEG : undefined)
      })

    // ④ : le PNG (et le GIF, qui est du même registre — capture, export) ne
    // passe pas en JPEG. Tout le reste est une photo.
    const sansPerte = format === 'image/png' || format === 'image/gif'
    let blob = await encoder(sansPerte ? 'image/png' : 'image/jpeg')

    // REPLI, trouvé par le banc d'essai (2026-08-18) : une image
    // PHOTOGRAPHIQUE enregistrée en PNG (un scan, une photo réenregistrée) ne
    // redescend pas sous le plafond en restant en PNG — le ré-encodage du
    // navigateur, moins optimisé que celui d'un outil d'image, peut même
    // ALOURDIR. On renonçait alors à réduire, et l'envoi échouait à coup sûr.
    // Mieux vaut un JPEG lisible qu'un refus : la règle « on n'abîme pas un
    // PNG » protège les captures d'écran de tableur, qui sont légères et
    // n'atteindront jamais ce repli.
    if (sansPerte && (!blob || blob.size > PLAFOND_ENVOI_OCTETS)) {
      const enJpeg = await encoder('image/jpeg')
      if (enJpeg && (!blob || enJpeg.size < blob.size)) blob = enJpeg
    }

    // Réduire ne doit jamais ALOURDIR : sur une image déjà bien compressée, le
    // ré-encodage peut gonfler. Dans ce cas on garde l'original — le serveur
    // rendra un refus en français, ce qui vaut mieux qu'un envoi plus lourd
    // que le fichier de départ.
    if (!blob || blob.size >= fichier.size) return null
    return blob
  } catch {
    // Format exotique, image corrompue, mémoire insuffisante : on renonce en
    // silence et on laisse partir l'original.
    return null
  } finally {
    bitmap?.close()
  }
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
      const formatSource = formatDe(fichier)
      // La réduction d'abord : c'est la charge RÉELLEMENT envoyée qui doit
      // tenir sous le plafond de la plateforme.
      const reduite = await reduireImage(fichier, formatSource)
      const charge: Blob = reduite ?? fichier

      // ⚠️ LE REFUS DOIT TOMBER ICI, PAS AU SERVEUR. C'est le piège du
      // 2026-08-18 : le contrôle `TAILLE_MAX_OCTETS` de la route est
      // INATTEIGNABLE au-delà du plafond de la plateforme. Vercel refuse le
      // corps de la requête AVANT d'entrer dans la fonction — notre phrase en
      // français n'est jamais lue, et la personne reçoit un message d'erreur
      // technique en anglais.
      //
      // On mesure donc ce qui va RÉELLEMENT partir — la charge après réduction,
      // pas le fichier de départ — et on refuse nous-mêmes avant d'envoyer. Le
      // contrôle de la route reste en place : il garde la porte pour tout
      // appelant qui ne passerait pas par cet écran.
      //
      // Ça vise le PDF SCANNÉ, qu'on ne sait pas alléger dans le navigateur et
      // qui pèse couramment 2 à 10 Mo. Le message le dit franchement plutôt que
      // de laisser croire à une panne : il n'y a pas de « réessaie » utile ici,
      // il y a un geste à faire sur le document.
      if (charge.size > PLAFOND_ENVOI_OCTETS) {
        // Le poids annoncé est celui de ce qui PART, pas celui du fichier
        // d'origine : après réduction, dire « 8 Mo » alors qu'on en envoie 3,2
        // ferait passer le refus pour une erreur de notre part.
        const poids = (charge.size / 1024 / 1024).toFixed(1)
        // Trois issues différentes, parce que le geste à faire n'est pas le
        // même : un PDF se découpe, une photo se refait, un tableau se scinde.
        // Un message unique dirait « refais la photo » à qui vient de déposer
        // un CSV.
        const conseil =
          formatSource === 'application/pdf'
            ? 'Je ne peux pas alléger un PDF moi-même. Deux façons de s’en sortir : n’envoyer que les pages qui portent les gardes, ou faire une photo de la page affichée à l’écran — celle-là, je saurai la réduire.'
            : formatSource.startsWith('image/')
              ? 'J’ai essayé de la réduire, mais elle reste au-dessus. Refais la photo en qualité normale, ou dépose le planning en deux fois — une moitié des dates, puis l’autre.'
              : 'Découpe-le en deux fichiers, une moitié des dates dans chacun, et dépose-les l’un après l’autre.'
        ouvrirErreur(
          `Ce fichier est trop lourd pour être envoyé (${poids} Mo, et la limite est d’environ 3 Mo). ${conseil}`,
        )
        return
      }

      // Le document part en BINAIRE, dans un multipart ordinaire. C'est tout
      // l'intérêt de la route : une Server Action l'aurait fait voyager en
      // base64 dans ses arguments, +33 % de poids et surtout un décodeur qui
      // plafonne à ~1 Mo (cf. l'en-tête de `api/import/lire/route.ts`).
      // L'encodage base64 que le modèle réclame se fait côté serveur.
      const formulaire = new FormData()
      formulaire.append('fichier', charge, fichier.name)

      const httpReponse = await fetch('/api/import/lire', {
        method: 'POST',
        body: formulaire,
      })

      // Une réponse non-JSON veut dire qu'on n'a pas atteint notre code : c'est
      // la plateforme qui a parlé (corps refusé, fonction expirée). On ne laisse
      // pas remonter un message technique en anglais.
      const reponse = await httpReponse.json().catch(() => ({
        error:
          'Le serveur n’a pas répondu comme prévu. Si le fichier est volumineux, essaie avec une version plus légère.',
      }))

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
