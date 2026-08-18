// ============================================================
// GUARDVETO — Lire un ancien planning déposé par le cabinet
// ============================================================
// SERVER-ONLY. Le cabinet arrive avec son planning d'avant : une photo prise
// au téléphone, un PDF exporté d'un tableur, un CSV. Sans ce chemin, la
// première génération repart de zéro — comme si personne n'avait jamais fait
// de garde — et les compteurs mentent dès le premier jour.
//
// CE QUE CE FICHIER FAIT, ET RIEN DE PLUS : il LIT. Il ne décide pas, il
// n'écrit pas. Il rend ce qu'il a compris, ligne par ligne, avec ce qu'il n'a
// PAS su lire nommé explicitement. L'écriture est un geste humain séparé
// (cf. `import-actions.ts`) — c'est le principe fondamental du projet : le
// moteur et les garde-fous décident, Filou est le porte-parole.
//
// POURQUOI PAS D'OCR. Le modèle lit nativement les images et les PDF passés
// en base64 dans un bloc `image` / `document`. Écrire une couche de
// reconnaissance de caractères par-dessus serait une seconde implémentation
// moins bonne, et un point de panne de plus.
//
// LA RÈGLE ANTI-INVENTION est tenue à DEUX endroits, parce qu'un seul ne
// suffit pas :
//   1. Le prompt interdit de deviner — une case illisible se dit, elle ne se
//      remplit pas.
//   2. La résolution des prénoms se fait ICI, sur la vraie liste du cabinet,
//      et REFUSE tout ce qu'elle ne reconnaît pas. Un prénom inventé par le
//      modèle ressort donc en « je n'ai pas reconnu », jamais en garde.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { cleIA, modeleIA } from './proposerRegle'
import type { LecturePlanning, LignePlanningLue, VetoConnu } from './importTypes'

/** Les formats qu'on sait vraiment lire. Un format absent d'ici est refusé
 *  AVANT l'appel facturé, avec une phrase qui dit quoi faire à la place. */
export const FORMATS_LUS = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/csv',
  'text/plain',
] as const

export type FormatLu = (typeof FORMATS_LUS)[number]

/** Plafond de taille du fichier déposé.
 *
 *  ⚠️ CE CHIFFRE N'EST PAS UN CONFORT, C'EST UNE LIMITE DE PLATEFORME.
 *  ============================================================
 *  Vercel plafonne le corps d'une requête à **4,5 Mo**, quel que soit
 *  l'abonnement. Ce plafond agit AVANT la fonction : `bodySizeLimit` dans
 *  `next.config.ts` ne desserre que ce qui se passe DEDANS, il ne peut rien
 *  contre lui. On se tient à 4 Mo pour garder la marge de l'enveloppe
 *  multipart.
 *
 *  ⚠️ Ce chiffre ne vaut QUE parce que le fichier voyage en BINAIRE, par
 *  `POST /api/import/lire`. Deux limites bien plus basses ont été payées avant
 *  d'arriver là, et les rouvrir suffirait à tout casser :
 *
 *  ① 12 Mo (avant le 2026-08-18) — jamais atteint. La plateforme refusait bien
 *     avant, et la personne lisait « An unexpected response was received from
 *     the server » au lieu d'une phrase en français. Annoncer un plafond qu'on
 *     ne fait pas respecter soi-même, c'est promettre ce qu'un autre refusera.
 *  ② 3 Mo (le 2026-08-18) — encore trop haut, mais pour une raison invisible :
 *     tant que la lecture passait par une SERVER ACTION, le document voyageait
 *     dans ses arguments, et le décodeur de Next borne cette charge à ~1 Mo
 *     (« Maximum array nesting exceeded »). Le déménagement vers une route API
 *     a levé cette limite-là — cf. l'en-tête de `api/import/lire/route.ts`.
 *
 *  En pratique ce plafond ne concerne presque plus les photos : le navigateur
 *  les réduit avant l'envoi (cf. `ImportPlanningLanceur`). Il reste le
 *  garde-fou du PDF, qu'on ne sait pas alléger côté client — un PDF scanné
 *  pèse couramment 2 à 10 Mo. */
export const TAILLE_MAX_OCTETS = 4 * 1024 * 1024

