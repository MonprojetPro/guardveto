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
import { placesAttendues, manqueSurGarde, codeCatalogue } from '@/lib/planning/placesAttendues'
import type { ContexteOutil, OutilEcriture, OutilLecture } from './types'
import { perimetrePeriodes, messagePerimetreVide } from './perimetre'

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

/** Même libellé que l'écran /historique quand la période n'a pas de
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
  // Bornée au CABINET et, pour un vétérinaire, aux périodes DIFFUSÉES. La
  // table `periodes` porte bien une RLS, mais elle raisonne sur le statut
  // (`publie` ou `verrouille`), pas sur la diffusion : une période verrouillée
  // jamais publiée y passait — c'est précisément la seule qui existe chez le
  // cabinet pilote. Le filtre explicite ferme cet écart.
  let requete = ctx.supabase
    .from('periodes')
    .select('id, libelle, saison, numero, date_debut, date_fin, statut, profil_id, nb_vetos_semaine_soir')
    .eq('cabinet_id', ctx.cabinetId)
    .order('date_debut', { ascending: false })
    .limit(30)
  if (!ctx.estAdmin) requete = requete.not('publie_at', 'is', null)
  const { data } = await requete
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

// `detecterSaison()` vivait ici, dupliqué depuis admin/periodes/actions.ts pour
// annoncer la période type que la saison ferait choisir. Retiré le 2026-08-04 :
// plus rien n'est choisi d'après la saison, la période type est toujours dite.

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

Le champ « état de la période » dit si ce planning est encore un brouillon (donc pas définitif) ou déjà publié.

REMPLACEMENT EXCEPTIONNEL : si un jour porte « remplacement_exceptionnel », c'est que quelqu'un tient cette place UNIQUEMENT ce jour-là — le reste du bloc week-end revient à son titulaire habituel. Dis-le : « c'est bien toi dimanche, en remplacement exceptionnel » n'appelle pas la même réaction que « tu es de garde tout le week-end ». Ne le déduis jamais de toi-même : ce champ est absent quand la garde est ordinaire.`,
  params: ParamsLireGardes,

  async executer(params, ctx) {
    const dateFin = params.date_fin ?? params.date_debut

    // ⚠️ LA VUE `planning_semaine` N'A AUCUNE RLS (elle appartient à `postgres`
    // et n'est pas `security_invoker`) : sans le filtre ci-dessous, cette
    // requête traversait le cabinet ET le rôle. Un vétérinaire obtenait ici le
    // planning non diffusé que son écran avait justement cessé de lui montrer.
    // Le périmètre borne les trois d'un coup — cabinet, rôle, diffusion.
    const perimetre = await perimetrePeriodes(ctx)
    if (perimetre.vide) {
      return { jours: [], note: messagePerimetreVide(ctx) }
    }

    const [{ data: gardesDb }, { data: typesDb }, periodes, profils] = await Promise.all([
      ctx.supabase
        .from('planning_semaine')
        // `jour_exceptionnel` : ce jour-là porte un remplacement qui ne vaut
        // QUE pour lui (backlog 8 bis). La vue applique déjà la substitution —
        // Filou donnait donc le bon nom sans le savoir — mais il ne pouvait pas
        // dire que c'était exceptionnel. Or c'est précisément ce qu'il faut
        // dire : « c'est bien toi dimanche, en remplacement » n'appelle pas la
        // même réaction que « tu es de garde tout le week-end ».
        .select('date, type, premier_prenom, second_prenom, periode_statut, jour_exceptionnel')
        .in('periode_id', perimetre.ids)
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

    // Le calcul lui-même vit dans `placesAttendues` — une fonction pure, couverte
    // par des tests gratuits qui figent les deux pièges (les vocabulaires qui ne
    // se parlent pas, et le catalogue qui déclare 2 places pour une nuit de
    // semaine qui n'en attend qu'une). Le garder ici en aurait fait une règle
    // qu'on ne peut vérifier qu'en payant un appel au modèle.
    const profilParId = new Map(profils.map((p) => [p.id, p]))
    const catalogue = new Map([...infosTypes].map(([code, i]) => [code, i.places]))

    type Row = {
      date: string
      type: string
      premier_prenom: string | null
      second_prenom: string | null
      periode_statut: 'brouillon' | 'publie' | 'verrouille'
      jour_exceptionnel: boolean | null
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
        // Le nom lisible suit la même traduction que les places : sans elle, une
        // nuit de semaine s'affichait « semaine » au lieu de « Soir de semaine ».
        const info = infosTypes.get(r.type) ?? infosTypes.get(codeCatalogue(r.type))
        const pourvues = [r.premier_prenom, r.second_prenom].filter(Boolean).length
        const attendues = placesAttendues({
          typePlanning: r.type,
          date: r.date,
          catalogue,
          periodes,
          profils: profilParId,
        })
        // Le trou se CALCULE, il ne se devine pas : c'est la différence entre ce
        // que le cabinet a réglé et ce qui est réellement programmé.
        const manque = manqueSurGarde(attendues, pourvues)
        return {
          date: r.date,
          jour_semaine: jourSemaineFr(r.date),
          creneau: info?.nom ?? r.type,
          programmes: [r.premier_prenom, r.second_prenom].filter(Boolean),
          places_attendues: attendues,
          places_pourvues: pourvues,
          manque,
          etat_periode: STATUT_HUMAIN[r.periode_statut] ?? r.periode_statut,
          // Présent uniquement quand c'est vrai : un `false` sur chaque jour
          // ordinaire encombrerait la réponse et finirait par être ignoré.
          ...(r.jour_exceptionnel ? { remplacement_exceptionnel: true } : {}),
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
        // ordre que le moteur (engine/loader.ts) et que l'écran /historique.
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
  // OBLIGATOIRE depuis le 2026-08-04 : plus de choix automatique selon la
  // saison. Si la personne n'a pas dit laquelle, Filou DEMANDE — il ne devine
  // pas la structure sur laquelle tout un trimestre de gardes sera calculé.
  profil: z
    .string()
    .describe('Nom de la période type à appliquer — OBLIGATOIRE. Si la personne ne l’a pas précisée, demande-lui laquelle avant d’appeler cet outil.'),
})

export const creerPeriode: OutilEcriture<typeof ParamsCreerPeriode> = {
  genre: 'ecriture',
  nom: 'creer_periode',
  description: `Prépare la création d'une nouvelle période (une fenêtre de planning à générer et publier).

Appelle-le quand on demande d'ouvrir une nouvelle période — « crée la période d'été 2027 », « ouvre Hiver P3 du 5 janvier au 30 mars ».

La PÉRIODE TYPE est obligatoire : c'est elle qui décide des gardes à couvrir et de l'effectif. Si on ne t'a pas dit laquelle, demande-la — ne choisis jamais à la place du cabinet.

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

    const profils = await chargerProfils(ctx)
    const nommees = profils.filter((p) => !p.est_defaut)
    if (nommees.length === 0) {
      return {
        ok: false,
        raison: 'Le cabinet n’a aucune période type. Il faut en créer au moins une '
          + '(Organisation › Périodes types) avant de pouvoir ouvrir un planning : '
          + 'c’est elle qui décide des gardes à couvrir et de l’effectif.',
      }
    }
    const cible = normaliser(params.profil)
    const candidats = nommees.filter((p) => normaliser(p.nom).includes(cible) || cible.includes(normaliser(p.nom)))
    if (candidats.length === 0) {
      return { ok: false, raison: `Aucune période type ne s’appelle « ${params.profil} ». Il y a : ${nommees.map((p) => p.nom).join(', ')}.` }
    }
    if (candidats.length > 1) {
      return { ok: false, raison: `Plusieurs périodes types correspondent à « ${params.profil} » : ${candidats.map((p) => p.nom).join(', ')}. Précise laquelle.` }
    }
    const profilId: string = candidats[0].id
    const profilLigne = `Période type : ${candidats[0].nom}`

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
    .describe('Nom de la période type à appliquer. On ne peut pas retirer la période type d’un planning — seulement en désigner une autre.'),
  effectif: z
    .union([z.literal(1), z.literal(2)])
    .optional()
    .describe('Effectif de garde la nuit en semaine : 1 ou 2 vétos.'),
})

export const reglerPeriode: OutilEcriture<typeof ParamsReglerPeriode> = {
  genre: 'ecriture',
  nom: 'regler_periode',
  description: `Prépare un changement de profil de planning et/ou d'effectif de nuit en semaine pour une période.

Appelle-le pour « mets la période type X sur Hiver P2 », « passe l'été à 1 véto la nuit ».

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
      // « remets le profil par défaut » n'existe plus (2026-08-04) : un planning
      // ne peut pas redevenir sans période type. On le dit au lieu de le faire.
      if (/d[ée]faut|aucun/i.test(params.profil.trim())) {
        return {
          ok: false,
          raison: 'Un planning ne peut plus revenir « sans période type » : c’est elle qui '
            + 'décide des gardes à couvrir et de l’effectif. Dis-moi laquelle appliquer.',
        }
      }
      const profils = (await chargerProfils(ctx)).filter((pr) => !pr.est_defaut)
      const cible = normaliser(params.profil)
      const candidats = profils.filter((pr) => normaliser(pr.nom).includes(cible) || cible.includes(normaliser(pr.nom)))
      if (candidats.length === 0) {
        return { ok: false, raison: `Aucune période type ne s’appelle « ${params.profil} ». Il y a : ${profils.map((pr) => pr.nom).join(', ') || 'aucune période type définie'}.` }
      }
      if (candidats.length > 1) {
        return { ok: false, raison: `Plusieurs périodes types correspondent à « ${params.profil} » : ${candidats.map((pr) => pr.nom).join(', ')}. Précise laquelle.` }
      }
      if (candidats[0].id === p.profil_id) {
        return { ok: false, raison: `« ${libellePeriode(p)} » utilise déjà la période type « ${candidats[0].nom} ».` }
      }
      nouveauProfilId = candidats[0].id
      nouveauProfilNom = candidats[0].nom
      lignes.push(`Période type : ${nouveauProfilNom}`)
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

/** Réponse de POST /api/publish, telle qu'on a besoin de la lire ici. */
interface ReponsePublish {
  success?: boolean
  error?: string
  requiresConfirmation?: boolean
  violations?: Array<{ detail: string }>
  souhaitsEnAttente?: number
}

