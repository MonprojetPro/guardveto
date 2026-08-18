// ============================================================
// GUARDVETO — API Route POST /api/import/lire
// ============================================================
// Fait lire un ancien planning par le modèle. N'écrit RIEN en base : l'écriture
// reste dans `enregistrerPlanningImporte`, après que l'admin a relu ligne par
// ligne. La frontière lecture / écriture est tout le dispositif de sécurité de
// cette fonctionnalité — cette route est du bon côté.
//
// POURQUOI UNE ROUTE, ET PLUS UNE SERVER ACTION (2026-08-18, `f069adf`).
// La lecture passait par `lireDocumentPlanning`, une Server Action recevant le
// document en base64 dans ses arguments. Ça tenait pour un CSV de 268 octets et
// cassait pour tout le reste, avec une erreur qui ne disait rien :
// « Maximum array nesting exceeded » (HTTP 500, journal Vercel).
//
// La cause, trouvée dans le décodeur : les arguments d'une Server Action sont
// désérialisés par `react-server-dom-webpack`, qui borne la charge à
// `arraySizeLimit`, **1 Mo par défaut** — et la taille des données compte
// directement dans ce budget. Next n'expose pas ce réglage. La vraie limite du
// transport était donc de ~1 Mo, très en deçà du plafond de la plateforme, et
// l'erreur tombait AVANT notre code : ni notre contrôle de taille ni notre
// message en français n'avaient la moindre chance de s'exécuter.
//
// Un POST ordinaire n'emprunte pas ce protocole. Deux gains, pas un :
//   ① la limite remonte de ~1 Mo au vrai plafond de la plateforme (4,5 Mo de
//      corps de requête) ;
//   ② le fichier voyage en BINAIRE et non plus en base64, ce qui économise les
//      33 % d'encodage — l'encodage se fait ici, côté serveur, juste avant
//      l'appel au modèle qui l'exige.
//
// Accès  : admin uniquement (même contrôle que l'écriture, source unique)
// Corps  : multipart/form-data, champ `fichier`
// Réponse: ReponseImport — { fichier, lecture, vets } | { error }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { contexteAdmin } from '@/lib/import/contexteAdmin'
import {
  FORMATS_LUS,
  TAILLE_MAX_OCTETS,
  lirePlanningDepuisFichier,
  type FormatLu,
  type VetoConnu,
} from '@/lib/ia/lirePlanningImporte'
import { assistantIaDisponible } from '@/lib/ia/proposerRegle'

// La lecture d'un document dense prend plusieurs dizaines de secondes. Sans
// cette ligne, la fonction tourne avec le défaut de la plateforme (10 à 15 s)
// et une grosse image expire — toutes les autres routes du projet posent 60.
export const maxDuration = 60

/** Le type MIME de ce qui a été reçu.
 *
 *  ⚠️ LE TYPE ANNONCÉ PRIME SUR L'EXTENSION, et ce n'est pas un détail : quand
 *  le navigateur réduit une image, il peut CHANGER son format sans changer son
 *  nom — un scan photographique déposé en `.png` repart en JPEG (le repli de
 *  `reduireImage`). Se fier à l'extension annoncerait « PNG » pour du JPEG, et
 *  le modèle recevrait un document qu'il ne sait pas ouvrir.
 *
 *  L'extension ne sert donc que de REPLI, pour les cas où le navigateur ne dit
 *  rien d'utile — fréquent pour les CSV sous Windows, où le type arrive vide ou
 *  vaut `application/vnd.ms-excel`. Et seul un type que l'on sait lire est
 *  retenu : une route ne fait jamais confiance à ce que son appelant déclare. */
