// ============================================================
// GUARDVETO — Outils de Filou : compteurs, équité, cohérence, historique
// ============================================================
// SERVER-ONLY. Ce fichier est presque entièrement en LECTURE : il donne à
// Filou de quoi répondre à « qui a fait le plus de week-ends ? », « le
// planning publié est-il fiable ? », « qui a fait Noël l'an dernier ? » — au
// lieu de dire « je ne sais pas », faute de voir plus loin que les règles.
//
// PIÈGE évité ici, et qui a un précédent réel dans ce projet (cf. mémoire
// « moteur-cecite-params-nesting ») : ne JAMAIS renvoyer un zéro pour dire
// « pas de donnée ». Un planning pas encore généré, une période en brouillon
// avec le périmètre « validées seulement », une re-validation refusée faute
// de droits admin : chacun de ces cas DOIT se dire en toutes lettres, sinon
// Filou répondrait « personne n'a de garde » ou « aucune violation » alors
// qu'il n'a simplement rien pu compter.
//
// Comme dans equipe.ts, le modèle ne manipule que des NOMS (prénom, libellé
// de période) — jamais d'UUID. La résolution se fait ici et refuse net dès
// qu'elle est ambiguë, plutôt que de deviner.
// ============================================================

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  queryCompteurs,
  queryTotalWE,
  queryBonusMalusCourant,
  queryHistoriqueFetes,
  type CompteursRow,
} from '@/hooks/useCompteurs'
import { calculerBilans, type BilanVet } from '@/engine/bilan'
import { revaliderPlanningPublie } from '@/data/revaliderPlanning'
import { setEquiteImportance } from '@/app/(protected)/regles/actions'
import {
  EQUITY_DIMENSIONS,
  IMPORTANCE_LEVELS,
  DEFAULT_IMPORTANCE,
  type EquityDimension,
  type ImportanceLevel,
} from '@/engine/equity-weights'
import { extraireEquityRules, type RegleCabinetRow } from '@/data/mapReglesCabinet'
import { periodeLabelCourt, periodeLabelBase } from '@/lib/periodes'
import { SANS_PARAMETRE, type ContexteOutil, type OutilEcriture, type OutilLecture } from './types'
import type { Periode, StatutPeriode } from '@/types'

// ── Fragments partagés ──────────────────────────────────────

/** Même nettoyage que `equipe.ts` (accents, casse, ponctuation) : dupliqué ici
 *  à dessein — ce fichier ne doit dépendre que de son propre domaine. */
