// ============================================================
// GUARDVETO — Outils de Filou : planning et périodes
// ============================================================
// SERVER-ONLY. Ce fichier couvre ce que Filou doit savoir sur le calendrier
// concret (qui est de garde) et sur les PÉRIODES (les fenêtres de 12 ou 17
// semaines qu'on génère puis publie), ainsi que la création/le réglage d'une
// période et sa publication.
//
// Comme dans equipe.ts et regles.ts, le modèle ne manipule ni UUID ni type
// technique : il parle en dates ISO (AAAA-MM-JJ) et en libellés de période
// (« Hiver P2 », « Été 2027 »). La résolution libellé → ligne se fait ici, sur
// la liste réelle du cabinet, et refuse net dès qu'elle est ambiguë — même
// principe que `resoudre()` dans equipe.ts.
//
// PARTI PRIS IMPORTANT — génération de planning : PAS d'outil d'écriture ici.
// /api/generate porte un verrou anti-concurrence (péremption à 3 min), un
// flux de confirmation en deux temps pour re-générer une période déjà
// PUBLIÉE (efface le planning publié, désynchronise Google Agenda, impose
// une republication), jusqu'à 60 s d'exécution et des effets de bord lourds.
// Le condenser dans un aller-retour « proposition → un clic » serait fragile
// et pourrait cacher à l'admin qu'il écrase un planning déjà publié. On
// n'expose donc que le PRÉ-VOL en lecture (`verifier_pre_vol_periode`) :
// Filou peut dire à l'admin ce qui clignote AVANT qu'il aille générer lui-même
// depuis l'écran Planning. Publier, en revanche, reste un aller-retour
// raisonnable (une seule action, réversible dans ses effets visibles côté
// planning) : il est bien couvert par un outil d'écriture plus bas.
// ============================================================

import { z } from 'zod'
import { creerPeriode as creerPeriodeAction, setProfilPeriode, setEffectifPeriode } from '@/app/(protected)/admin/periodes/actions'
import { GET as preVolGET } from '@/app/api/generate/pre-vol/route'
import { POST as publierPOST } from '@/app/api/publish/route'
import { revaliderPlanningPublie } from '@/data/revaliderPlanning'
import { compterSouhaitsCongesEnAttente } from '@/data/souhaitsCongesEnAttente'
import { mapDbTypeToEngine } from '@/lib/crise/contexte'
import type { ContexteOutil, OutilEcriture, OutilLecture } from './types'

// ── Fragments partagés ──────────────────────────────────────

interface PeriodeRow {
  id: string
  libelle: string | null
  saison: 'ete' | 'hiver'
  numero: number | null
  date_debut: string
  date_fin: string
  statut: 'brouillon' | 'publie' | 'verrouille'
  profil_id: string | null
  nb_vetos_semaine_soir: number | null
}

interface ProfilRow {
  id: string
  nom: string
  est_defaut: boolean
  saison_suggeree: 'ete' | 'hiver' | null
  nb_vetos_semaine_soir: number | null
}

const STATUT_HUMAIN: Record<string, string> = {
  brouillon: 'brouillon',
  publie: 'publiée',
  verrouille: 'verrouillée',
}

/** Même libellé que l'écran /admin/periodes quand la période n'a pas de
 *  titre : « Été » ou « Hiver Pn ». Duplication assumée (3 lignes pures) —
 *  si l'écran change cette règle d'affichage, ce texte divergera et personne
 *  n'est prévenu ; à surveiller si le libellé de période évolue un jour. */
function libellePeriode(p: PeriodeRow): string {
  if (p.libelle) return p.libelle
  return p.saison === 'ete' ? 'Été' : `Hiver P${p.numero ?? ''}`
}

/** Compare deux textes sans se laisser arrêter par les accents, la casse ou
 *  la ponctuation — même esprit que `memeNom()` dans equipe.ts. */