function formatDe(nom: string, typeAnnonce: string): string {
  if ((FORMATS_LUS as readonly string[]).includes(typeAnnonce)) return typeAnnonce
  const n = nom.toLowerCase()
  if (n.endsWith('.csv')) return 'text/csv'
  if (n.endsWith('.txt')) return 'text/plain'
  if (n.endsWith('.pdf')) return 'application/pdf'
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg'
  if (n.endsWith('.png')) return 'image/png'
  if (n.endsWith('.webp')) return 'image/webp'
  if (n.endsWith('.gif')) return 'image/gif'
  return typeAnnonce || ''
}

export async function POST(req: NextRequest) {
  const c = await contexteAdmin()
  if ('error' in c) {
    // 403 et pas 401 : le message distingue déjà les deux cas, et l'écran
    // affiche la phrase telle quelle sans regarder le code.
    return NextResponse.json({ error: c.error }, { status: 403 })
  }

  if (!assistantIaDisponible()) {
    return NextResponse.json(
      { error: 'Assistant IA non configuré (clé API manquante côté serveur).' },
      { status: 503 },
    )
  }

  // ── Le fichier ──────────────────────────────────────────
  let fichier: File
  try {
    const form = await req.formData()
    const champ = form.get('fichier')
    if (!(champ instanceof File)) {
      return NextResponse.json({ error: 'Aucun fichier reçu.' }, { status: 400 })
    }
    fichier = champ
  } catch {
    // Le corps n'a pas pu être lu : requête tronquée, ou refusée par la
    // plateforme avant d'arriver. Le navigateur refuse déjà au-delà du plafond,
    // donc on ne devrait pas passer par là — mais une phrase en français vaut
    // mieux qu'une erreur de framework si ça arrive.
    return NextResponse.json(
      { error: "Le fichier n'a pas pu être reçu en entier. Réessaie, ou envoie un fichier plus léger." },
      { status: 400 },
    )
  }

  const format = formatDe(fichier.name, fichier.type)
  if (!(FORMATS_LUS as readonly string[]).includes(format)) {
    return NextResponse.json(
      {
        error:
          'Je ne sais pas lire ce format. Une photo (JPEG, PNG), un PDF ou un fichier CSV, oui — un tableur Excel, enregistre-le d’abord en CSV ou prends-en une capture d’écran.',
      },
      { status: 400 },
    )
  }

  if (fichier.size > TAILLE_MAX_OCTETS) {
    return NextResponse.json(
      {
        error: `Ce fichier est trop lourd (${(fichier.size / 1024 / 1024).toFixed(1)} Mo). Au-delà de ${(
          TAILLE_MAX_OCTETS /
          1024 /
          1024
        ).toFixed(0)} Mo je ne peux pas le recevoir — refais la photo en qualité normale, ou découpe le PDF.`,
      },
      { status: 413 },
    )
  }
  if (fichier.size < 32) {
    return NextResponse.json({ error: 'Ce fichier est vide.' }, { status: 400 })
  }

  // ── Qui peut être rattaché aux gardes lues ──────────────
  const { data: vetsDb } = await c.supabase
    .from('veterinaires')
    .select('id, prenom, nom')
    .eq('cabinet_id', c.cabinetId)
    .eq('actif', true)
    .order('nom')

  const vets = (vetsDb as VetoConnu[] | null) ?? []
  if (vets.length === 0) {
    return NextResponse.json(
      { error: "Aucun vétérinaire actif dans le cabinet : je n'aurais personne à qui rattacher les gardes." },
      { status: 400 },
    )
  }

  // L'encodage base64 a lieu ICI, au plus près de l'appel : c'est le modèle qui
  // l'exige, pas le transport. Le fichier a voyagé en binaire jusque-là.
  const base64 = Buffer.from(await fichier.arrayBuffer()).toString('base64')

  const lu = await lirePlanningDepuisFichier(
    { nom: fichier.name, format: format as FormatLu, base64 },
    vets,
  )
  if (!lu.ok) return NextResponse.json({ error: lu.raison }, { status: 422 })

  return NextResponse.json({ fichier: fichier.name, lecture: lu.lecture, vets })
}