const DIACRITIQUES = /[̀-ͯ]/g
function normaliser(s: string): string {
  return s
    .normalize('NFD')
    .replace(DIACRITIQUES, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

interface VetoMini {
  id: string
  prenom: string
  nom: string
}

async function chargerVets(ctx: ContexteOutil): Promise<VetoMini[]> {
  const { data } = await ctx.supabase.from('veterinaires').select('id, prenom, nom')
  return (data as VetoMini[] | null) ?? []
}

/** Résout un prénom en véto. Refuse l'à-peu-près, comme `equipe.ts`. */
function resoudreVeto(
  vets: VetoMini[],
  prenom: string,
): { ok: true; veto: VetoMini } | { ok: false; raison: string } {
  const cible = normaliser(prenom)
  const exacts = vets.filter((v) => normaliser(v.prenom) === cible)
  if (exacts.length === 1) return { ok: true, veto: exacts[0] }
  if (exacts.length > 1) {
    return { ok: false, raison: `Plusieurs vétérinaires s'appellent ${prenom}. Précise avec le nom de famille.` }
  }
  const connus = vets.map((v) => v.prenom).join(', ')
  return { ok: false, raison: `Aucun vétérinaire ne s'appelle « ${prenom} » dans ce cabinet. Les vétérinaires sont : ${connus}.` }
}

/**
 * Résout un nom de période en fiche. Sans `query` : la période EN COURS
 * aujourd'hui, ou à défaut la prochaine à venir, ou à défaut la plus
 * récente — même logique que la page /historique (Filou et l'écran doivent
 * s'accorder sur ce que veut dire « la période »).
 *
 * Avec `query` : reconnaît une année (4 chiffres), une saison (hiver/été) et
 * un numéro (« P3 »), combinables. Refuse net si plusieurs périodes matchent
 * encore après ces critères — mieux vaut redemander que de compter la
 * mauvaise période.
 */
async function resoudrePeriode(
  ctx: ContexteOutil,
  query: string | undefined,
): Promise<{ ok: true; periode: Periode } | { ok: false; raison: string }> {
  // Bornée au CABINET et, pour un vétérinaire, aux périodes DIFFUSÉES.
  // C'est le point d'entrée de TOUS les outils de comptage : une période
  // retenue ici devient lisible plus bas dans `compteurs_gardes`, vue qui
  // n'a aucune RLS. Le filtre doit donc être posé ICI, une fois.
  let requete = ctx.supabase
    .from('periodes')
    .select('*')
    .eq('cabinet_id', ctx.cabinetId)
    .order('date_debut', { ascending: false })
    .limit(50)
  if (!ctx.estAdmin) requete = requete.not('publie_at', 'is', null)
  const { data } = await requete
  const periodes = (data as Periode[] | null) ?? []
  if (periodes.length === 0) {
    // Formulation neutre côté vétérinaire : dire « il existe un brouillon mais
    // tu n'y as pas accès » trahirait déjà l'existence et l'état d'un planning
    // qu'il n'est pas censé connaître.
    return {
      ok: false,
      raison: ctx.estAdmin
        ? "Ce cabinet n'a encore aucune période de planification créée."
        : "Aucun planning ne t'a encore été diffusé.",
    }
  }

  const q = query?.trim().toLowerCase()
  if (!q || ['courante', 'actuelle', 'en cours', 'maintenant'].includes(q)) {
    const today = new Date().toISOString().slice(0, 10)
    const asc = [...periodes].reverse()
    const courante =
      periodes.find((p) => p.date_debut <= today && p.date_fin >= today) ??
      asc.find((p) => p.date_debut >= today) ??
      periodes[0]
    return { ok: true, periode: courante }
  }

  const annee = q.match(/\d{4}/)?.[0]
  const saison: 'hiver' | 'ete' | null = q.includes('hiver') ? 'hiver' : /(ete|été)/.test(q) ? 'ete' : null
  const numero = q.match(/p\s*(\d+)/i)?.[1] ?? q.match(/n[°o]?\s*(\d+)/i)?.[1]

  let candidats = periodes
  if (annee) candidats = candidats.filter((p) => p.date_debut.slice(0, 4) === annee)
  if (saison) candidats = candidats.filter((p) => p.saison === saison)
  if (numero) candidats = candidats.filter((p) => p.numero === Number(numero))

  // Aucun critère structuré reconnu (annee/saison/numero) → on retombe sur le
  // libellé affiché à l'écran, en confiance moindre (correspondance texte).
  if (!annee && !saison && !numero) {
    candidats = periodes.filter(
      (p) => periodeLabelBase(p).toLowerCase().includes(q) || periodeLabelCourt(p).toLowerCase().includes(q),
    )
  }

  if (candidats.length === 1) return { ok: true, periode: candidats[0] }
  if (candidats.length > 1) {
    const liste = candidats.slice(0, 8).map((p) => periodeLabelCourt(p)).join(' / ')
    return { ok: false, raison: `Plusieurs périodes correspondent à « ${query} » : ${liste}. Précise laquelle.` }
  }
  const connues = periodes.slice(0, 8).map((p) => periodeLabelCourt(p)).join(' / ')
  return { ok: false, raison: `Aucune période ne correspond à « ${query} ». Les périodes connues : ${connues}.` }
}

/** Traduit un écart en phrase-donnée courte, dans le bon sens : la convention
 *  moteur (`ecart > 0` = a fait PLUS que sa part) est facile à inverser de
 *  tête — c'est ici, une fois pour toutes, qu'elle est mise en mots. */
function interpreterEcart(ecart: number, unite: string): string {
  if (ecart === 0) return `dans la moyenne (aucun écart)`
  if (ecart > 0) return `${ecart} ${unite} de plus que la moyenne`
  return `${Math.abs(ecart)} ${unite} de moins que la moyenne`
}

const LIBELLE_DIMENSION: Record<EquityDimension, string> = {
  weekend: 'nombre de gardes de week-end',
  weekend_premier: "rôle 1er le week-end (avantage financier)",
  ferie: 'gardes de jours fériés',
  semaine_premier: 'gardes de semaine en 1er',
  semaine_second: 'gardes de semaine en 2nd',
  semaine_renfort: 'gardes de semaine tenues en renfort (3ᵉ place et au-delà)',
  grands_weekend: 'grands week-ends libres perdus (salariés uniquement)',
}

const LIBELLE_IMPORTANCE: Record<ImportanceLevel, string> = {
  ignoree: 'ignorée (cette dimension n’est pas équilibrée du tout)',
  peu_important: 'peu importante',
  normal: 'normale',
  important: 'importante',
  essentiel: 'essentielle',
}

const LIBELLE_STATUT: Record<StatutPeriode, string> = {
  brouillon: 'brouillon (pas encore publiée)',
  publie: 'publiée',
  verrouille: 'verrouillée (figée)',
}

async function chargerReglesEquite(ctx: ContexteOutil): Promise<RegleCabinetRow[]> {
  const { data } = await ctx.supabase
    .from('regles_cabinet')
    .select('id, cabinet_id, periode_id, brique_id, params_json, force, actif')
    .eq('brique_id', 'equilibrer')
  return (data as RegleCabinetRow[] | null) ?? []
}

// ── Lecture : compteurs de gardes + écarts d'équité ──────────

const ParamsCompteurs = z.object({
  periode: z
    .string()
    .optional()
    .describe(
      'La période à consulter : « Hiver 2026 », « été 2026 », « P3 »… Laisse vide pour la période en cours (aujourd’hui, ou à défaut la prochaine).',
    ),
  veto: z
    .string()
    .optional()
    .describe('Pour ne voir que ce vétérinaire. Laisse vide pour voir toute l’équipe.'),
})

export const lireCompteurs: OutilLecture<typeof ParamsCompteurs> = {
  genre: 'lecture',
  nom: 'lire_compteurs',
  description: `Donne, pour une période donnée, le nombre de gardes de chaque vétérinaire (week-ends, semaine, fériés) et son écart par rapport à la moyenne du cabinet — c'est l'équité du planning.

Appelle-le pour toute question de comptage ou de répartition : « combien de week-ends a fait Manon ? », « qui a fait le plus de gardes ? », « l'équité est-elle respectée sur cette période ? », « qui est en retard sur ses gardes ? ».

Un écart POSITIF veut dire que la personne a fait PLUS que sa part (elle en fera moins ensuite) ; un écart NÉGATIF veut dire qu'elle a fait MOINS (elle en fera plus ensuite). C'est déjà traduit en phrase dans la réponse — ne réinterprète pas le signe.

Si aucune garde n'a encore été générée pour la période demandée, l'outil le dit : ne dis jamais « zéro garde » à sa place, ça voudrait dire autre chose.`,
  params: ParamsCompteurs,

  async executer(params, ctx) {
    const resolue = await resoudrePeriode(ctx, params.periode)
    if (!resolue.ok) return { erreur: resolue.raison }
    const periode = resolue.periode

    const [{ compteurs, erreur: errCompteurs }, { totalWE, erreur: errWE }] = await Promise.all([
      queryCompteurs(ctx.supabase, periode.id),
      queryTotalWE(ctx.supabase, periode.id),
    ])

    // Exactement le piège décrit en tête de fichier : sans ce test, une lecture
    // en échec repartirait dans la branche « aucune garde » juste en dessous, et
    // Filou annoncerait « personne n'a de garde » alors qu'il n'a rien pu lire.
    const erreurLecture = errCompteurs ?? errWE
    if (erreurLecture) {
      return {
        periode: periodeLabelCourt(periode),
        erreur: `Je n'ai pas pu LIRE les compteurs de cette période (${erreurLecture}). Ce n'est pas « zéro garde » : je ne sais pas. Ne donne aucun chiffre.`,
      }
    }

    if (compteurs.length === 0) {
      return {
        periode: periodeLabelCourt(periode),
        statut: LIBELLE_STATUT[periode.statut],
        erreur:
          "Aucune garde n'est encore comptée sur cette période — le planning n'a pas été généré, ou pas encore de gardes attribuées. Il n'y a rien à annoncer comme total, ni comme écart.",
      }
    }

    // ⛔ L'ÉQUITÉ DE TOUTE L'ÉQUIPE EST UNE INFORMATION D'ADMIN.
    //
    // L'écran /historique, qui montre exactement ces tableaux, est réservé aux
    // administratrices depuis le 2026-08-21 : c'est un outil de PRÉPARATION,
    // « un véto n'en a pas l'usage ». Filou ne peut pas être la porte de
    // service par laquelle on obtient au chat ce que l'écran refuse.
    //
    // Un vétérinaire garde en revanche accès à SES propres compteurs — savoir
    // combien de week-ends on a faits est légitime, et le lui refuser serait
    // absurde. C'est le principe « Filou pour tous, périmètre par droits ».
    let lignes: CompteursRow[] = ctx.estAdmin
      ? compteurs
      : compteurs.filter((c) => c.veterinaire_id === ctx.vetoId)

    if (!ctx.estAdmin && lignes.length === 0) {
      return {
        periode: periodeLabelCourt(periode),
        statut: LIBELLE_STATUT[periode.statut],
        erreur: "Tu n'as aucune garde comptée sur cette période.",
      }
    }

    if (params.veto) {
      const vets = await chargerVets(ctx)
      const trouve = resoudreVeto(vets, params.veto)
      if (!trouve.ok) return { erreur: trouve.raison }

      // Un vétérinaire qui nomme quelqu'un d'autre se voit refuser NETTEMENT.
      // Sans ce test, la restriction ci-dessus tombait : il suffisait de
      // demander « les compteurs de Manon » pour les obtenir — le filtre
      // repartait de la liste complète, pas de la liste déjà restreinte.
      if (!ctx.estAdmin && trouve.veto.id !== ctx.vetoId) {
        return {
          erreur:
            "Les compteurs des autres vétérinaires ne sont visibles que par l'administratrice du cabinet. Je peux te donner les tiens.",
        }
      }

      lignes = lignes.filter((c) => c.veterinaire_id === trouve.veto.id)
      if (lignes.length === 0) {
        return {
          periode: periodeLabelCourt(periode),
          erreur: `${trouve.veto.prenom} n'a aucune garde comptée sur cette période.`,
        }
      }
    }

    const bilans = calculerBilans(compteurs, totalWE)
    const bilanDe = (id: string): BilanVet | undefined => bilans.find((b) => b.veterinaire_id === id)

    // Bilan OFFICIEL déjà enregistré (fin de période) s'il existe — distinct du
    // calcul en direct ci-dessus, qui reste valable même en cours de période.
    // RÉSERVÉ À L'ADMIN : sur /historique, le widget équivalent (BonusMalusCard)
    // n'est montré qu'à l'admin (`afficherBilan = estAdmin && …`). On ne fait
    // même pas la requête pour un non-admin — un `off` toujours vide se lirait
    // comme « pas encore enregistré » alors qu'il pourrait très bien exister.
    const officiel =
      ctx.estAdmin && periode.statut !== 'brouillon'
        ? await queryBonusMalusCourant(ctx.supabase, periode.id)
        : []
    const officielDe = (id: string) => officiel.find((o) => o.veterinaire_id === id)

    return {
      periode: periodeLabelCourt(periode),
      statut: LIBELLE_STATUT[periode.statut],
      nombre_week_ends_dans_la_periode: totalWE,
      vetos: lignes.map((c) => {
        const b = bilanDe(c.veterinaire_id)
        const off = officielDe(c.veterinaire_id)
        return {
          prenom: c.prenom,
          nom: c.nom,
          statut: c.statut,
          gardes_total: c.total_gardes,
          week_ends: {
            en_premier: c.we_premier,
            en_second: c.we_second,
            total: c.we_total,
            ecart: b ? interpreterEcart(b.ecart_we, 'week-end(s)') : 'non calculable',
          },
          semaine: {
            en_premier: c.sem_premier,
            en_second: c.sem_second,
            total: c.sem_total,
            ecart_en_premier: b ? interpreterEcart(b.ecart_semaine, 'garde(s)') : 'non calculable',
          },
          feries: {
            en_premier: c.feries_premier,
            en_second: c.feries_second,
            total: c.feries_total,
            ecart: b ? interpreterEcart(b.ecart_feries, 'garde(s)') : 'non calculable',
          },
          grands_week_ends_perdus:
            b && c.statut === 'salarie'
              ? { total: b.grands_we_realise, ecart: interpreterEcart(b.ecart_grands_we, 'week-end(s)') }
              : "ne s'applique qu'aux salariés",
          bilan_officiel_deja_enregistre: !ctx.estAdmin
            ? "réservé à l'administrateur"
            : off
              ? {
                  note:
                    'Ce bilan a été validé et enregistré à la clôture de la période — il fera foi pour la période suivante.',
                  ecart_we: off.ecart_we,
                  ecart_semaine: off.ecart_semaine,
                  ecart_feries: off.ecart_feries,
                  ecart_grands_we: off.ecart_grands_we,
                }
              : "pas encore enregistré (le calcul ci-dessus est provisoire, recalculé en direct)",
        }
      }),
    }
  },
}

// ── Lecture : cohérence du planning publié ───────────────────

const ParamsCoherence = z.object({
  periode: z
    .string()
    .optional()
    .describe('La période à vérifier. Laisse vide pour la période en cours.'),
})

export const verifierCoherencePlanning: OutilLecture<typeof ParamsCoherence> = {
  genre: 'lecture',
  nom: 'verifier_coherence_planning',
  description: `Re-vérifie, avec le MÊME contrôleur indépendant que celui utilisé à la génération, si le planning PUBLIÉ d'une période respecte encore toutes les règles fermes du cabinet.

Appelle-le quand on demande si le planning est fiable, s'il y a un problème dessus, ou après qu'un congé, une règle ou une édition manuelle a pu introduire une incohérence : « le planning est-il toujours bon ? », « y a-t-il une violation quelque part ? ».

Ne s'applique qu'à une période PUBLIÉE ou VERROUILLÉE : un brouillon n'a encore rien à vérifier, l'outil le dit plutôt que de renvoyer « aucune violation » à tort.`,
  params: ParamsCoherence,
  adminSeulement: true, // le contrôleur lui-même n'agit qu'avec les droits admin

  async executer(params, ctx) {
    const resolue = await resoudrePeriode(ctx, params.periode)
    if (!resolue.ok) return { erreur: resolue.raison }
    const periode = resolue.periode

    if (periode.statut === 'brouillon') {
      return {
        periode: periodeLabelCourt(periode),
        erreur:
          "Cette période est encore en brouillon : il n'y a pas de planning publié à vérifier. La vérification ne porte que sur les périodes publiées ou verrouillées.",
      }
    }

    const violations = await revaliderPlanningPublie([periode.id])
    if (violations.length === 0) {
      return {
        periode: periodeLabelCourt(periode),
        statut: LIBELLE_STATUT[periode.statut],
        verdict: 'Aucune violation détectée : le planning publié respecte toutes les règles fermes du cabinet.',
      }
    }

    const vets = await chargerVets(ctx)
    const prenomDe = (id?: string) => (id ? vets.find((v) => v.id === id)?.prenom ?? 'un vétérinaire' : undefined)

    return {
      periode: periodeLabelCourt(periode),
      statut: LIBELLE_STATUT[periode.statut],
      nombre_violations: violations.length,
      violations: violations.map((v) => ({
        regle: v.regle,
        date: v.date,
        type: v.type,
        role: v.role,
        veto_concerne: prenomDe(v.vetId),
        detail: v.detail,
      })),
    }
  },
}

// ── Lecture : historique des périodes passées ────────────────

const ParamsHistoriquePeriodes = z.object({
  limite: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe('Nombre de périodes à lister, les plus récentes d’abord. Par défaut 10.'),
})

export const lireHistoriquePeriodes: OutilLecture<typeof ParamsHistoriquePeriodes> = {
  genre: 'lecture',
  nom: 'lire_historique_periodes',
  description: `Liste les périodes de planification du cabinet, les plus récentes d'abord : dates, saison, statut (brouillon / publiée / verrouillée), nombre de semaines.

Appelle-le pour situer une période dans le temps, savoir combien il y en a eu, ou retrouver le nom exact d'une période avant d'appeler lire_compteurs ou verifier_coherence_planning dessus.`,
  params: ParamsHistoriquePeriodes,

  async executer(params, ctx) {
    const { data } = await ctx.supabase
      .from('periodes')
      .select('*')
      .eq('cabinet_id', ctx.cabinetId)
      .order('date_debut', { ascending: false })
      .limit(params.limite ?? 10)
    const periodes = ((data as Periode[] | null) ?? [])
      // Un vétérinaire n'apprend pas l'EXISTENCE ni l'état d'avancement d'un
      // planning qu'on ne lui a pas diffusé. La barre du haut a cessé de le
      // faire le 2026-08-21 ; lister ici « Historique été 2026 — verrouillée »
      // reviendrait à le lui dire par une autre bouche.
      .filter((p) => ctx.estAdmin || Boolean((p as { publie_at?: string | null }).publie_at))
    if (periodes.length === 0) {
      return {
        erreur: ctx.estAdmin
          ? "Ce cabinet n'a encore aucune période de planification créée."
          : "Aucun planning ne t'a encore été diffusé.",
      }
    }
    return {
      periodes: periodes.map((p) => {
        const jours = (new Date(p.date_fin).getTime() - new Date(p.date_debut).getTime()) / 86_400_000 + 1
        return {
          periode: periodeLabelCourt(p),
          saison: p.saison === 'ete' ? 'été' : 'hiver',
          debut: p.date_debut,
          fin: p.date_fin,
          nombre_semaines: Math.max(1, Math.round(jours / 7)),
          statut: LIBELLE_STATUT[p.statut],
        }
      }),
    }
  },
}

// ── Lecture : historique des fêtes de fin d'année ────────────

const ParamsHistoriqueFetes = z.object({
  veto: z
    .string()
    .optional()
    .describe('Pour ne voir que ce vétérinaire. Laisse vide pour voir tout l’historique.'),
})

export const lireHistoriqueFetes: OutilLecture<typeof ParamsHistoriqueFetes> = {
  genre: 'lecture',
  nom: 'lire_historique_fetes',
  // Reserve a l'admin, comme l'ecran qui montre la meme chose : /historique est
  // ferme aux veterinaires depuis le 2026-08-21. Laisser Filou le restituer au
  // chat aurait ete la porte de service du meme tableau — et les deux auraient
  // diverge en silence, ce qui est pire que l'un ou l'autre choix.
  adminSeulement: true,
  description: `Donne qui a fait Noël et le Nouvel An, année par année, aussi loin que le cabinet a renseigné cet historique.

Appelle-le pour toute question du type « qui a fait Noël l'an dernier ? », « c'est à qui le tour cette année ? », « est-ce que j'ai déjà fait le nouvel an ? ».

Si le cabinet n'a rien renseigné, l'outil le dit — ce n'est pas la même chose que « personne n'a jamais fait Noël ».`,
  params: ParamsHistoriqueFetes,

  async executer(params, ctx) {
    const rows = await queryHistoriqueFetes(ctx.supabase)
    if (rows.length === 0) {
      return { erreur: "Aucun historique de fêtes n'est renseigné pour ce cabinet." }
    }

    let filtrees = rows
    if (params.veto) {
      const cible = normaliser(params.veto)
      filtrees = rows.filter((r) => normaliser(r.prenom) === cible)
      if (filtrees.length === 0) {
        return { erreur: `Aucun historique de fêtes ne mentionne « ${params.veto} ».` }
      }
    }

    return {
      historique: filtrees
        .sort((a, b) => b.annee - a.annee)
        .map((r) => ({
          annee: r.annee,
          fete: r.fete === 'noel' ? 'Noël' : 'Nouvel An',
          vetorinaire: `${r.prenom} ${r.nom}`.trim(),
          role: r.role ?? undefined,
        })),
    }
  },
}

// ── Lecture : réglages d'équité en vigueur ───────────────────

export const lireReglagesEquite: OutilLecture<typeof SANS_PARAMETRE> = {
  genre: 'lecture',
  nom: 'lire_reglages_equite',
  description: `Donne l'importance actuellement réglée pour chaque dimension d'équité du planning (week-ends, fériés, semaine en 1er/2nd, grands week-ends), plus les cohortes éventuelles (une importance différente pour un groupe de vétérinaires portant une même étiquette).

Appelle-le pour toute question sur la façon dont l'équité est réglée : « comment est réglée l'équité des week-ends ? », « y a-t-il une équité spéciale pour les juniors ? », avant de proposer de changer un réglage avec regler_equite.

Une dimension « ignorée » n'est PAS du tout équilibrée par le moteur — ce n'est pas un oubli, c'est un choix explicite du cabinet (ou le réglage par défaut).`,
  params: SANS_PARAMETRE,

  async executer(_params, ctx) {
    const rows = await chargerReglesEquite(ctx)
    const regles = extraireEquityRules(rows)

    const globales = new Map(regles.filter((r) => !r.tag).map((r) => [r.dimension, r.importance]))
    const cohortes = regles.filter((r) => r.tag)

    return {
      dimensions: EQUITY_DIMENSIONS.map((dim) => {
        const importance = globales.get(dim) ?? DEFAULT_IMPORTANCE[dim]
        return {
          dimension: dim,
          libelle: LIBELLE_DIMENSION[dim],
          importance,
          importance_libelle: LIBELLE_IMPORTANCE[importance],
          reglage_par_defaut: !globales.has(dim),
        }
      }),
      cohortes: cohortes.map((c) => ({
        dimension: c.dimension,
        libelle: LIBELLE_DIMENSION[c.dimension],
        etiquette: c.tag,
        importance: c.importance,
        importance_libelle: LIBELLE_IMPORTANCE[c.importance],
        note: `S'ajoute au réglage global de « ${LIBELLE_DIMENSION[c.dimension]} », ne concerne que les vétérinaires portant l'étiquette « ${c.tag} ».`,
      })),
    }
  },
}

// ── Écriture : régler l'importance d'une dimension d'équité ──
//
// Délègue entièrement à `setEquiteImportance` (action serveur existante,
// utilisée par l'écran /regles) : même garde admin, même validation, même
// RLS. On ne réimplémente rien de l'écriture ici.

const ParamsReglerEquite = z.object({
  dimension: z.enum(EQUITY_DIMENSIONS).describe(
    'La dimension à régler : weekend (nombre de gardes de week-end), weekend_premier (rôle 1er le week-end), ferie (jours fériés), semaine_premier, semaine_second, ou grands_weekend (grands week-ends perdus par les salariés).',
  ),
  importance: z.enum(IMPORTANCE_LEVELS).describe(
    'ignoree = ne plus équilibrer du tout cette dimension ; peu_important ; normal ; important ; essentiel = priorité maximale.',
  ),
})

export const reglerEquite: OutilEcriture<typeof ParamsReglerEquite> = {
  genre: 'ecriture',
  nom: 'regler_equite',
  description: `Prépare le changement d'importance d'UNE dimension d'équité du planning (week-ends, fériés, semaine…).

Appelle-le quand la demande revient à rendre une dimension plus ou moins prioritaire dans l'équilibrage : « l'équité des fériés compte moins », « ignore complètement l'équité des grands week-ends », « rends les week-ends essentiels ».

Appelle d'abord lire_reglages_equite si tu ne connais pas déjà le réglage actuel — la proposition affiche l'avant/après. Rien n'est enregistré tant que la personne n'a pas validé.

Ne concerne QUE le réglage global (tous les vétérinaires). Pour une équité spécifique à un groupe (étiquette), ce n'est pas cet outil.`,
  params: ParamsReglerEquite,
  adminSeulement: true,

  async resumer(params, ctx) {
    const rows = await chargerReglesEquite(ctx)
    const regles = extraireEquityRules(rows)
    const actuelle =
      regles.find((r) => r.dimension === params.dimension && !r.tag)?.importance ??
      DEFAULT_IMPORTANCE[params.dimension]

    if (actuelle === params.importance) {
      return {
        ok: false,
        raison: `L'équité « ${LIBELLE_DIMENSION[params.dimension]} » est déjà réglée sur « ${LIBELLE_IMPORTANCE[params.importance]} ».`,
      }
    }

    return {
      ok: true,
      proposition: {
        titre: `Régler l'équité — ${LIBELLE_DIMENSION[params.dimension]}`,
        phrase: `Je vais changer l'importance de cette dimension d'équité.`,
        lignes: [
          `Avant : ${LIBELLE_IMPORTANCE[actuelle]}`,
          `Après : ${LIBELLE_IMPORTANCE[params.importance]}`,
        ],
        action: 'Appliquer',
        avertissement:
          'Le planning déjà publié ne bouge pas : ce réglage vaudra pour la prochaine génération.',
      },
    }
  },

  async executer(params) {
    const r = await setEquiteImportance(params.dimension, params.importance)
    return 'error' in r ? { error: r.error } : {}
  },
}