/** Une ligne telle que le modèle l'a lue, AVANT résolution des prénoms. */
const LigneLue = z.object({
  date: z
    .string()
    .describe('La date de la garde, au format AAAA-MM-JJ. Pour un week-end, la date du SAMEDI.'),
  type: z
    .enum(['weekend', 'semaine', 'ferie'])
    .describe(
      'weekend pour une garde de week-end, ferie pour un jour férié, semaine pour une garde de nuit en semaine.',
    ),
  premier: z
    .string()
    .describe('Le prénom du vétérinaire de premier rang, tel qu’il est écrit sur le document.'),
  second: z
    .string()
    .describe(
      'Le prénom du second vétérinaire s’il y en a un. Chaîne vide s’il n’y en a pas, ou si tu ne l’as pas lu.',
    ),
})

const ParamsRestituer = z.object({
  gardes: z
    .array(LigneLue)
    .describe('Une entrée par garde effectivement lue sur le document. Vide si tu n’as rien lu.'),
  illisibles: z
    .array(z.string())
    .describe(
      'Une phrase par endroit que tu n’as PAS su lire (« la semaine du 12 mai, la colonne de droite est floue »). Ne devine jamais : ce que tu ne lis pas se déclare ici.',
    ),
  remarque: z
    .string()
    .describe('Une phrase sur ce que tu as vu dans l’ensemble : période couverte, forme du document.'),
})

type Restitution = z.infer<typeof ParamsRestituer>

// Le vocabulaire partagé avec l'écran de validation vit dans `importTypes.ts` :
// ce fichier-ci embarque le SDK Anthropic et ne peut donc pas être importé
// depuis un composant client.
export type { LecturePlanning, LignePlanningLue, VetoConnu } from './importTypes'

// ── Résolution des prénoms ──────────────────────────────────────────────

/** Enlève accents, casse et ponctuation : « Anne-Sophie » et « anne sophie »
 *  doivent tomber sur la même personne, « Anne-Cath » aussi. */
export function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Retrouve UNE personne du cabinet à partir de ce qui est écrit sur le
 * document, ou rien du tout.
 *
 * Volontairement strict et sans « à peu près » : sur un planning de gardes,
 * attribuer la nuit du 14 juillet à la mauvaise personne parce que deux
 * prénoms se ressemblent coûte plus cher qu'un trou signalé. Trois passes,
 * de la plus sûre à la moins sûre, et l'AMBIGUÏTÉ REFUSE : deux candidats,
 * personne.
 */
export function resoudreVeto(brut: string, vets: VetoConnu[]): VetoConnu | null {
  const cible = normaliser(brut)
  if (!cible) return null

  const candidats = (predicat: (v: VetoConnu) => boolean): VetoConnu | null => {
    const trouves = vets.filter(predicat)
    return trouves.length === 1 ? trouves[0] : null
  }

  // 1. Le prénom, le nom, ou « prénom nom » — exactement.
  const exact = candidats(
    (v) =>
      normaliser(v.prenom) === cible ||
      normaliser(v.nom) === cible ||
      normaliser(`${v.prenom} ${v.nom}`) === cible,
  )
  if (exact) return exact

  // 2. Une abréviation du prénom (« Anne-Cath », « Vic »). Trois lettres au
  //    minimum : « An » désignerait aussi bien Anne-Sophie qu'Anne-Catherine
  //    ou Antoine, et le filtre d'unicité ci-dessous le refuserait de toute
  //    façon — autant ne pas y passer.
  if (cible.length >= 3) {
    const prefixe = candidats((v) => normaliser(v.prenom).startsWith(cible))
    if (prefixe) return prefixe
  }

  // 3. Les initiales — c'est ainsi qu'on remplit une case étroite à la main.
  //    Trois lectures possibles, parce que les cabinets écrivent les trois :
  //    « AS » (les initiales du prénom composé), « JDT » (prénom + nom),
  //    « DT » (le nom à particule). Deux lettres au minimum : une seule
  //    lettre désignerait trop de monde, et la règle d'unicité la refuserait
  //    de toute façon.
  const sigle = cible.replace(/ /g, '')
  if (sigle.length >= 2) {
    const initialesDe = (texte: string) =>
      normaliser(texte)
        .split(' ')
        .filter(Boolean)
        .map((mot) => mot[0])
        .join('')

    const parInitiales = candidats((v) =>
      [initialesDe(v.prenom), initialesDe(`${v.prenom} ${v.nom}`), initialesDe(v.nom)].includes(
        sigle,
      ),
    )
    if (parInitiales) return parInitiales
  }

  return null
}

// ── L'appel au modèle ───────────────────────────────────────────────────