function normaliser(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

async function chargerPeriodes(ctx: ContexteOutil): Promise<PeriodeRow[]> {
  const { data } = await ctx.supabase
    .from('periodes')
    .select('id, libelle, saison, numero, date_debut, date_fin, statut, profil_id, nb_vetos_semaine_soir')
    .order('date_debut', { ascending: false })
    .limit(30)
  return (data as PeriodeRow[] | null) ?? []
}

async function chargerProfils(ctx: ContexteOutil): Promise<ProfilRow[]> {
  const { data } = await ctx.supabase
    .from('profils_planning')
    .select('id, nom, est_defaut, saison_suggeree, nb_vetos_semaine_soir')
    .eq('actif', true)
    .order('ordre')
  return (data as ProfilRow[] | null) ?? []
}

/** Résout un texte libre (« Hiver P2 », « Été 2027 »…) en période. Match
 *  exact d'abord, puis « contient » dans un sens ou l'autre — une période se
 *  décrit rarement mot pour mot. Refuse l'ambiguïté : mieux vaut redemander
 *  que toucher la mauvaise fenêtre de planning. */
function resoudrePeriode(
  periodes: PeriodeRow[],
  texte: string,
): { ok: true; periode: PeriodeRow } | { ok: false; raison: string } {
  const cible = normaliser(texte)
  const labels = periodes.map((p) => ({ p, n: normaliser(libellePeriode(p)) }))

  const exacts = labels.filter((l) => l.n === cible)
  const candidats = exacts.length > 0 ? exacts : labels.filter((l) => l.n.includes(cible) || cible.includes(l.n))

  if (candidats.length === 1) return { ok: true, periode: candidats[0].p }
  if (candidats.length > 1) {
    return {
      ok: false,
      raison: `Plusieurs périodes correspondent à « ${texte} » : ${candidats.map((c) => libellePeriode(c.p)).join(', ')}. Précise laquelle.`,
    }
  }
  const connues = periodes.map((p) => libellePeriode(p)).join(', ') || 'aucune période enregistrée'
  return { ok: false, raison: `Aucune période ne correspond à « ${texte} ». Les périodes connues sont : ${connues}.` }
}

/** Mai (5) → Août (8) = été, le reste = hiver — MIROIR de `detecterSaison()`
 *  dans admin/periodes/actions.ts. Fonction pure de 2 lignes, dupliquée ici
 *  pour prévisualiser sans écrire ; si la coupure été/hiver change là-bas,
 *  la répercuter ici. */
function detecterSaison(dateDebut: string): 'ete' | 'hiver' {
  const mois = new Date(dateDebut + 'T12:00:00Z').getUTCMonth() + 1
  return mois >= 5 && mois <= 8 ? 'ete' : 'hiver'
}

function jourSemaineFr(date: string): string {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long' })
}

// ── Lecture : qui est de garde ───────────────────────────────

const ParamsLireGardes = z.object({
  date_debut: z.string().describe('Date ISO (AAAA-MM-JJ) du premier jour à consulter.'),
  date_fin: z
    .string()
    .optional()
    .describe('Date ISO (AAAA-MM-JJ) du dernier jour à consulter. Laisse vide pour un seul jour (= date_debut).'),
})

export const lireGardes: OutilLecture<typeof ParamsLireGardes> = {
  genre: 'lecture',
  nom: 'lire_gardes',
  description: `Donne qui est de garde, jour par jour, sur une date ou une plage de dates.

Appelle-le pour toute question sur le planning concret : « qui est de garde demain ? », « qui travaille le week-end du 14 ? », « est-ce que j'ai une garde la semaine prochaine ? ».

COMBIEN DE PERSONNES SONT ATTENDUES DÉPEND DU CRÉNEAU. Le cabinet règle ce nombre lui-même : beaucoup de créneaux n'en attendent qu'UNE SEULE, et une nuit de semaine à un seul vétérinaire est alors parfaitement normale. Ne parle donc JAMAIS de « second manquant » de toi-même.

Fie-toi à ces trois champs, jamais à ton intuition :
- « places_attendues » : ce que le cabinet a réglé pour ce créneau.
- « places_pourvues » : combien de personnes y sont réellement programmées.
- « manque » : le nombre de places vides. C'est LE seul indicateur de trou. À 0, il n'y a rien à signaler ; au-dessus de 0, dis-le clairement, ce n'est jamais anodin.

Si « places_attendues » vaut null, le réglage est indéterminé : dis simplement qui est programmé, sans conclure qu'il manque quelqu'un.

Le champ « état de la période » dit si ce planning est encore un brouillon (donc pas définitif) ou déjà publié.`,
  params: ParamsLireGardes,

  async executer(params, ctx) {
    const dateFin = params.date_fin ?? params.date_debut
    const [{ data: gardesDb }, { data: typesDb }, periodes, profils] = await Promise.all([
      ctx.supabase
        .from('planning_semaine')
        .select('date, type, premier_prenom, second_prenom, periode_statut')
        .gte('date', params.date_debut)
        .lte('date', dateFin)
        .order('date'),
      // `nb_places` est LA source de vérité du nombre de personnes attendues sur
      // un créneau — réglable par le cabinet, profil par profil. Sans elle, on
      // ne pouvait que supposer « toujours deux », et Filou annonçait un
      // « second manquant » sur des créneaux qui n'en attendent qu'un.
      ctx.supabase
        .from('creneau_modele')
        .select('code, nom, nb_places')
        .eq('cabinet_id', ctx.cabinetId)
        .not('code', 'is', null),
      chargerPeriodes(ctx),
      chargerProfils(ctx),
    ])

    // ⚠️ DEUX VOCABULAIRES DE CRÉNEAUX, et ils ne se parlent pas.
    // Le planning stocke 'semaine' / 'weekend' / 'ferie' ; le catalogue déclare
    // 'semaine_soir' / 'vendredi_soir' / 'weekend' / 'ferie'. Rapprocher les deux
    // par égalité de code laissait 57 lignes sur 100 sans nombre de places —
    // toutes les nuits de semaine. Filou n'inventait plus de manque, mais il
    // était devenu incapable d'en voir un.
    //
    // On passe donc par `mapDbTypeToEngine`, la traduction déjà utilisée par le
    // moteur et par les absences. Une copie locale de cette règle serait la
    // troisième version du même vocabulaire — et divergerait un jour.
    const infosTypes = new Map<string, { nom: string; places: number | null }>()
    for (const t of (typesDb as Array<{ code: string; nom: string; nb_places: number | null }> | null) ?? []) {
      const places = typeof t.nb_places === 'number' ? t.nb_places : null
      const connu = infosTypes.get(t.code)
      if (!connu) infosTypes.set(t.code, { nom: t.nom, places })
      // Un même code existe dans plusieurs profils de planning, parfois avec un
      // nombre de places différent. On ne sait pas ici lequel s'applique à la
      // date lue : en cas de désaccord, on préfère ne rien affirmer (null)
      // plutôt que d'annoncer un trou imaginaire.
      else if (connu.places !== places) connu.places = null
    }

    // ⚠️ PIÈGE : `semaine_soir` déclare 2 places dans le catalogue, mais le
    // nombre réellement exigé une nuit de semaine est celui de la PÉRIODE
    // (1 en été, 2 en hiver, sauf réglage). Se fier au catalogue ferait
    // annoncer un manque sur chaque nuit de semaine — le bug d'origine, à
    // l'envers. La précédence est celle du solveur : période > profil > saison.
    const profilParId = new Map(profils.map((p) => [p.id, p]))
    const effectifSemaine = (p: PeriodeRow): number => {
      if (typeof p.nb_vetos_semaine_soir === 'number') return p.nb_vetos_semaine_soir
      const profil = p.profil_id ? profilParId.get(p.profil_id) : undefined
      if (profil && typeof profil.nb_vetos_semaine_soir === 'number') return profil.nb_vetos_semaine_soir
      return p.saison === 'hiver' ? 2 : 1
    }
    const periodeDe = (date: string): PeriodeRow | undefined =>
      periodes.find((p) => p.date_debut <= date && date <= p.date_fin)

    type Row = {
      date: string
      type: string
      premier_prenom: string | null
      second_prenom: string | null
      periode_statut: 'brouillon' | 'publie' | 'verrouille'
    }
    const rows = (gardesDb as Row[] | null) ?? []

    if (rows.length === 0) {
      return { jours: [], note: 'Aucune garde trouvée sur cette période — elle est peut-être hors de toute période créée, ou pas encore générée.' }
    }

    return {
      jours: rows.map((r) => {
        // Le code du planning, traduit dans le vocabulaire du catalogue. On
        // essaie d'abord tel quel : un créneau sur-mesure porte le même code des
        // deux côtés, et la traduction le laisse passer intact.
        const typeEngine = mapDbTypeToEngine(r.type)
        const info = infosTypes.get(r.type) ?? infosTypes.get(typeEngine)
        const pourvues = [r.premier_prenom, r.second_prenom].filter(Boolean).length
        // Une nuit de semaine suit l'effectif de sa période ; tout le reste suit
        // le nombre de places de son créneau.
        const periode = periodeDe(r.date)
        const attendues =
          typeEngine === 'semaine_soir'
            ? (periode ? effectifSemaine(periode) : null)
            : (info?.places ?? null)
        // Le trou se CALCULE, il ne se devine pas : c'est la différence entre ce
        // que le cabinet a réglé et ce qui est réellement programmé.
        const manque = attendues === null ? null : Math.max(0, attendues - pourvues)
        return {
          date: r.date,
          jour_semaine: jourSemaineFr(r.date),
          creneau: info?.nom ?? r.type,
          programmes: [r.premier_prenom, r.second_prenom].filter(Boolean),
          places_attendues: attendues,
          places_pourvues: pourvues,
          manque,
          etat_periode: STATUT_HUMAIN[r.periode_statut] ?? r.periode_statut,
        }
      }),
    }
  },
}

// ── Lecture : état des périodes ──────────────────────────────

const ParamsEtatPeriodes = z.object({
  periode: z
    .string()
    .optional()
    .describe('Pour ne voir qu’une période précise (ex. « Hiver P2 », « Été 2027 »). Laisse vide pour la liste complète.'),
})

export const lireEtatPeriodes: OutilLecture<typeof ParamsEtatPeriodes> = {
  genre: 'lecture',
  nom: 'lire_etat_periodes',
  description: `Donne la liste des périodes du cabinet : libellé, saison, dates, statut (brouillon / publiée / verrouillée), profil de planning appliqué et effectif de nuit en semaine (1 ou 2 vétos).

Appelle-le pour toute question sur les périodes elles-mêmes plutôt que sur le détail des gardes : « quelles sont les périodes en cours ? », « la période d'hiver est-elle publiée ? », « quel profil est appliqué sur Été 2027 ? », « c'est réglé sur combien de vétos la nuit ? ».`,
  params: ParamsEtatPeriodes,

  async executer(params, ctx) {
    const [periodes, profils] = await Promise.all([chargerPeriodes(ctx), chargerProfils(ctx)])
    const profilParId = new Map(profils.map((p) => [p.id, p]))

    const cible = params.periode?.trim()
    let selection = periodes
    let note: string | undefined
    if (cible) {
      const trouve = resoudrePeriode(periodes, cible)
      if (!trouve.ok) return { periodes: [], note: trouve.raison }
      selection = [trouve.periode]
    }

    return {
      periodes: selection.map((p) => {
        // Précédence effectif : période (surcharge) > profil > saison — MÊME
        // ordre que le moteur (engine/loader.ts) et que l'écran /admin/periodes.
        let effectif: number
        let effectifProvenance: string
        if (typeof p.nb_vetos_semaine_soir === 'number') {
          effectif = p.nb_vetos_semaine_soir
          effectifProvenance = 'réglé directement sur la période'
        } else {
          const profil = p.profil_id ? profilParId.get(p.profil_id) : undefined
          if (profil && typeof profil.nb_vetos_semaine_soir === 'number') {
            effectif = profil.nb_vetos_semaine_soir
            effectifProvenance = `hérité du profil « ${profil.nom} »`
          } else {
            effectif = p.saison === 'hiver' ? 2 : 1
            effectifProvenance = `valeur par défaut de la saison (${p.saison === 'hiver' ? 'hiver' : 'été'})`
          }
        }

        return {
          libelle: libellePeriode(p),
          saison: p.saison === 'ete' ? 'été' : 'hiver',
          date_debut: p.date_debut,
          date_fin: p.date_fin,
          statut: STATUT_HUMAIN[p.statut] ?? p.statut,
          profil: p.profil_id ? (profilParId.get(p.profil_id)?.nom ?? 'profil supprimé') : 'profil par défaut du cabinet',
          effectif_nuit_semaine: effectif,
          effectif_provenance: effectifProvenance,
        }
      }),
      note,
    }
  },
}

// ── Lecture : pré-vol de génération ───────────────────────────

const ParamsPreVol = z.object({
  periode: z.string().describe('La période à vérifier avant génération (ex. « Hiver P2 »).'),
})

export const verifierPreVolPeriode: OutilLecture<typeof ParamsPreVol> = {
  genre: 'lecture',
  nom: 'verifier_pre_vol_periode',
  description: `Vérifie AVANT génération si des incohérences sont détectables sur une période : une règle qui vise un vétérinaire sorti de l'effectif, un créneau qu'aucune combinaison de vétos ne peut couvrir, une charge globale insuffisante… ainsi que le nombre de demandes de congé encore en attente sur ses dates.

Appelle-le quand on demande si une période est prête à générer, ou avant de conseiller de lancer une génération.

Ce pré-vol n'est JAMAIS bloquant : même sans rien signaler, la génération peut échouer pour d'autres raisons (aucune combinaison ne couvre tous les créneaux, par exemple) — dis-le si on te demande une garantie. Filou ne LANCE PAS la génération lui-même : elle se fait depuis l'écran Planning, elle prend du temps et peut écraser un planning déjà publié.`,
  params: ParamsPreVol,
  // Le nombre de demandes de congé en attente est la même donnée sensible
  // que `lire_souhaits_en_attente` (conges.ts) : un vétérinaire ne traite
  // pas les demandes des autres. Même restriction ici, par cohérence.
  adminSeulement: true,

  async executer(params, ctx) {
    const periodes = await chargerPeriodes(ctx)
    const trouve = resoudrePeriode(periodes, params.periode)
    if (!trouve.ok) return { erreur: trouve.raison }

    // Délégation à la route existante plutôt qu'à une réimplémentation : le
    // chargement « miroir » qu'elle fait (engine/loader.ts) est explicitement
    // fragile aux divergences — mieux vaut un aller-retour de plus que deux
    // implémentations qui glissent l'une de l'autre.
    const req = new Request(`http://filou.local/api/generate/pre-vol?periodeId=${encodeURIComponent(trouve.periode.id)}`)
    const res = await preVolGET(req as unknown as Parameters<typeof preVolGET>[0])
    const data = (await res.json()) as {
      avertissements?: Array<{ message: string }>
      souhaitsEnAttente?: number
      error?: string
    }
    if (data.error) return { erreur: data.error }

    return {
      periode: libellePeriode(trouve.periode),
      avertissements: (data.avertissements ?? []).map((a) => a.message),
      demandes_de_conge_en_attente: data.souhaitsEnAttente ?? 0,
      note:
        (data.avertissements?.length ?? 0) === 0 && (data.souhaitsEnAttente ?? 0) === 0
          ? 'Rien à signaler sur ce pré-vol — cela ne garantit pas que la génération réussira.'
          : 'Ces points ne bloquent pas la génération, mais valent la peine d’être réglés avant.',
    }
  },
}

// ── Écriture : créer une période ──────────────────────────────

const ParamsCreerPeriode = z.object({
  libelle: z.string().describe('Le titre de la période, ex. « Hiver P3 » ou « Été 2027 ».'),
  date_debut: z.string().describe('Date ISO (AAAA-MM-JJ) du premier jour — doit être un LUNDI.'),
  date_fin: z.string().describe('Date ISO (AAAA-MM-JJ) du dernier jour.'),
  profil: z
    .string()
    .optional()
    .describe('Nom du profil de planning à appliquer. Laisse vide pour laisser le cabinet choisir automatiquement selon la saison.'),
})

export const creerPeriode: OutilEcriture<typeof ParamsCreerPeriode> = {
  genre: 'ecriture',
  nom: 'creer_periode',
  description: `Prépare la création d'une nouvelle période (une fenêtre de planning à générer et publier).

Appelle-le quand on demande d'ouvrir une nouvelle période — « crée la période d'été 2027 », « ouvre Hiver P3 du 5 janvier au 30 mars ».

La période est créée en BROUILLON, sans aucune garde : générer et publier sont des étapes séparées, qui ne se font pas ici. Rien n'est enregistré tant que la personne n'a pas validé.`,
  params: ParamsCreerPeriode,
  adminSeulement: true,

  async resumer(params, ctx) {
    const jour = new Date(params.date_debut + 'T12:00:00Z').getUTCDay()
    if (jour !== 1) {
      return { ok: false, raison: `${params.date_debut} n’est pas un lundi. La date de début d’une période doit être un lundi.` }
    }
    if (params.date_fin < params.date_debut) {
      return { ok: false, raison: 'La date de fin est avant la date de début.' }
    }

    const periodes = await chargerPeriodes(ctx)
    const chevauche = periodes.find((p) => p.date_debut <= params.date_fin && p.date_fin >= params.date_debut)
    if (chevauche) {
      return {
        ok: false,
        raison: `Ces dates chevauchent la période « ${libellePeriode(chevauche)} » (${chevauche.date_debut} → ${chevauche.date_fin}).`,
      }
    }

    const saison = detecterSaison(params.date_debut)
    let profilId: string | null = null
    let profilLigne: string
    if (params.profil) {
      const profils = await chargerProfils(ctx)
      const cible = normaliser(params.profil)
      const candidats = profils.filter((p) => normaliser(p.nom).includes(cible) || cible.includes(normaliser(p.nom)))
      if (candidats.length === 0) {
        return { ok: false, raison: `Aucun profil ne s’appelle « ${params.profil} ». Les profils sont : ${profils.map((p) => p.nom).join(', ') || 'aucun profil défini'}.` }
      }
      if (candidats.length > 1) {
        return { ok: false, raison: `Plusieurs profils correspondent à « ${params.profil} » : ${candidats.map((p) => p.nom).join(', ')}. Précise lequel.` }
      }
      profilId = candidats[0].id
      profilLigne = `Profil : ${candidats[0].nom}`
    } else {
      profilLigne = `Profil : choisi automatiquement selon la saison (${saison === 'ete' ? 'été' : 'hiver'})`
    }

    return {
      ok: true,
      proposition: {
        titre: `Créer la période « ${params.libelle} »`,
        phrase: `Je vais créer une nouvelle période, en brouillon, du ${params.date_debut} au ${params.date_fin}.`,
        lignes: [profilLigne],
        action: 'Créer la période',
        avertissement: 'Aucune garde n’est générée par cette action — elle vient après, depuis l’écran Planning.',
      },
      charge: { libelle: params.libelle, dateDebut: params.date_debut, dateFin: params.date_fin, profilId },
    }
  },

  async executer(_params, _ctx, charge) {
    const c = charge as { libelle?: string; dateDebut?: string; dateFin?: string; profilId?: string | null } | undefined
    if (!c?.libelle || !c.dateDebut || !c.dateFin) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    const fd = new FormData()
    fd.set('libelle', c.libelle)
    fd.set('date_debut', c.dateDebut)
    fd.set('date_fin', c.dateFin)
    if (c.profilId) fd.set('profil_id', c.profilId)
    const r = await creerPeriodeAction(fd)
    return 'error' in r ? { error: r.error } : {}
  },
}

// ── Écriture : régler profil / effectif d'une période ──────────

const ParamsReglerPeriode = z.object({
  periode: z.string().describe('La période à régler, ex. « Hiver P2 ».'),
  profil: z
    .string()
    .optional()
    .describe('Nom du profil de planning à appliquer. Dis « défaut » ou « aucun » pour revenir au profil par défaut du cabinet.'),
  effectif: z
    .union([z.literal(1), z.literal(2)])
    .optional()
    .describe('Effectif de garde la nuit en semaine : 1 ou 2 vétos.'),
})

export const reglerPeriode: OutilEcriture<typeof ParamsReglerPeriode> = {
  genre: 'ecriture',
  nom: 'regler_periode',
  description: `Prépare un changement de profil de planning et/ou d'effectif de nuit en semaine pour une période.

Appelle-le pour « mets le profil X sur Hiver P2 », « passe l'été à 1 véto la nuit », « remets le profil par défaut sur cette période ».

S'applique à la PROCHAINE génération de cette période — le planning déjà généré ne bouge pas tout seul. Rien n'est enregistré tant que la personne n'a pas validé.`,
  params: ParamsReglerPeriode,
  adminSeulement: true,

  async resumer(params, ctx) {
    if (!params.profil && !params.effectif) {
      return { ok: false, raison: 'Précise ce que tu veux régler : le profil, l’effectif, ou les deux.' }
    }

    const periodes = await chargerPeriodes(ctx)
    const trouve = resoudrePeriode(periodes, params.periode)
    if (!trouve.ok) return { ok: false, raison: trouve.raison }
    const p = trouve.periode

    const lignes: string[] = []
    let nouveauProfilId: string | null | undefined
    let nouveauProfilNom: string | undefined

    if (params.profil) {
      const remiseADefaut = /d[ée]faut|aucun/i.test(params.profil.trim())
      if (remiseADefaut) {
        if (p.profil_id === null) {
          return { ok: false, raison: `« ${libellePeriode(p)} » est déjà sur le profil par défaut du cabinet.` }
        }
        nouveauProfilId = null
        nouveauProfilNom = 'profil par défaut du cabinet'
      } else {
        const profils = await chargerProfils(ctx)
        const cible = normaliser(params.profil)
        const candidats = profils.filter((pr) => normaliser(pr.nom).includes(cible) || cible.includes(normaliser(pr.nom)))
        if (candidats.length === 0) {
          return { ok: false, raison: `Aucun profil ne s’appelle « ${params.profil} ». Les profils sont : ${profils.map((pr) => pr.nom).join(', ') || 'aucun profil défini'}.` }
        }
        if (candidats.length > 1) {
          return { ok: false, raison: `Plusieurs profils correspondent à « ${params.profil} » : ${candidats.map((pr) => pr.nom).join(', ')}. Précise lequel.` }
        }
        if (candidats[0].id === p.profil_id) {
          return { ok: false, raison: `« ${libellePeriode(p)} » utilise déjà le profil « ${candidats[0].nom} ».` }
        }
        nouveauProfilId = candidats[0].id
        nouveauProfilNom = candidats[0].nom
      }
      lignes.push(`Profil : ${nouveauProfilNom}`)
    }

    let nouvelEffectif: number | undefined
    if (params.effectif) {
      if (p.nb_vetos_semaine_soir === params.effectif) {
        return { ok: false, raison: `« ${libellePeriode(p)} » est déjà réglée sur ${params.effectif} véto(s) la nuit en semaine.` }
      }
      nouvelEffectif = params.effectif
      lignes.push(`Effectif de nuit en semaine : ${params.effectif} véto${params.effectif > 1 ? 's' : ''}`)
    }

    return {
      ok: true,
      proposition: {
        titre: `Régler « ${libellePeriode(p)} »`,
        phrase: `Voici ce que je changerais sur « ${libellePeriode(p)} ».`,
        lignes,
        action: 'Appliquer',
        avertissement: 'Le planning déjà généré ne bouge pas : le changement vaut pour la prochaine génération.',
      },
      charge: { periodeId: p.id, profilId: nouveauProfilId, effectif: nouvelEffectif },
    }
  },

  async executer(_params, _ctx, charge) {
    const c = charge as { periodeId?: string; profilId?: string | null; effectif?: number } | undefined
    if (!c?.periodeId) return { error: 'La proposition a été perdue — redemande-la à Filou.' }

    if (c.profilId !== undefined) {
      const r = await setProfilPeriode(c.periodeId, c.profilId)
      if ('error' in r) return { error: r.error }
    }
    if (c.effectif !== undefined) {
      const r = await setEffectifPeriode(c.periodeId, c.effectif)
      if ('error' in r) return { error: r.error }
    }
    return {}
  },
}

// ── Écriture : publier une période ─────────────────────────────

const ParamsPublierPeriode = z.object({
  periode: z.string().describe('La période à publier, ex. « Hiver P2 ».'),
})

export const publierPeriode: OutilEcriture<typeof ParamsPublierPeriode> = {
  genre: 'ecriture',
  nom: 'publier_periode',
  description: `Prépare la publication d'une période en BROUILLON : elle devient visible de tous les vétérinaires, qui reçoivent une notification, et le planning est synchronisé vers Google Agenda.

Appelle-le quand on demande de publier un planning — « publie Hiver P2 », « rends la période d'été visible à l'équipe ».

C'est une action qui touche toute l'équipe : les vétérinaires sont notifiés dès la publication. Rien n'est envoyé tant que la personne n'a pas validé.`,
  params: ParamsPublierPeriode,
  adminSeulement: true,

  async resumer(params, ctx) {
    const periodes = await chargerPeriodes(ctx)
    const trouve = resoudrePeriode(periodes, params.periode)
    if (!trouve.ok) return { ok: false, raison: trouve.raison }
    const p = trouve.periode

    if (p.statut !== 'brouillon') {
      return {
        ok: false,
        raison: `« ${libellePeriode(p)} » est déjà ${STATUT_HUMAIN[p.statut] ?? p.statut} — seul un brouillon peut être publié.`,
      }
    }

    const { count } = await ctx.supabase
      .from('gardes')
      .select('id', { count: 'exact', head: true })
      .eq('periode_id', p.id)
    if (!count) {
      return { ok: false, raison: `Aucune garde n’a encore été générée pour « ${libellePeriode(p)} ». Génère le planning avant de publier.` }
    }

    // Même contrôle que le gate de la route /api/publish, en LECTURE seule
    // (aucune des deux fonctions n'écrit) — pour montrer les réserves AVANT
    // le clic plutôt que de laisser la route les découvrir après coup.
    //
    // ⚠️ Un contrôle qui ÉCHOUE (panne, timeout) n'est PAS la preuve que
    // tout est sain — un `[]` par défaut serait indistinguable d'un vrai
    // zéro. Sur l'action la plus lourde de conséquences du produit
    // (notification à toute l'équipe, synchro agenda, écrasement d'un
    // planning publié), on distingue les deux et on le dit en clair : la
    // publication reste possible (c'est l'humain qui décide), mais il
    // décide en sachant que la vérification n'a pas pu être faite.
    let violations: Array<{ detail: string }> = []
    let controleViolationsEchoue = false
    try {
      violations = await revaliderPlanningPublie([p.id])
    } catch {
      controleViolationsEchoue = true
    }
    let souhaitsEnAttente = 0
    let controleSouhaitsEchoue = false
    try {
      souhaitsEnAttente = await compterSouhaitsCongesEnAttente(ctx.supabase, p.date_debut, p.date_fin)
    } catch {
      controleSouhaitsEchoue = true
    }

    const lignes: string[] = []
    if (controleViolationsEchoue) {
      lignes.push('⚠️ Le contrôle des règles du planning n’a pas pu être fait — regarde l’écran Planning avant de continuer.')
    }
    if (controleSouhaitsEchoue) {
      lignes.push('⚠️ Le contrôle des demandes de congé en attente n’a pas pu être fait — regarde l’écran Planning avant de continuer.')
    }
    if (violations.length > 0) {
      lignes.push(`${violations.length} point${violations.length > 1 ? 's' : ''} de règle non respecté${violations.length > 1 ? 's' : ''} :`)
      lignes.push(...violations.slice(0, 8).map((v) => `• ${v.detail}`))
    }
    if (souhaitsEnAttente > 0) {
      lignes.push(`${souhaitsEnAttente} demande${souhaitsEnAttente > 1 ? 's' : ''} de congé encore en attente sur ces dates.`)
    }

    return {
      ok: true,
      proposition: {
        titre: `Publier « ${libellePeriode(p)} »`,
        phrase:
          lignes.length > 0
            ? `Je peux publier « ${libellePeriode(p)} » malgré ces réserves :`
            : `Je vais publier « ${libellePeriode(p)} ». Rien à signaler.`,
        lignes: lignes.length > 0 ? lignes : undefined,
        action: 'Publier',
        avertissement: `Tous les vétérinaires seront notifiés et le planning sera synchronisé vers Google Agenda.${lignes.length > 0 ? ' Ces réserves resteront présentes après publication.' : ''}`,
      },
      charge: { periodeId: p.id },
    }
  },

  async executer(_params, _ctx, charge) {
    const c = charge as { periodeId?: string } | undefined
    if (!c?.periodeId) return { error: 'La proposition a été perdue — redemande-la à Filou.' }

    // Délégation à la route réelle : c'est elle qui écrit le statut, envoie
    // les e-mails et synchronise l'agenda — jamais dupliqué ici. On passe
    // confirmAvecReserves systématiquement à true : les réserves ont déjà
    // été montrées et validées au moment de l'aperçu, la route n'a pas à
    // redemander une confirmation que Filou vient d'obtenir.
    const req = new Request('http://filou.local/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ periodeId: c.periodeId, confirmAvecReserves: true }),
    })
    const res = await publierPOST(req as unknown as Parameters<typeof publierPOST>[0])
    const data = (await res.json()) as { success?: boolean; error?: string; requiresConfirmation?: boolean }
    if (data.error) return { error: data.error }
    if (data.requiresConfirmation) {
      return { error: 'La publication a été refusée par un contrôle imprévu — redemande à Filou de publier à nouveau.' }
    }
    return {}
  },
}
