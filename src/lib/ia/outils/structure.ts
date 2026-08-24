// ============================================================
// GUARDVETO — Outils de Filou : structure du planning & réglages du cabinet
// ============================================================
// SERVER-ONLY. L'écran Structure avait ses propres assistants IA (proposition
// de profil, proposition de liaison) séparés de Filou. La décision produit est
// qu'il n'y ait plus qu'un seul assistant : ces outils RÉUTILISENT ces deux
// assistants comme moteurs de traduction (proposerProfilDepuisTexte,
// proposerRelationDepuisTexte), exactement comme creer_regle réutilise
// l'assistant règles — même patron `charge` (regles.ts) : ce que l'aperçu a
// obtenu voyage tel quel jusqu'à l'exécution, pour ne jamais montrer A et
// créer B.
//
// Le modèle ne manipule NI UUID de profil, NI UUID de créneau : il parle en
// NOMS (profil, créneau) et en horaires/jours. La résolution nom → identifiant
// se fait ici, sur les données réelles du cabinet, et refuse net dès qu'elle
// est ambiguë (même discipline que resoudre() dans equipe.ts).
//
// Toucher à la structure change la forme du planning des PÉRIODES À VENIR :
// chaque proposition d'écriture porte donc un avertissement, et prévient
// quand la cible est déjà utilisée par une période existante (periodes.profil_id)
// — c'est la seule inspection de consumer possible ici : une période verrouillée
// dont la structure change sous elle serait une incohérence silencieuse.
// ============================================================

import { z } from 'zod'
import {
  proposerProfilDepuisTexte,
  proposerRelationDepuisTexte,
  creerProfilComplet,
  creerRelationCreneau,
  setCreneauActif,
  supprimerCreneauSurMesure,
  setRelationActive,
  supprimerRelation,
  supprimerProfil,
  setHorairesProfilCreneau,
  setAffinagePeriodeType,
  creerCreneauSurMesure,
  configurerAdresseCabinet,
  configurerPartagesCabinet,
  type CreerRelationPayload,
  type CreerCreneauSurMesurePayload,
} from '@/app/(protected)/admin/structure/actions'
import { adresseBienFormee } from '@/lib/emails/destinataire'
import type { CreerProfilCompletPayload } from '@/lib/ia/profilSchema'
import type { CreerRelationIaPayload } from '@/lib/ia/relationSchema'
import { SANS_PARAMETRE, type ContexteOutil, type OutilEcriture, type OutilLecture, type PropositionAction } from './types'

// ── Chargement des données de structure (partagé lecture + résolution) ──────

interface ProfilRow {
  id: string
  nom: string
  actif: boolean
  est_defaut: boolean
  saison_suggeree: string | null
  nb_vetos_semaine_soir: number | null
}

interface CreneauRow {
  id: string
  profil_id: string
  code: string | null
  nom: string
  jours_semaine: number[] | null
  heure_debut: string
  heure_fin: string
  offset_jours_fin: number
  nb_places: number
  roles: string[] | null
  actif: boolean
}

interface RelationRow {
  id: string
  profil_id: string
  source_id: string
  cible_id: string
  genre: string
  actif: boolean
}

async function chargerProfils(ctx: ContexteOutil): Promise<ProfilRow[]> {
  const { data } = await ctx.supabase
    .from('profils_planning')
    .select('id, nom, actif, est_defaut, saison_suggeree, nb_vetos_semaine_soir')
    .order('ordre')
  return (data as ProfilRow[] | null) ?? []
}

/**
 * LE SOCLE du cabinet (2026-08-04). Les créneaux ne sont plus dupliqués par
 * période type : il en existe un jeu unique (`profil_id IS NULL`), et chaque
 * période type dit seulement combien de vétérinaires elle veut sur chacun.
 *
 * ⚠️ Sans ce filtre, la requête rendait aussi d'éventuels résidus rattachés à
 * une période type — et surtout, tout le code qui filtrait ensuite sur
 * `profil_id === <celui de la période>` ne trouvait plus RIEN : Filou
 * répondait « aucun type de garde dans cette période type » sur un cabinet
 * parfaitement configuré.
 */
async function chargerCreneaux(ctx: ContexteOutil): Promise<CreneauRow[]> {
  const { data } = await ctx.supabase
    .from('creneau_modele')
    .select('id, profil_id, code, nom, jours_semaine, heure_debut, heure_fin, offset_jours_fin, nb_places, roles, actif')
    .is('profil_id', null)
    .order('ordre')
  return (data as CreneauRow[] | null) ?? []
}

async function chargerRelations(ctx: ContexteOutil): Promise<RelationRow[]> {
  const { data } = await ctx.supabase
    .from('relation_creneau')
    .select('id, profil_id, source_id, cible_id, genre, actif')
    .is('profil_id', null)
  return (data as RelationRow[] | null) ?? []
}

/** Ce que chaque période type retient : `profil_id|creneau_id` → nb de vétos. */
async function chargerAffinages(ctx: ContexteOutil): Promise<Map<string, number>> {
  const { data } = await ctx.supabase
    .from('periode_type_creneau')
    .select('profil_id, creneau_id, nb_vetos')
  const m = new Map<string, number>()
  for (const r of (data ?? []) as { profil_id: string; creneau_id: string; nb_vetos: number }[]) {
    m.set(`${r.profil_id}|${r.creneau_id}`, r.nb_vetos)
  }
  return m
}

/**
 * Combien de vétérinaires une période type retient sur une garde du socle.
 * MÊME RÈGLE que `appliquerAffinage` côté moteur : aucune ligne = le créneau
 * tel quel, jamais plus que le socle. `0` = pas de garde de ce type ici.
 */
function vetosRetenus(
  affinages: ReadonlyMap<string, number>,
  profilId: string,
  creneau: { id: string; nb_places: number },
): number {
  const voulu = affinages.get(`${profilId}|${creneau.id}`)
  if (voulu === undefined) return creneau.nb_places
  return Math.max(0, Math.min(voulu, creneau.nb_places))
}

/** Compte les périodes qui référencent explicitement ce profil (repli défaut
 *  exclu : NULL = défaut, donc jamais compté ici). Sert à l'avertissement. */
async function comptePeriodesSurProfil(ctx: ContexteOutil, profilId: string): Promise<number> {
  const { count } = await ctx.supabase
    .from('periodes')
    .select('id', { count: 'exact', head: true })
    .eq('profil_id', profilId)
  return count ?? 0
}

const DIACRITIQUES = /[̀-ͯ]/g

/** Compare deux noms sans se laisser arrêter par les accents, la casse ou un
 *  trait d'union — même discipline que memeNom() dans equipe.ts. */