/** Un aller-retour vers la route de publication. Isolé pour que l'exécution
 *  puisse l'appeler DEUX fois : une première sans confirmation (c'est la route
 *  qui recalcule les réserves), une seconde avec, une fois qu'on a vérifié que
 *  rien de nouveau n'était apparu depuis l'aperçu. */
async function appelerPublish(periodeId: string, confirmAvecReserves: boolean): Promise<ReponsePublish> {
  const req = new Request('http://filou.local/api/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ periodeId, confirmAvecReserves }),
  })
  const res = await publierPOST(req as unknown as Parameters<typeof publierPOST>[0])
  return (await res.json()) as ReponsePublish
}

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
    // planning publié), on distingue les deux et on le dit en clair. Un
    // contrôle en échec est reporté dans la `charge` : l'exécution refusera
    // alors de publier, faute de pouvoir comparer l'avant et l'après.
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

    // Contrôle en panne : on ne propose PAS de bouton. Un bouton « Publier »
    // qui refusera au clic est une coquille vide, et publier quand même serait
    // prévenir toute l'équipe d'un planning que personne n'a relu.
    if (controleViolationsEchoue || controleSouhaitsEchoue) {
      const quoi = controleViolationsEchoue && controleSouhaitsEchoue
        ? 'Les contrôles des règles du planning et des demandes de congé en attente n’ont pas pu être faits'
        : controleViolationsEchoue
          ? 'Le contrôle des règles du planning n’a pas pu être fait'
          : 'Le contrôle des demandes de congé en attente n’a pas pu être fait'
      return {
        ok: false,
        raison: `${quoi} — je ne te propose pas de publier « ${libellePeriode(p)} » sans savoir ce qu’il y a dedans : toute l’équipe serait prévenue. Redemande-moi dans un instant, ou passe par l’écran Planning si ça persiste.`,
      }
    }

    const lignes: string[] = []
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
      charge: {
        periodeId: p.id,
        // Ce qui a été MONTRÉ. L'exécution redemande le contrôle à la route et
        // compare : une réserve apparue entre l'affichage et le clic n'est pas
        // publiée en douce. Même patron que `reparer_absence` (absences.ts) et
        // que la validation d'échange (echanges.ts).
        violationsMontrees: violations.map((v) => v.detail),
        souhaitsMontres: souhaitsEnAttente,
        // Un contrôle qui a ÉCHOUÉ à l'aperçu ne donne aucun point de
        // comparaison : on ne peut pas dire « rien de nouveau » quand on n'a
        // jamais rien lu. L'exécution s'arrête plutôt que de confirmer à
        // l'aveugle des réserves que l'admin n'a pas pu voir.
        controleEchoue: controleViolationsEchoue || controleSouhaitsEchoue,
      },
    }
  },

  async executer(_params, _ctx, charge) {
    const c = charge as
      | {
          periodeId?: string
          violationsMontrees?: string[]
          souhaitsMontres?: number
          controleEchoue?: boolean
        }
      | undefined
    if (!c?.periodeId) return { error: 'La proposition a été perdue — redemande-la à Filou.' }

    if (c.controleEchoue) {
      return {
        error:
          "Je n'ai pas pu vérifier l'état du planning au moment de te faire la proposition — je ne publie pas sur un contrôle absent : toute l'équipe serait prévenue d'un planning que personne n'a relu. Redemande-moi de publier, je referai la vérification et je te montrerai ce qu'elle donne.",
      }
    }

    // Délégation à la route réelle : c'est elle qui écrit le statut, envoie les
    // e-mails et synchronise l'agenda — jamais dupliqué ici.
    //
    // PREMIER APPEL SANS CONFIRMATION. C'est la route qui recalcule et qui
    // tranche, pas Filou. Trois issues :
    //   • elle publie      → il n'y avait rien à signaler, terminé ;
    //   • elle demande une confirmation avec EXACTEMENT les réserves déjà
    //     montrées → on confirme, l'admin a tranché en connaissance de cause ;
    //   • elle en remonte une NOUVELLE → on n'écrit pas. Publier reste possible
    //     avec des réserves (le système informe, il n'interdit pas), mais pas
    //     avec des réserves que personne n'a vues.
    const premier = await appelerPublish(c.periodeId, false)
    if (premier.error) return { error: premier.error }
    if (!premier.requiresConfirmation) return {}

    const montrees = new Set(c.violationsMontrees ?? [])
    const nouvelles = (premier.violations ?? []).map((v) => v.detail).filter((d) => !montrees.has(d))
    const souhaitsEnPlus = (premier.souhaitsEnAttente ?? 0) - (c.souhaitsMontres ?? 0)

    if (nouvelles.length > 0 || souhaitsEnPlus > 0) {
      const morceaux: string[] = []
      if (nouvelles.length > 0) {
        morceaux.push(
          `${nouvelles.length === 1 ? 'un point de règle' : `${nouvelles.length} points de règle`} que je ne t'avais pas montré${nouvelles.length === 1 ? '' : 's'} — ${nouvelles.slice(0, 5).join(' ')}`,
        )
      }
      if (souhaitsEnPlus > 0) {
        morceaux.push(
          `${souhaitsEnPlus === 1 ? 'une demande de congé de plus' : `${souhaitsEnPlus} demandes de congé de plus`} en attente sur ces dates`,
        )
      }
      return {
        error: `Le planning a changé depuis ma proposition : il y a maintenant ${morceaux.join(' et ')}. Je ne publie pas sans te l'avoir montré — redemande-moi de publier pour que je te présente la situation à jour.`,
      }
    }

    const second = await appelerPublish(c.periodeId, true)
    if (second.error) return { error: second.error }
    if (second.requiresConfirmation) {
      return { error: 'La publication a été refusée par un contrôle imprévu — redemande à Filou de publier à nouveau.' }
    }
    return {}
  },
}