const NOM_OUTIL = 'restituer_planning'

function systemPour(vets: VetoConnu[]): string {
  const liste = vets.map((v) => `- ${v.prenom} ${v.nom}`).join('\n')
  return `Tu lis un ANCIEN planning de gardes vétérinaires, tenu par le cabinet avant qu'il n'utilise ce logiciel. Il peut être manuscrit, photographié de travers, exporté d'un tableur, ou imprimé.

Ta seule mission : RESTITUER ce qui est écrit. Tu ne calcules rien, tu ne complètes rien, tu ne corriges rien.

LES VÉTÉRINAIRES DU CABINET
${liste}

Ce sont les SEULS noms possibles. Recopie le prénom tel qu'il est écrit sur le document ; le rattachement à la bonne personne se fait après toi.

CE QUI EST INTERDIT, ET C'EST LE PLUS IMPORTANT

N'INVENTE JAMAIS. Pas une date, pas un nom, pas une garde. Si une case est floue, barrée, raturée, coupée par le bord de la photo ou simplement illisible, tu ne la devines pas : tu la déclares dans « illisibles », en disant où elle se trouve. Une case laissée en blanc par le cabinet est une case vide, pas une garde à deviner.

Ne complète pas une série. Si tu vois les week-ends du 4, du 11 et du 25 mai, tu ne rajoutes pas le 18 : il n'y était pas.

Ne déduis pas une année qui n'est pas écrite. Si le document ne porte que « samedi 12 avril », dis-le dans « illisibles » plutôt que de choisir une année.

COMMENT TU LIS

Une garde de WEEK-END se note à la date du SAMEDI, même si le document affiche le vendredi soir ou le dimanche : le week-end est une seule garde.
Une garde de nuit en semaine se note à la date de la nuit concernée.
Un jour férié se note en « ferie ».
Quand deux personnes sont de garde ensemble, la première citée est le premier rang.

Termine toujours par l'outil ${NOM_OUTIL}.`
}

/** Le fichier tel qu'il arrive du navigateur. `base64` SANS le préfixe
 *  `data:`, `contenu` déjà décodé pour les formats texte. */
export interface FichierDepose {
  nom: string
  format: FormatLu
  base64: string
}

function blocDocument(fichier: FichierDepose): Anthropic.ContentBlockParam {
  if (fichier.format === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: fichier.base64 },
    }
  }
  if (fichier.format === 'text/csv' || fichier.format === 'text/plain') {
    // Un tableur n'est pas une image : on l'envoie en texte, c'est plus fiable
    // et beaucoup moins cher que de le faire regarder.
    const texte = Buffer.from(fichier.base64, 'base64').toString('utf-8')
    return {
      type: 'text',
      text: `Contenu du fichier « ${fichier.nom} » :\n\n${texte.slice(0, 60_000)}`,
    }
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: fichier.format, data: fichier.base64 },
  }
}

/**
 * Fait lire le document, puis rattache les noms lus au cabinet réel.
 *
 * N'écrit rien, ne propose rien : rend une lecture, avec ses trous nommés.
 */
export async function lirePlanningDepuisFichier(
  fichier: FichierDepose,
  vets: VetoConnu[],
): Promise<{ ok: true; lecture: LecturePlanning } | { ok: false; raison: string }> {
  const cle = cleIA()
  if (!cle) return { ok: false, raison: 'Assistant IA non configuré (clé API manquante côté serveur).' }

  const depart = Date.now()
  const modele = modeleIA()
  const client = new Anthropic({ apiKey: cle })

  let reponse: Anthropic.Message
  try {
    reponse = await client.messages.create({
      model: modele,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: systemPour(vets) }],
      tools: [
        {
          name: NOM_OUTIL,
          description:
            'Rends ce que tu as lu sur le document : les gardes, et ce que tu n’as pas su lire.',
          input_schema: z.toJSONSchema(ParamsRestituer, {
            target: 'draft-7',
          }) as unknown as Anthropic.Tool['input_schema'],
        },
      ],
      // L'obligation de répondre par l'outil : sans elle, le modèle commente le
      // document en prose et il n'y a plus rien à valider à l'écran.
      tool_choice: { type: 'tool', name: NOM_OUTIL },
      messages: [
        {
          role: 'user',
          content: [
            blocDocument(fichier),
            {
              type: 'text',
              text: "Voici l'ancien planning de gardes du cabinet. Lis-le et restitue-le.",
            },
          ],
        },
      ],
    })
  } catch (e) {
    return { ok: false, raison: e instanceof Error ? e.message : 'Lecture impossible.' }
  }

  const appel = reponse.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!appel) {
    return { ok: false, raison: "Je n'ai rien su tirer de ce document. Essaie une photo plus nette, ou un autre format." }
  }

  const valides = ParamsRestituer.safeParse(appel.input ?? {})
  if (!valides.success) {
    return { ok: false, raison: "Ce que j'ai lu n'était pas exploitable. Réessaie ?" }
  }

  return {
    ok: true,
    lecture: {
      ...rattacher(valides.data, vets),
      ms: Date.now() - depart,
      modele,
    },
  }
}