function memeNom(a: string, b: string): boolean {
  const nettoyer = (s: string) =>
    s.normalize('NFD').replace(DIACRITIQUES, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return nettoyer(a) === nettoyer(b)
}

/** Résout un nom de profil en fiche, parmi les profils ACTIFS. Refuse
 *  l'à-peu-près : mieux vaut redemander que modifier le mauvais profil.
 *  `undefined` → le profil par défaut du cabinet. */
function resoudreProfil(
  profils: ProfilRow[],
  nom: string | undefined,
): { ok: true; profil: ProfilRow } | { ok: false; raison: string } {
  const actifs = profils.filter((p) => p.actif)
  if (!nom || !nom.trim()) {
    const def = actifs.find((p) => p.est_defaut)
    if (def) return { ok: true, profil: def }
    return { ok: false, raison: 'Aucune période type par défaut disponible pour ce cabinet.' }
  }
  const exacts = actifs.filter((p) => memeNom(p.nom, nom))
  if (exacts.length === 1) return { ok: true, profil: exacts[0] }
  if (exacts.length > 1) {
    return { ok: false, raison: `Plusieurs périodes types s'appellent « ${nom} ». Précise laquelle.` }
  }
  const connus = actifs.map((p) => p.nom).join(', ')
  return {
    ok: false,
    raison: `Aucune période type ne s'appelle « ${nom} ». Les périodes types du cabinet sont : ${connus}.`,
  }
}

/**
 * Résout un nom de garde DANS LE SOCLE du cabinet.
 *
 * Le paramètre `profilId` a disparu (2026-08-04) : une garde n'appartient plus
 * à une période type, elle appartient au cabinet. Chercher « Soir du vendredi
 * dans Hiver » n'a plus de sens — il n'y en a qu'un, et Hiver dit seulement
 * combien de personnes elle y met.
 */
function resoudreCreneau(
  creneaux: CreneauRow[],
  nom: string,
): { ok: true; creneau: CreneauRow } | { ok: false; raison: string } {
  const exacts = creneaux.filter((c) => memeNom(c.nom, nom))
  if (exacts.length === 1) return { ok: true, creneau: exacts[0] }
  if (exacts.length > 1) {
    return { ok: false, raison: `Plusieurs types de garde s'appellent « ${nom} ». Précise lequel.` }
  }
  const connus = creneaux.map((c) => c.nom).join(', ') || '(aucun)'
  return {
    ok: false,
    raison: `Aucun type de garde ne s'appelle « ${nom} » dans la structure du cabinet. Ceux qui existent : ${connus}.`,
  }
}

// Index = jour de la semaine tel que stocké en base (0=dimanche … 6=samedi,
// convention SQL EXTRACT(DOW)). Const tuple réutilisée aussi comme énum Zod
// pour la création de créneau sur-mesure : le modèle écrit un nom de jour,
// jamais un chiffre — un « 0 » ou un « 7 » mal recopié serait invisible.
const JOURS_LABEL = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const

function joursHumains(jours: number[] | null): string {
  if (!jours || jours.length === 0) return 'aucun jour'
  return jours
    .slice()
    .sort()
    .map((j) => JOURS_LABEL[j] ?? String(j))
    .join(', ')
}

/** Miroir de la borne côté serveur (actions.ts n'exporte pas sa constante) —
 *  le serveur revalide de toute façon ; ceci n'est qu'un garde-fou côté outil
 *  pour ne pas proposer une valeur que le serveur rejettera. */
const N_PLACES_MAX = 4

const GENRE_HUMAIN: Record<string, string> = {
  meme_binome: 'même équipe',
  inversion_role: 'rôles différents',
}

// ════════════════════════════════════════════════════════════
// Lecture
// ════════════════════════════════════════════════════════════

export const lireProfilsPlanning: OutilLecture<typeof SANS_PARAMETRE> = {
  genre: 'lecture',
  nom: 'lire_profils_planning',
  description: `Donne la liste des PÉRIODES TYPES du cabinet (« Hiver », « Été »…) : leur nom, si elle est active, et laquelle sert de repli par défaut.

COMMENT S'ORGANISE UN CABINET (à savoir avant de répondre sur la structure) :
· LA STRUCTURE DES GARDES est le SOCLE, commun à tout le cabinet : quels types de garde existent, quels jours, quels horaires, et jusqu'à combien de vétérinaires chacun peut accueillir.
· UNE PÉRIODE TYPE AFFINE ce socle : elle dit, pour chaque garde, combien de vétérinaires elle veut réellement — et « aucun », ce qui retire complètement cette garde de la période.
Autrement dit : le socle donne les possibilités, la période type choisit dedans. Une période type ne possède PAS ses propres horaires.

À l'écran, l'utilisateur dit « période type » et « type de garde » : emploie ces mots-là, jamais « profil » ni « créneau ».

Appelle-le avant de créer une période type (pour vérifier qu'un équivalent n'existe pas), ou pour toute question sur celles qui existent. Pour savoir ce que l'une d'elles retient, appelle lire_creneaux_profil.`,
  params: SANS_PARAMETRE,
  async executer(_params, ctx) {
    const profils = await chargerProfils(ctx)
    // Ni saison suggérée ni effectif de nuit : les deux réglages ont été
    // supprimés le 2026-08-04. Les annoncer ferait parler Filou de leviers
    // que le cabinet ne trouverait nulle part à l'écran.
    return profils.map((p) => ({
      nom: p.nom,
      actif: p.actif,
      periode_type_par_defaut: p.est_defaut,
    }))
  },
}

const ParamsLireCreneaux = z.object({
  profil: z
    .string()
    .optional()
    .describe('Le nom du profil dont on veut le catalogue. Laisse vide pour le profil par défaut.'),
})

export const lireCreneauxProfil: OutilLecture<typeof ParamsLireCreneaux> = {
  genre: 'lecture',
  nom: 'lire_creneaux_profil',
  description: `Donne les TYPES DE GARDE du cabinet et ce qu'une période type en retient : nom, jours couverts, horaires, le maximum de vétérinaires possible (le socle) et le nombre réellement retenu par cette période type.

Quand « vetos_sur_cette_periode » vaut 0, la garde N'EXISTE PAS sur cette période type : le moteur n'en posera aucune ces jours-là. Dis-le clairement si on te pose la question.

Les jours et les horaires appartiennent au CABINET (le socle) : ils sont les mêmes pour toutes les périodes types. Seul le nombre de vétérinaires change de l'une à l'autre. Ne laisse jamais croire qu'on peut changer un horaire « pour l'hiver seulement ».

Appelle-le pour toute question sur les horaires, la composition d'une période type, ou avant de créer une liaison entre deux gardes (il faut leurs noms exacts).`,
  params: ParamsLireCreneaux,
  async executer(params, ctx) {
    const profils = await chargerProfils(ctx)
    const trouve = resoudreProfil(profils, params.profil)
    if (!trouve.ok) return { erreur: trouve.raison }

    const [creneaux, affinages] = await Promise.all([
      chargerCreneaux(ctx),
      chargerAffinages(ctx),
    ])

    return {
      periode_type: trouve.profil.nom,
      gardes: creneaux.map((c) => {
        const retenus = vetosRetenus(affinages, trouve.profil.id, c)
        return {
          nom: c.nom,
          jours: joursHumains(c.jours_semaine),
          heure_debut: c.heure_debut,
          heure_fin: c.heure_fin,
          jour_de_fin: c.offset_jours_fin === 0 ? 'même jour' : `+${c.offset_jours_fin} jour(s)`,
          maximum_possible: c.nb_places,
          vetos_sur_cette_periode: retenus,
          absente_de_cette_periode: retenus === 0,
          roles: (c.roles ?? []).slice(0, retenus),
          actif: c.actif,
        }
      }),
    }
  },
}

const ParamsLireRelations = z.object({
  profil: z
    .string()
    .optional()
    .describe('Le nom du profil dont on veut les liaisons. Laisse vide pour le profil par défaut.'),
})

export const lireRelationsCreneaux: OutilLecture<typeof ParamsLireRelations> = {
  genre: 'lecture',
  nom: 'lire_relations_creneaux',
  description: `Donne les liaisons entre types de garde : « même équipe » (les deux gardes sont tenues par les mêmes vétérinaires) ou « rôles différents » (l'équipe s'inverse de l'une à l'autre).

Les liaisons appartiennent au CABINET, comme les gardes elles-mêmes : elles sont les mêmes pour toutes les périodes types. Une liaison dont l'une des deux gardes est absente d'une période type (0 vétérinaire) ne s'y applique simplement pas — c'est signalé par « sans_effet_sur_cette_periode ».

Appelle-le pour « le vendredi soir et le week-end sont-ils liés ? », ou avant de proposer une nouvelle liaison (pour vérifier qu'elle n'existe pas déjà).`,
  params: ParamsLireRelations,
  async executer(params, ctx) {
    const profils = await chargerProfils(ctx)
    const trouve = resoudreProfil(profils, params.profil)
    if (!trouve.ok) return { erreur: trouve.raison }

    const [creneaux, relations, affinages] = await Promise.all([
      chargerCreneaux(ctx), chargerRelations(ctx), chargerAffinages(ctx),
    ])
    const parId = new Map(creneaux.map((c) => [c.id, c]))
    const nomCreneau = (id: string) => parId.get(id)?.nom ?? 'une garde'
    const absente = (id: string) => {
      const c = parId.get(id)
      return c ? vetosRetenus(affinages, trouve.profil.id, c) === 0 : false
    }

    return {
      periode_type: trouve.profil.nom,
      liaisons: relations.map((r) => ({
        de: nomCreneau(r.source_id),
        vers: nomCreneau(r.cible_id),
        regle: GENRE_HUMAIN[r.genre] ?? r.genre,
        active: r.actif,
        sans_effet_sur_cette_periode: absente(r.source_id) || absente(r.cible_id),
      })),
    }
  },
}

export const lireReglagesCabinet: OutilLecture<typeof SANS_PARAMETRE> = {
  genre: 'lecture',
  nom: 'lire_reglages_cabinet',
  // Reserve a l'admin, comme l'ecran /reglages qui montre exactement ces
  // champs et redirige un veterinaire vers l'accueil. Ce sont des
  // branchements d'infrastructure — identifiant de l'agenda Google, adresse
  // d'expedition des e-mails, adresse d'exercice : rien qu'un veterinaire ait
  // a connaitre, et la RLS de `cabinets` ne pose aucune condition de role.
  adminSeulement: true,
  description: `Donne les réglages généraux du cabinet : adresse, zone scolaire (A/B/C) et région des fériés (dérivées de l'adresse), agenda Google partagé, expéditeur des e-mails.

Appelle-le pour toute question sur ces branchements — « quelle est notre zone scolaire ? », « quel agenda est partagé ? », « qui envoie les e-mails ? ».`,
  params: SANS_PARAMETRE,
  async executer(_params, ctx) {
    const { data } = await ctx.supabase
      .from('cabinets')
      .select(
        'adresse, code_postal, ville, zone_scolaire, region_feries, google_calendar_id, brevo_from_email, brevo_from_name',
      )
      .eq('id', ctx.cabinetId)
      .maybeSingle()

    const c = data as {
      adresse: string | null
      code_postal: string | null
      ville: string | null
      zone_scolaire: string | null
      region_feries: string | null
      google_calendar_id: string | null
      brevo_from_email: string | null
      brevo_from_name: string | null
    } | null

    if (!c) return { erreur: 'Réglages du cabinet introuvables.' }

    return {
      adresse: c.adresse,
      code_postal: c.code_postal,
      ville: c.ville,
      zone_scolaire: c.zone_scolaire,
      region_feries: c.region_feries,
      agenda_google_partage: c.google_calendar_id ?? '(réglage par défaut du serveur)',
      email_expediteur: c.brevo_from_email ?? '(réglage par défaut du serveur)',
      nom_expediteur: c.brevo_from_name ?? '(réglage par défaut du serveur)',
    }
  },
}

// ════════════════════════════════════════════════════════════
// Écriture — créer un PROFIL depuis une phrase (délégation)
// ════════════════════════════════════════════════════════════
// Même patron que creer_regle (regles.ts) : l'assistant existant
// (proposerProfilDepuisTexte) traduit la phrase en proposition structurée ; ce
// que l'aperçu a obtenu voyage en `charge` jusqu'à creerProfilComplet, sans
// jamais rappeler l'assistant à l'exécution.

const ParamsCreerProfil = z.object({
  demande: z
    .string()
    .describe(
      'La description du profil à créer, en une phrase complète et autonome. Ex. « Crée un profil Été basé sur Hiver, avec 1 seul vétérinaire le soir en semaine, gardes de semaine à 19h ».',
    ),
})

export const creerProfilDepuisPhrase: OutilEcriture<typeof ParamsCreerProfil> = {
  genre: 'ecriture',
  nom: 'creer_profil_planning',
  description: `Prépare la création d'un NOUVEAU profil de planning (« Été », « Vacances scolaires »…) à partir d'une phrase en français.

Appelle-le quand la demande crée une structure de planning qui n'existe pas encore. Le profil est composé à partir des types de garde EXISTANTS du profil source (par défaut le profil par défaut du cabinet) : on ne peut pas inventer un type de garde inédit ici, seulement dupliquer et ajuster horaires/saison/effectif.

Avant d'appeler, vérifie avec lire_profils_planning qu'un profil équivalent n'existe pas déjà. Rien n'est créé tant que la personne n'a pas validé.`,
  params: ParamsCreerProfil,
  adminSeulement: true,

  async resumer(params) {
    const res = await proposerProfilDepuisTexte(params.demande)
    if ('error' in res) return { ok: false, raison: res.error }
    if (!res.payload) {
      return {
        ok: false,
        raison: res.proposition.message || "Je n'arrive pas à traduire cette demande en profil de planning.",
      }
    }

    return {
      ok: true,
      proposition: {
        titre: 'Créer un profil de planning',
        phrase: res.apercu,
        action: 'Créer ce profil',
        avertissement:
          'Ce profil ne sera utilisé que par les périodes qui le sélectionneront explicitement à la génération : les périodes déjà générées ne changent pas.',
      },
      charge: { payload: res.payload },
    }
  },

  async executer(_params, _ctx, charge) {
    const c = charge as { payload?: CreerProfilCompletPayload } | undefined
    if (!c?.payload) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    return creerProfilComplet(c.payload)
  },
}

// ════════════════════════════════════════════════════════════
// Écriture — créer une RELATION entre créneaux depuis une phrase (délégation)
// ════════════════════════════════════════════════════════════

const ParamsCreerRelation = z.object({
  demande: z
    .string()
    .describe(
      'La liaison à créer, en une phrase complète et autonome, nommant les deux créneaux. Ex. « Le vendredi soir et le week-end doivent être tenus par la même équipe ».',
    ),
})

export const creerRelationDepuisPhrase: OutilEcriture<typeof ParamsCreerRelation> = {
  genre: 'ecriture',
  nom: 'creer_relation_creneaux',
  description: `Prépare la création d'une LIAISON entre deux créneaux d'un même profil : « même équipe » (les deux créneaux doivent être tenus par les mêmes vétérinaires) ou « rôles différents » (l'équipe s'inverse).

Appelle-le quand la demande relie explicitement deux types de garde — « le vendredi soir et le week-end, même équipe », « inverse les rôles entre le samedi et le dimanche ».

Avant d'appeler, vérifie avec lire_relations_creneaux que la liaison n'existe pas déjà. Rien n'est créé tant que la personne n'a pas validé.`,
  params: ParamsCreerRelation,
  adminSeulement: true,

  async resumer(params, ctx) {
    const res = await proposerRelationDepuisTexte(params.demande)
    if ('error' in res) return { ok: false, raison: res.error }
    if (!res.payload) {
      return {
        ok: false,
        raison: res.proposition.message || "Je n'arrive pas à traduire cette demande en liaison entre créneaux.",
      }
    }

    const profils = await chargerProfils(ctx)
    const nomProfil = profils.find((p) => p.id === res.payload!.profil_id)?.nom

    return {
      ok: true,
      proposition: {
        titre: 'Créer une liaison entre créneaux',
        phrase: res.apercu,
        lignes: nomProfil ? [`Profil concerné : ${nomProfil}`] : undefined,
        action: 'Créer cette liaison',
        avertissement:
          'La liaison s\'applique à la prochaine génération de planning sur ce profil : les périodes déjà générées ne changent pas.',
      },
      charge: { payload: res.payload },
    }
  },

  async executer(_params, _ctx, charge) {
    const c = charge as { payload?: CreerRelationIaPayload } | undefined
    if (!c?.payload) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    return creerRelationCreneau(c.payload as CreerRelationPayload)
  },
}

// ════════════════════════════════════════════════════════════
// Écriture — activer / désactiver / supprimer un créneau
// ════════════════════════════════════════════════════════════

const ParamsCreneauActif = z.object({
  profil: z.string().optional().describe('Le profil concerné. Laisse vide pour le profil par défaut.'),
  creneau: z.string().describe('Le nom du créneau, tel qu’il apparaît dans le profil.'),
  action: z
    .enum(['desactiver', 'activer', 'supprimer'])
    .describe(
      'desactiver = le créneau n’émet plus de garde (réversible) ; activer = le remettre en service ; supprimer = l’effacer définitivement — impossible sur les 4 créneaux de base, désactive-les à la place.',
    ),
})

export const agirSurCreneau: OutilEcriture<typeof ParamsCreneauActif> = {
  genre: 'ecriture',
  nom: 'agir_sur_creneau',
  description: `Prépare la mise en pause, la remise en service, ou la suppression définitive d'un créneau EXISTANT dans un profil.

Appelle-le quand la demande retire ou réactive un type de garde — « désactive le samedi seul dans le profil Été », « supprime le créneau garde de jour ».

Préfère la désactivation à la suppression : elle se rattrape, l'effacement non. Les 4 créneaux de base du cabinet (semaine soir, vendredi soir, week-end, férié) ne peuvent qu'être désactivés, jamais supprimés — c'est le filet de sécurité du cabinet.`,
  params: ParamsCreneauActif,
  adminSeulement: true,

  async resumer(params, ctx) {
    const profils = await chargerProfils(ctx)
    const trouveProfil = resoudreProfil(profils, params.profil)
    if (!trouveProfil.ok) return { ok: false, raison: trouveProfil.raison }

    const creneaux = await chargerCreneaux(ctx)
    const trouve = resoudreCreneau(creneaux, params.creneau)
    if (!trouve.ok) return { ok: false, raison: trouve.raison }
    const cr = trouve.creneau

    if (params.action === 'supprimer') {
      const CODES_SEED = new Set(['semaine_soir', 'vendredi_soir', 'weekend', 'ferie'])
      if (cr.code !== null && CODES_SEED.has(cr.code)) {
        return {
          ok: false,
          raison: `« ${cr.nom} » fait partie des 4 créneaux de base du cabinet : il ne peut pas être supprimé, seulement désactivé.`,
        }
      }
    } else if ((params.action === 'activer') === cr.actif) {
      return { ok: false, raison: `« ${cr.nom} » est déjà dans cet état.` }
    }

    const periodesConcernees = await comptePeriodesSurProfil(ctx, trouveProfil.profil.id)
    const avertPeriode =
      periodesConcernees > 0
        ? ` Attention : ${periodesConcernees} période(s) utilisent explicitement le profil « ${trouveProfil.profil.nom} ».`
        : ''

    const verbe =
      params.action === 'supprimer' ? 'supprimer définitivement' : params.action === 'desactiver' ? 'mettre en pause' : 'remettre en service'

    return {
      ok: true,
      proposition: {
        titre: `${params.action === 'supprimer' ? 'Supprimer' : params.action === 'desactiver' ? 'Désactiver' : 'Activer'} un créneau`,
        phrase: `Je vais ${verbe} « ${cr.nom} » dans le profil « ${trouveProfil.profil.nom} ».`,
        action:
          params.action === 'supprimer' ? 'Supprimer définitivement' : params.action === 'desactiver' ? 'Mettre en pause' : 'Remettre en service',
        avertissement:
          (params.action === 'supprimer'
            ? 'La suppression ne se rattrape pas.'
            : 'Le planning déjà généré ne bouge pas : le changement vaut pour la prochaine génération sur ce profil.') + avertPeriode,
      },
      charge: { creneauId: cr.id, action: params.action },
    }
  },

  async executer(_params, _ctx, charge) {
    const c = charge as { creneauId?: string; action?: string } | undefined
    if (!c?.creneauId || !c.action) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    if (c.action === 'supprimer') {
      const r = await supprimerCreneauSurMesure(c.creneauId)
      return 'error' in r ? { error: r.error } : {}
    }
    const r = await setCreneauActif(c.creneauId, c.action === 'activer')
    return 'error' in r ? { error: r.error } : {}
  },
}

// ════════════════════════════════════════════════════════════
// Écriture — créer un CRÉNEAU SUR-MESURE (P3b)
// ════════════════════════════════════════════════════════════
// Contrairement au profil et à la relation, il n'existe PAS d'assistant IA
// dédié côté écran Structure pour cette capacité (elle est saisie à la main,
// champ par champ, dans le formulaire) : cet outil ne délègue donc pas une
// traduction à un assistant existant, il construit directement le payload à
// partir des champs structurés que le modèle a remplis, puis délègue
// l'ÉCRITURE elle-même à creerCreneauSurMesure — même frontière de confiance
// (assertAdmin + RLS + validation) que le bouton de l'écran.
//
// nb_places est le champ le plus lourd de conséquences : c'est lui qui dit au
// moteur combien de vétérinaires il doit trouver DISPONIBLES EN MÊME TEMPS
// pour ce créneau. On le rappelle dans l'avertissement avec l'effectif réel
// du cabinet, pour que la personne mesure l'exigence avant de valider.

const ParamsCreerCreneau = z.object({
  profil: z
    .string()
    .optional()
    .describe('Le profil dans lequel créer le créneau. Laisse vide pour le profil par défaut.'),
  nom: z.string().describe('Le nom du créneau, tel qu’il doit apparaître dans le planning. Ex. « Garde de jour ».'),
  jours: z
    .array(z.enum(JOURS_LABEL))
    .min(1)
    .describe('Les jours de la semaine couverts par ce créneau, au moins un.'),
  heure_debut: z.string().describe('Heure de début au format HH:MM (24h), ex. « 08:00 ».'),
  heure_fin: z.string().describe('Heure de fin au format HH:MM (24h).'),
  jour_de_fin: z
    .number()
    .int()
    .min(0)
    .max(3)
    .describe('0 = se termine le même jour ; 1 = le lendemain ; 2 = le surlendemain ; 3 = trois jours après.'),
  nb_places: z
    .number()
    .int()
    .min(1)
    .max(N_PLACES_MAX)
    .describe(
      `Nombre de vétérinaires que le moteur devra affecter EN MÊME TEMPS sur ce créneau (entre 1 et ${N_PLACES_MAX}). Ce nombre a un vrai coût de génération : plus il est élevé, plus il faut de vétérinaires disponibles simultanément.`,
    ),
  roles: z
    .array(z.string())
    .describe(
      'Un nom de place par vétérinaire attendu (longueur = nb_places), tous différents. Ex. pour 2 places : ["Vétérinaire de garde", "Vétérinaire de renfort"]. Pour 1 place, un seul nom suffit.',
    ),
})

/** Places du créneau ↔ effectif réel du cabinet : borne haute (N_PLACES_MAX)
 *  déjà mécanique côté serveur, mais un cabinet à faible effectif peut se
 *  fabriquer un créneau ingénérable (ex. 4 places pour 5 vétérinaires actifs,
 *  alors que d'autres créneaux tournent en parallèle). On ne bloque pas — la
 *  décision reste au cabinet — mais on le dit explicitement. */
async function compteVetosActifs(ctx: ContexteOutil): Promise<number> {
  const { count } = await ctx.supabase
    .from('veterinaires')
    .select('id', { count: 'exact', head: true })
    .eq('actif', true)
  return count ?? 0
}

export const creerCreneauSurMesureDepuisPhrase: OutilEcriture<typeof ParamsCreerCreneau> = {
  genre: 'ecriture',
  nom: 'creer_creneau_sur_mesure',
  description: `Prépare la création d'un NOUVEAU créneau (type de garde) dans le catalogue d'un profil : nom, jours de la semaine, horaires, nombre de vétérinaires requis et rôles.

Appelle-le quand la demande décrit un type de garde qui n'existe pas encore dans le profil — « ajoute une garde de jour le samedi de 8h à 20h », « crée un créneau week-end fractionné avec un vétérinaire le samedi et un autre le dimanche ».

Avant d'appeler, vérifie avec lire_creneaux_profil qu'un créneau équivalent n'existe pas déjà dans ce profil. Rien n'est créé tant que la personne n'a pas validé.`,
  params: ParamsCreerCreneau,
  adminSeulement: true,

  async resumer(params, ctx) {
    const profils = await chargerProfils(ctx)
    const trouveProfil = resoudreProfil(profils, params.profil)
    if (!trouveProfil.ok) return { ok: false, raison: trouveProfil.raison }

    const nom = params.nom?.trim()
    if (!nom) return { ok: false, raison: 'Donne un nom au créneau.' }
    if (nom.length > 60) return { ok: false, raison: 'Le nom du créneau est trop long (60 caractères max).' }

    const creneauxExistants = await chargerCreneaux(ctx)
    const doublon = creneauxExistants.find(
      (c) => c.profil_id === trouveProfil.profil.id && memeNom(c.nom, nom),
    )
    if (doublon) {
      return {
        ok: false,
        raison: `Un créneau « ${doublon.nom} » existe déjà dans le profil « ${trouveProfil.profil.nom} ».`,
      }
    }

    const HEURE_RE = /^([01]\d|2[0-3]):[0-5]\d$/
    if (!HEURE_RE.test(params.heure_debut) || !HEURE_RE.test(params.heure_fin)) {
      return { ok: false, raison: 'Heure invalide (format attendu HH:MM, ex. 08:00).' }
    }
    if (params.jour_de_fin === 0) {
      const [h1, m1] = params.heure_debut.split(':').map(Number)
      const [h2, m2] = params.heure_fin.split(':').map(Number)
      if (h2 * 60 + m2 <= h1 * 60 + m1) {
        return {
          ok: false,
          raison: "L'heure de fin doit être après l'heure de début, ou la garde doit se terminer un jour suivant.",
        }
      }
    }

    const roles = (params.roles ?? []).map((r) => r.trim())
    if (roles.length !== params.nb_places || roles.some((r) => !r || r.length > 30)) {
      return {
        ok: false,
        raison: `Il faut exactement ${params.nb_places} nom(s) de place, non vide(s) (30 caractères max chacun).`,
      }
    }
    if (new Set(roles).size !== roles.length) {
      return { ok: false, raison: 'Les noms des places doivent être différents.' }
    }

    const jours = [...new Set(params.jours.map((j) => JOURS_LABEL.indexOf(j)))].sort()

    const [periodesConcernees, effectifCabinet] = await Promise.all([
      comptePeriodesSurProfil(ctx, trouveProfil.profil.id),
      compteVetosActifs(ctx),
    ])

    const suffixDuree = params.jour_de_fin === 0 ? '' : ` (+${params.jour_de_fin} jour${params.jour_de_fin > 1 ? 's' : ''})`
    const lignes = [
      `Jours : ${joursHumains(jours)}`,
      `Horaires : ${params.heure_debut} → ${params.heure_fin}${suffixDuree}`,
      `Places : ${params.nb_places} (${roles.join(', ')})`,
    ]

    const avertPlaces =
      params.nb_places > 1
        ? ` Ce créneau demandera ${params.nb_places} vétérinaires disponibles EN MÊME TEMPS sur le cabinet (qui compte ${effectifCabinet} vétérinaire${effectifCabinet > 1 ? 's' : ''} actif${effectifCabinet > 1 ? 's' : ''}) — vérifie que c'est tenable en plus des autres créneaux du même jour.`
        : ''
    const avertPeriode =
      periodesConcernees > 0
        ? ` ${periodesConcernees} période(s) utilisent déjà explicitement le profil « ${trouveProfil.profil.nom} ».`
        : ''

    return {
      ok: true,
      proposition: {
        titre: `Créer le créneau « ${nom} »`,
        phrase: `Créer « ${nom} » dans le profil « ${trouveProfil.profil.nom} ».`,
        lignes,
        action: 'Créer ce créneau',
        avertissement:
          'Ce nouveau créneau change la forme des plannings à venir sur ce profil : le planning déjà généré ne bouge pas.' +
          avertPlaces +
          avertPeriode,
      },
      charge: {
        payload: {
          profil_id: trouveProfil.profil.id,
          nom,
          jours_semaine: jours,
          heure_debut: params.heure_debut,
          heure_fin: params.heure_fin,
          offset_jours_fin: params.jour_de_fin,
          nb_places: params.nb_places,
          roles,
        } satisfies CreerCreneauSurMesurePayload,
      },
    }
  },

  async executer(_params, _ctx, charge) {
    const c = charge as { payload?: CreerCreneauSurMesurePayload } | undefined
    if (!c?.payload) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    return creerCreneauSurMesure(c.payload)
  },
}

// ════════════════════════════════════════════════════════════
// Écriture — activer / désactiver / supprimer une relation
// ════════════════════════════════════════════════════════════

const ParamsRelationAction = z.object({
  profil: z.string().optional().describe('Le profil concerné. Laisse vide pour le profil par défaut.'),
  de: z.string().describe('Le nom du premier créneau de la liaison.'),
  vers: z.string().describe('Le nom du second créneau de la liaison.'),
  action: z
    .enum(['desactiver', 'activer', 'supprimer'])
    .describe('desactiver = ignorée par le moteur (réversible) ; activer = remise en service ; supprimer = effacée définitivement.'),
})

export const agirSurRelation: OutilEcriture<typeof ParamsRelationAction> = {
  genre: 'ecriture',
  nom: 'agir_sur_relation',
  description: `Prépare la mise en pause, la remise en service, ou la suppression d'une liaison EXISTANTE entre deux créneaux.

Appelle-le quand la demande lève ou remet une contrainte de liaison — « découple le vendredi soir du week-end », « remets la liaison entre le samedi et le dimanche ».

Appelle TOUJOURS lire_relations_creneaux juste avant pour connaître les noms exacts des deux créneaux liés. Préfère la désactivation à la suppression.`,
  params: ParamsRelationAction,
  adminSeulement: true,

  async resumer(params, ctx) {
    const profils = await chargerProfils(ctx)
    const trouveProfil = resoudreProfil(profils, params.profil)
    if (!trouveProfil.ok) return { ok: false, raison: trouveProfil.raison }

    const [creneaux, relations] = await Promise.all([chargerCreneaux(ctx), chargerRelations(ctx)])
    const source = resoudreCreneau(creneaux, params.de)
    if (!source.ok) return { ok: false, raison: source.raison }
    const cible = resoudreCreneau(creneaux, params.vers)
    if (!cible.ok) return { ok: false, raison: cible.raison }

    const relation = relations.find(
      (r) =>
        r.profil_id === trouveProfil.profil.id &&
        ((r.source_id === source.creneau.id && r.cible_id === cible.creneau.id) ||
          (r.source_id === cible.creneau.id && r.cible_id === source.creneau.id)),
    )
    if (!relation) {
      return {
        ok: false,
        raison: `Aucune liaison n'existe entre « ${source.creneau.nom} » et « ${cible.creneau.nom} » dans ce profil.`,
      }
    }
    if (params.action !== 'supprimer' && (params.action === 'activer') === relation.actif) {
      return { ok: false, raison: 'Cette liaison est déjà dans cet état.' }
    }

    const periodesConcernees = await comptePeriodesSurProfil(ctx, trouveProfil.profil.id)
    const avertPeriode =
      periodesConcernees > 0
        ? ` Attention : ${periodesConcernees} période(s) utilisent explicitement le profil « ${trouveProfil.profil.nom} ».`
        : ''

    const verbe =
      params.action === 'supprimer' ? 'supprimer définitivement' : params.action === 'desactiver' ? 'mettre en pause' : 'remettre en service'

    return {
      ok: true,
      proposition: {
        titre: `${params.action === 'supprimer' ? 'Supprimer' : params.action === 'desactiver' ? 'Désactiver' : 'Activer'} une liaison`,
        phrase: `Je vais ${verbe} la liaison « ${GENRE_HUMAIN[relation.genre] ?? relation.genre} » entre « ${source.creneau.nom} » et « ${cible.creneau.nom} ».`,
        action:
          params.action === 'supprimer' ? 'Supprimer définitivement' : params.action === 'desactiver' ? 'Mettre en pause' : 'Remettre en service',
        avertissement:
          (params.action === 'supprimer'
            ? 'La suppression ne se rattrape pas.'
            : 'Le planning déjà généré ne bouge pas : le changement vaut pour la prochaine génération sur ce profil.') + avertPeriode,
      },
      charge: { relationId: relation.id, action: params.action },
    }
  },

  async executer(_params, _ctx, charge) {
    const c = charge as { relationId?: string; action?: string } | undefined
    if (!c?.relationId || !c.action) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    if (c.action === 'supprimer') {
      const r = await supprimerRelation(c.relationId)
      return 'error' in r ? { error: r.error } : {}
    }
    const r = await setRelationActive(c.relationId, c.action === 'activer')
    return 'error' in r ? { error: r.error } : {}
  },
}

// ════════════════════════════════════════════════════════════
// Écriture — activer / supprimer un profil
// ════════════════════════════════════════════════════════════
// Pas de « désactiver » : un profil n'a pas d'état pause (contrairement aux
// créneaux/relations) — actions.ts n'expose que la suppression. On l'aligne.

const ParamsProfilSupprimer = z.object({
  profil: z.string().describe('Le nom du profil à supprimer.'),
})

export const supprimerProfilDepuisNom: OutilEcriture<typeof ParamsProfilSupprimer> = {
  genre: 'ecriture',
  nom: 'supprimer_profil_planning',
  description: `Prépare la suppression DÉFINITIVE d'un profil de planning.

Appelle-le uniquement quand la demande dit clairement supprimer un profil — « supprime le profil Vacances ». Le profil PAR DÉFAUT du cabinet ne peut jamais être supprimé (le cabinet doit toujours en avoir un) : dis-le sans appeler l'outil si c'est le cas.

Les périodes qui référençaient ce profil retombent automatiquement sur le profil par défaut — elles ne sont jamais supprimées.`,
  params: ParamsProfilSupprimer,
  adminSeulement: true,

  async resumer(params, ctx) {
    const profils = await chargerProfils(ctx)
    const trouve = resoudreProfil(profils, params.profil)
    if (!trouve.ok) return { ok: false, raison: trouve.raison }
    if (trouve.profil.est_defaut) {
      return { ok: false, raison: `« ${trouve.profil.nom} » est le profil par défaut du cabinet : il ne peut pas être supprimé.` }
    }

    const periodesConcernees = await comptePeriodesSurProfil(ctx, trouve.profil.id)

    return {
      ok: true,
      proposition: {
        titre: 'Supprimer un profil de planning',
        phrase: `Je vais supprimer définitivement le profil « ${trouve.profil.nom} » et tout son catalogue de créneaux.`,
        action: 'Supprimer définitivement',
        avertissement:
          'Cette suppression ne se rattrape pas.' +
          (periodesConcernees > 0
            ? ` ${periodesConcernees} période(s) utilisaient ce profil : elles retomberont automatiquement sur le profil par défaut du cabinet, sans être supprimées.`
            : ''),
      },
      charge: { profilId: trouve.profil.id },
    }
  },

  async executer(_params, _ctx, charge) {
    const c = charge as { profilId?: string } | undefined
    if (!c?.profilId) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    const r = await supprimerProfil(c.profilId)
    return 'error' in r ? { error: r.error } : {}
  },
}

// ════════════════════════════════════════════════════════════
// Écriture — régler les horaires d'un créneau
// ════════════════════════════════════════════════════════════

const ParamsHoraires = z.object({
  profil: z.string().optional().describe('Le profil concerné. Laisse vide pour le profil par défaut.'),
  creneau: z.string().describe('Le nom du créneau dont on règle les horaires.'),
  heure_debut: z.string().describe('Heure de début au format HH:MM (24h), ex. « 18:30 ».'),
  heure_fin: z.string().describe('Heure de fin au format HH:MM (24h).'),
  jour_de_fin: z
    .number()
    .int()
    .min(0)
    .max(3)
    .describe('0 = se termine le même jour ; 1 = le lendemain ; 2 = le surlendemain ; 3 = trois jours après.'),
})

export const reglerHorairesCreneau: OutilEcriture<typeof ParamsHoraires> = {
  genre: 'ecriture',
  nom: 'regler_horaires_creneau',
  description: `Prépare le changement des horaires (début, fin, jour de fin) d'un créneau EXISTANT dans un profil.

Appelle-le quand la demande précise un horaire pour un créneau qui existe déjà — « mets le vendredi soir à 18h30 dans le profil Hiver », « le week-end doit finir le lundi matin ».

Si le créneau n'existe pas encore, ce n'est pas cet outil : propose de créer un profil ou un créneau. Rien n'est enregistré tant que la personne n'a pas validé.`,
  params: ParamsHoraires,
  adminSeulement: true,

  async resumer(params, ctx) {
    const profils = await chargerProfils(ctx)
    const trouveProfil = resoudreProfil(profils, params.profil)
    if (!trouveProfil.ok) return { ok: false, raison: trouveProfil.raison }

    const creneaux = await chargerCreneaux(ctx)
    const trouve = resoudreCreneau(creneaux, params.creneau)
    if (!trouve.ok) return { ok: false, raison: trouve.raison }
    const cr = trouve.creneau

    const HEURE_RE = /^([01]\d|2[0-3]):[0-5]\d$/
    if (!HEURE_RE.test(params.heure_debut) || !HEURE_RE.test(params.heure_fin)) {
      return { ok: false, raison: 'Heure invalide (format attendu HH:MM, ex. 18:30).' }
    }
    if (params.jour_de_fin === 0) {
      const [h1, m1] = params.heure_debut.split(':').map(Number)
      const [h2, m2] = params.heure_fin.split(':').map(Number)
      if (h2 * 60 + m2 <= h1 * 60 + m1) {
        return {
          ok: false,
          raison: "L'heure de fin doit être après l'heure de début, ou la garde doit se terminer un jour suivant.",
        }
      }
    }

    const avant = `${cr.heure_debut} → ${cr.heure_fin}${cr.offset_jours_fin ? ` (+${cr.offset_jours_fin}j)` : ''}`
    const apres = `${params.heure_debut} → ${params.heure_fin}${params.jour_de_fin ? ` (+${params.jour_de_fin}j)` : ''}`
    if (avant === apres) {
      return { ok: false, raison: `« ${cr.nom} » a déjà ces horaires.` }
    }

    return {
      ok: true,
      proposition: {
        titre: `Régler les horaires de « ${cr.nom} »`,
        phrase: `Garde « ${cr.nom} » : ${avant} → ${apres}.`,
        action: 'Appliquer',
        // Un horaire appartient au SOCLE depuis le 2026-08-04 : le dire, sinon
        // le cabinet croit ne changer que « son hiver » et découvre l'effet
        // partout à la génération suivante.
        avertissement:
          'Les horaires appartiennent à la structure du cabinet : ce changement vaut pour TOUTES '
          + 'les périodes types. Les plannings déjà générés ne bougent pas — il s’applique aux '
          + 'prochaines générations.',
      },
      charge: {
        creneauId: cr.id,
        heure_debut: params.heure_debut,
        heure_fin: params.heure_fin,
        offset_jours_fin: params.jour_de_fin,
      },
    }
  },

  async executer(_params, _ctx, charge) {
    const c = charge as
      | { creneauId?: string; heure_debut?: string; heure_fin?: string; offset_jours_fin?: number }
      | undefined
    if (!c?.creneauId || !c.heure_debut || !c.heure_fin || c.offset_jours_fin === undefined) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    return setHorairesProfilCreneau(c.creneauId, {
      heure_debut: c.heure_debut,
      heure_fin: c.heure_fin,
      offset_jours_fin: c.offset_jours_fin,
    })
  },
}

// ════════════════════════════════════════════════════════════
// Écriture — ce qu'une période type retient d'une garde
// ════════════════════════════════════════════════════════════

const ParamsAffinage = z.object({
  periode_type: z
    .string()
    .describe('Le nom de la période type à régler, ex. « Hiver ». Laisse vide pour celle par défaut.')
    .optional(),
  garde: z.string().describe('Le nom du type de garde, ex. « Soir du vendredi ».'),
  vetos: z
    .number()
    .int()
    .describe('Combien de vétérinaires sur cette garde pour cette période type. 0 = pas de garde de ce type sur cette période.'),
})

export const reglerVetosSurPeriodeType: OutilEcriture<typeof ParamsAffinage> = {
  genre: 'ecriture',
  nom: 'regler_vetos_sur_periode_type',
  description: `Prépare le réglage du nombre de VÉTÉRINAIRES qu'une période type met sur une garde.

C'est LE geste propre aux périodes types : la structure du cabinet dit ce qui est possible (jusqu'à 2 vétérinaires le vendredi, par exemple), et chaque période type choisit dedans.

Appelle-le pour « en hiver, on veut 2 vétos le week-end », « l'été, un seul le soir de semaine », « pas de garde le vendredi soir pendant les vacances » (→ vetos = 0).

vetos = 0 SUPPRIME la garde de cette période type : le moteur n'en posera aucune ces jours-là. C'est un vrai choix, pas une désactivation temporaire — annonce-le clairement.

Ne l'utilise PAS pour changer un horaire, un jour ou le maximum possible : ceux-là appartiennent à la structure du cabinet et valent pour toutes les périodes types.`,
  params: ParamsAffinage,
  adminSeulement: true,

  async resumer(params, ctx) {
    const profils = await chargerProfils(ctx)
    const trouveProfil = resoudreProfil(profils, params.periode_type)
    if (!trouveProfil.ok) return { ok: false, raison: trouveProfil.raison }

    const [creneaux, affinages] = await Promise.all([
      chargerCreneaux(ctx), chargerAffinages(ctx),
    ])
    const trouve = resoudreCreneau(creneaux, params.garde)
    if (!trouve.ok) return { ok: false, raison: trouve.raison }
    const cr = trouve.creneau

    if (!Number.isInteger(params.vetos) || params.vetos < 0) {
      return { ok: false, raison: 'Le nombre de vétérinaires doit être 0 ou plus.' }
    }
    // Le socle borne : demander 3 là où la structure en permet 2 n'est pas une
    // erreur de saisie mais une confusion de niveau — on l'explique, et on
    // indique où se règle le maximum.
    if (params.vetos > cr.nb_places) {
      return {
        ok: false,
        raison: `« ${cr.nom} » ne peut accueillir que ${cr.nb_places} vétérinaire(s) : c'est le maximum `
          + `fixé par la structure du cabinet. Pour aller au-delà, il faut d'abord augmenter ce maximum `
          + `dans « Structure des gardes » — et cela vaudrait pour toutes les périodes types.`,
      }
    }

    const actuel = vetosRetenus(affinages, trouveProfil.profil.id, cr)
    if (actuel === params.vetos) {
      return {
        ok: false,
        raison: params.vetos === 0
          ? `« ${cr.nom} » est déjà absente de « ${trouveProfil.profil.nom} ».`
          : `« ${cr.nom} » est déjà à ${params.vetos} vétérinaire(s) sur « ${trouveProfil.profil.nom} ».`,
      }
    }

    const dire = (n: number) => (n === 0 ? 'aucune garde' : `${n} vétérinaire${n > 1 ? 's' : ''}`)
    const periodesConcernees = await comptePeriodesSurProfil(ctx, trouveProfil.profil.id)

    return {
      ok: true,
      proposition: {
        titre: `« ${cr.nom} » sur « ${trouveProfil.profil.nom} »`,
        phrase: `${dire(actuel)} → ${dire(params.vetos)}.`,
        lignes: [
          `Jours : ${joursHumains(cr.jours_semaine)}`,
          `Maximum possible (structure du cabinet) : ${cr.nb_places}`,
        ],
        action: params.vetos === 0 ? 'Retirer cette garde' : 'Appliquer',
        avertissement:
          (params.vetos === 0
            ? `Plus aucune garde « ${cr.nom} » ne sera posée sur les plannings de cette période type. `
            : '')
          + 'Les plannings déjà générés ne bougent pas — le changement vaut pour les prochaines générations.'
          + (periodesConcernees > 0
            ? ` ${periodesConcernees} planning(s) utilisent « ${trouveProfil.profil.nom} ».`
            : ''),
      },
      charge: { profilId: trouveProfil.profil.id, creneauId: cr.id, vetos: params.vetos },
    }
  },

  async executer(_params, _ctx, charge) {
    const c = charge as { profilId?: string; creneauId?: string; vetos?: number } | undefined
    if (!c?.profilId || !c.creneauId || c.vetos === undefined) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    return setAffinagePeriodeType(c.profilId, c.creneauId, c.vetos)
  },
}

// ════════════════════════════════════════════════════════════
// Écriture — réglages du cabinet (adresse, partages)
// ════════════════════════════════════════════════════════════
// Pas de résolution de nom ici : un cabinet n'a qu'une seule fiche de
// réglages (ctx.cabinetId), donc aucune ambiguïté possible.

const ParamsAdresse = z.object({
  adresse: z.string().describe('Adresse postale du cabinet (numéro et voie).'),
  code_postal: z.string().describe('Code postal, 5 chiffres.'),
  ville: z.string().describe('Ville du cabinet.'),
})

export const configurerAdresseDepuisPhrase: OutilEcriture<typeof ParamsAdresse> = {
  genre: 'ecriture',
  nom: 'configurer_adresse_cabinet',
  description: `Prépare l'enregistrement de l'adresse du cabinet. La zone scolaire (A/B/C) et la région des fériés en sont AUTOMATIQUEMENT dérivées à partir du code postal — inutile de les demander séparément.

Appelle-le quand la demande donne ou change l'adresse du cabinet — « le cabinet est au 12 rue des Lilas, 03000 Moulins ».`,
  params: ParamsAdresse,
  adminSeulement: true,

  async resumer(params, ctx) {
    const cp = params.code_postal?.trim()
    if (!/^\d{5}$/.test(cp ?? '')) {
      return { ok: false, raison: 'Le code postal doit comporter 5 chiffres.' }
    }
    if (!params.adresse?.trim() || !params.ville?.trim()) {
      return { ok: false, raison: "L'adresse et la ville sont obligatoires." }
    }

    const { data } = await ctx.supabase
      .from('cabinets')
      .select('adresse, code_postal, ville')
      .eq('id', ctx.cabinetId)
      .maybeSingle()
    const actuel = data as { adresse: string | null; code_postal: string | null; ville: string | null } | null

    return {
      ok: true,
      proposition: {
        titre: 'Régler l’adresse du cabinet',
        phrase: `Adresse du cabinet : ${params.adresse.trim()}, ${cp} ${params.ville.trim()}.`,
        lignes: actuel?.adresse
          ? [`Adresse actuelle : ${actuel.adresse}, ${actuel.code_postal} ${actuel.ville}`]
          : undefined,
        action: 'Enregistrer',
        avertissement:
          'La zone scolaire et la région des fériés seront recalculées automatiquement à partir de ce code postal.',
      } satisfies PropositionAction,
      charge: { adresse: params.adresse.trim(), code_postal: cp, ville: params.ville.trim() },
    }
  },

  async executer(_params, _ctx, charge) {
    const c = charge as { adresse?: string; code_postal?: string; ville?: string } | undefined
    if (!c?.adresse || !c.code_postal || !c.ville) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    const r = await configurerAdresseCabinet({ adresse: c.adresse, codePostal: c.code_postal, ville: c.ville })
    return 'error' in r ? { error: r.error } : {}
  },
}

const ParamsPartages = z.object({
  agenda_google: z
    .string()
    .optional()
    .describe('Identifiant du Google Agenda à partager. Laisse vide pour ne pas changer.'),
  email_expediteur: z
    .string()
    .optional()
    .describe('Adresse e-mail expéditrice des notifications. Laisse vide pour ne pas changer.'),
  nom_expediteur: z
    .string()
    .optional()
    .describe('Nom affiché comme expéditeur des e-mails. Laisse vide pour ne pas changer.'),
})

export const configurerPartagesDepuisPhrase: OutilEcriture<typeof ParamsPartages> = {
  genre: 'ecriture',
  nom: 'configurer_partages_cabinet',
  description: `Prépare le réglage de l'agenda Google partagé et/ou de l'expéditeur des e-mails du cabinet.

Appelle-le quand la demande change l'un de ces branchements — « change l'expéditeur des mails pour contact@cabinet.fr », « partage l'agenda X ». Laisser un champ vide dans une nouvelle demande EFFACERAIT le réglage existant (retour au réglage par défaut du serveur) — appelle donc lire_reglages_cabinet d'abord si tu ne dois changer qu'un seul des trois champs, pour reprendre les autres tels quels.`,
  params: ParamsPartages,
  adminSeulement: true,

  async resumer(params, ctx) {
    const { data } = await ctx.supabase
      .from('cabinets')
      .select('google_calendar_id, brevo_from_email, brevo_from_name')
      .eq('id', ctx.cabinetId)
      .maybeSingle()
    const actuel = data as
      | { google_calendar_id: string | null; brevo_from_email: string | null; brevo_from_name: string | null }
      | null

    const agenda = params.agenda_google?.trim() ?? actuel?.google_calendar_id ?? ''
    const email = params.email_expediteur?.trim() ?? actuel?.brevo_from_email ?? ''
    const nom = params.nom_expediteur?.trim() ?? actuel?.brevo_from_name ?? ''

    if (email && !adresseBienFormee(email)) {
      return { ok: false, raison: `« ${email} » n'est pas une adresse e-mail valide.` }
    }

    const lignes: string[] = []
    if (params.agenda_google !== undefined) lignes.push(`Agenda Google : ${agenda || '(réglage par défaut du serveur)'}`)
    if (params.email_expediteur !== undefined) lignes.push(`E-mail expéditeur : ${email || '(réglage par défaut du serveur)'}`)
    if (params.nom_expediteur !== undefined) lignes.push(`Nom expéditeur : ${nom || '(réglage par défaut du serveur)'}`)
    if (lignes.length === 0) {
      return { ok: false, raison: 'Précise au moins un réglage à changer.' }
    }

    return {
      ok: true,
      proposition: {
        titre: 'Régler les partages du cabinet',
        phrase: 'Voici ce que je changerais dans les réglages du cabinet.',
        lignes,
        action: 'Enregistrer',
        avertissement: 'Un champ laissé vide repasse sur le réglage par défaut du serveur.',
      },
      charge: { googleCalendarId: agenda, brevoFromEmail: email, brevoFromName: nom },
    }
  },

  async executer(_params, _ctx, charge) {
    const c = charge as { googleCalendarId?: string; brevoFromEmail?: string; brevoFromName?: string } | undefined
    if (c?.googleCalendarId === undefined) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }

    // La `charge` fait l'aller-retour par le NAVIGATEUR : la vérification faite
    // au résumé ne prouve rien sur ce qui revient. Et ce champ-là n'est pas un
    // réglage de confort — une adresse d'expéditeur bancale fait tomber les
    // SEPT chemins d'envoi du cabinet (planning publié, rappels, échanges,
    // congés…), silencieusement, comme le 21 août. On revérifie donc ici, au
    // moment d'écrire. Vide reste permis : c'est le retour au réglage serveur.
    const emailAEcrire = (c.brevoFromEmail ?? '').trim()
    if (emailAEcrire !== '' && !adresseBienFormee(emailAEcrire)) {
      return {
        error: `« ${emailAEcrire} » n'est pas une adresse e-mail valide — je ne l'enregistre pas : plus aucun e-mail du cabinet ne partirait. Redonne-moi l'adresse expéditrice.`,
      }
    }

    const r = await configurerPartagesCabinet({
      googleCalendarId: c.googleCalendarId,
      brevoFromEmail: emailAEcrire,
      brevoFromName: c.brevoFromName ?? '',
    })
    return 'error' in r ? { error: r.error } : {}
  },
}