/** Rattache les noms lus aux personnes du cabinet. Exporté pour être testé
 *  sans appel facturé : c'est ici que se joue « ne rien inventer ». */
export function rattacher(
  brut: Restitution,
  vets: VetoConnu[],
): Pick<LecturePlanning, 'lignes' | 'illisibles' | 'remarque'> {
  const lignes: LignePlanningLue[] = []
  const illisibles = [...brut.illisibles]

  brut.gardes.forEach((g, index) => {
    // Une date qui n'est pas une date n'entre pas : elle se signale.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date) || Number.isNaN(Date.parse(g.date))) {
      illisibles.push(`Une ligne portait une date que je n’ai pas su lire (« ${g.date} »).`)
      return
    }

    const premier = g.premier.trim() ? resoudreVeto(g.premier, vets) : null
    const second = g.second.trim() ? resoudreVeto(g.second, vets) : null

    const inconnus: string[] = []
    if (g.premier.trim() && !premier) inconnus.push(g.premier.trim())
    if (g.second.trim() && !second) inconnus.push(g.second.trim())

    lignes.push({
      cle: index,
      date: g.date,
      type: g.type,
      premierId: premier?.id ?? null,
      secondId: second?.id ?? null,
      premierLu: g.premier.trim(),
      secondLu: g.second.trim(),
      inconnus,
    })
  })

  lignes.sort((a, b) => (a.date === b.date ? a.type.localeCompare(b.type) : a.date.localeCompare(b.date)))

  return { lignes, illisibles, remarque: brut.remarque }
}

// ── Mise en forme des dates pour l'écriture ─────────────────────────────

/** Le lundi de la semaine d'une date ISO. La table `periodes` l'exige
 *  (contrainte `debut_lundi`) : une période qui commencerait un jeudi est
 *  refusée par la base, et l'import échouerait à la dernière seconde. */
export function lundiDeLaSemaine(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const jour = d.getUTCDay() // 0 = dimanche
  const recul = jour === 0 ? 6 : jour - 1
  d.setUTCDate(d.getUTCDate() - recul)
  return d.toISOString().slice(0, 10)
}

/** Le dimanche qui clôt la semaine d'une date ISO. */
export function dimancheDeLaSemaine(iso: string): string {
  const lundi = new Date(`${lundiDeLaSemaine(iso)}T00:00:00Z`)
  lundi.setUTCDate(lundi.getUTCDate() + 6)
  return lundi.toISOString().slice(0, 10)
}

/**
 * Ramène une garde de week-end à son SAMEDI.
 *
 * La vue `planning_semaine` déduit le vendredi soir (date − 1) et le dimanche
 * (date + 1) depuis cette seule ligne. Une garde de week-end posée sur le
 * dimanche décalerait donc tout le week-end d'un jour à l'affichage, sans
 * qu'aucune erreur ne le signale.
 */
export function ancrerSamedi(iso: string, type: string): string {
  if (type !== 'weekend') return iso
  const d = new Date(`${iso}T00:00:00Z`)
  const jour = d.getUTCDay()
  if (jour === 6) return iso
  if (jour === 0) d.setUTCDate(d.getUTCDate() - 1) // dimanche → samedi
  else if (jour === 5) d.setUTCDate(d.getUTCDate() + 1) // vendredi → samedi
  else return iso
  return d.toISOString().slice(0, 10)
}

/** La saison telle que la base l'exige (colonne héritée, non nulle). Elle ne
 *  pilote plus rien dans le moteur — cf. « la saison sort du moteur » — mais
 *  la contrainte existe toujours. */
export function saisonDe(iso: string): 'ete' | 'hiver' {
  const mois = Number(iso.slice(5, 7))
  return mois >= 5 && mois <= 9 ? 'ete' : 'hiver'
}
