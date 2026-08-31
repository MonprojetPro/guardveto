// ============================================================
// GUARDVETO — Banc de mesure de la RELECTURE (B-089, lot 1)
// ============================================================
// SERVER-ONLY, et FACTURÉ : chaque exécution fait de vrais appels à l'API.
//
// LA QUESTION À LAQUELLE IL RÉPOND, chiffres en main — MiKL, le 31/08 :
// « le temps de réflexion est anormalement long, il doit y avoir quelque chose
//  qui cloche […] est-ce que c'est le niveau de réflexion d'Opus, ne vaudrait-il
//  pas mieux rester sur Sonnet 5 qui suffirait peut-être largement ? »
//
// ── CE QUE L'AUDIT A TROUVÉ AVANT D'ÉCRIRE CE BANC ──────────────────────────
//
// La relecture n'a JAMAIS réglé son application : `relecturePlanning.ts`
// n'envoyait pas `output_config.effort`, donc l'API applique son défaut —
// `high`, le deuxième cran le plus fouillé de la gamme. Ce n'est pas un choix
// qui a été fait, c'est un choix qui n'a pas été fait. Le Filou du quotidien,
// lui, tourne à `medium` depuis le 28/07 : la décision existait, elle n'avait
// simplement jamais été portée jusqu'ici.
//
// Et le volume n'explique rien : Hiver P1, c'est 40 places et 7 personnes, un
// prompt système de ~1 500 jetons. Une attente longue sur une entrée aussi
// petite ne vient pas de la lecture — elle vient de ce qu'on autorise à
// produire.
//
// ── POURQUOI UN BANC ET PAS UN CORRECTIF DIRECT ─────────────────────────────
//
// Parce qu'on ne sait pas encore ce que la qualité coûte. Baisser l'application
// et changer de modèle d'un même geste, c'est se priver de savoir lequel des
// deux a fait le gain — et lequel a fait la perte. Le banc mesure les deux
// axes séparément SUR LE MÊME DOSSIER, et MiKL tranche sur des chiffres.
//
// ── CE QU'IL MESURE, ET CE QU'IL NE MESURE PAS ──────────────────────────────
//
// ✅ Le temps de PRÉPARATION (contexte + « qui pourrait aller où ») isolé du
//    temps du modèle — sinon on accuse l'IA d'une lenteur qui serait la nôtre.
// ✅ Le temps, les jetons et le coût réel de chaque configuration.
// ✅ CE QU'ELLE A TROUVÉ : nombre de constats, de problèmes, de propositions.
//    Un banc qui ne mesurerait que la vitesse ferait choisir le plus rapide,
//    c'est-à-dire le plus muet.
//
// ❌ Il ne dit PAS combien de jetons sont partis dans la réflexion : l'API ne
//    sépare pas réflexion et réponse dans `usage`. On mesure ce qui se paie.
// ❌ Il ne juge pas la JUSTESSE des constats — ça, c'est l'œil de MiKL sur le
//    détail rendu, et c'est pour ça que le banc affiche les constats en clair.
//
// ⚠️ IL N'ÉCRIT RIEN. Pas d'arbitrage, pas de persistance, pas de planning
//    touché. Il lit un planning et pose des questions au modèle.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { resoudreContexte } from '@/data/resoudreContexte'
import { monterValidationPeriode } from '@/data/monterValidationPeriode'
import { monterDossierRelecture } from '@/data/monterDossierRelecture'
import { remplacantsPossibles } from '@/engine/relecture/remplacants'
import {
  relirePlanningIA,
  modeleRelecture,
  effortRelecture,
  type DossierRelecture,
  type EffortRelecture,
} from './relecturePlanning'
import { CRITERES_HUMAINS } from '@/lib/planning/criteres-humains'

/**
 * Tarifs publics, en dollars par MILLION de jetons (relevés le 2026-08-31).
 *
 * ⚠️ Sonnet 5 est en tarif d'introduction (2 $ / 10 $) jusqu'au 2026-08-31
 * INCLUS — c'est-à-dire aujourd'hui. On chiffre donc au tarif PLEIN : un banc
 * qui ferait trancher sur un prix qui expire ce soir ferait prendre la
 * décision pour de mauvaises raisons.
 */
const TARIFS: Record<string, { entree: number; sortie: number }> = {
  'claude-opus-4-8': { entree: 5, sortie: 25 },
  'claude-opus-5': { entree: 5, sortie: 25 },
  'claude-sonnet-5': { entree: 3, sortie: 15 },
  'claude-haiku-4-5': { entree: 1, sortie: 5 },
}

/** Écrire le cache coûte 1,25× ; le relire, 0,1×. */
const MULT_ECRITURE_CACHE = 1.25
const MULT_LECTURE_CACHE = 0.1

/**
 * Les configurations mises en concurrence.
 *
 * La première est l'ACTUELLE, sans réglage d'application — elle sert d'étalon.
 * Sans elle, on comparerait trois nouveautés entre elles sans jamais savoir ce
 * qu'on a amélioré.
 */
export interface ConfigBanc {
  cle: string
  nom: string
  modele: string
  /** `undefined` = on n'envoie rien, donc `high`, le défaut de l'API. */
  effort?: EffortRelecture
  pourquoi: string
}

export function configurationsBanc(): ConfigBanc[] {
  return [
    {
      cle: 'actuel',
      nom: 'Opus 4.8 · application non réglée',
      modele: 'claude-opus-4-8',
      effort: undefined,
      pourquoi:
        'Ce qui tourne aujourd’hui. L’application n’est pas transmise, donc l’API applique « high ».',
    },
    {
      cle: 'opus-medium',
      nom: 'Opus 4.8 · medium',
      modele: 'claude-opus-4-8',
      effort: 'medium',
      pourquoi:
        'Même modèle, application bridée : isole ce que coûte l’application, sans changer de cerveau.',
    },
    {
      cle: 'sonnet-medium',
      nom: 'Sonnet 5 · medium',
      modele: 'claude-sonnet-5',
      effort: 'medium',
      pourquoi:
        'Le candidat de MiKL, au même cran que le Filou du quotidien : isole ce que coûte le modèle.',
    },
    {
      cle: 'sonnet-low',
      nom: 'Sonnet 5 · low',
      modele: 'claude-sonnet-5',
      effort: 'low',
      pourquoi:
        'Le plancher. Sert à voir où la qualité casse — s’il tient ici, tout le reste est du confort.',
    },
  ]
}

// ── Ce que le banc rend ──────────────────────────────────────

export interface LigneBanc {
  cle: string
  nom: string
  pourquoi: string
  /** Rempli si l'appel a échoué — l'erreur brute, jamais maquillée. */
  erreur?: string
  secondes?: number
  entree?: number
  sortie?: number
  cacheLu?: number
  cout?: number
  /** Ce qu'il a TROUVÉ — sans quoi on choisirait le plus rapide, donc le plus muet. */
  criteresTraites?: number
  problemes?: number
  aSurveiller?: number
  changements?: number
  synthese?: string
  /** Les constats en clair : c'est là que MiKL juge la justesse, pas le banc. */
  constats?: { critere: string; verdict: string; constat: string }[]
}

export interface ResultatBancRelecture {
  periode: string
  /** Ce que le banc a donné à lire — la même chose pour tout le monde. */
  places: number
  personnes: number
  placesVides: number
  /** Le temps de NOTRE travail, avant le moindre appel au modèle. */
  preparationSecondes: number
  /** Le réglage réellement en vigueur au moment de la mesure. */
  configurationEnVigueur: { modele: string; effort: string }
  lignes: LigneBanc[]
  /** Coût total de cette exécution, en dollars. */
  coutTotal: number
  avertissements: string[]
}

// ── La mesure ────────────────────────────────────────────────

function cout(
  modele: string,
  m: { entree: number; sortie: number; cacheEcrit: number; cacheLu: number },
): number {
  const t = TARIFS[modele]
  if (!t) return 0
  const entree =
    (m.entree +
      m.cacheEcrit * MULT_ECRITURE_CACHE +
      m.cacheLu * MULT_LECTURE_CACHE) *
    (t.entree / 1_000_000)
  return entree + m.sortie * (t.sortie / 1_000_000)
}

/**
 * Monte le dossier UNE FOIS, puis fait relire le même dossier par chaque
 * configuration.
 *
 * ⚠️ Le dossier est monté une seule fois À DESSEIN : deux montages successifs
 * pourraient différer (une garde retouchée entre-temps) et on comparerait alors
 * des modèles sur des données différentes — le pire des bancs, celui qui rend
 * un classement faux avec l'autorité d'un chiffre.
 */
export async function lancerBancRelecture(
  supabase: SupabaseClient,
  periodeId: string,
  cabinetId: string,
): Promise<ResultatBancRelecture> {
  const avertissements: string[] = []

  // ── 1. NOTRE part du temps ──
  const t0 = Date.now()

  const contexte = await resoudreContexte(periodeId, cabinetId)
  const montage = await monterValidationPeriode(supabase, periodeId, cabinetId)
  if (!montage) {
    throw new Error('Aucun planning à relire pour cette période.')
  }
  const planningActuel = montage.construirePlanning(montage.gardes)

  const remplacants = remplacantsPossibles(planningActuel, {
    vets: contexte.vets,
    dateDebut: contexte.dateDebut,
    dateFin: contexte.dateFin,
    saison: contexte.saison,
    calendrier: contexte.calendrier,
    nbVetosSemaineSoir: contexte.nbVetosSemaineSoir,
    structureConfig: contexte.structureConfig,
    creneaux: contexte.creneaux,
    contexteAnterieur: contexte.contexteAnterieur,
  })

  const { dossier, historiqueIndisponible } = await monterDossierRelecture(
    supabase, planningActuel, contexte, periodeId, cabinetId, remplacants,
  )

  const preparationSecondes = (Date.now() - t0) / 1000

  if (historiqueIndisponible) {
    avertissements.push(
      'Les compteurs des périodes précédentes n’ont pas pu être lus : le critère « l’équilibre se juge au-delà de cette période » est mesuré à l’aveugle pour toutes les configurations.',
    )
  }

  // ── 2. Les configurations, EN PARALLÈLE ──
  //
  // ⚠️ Le parallèle est un choix de durée, pas de justesse : en série, quatre
  // appels dépasseraient le plafond de la plateforme et le banc mourrait avant
  // de rendre quoi que ce soit. Chaque configuration est chronométrée
  // individuellement, donc les temps restent comparables entre eux — mais ils
  // sont mesurés sous charge simultanée, et peuvent être un peu au-dessus de ce
  // qu'un appel seul donnerait. C'est écrit à l'écran : un chiffre dont on tait
  // les conditions de mesure est un chiffre qui ment.
  avertissements.push(
    'Les quatre configurations tournent en même temps : les durées sont comparables entre elles, mais chacune peut être légèrement au-dessus de ce que donnerait un appel isolé.',
  )

  const configs = configurationsBanc()
  const lignes = await Promise.all(
    configs.map(async (c): Promise<LigneBanc> => {
      const depart = Date.now()
      try {
        const r = await relirePlanningIA(dossier, {
          modele: c.modele,
          effort: c.effort,
        })
        const secondes = (Date.now() - depart) / 1000
        return {
          cle: c.cle,
          nom: c.nom,
          pourquoi: c.pourquoi,
          secondes,
          entree: r.mesure.entree,
          sortie: r.mesure.sortie,
          cacheLu: r.mesure.cacheLu,
          cout: cout(c.modele, r.mesure),
          criteresTraites: r.revue.length,
          problemes: r.revue.filter((x) => x.verdict === 'probleme').length,
          aSurveiller: r.revue.filter((x) => x.verdict === 'a_surveiller').length,
          changements: r.changements.length,
          synthese: r.synthese,
          constats: r.revue.map((x) => ({
            critere:
              CRITERES_HUMAINS.find((k) => k.cle === x.critere)?.titre ?? x.critere,
            verdict: x.verdict,
            constat: x.constat,
          })),
        }
      } catch (e) {
        // Une configuration qui échoue est un RÉSULTAT, pas un trou : c'est
        // peut-être exactement ce qu'on cherche (une coupure par manque de
        // place, un modèle qui refuse le réglage). On la rend telle quelle.
        return {
          cle: c.cle,
          nom: c.nom,
          pourquoi: c.pourquoi,
          secondes: (Date.now() - depart) / 1000,
          erreur: e instanceof Error ? e.message : String(e),
        }
      }
    }),
  )

  return {
    periode: dossier.periode,
    places: dossier.places.length,
    personnes: dossier.equipe.length,
    placesVides: dossier.places.filter((p) => !p.vetId).length,
    preparationSecondes,
    configurationEnVigueur: {
      modele: modeleRelecture(),
      effort: effortRelecture() ?? 'non réglé → « high », le défaut de l’API',
    },
    lignes,
    coutTotal: lignes.reduce((s, l) => s + (l.cout ?? 0), 0),
    avertissements,
  }
}

/** Le dossier, tel qu'il est parti — exposé pour pouvoir en compter les jetons. */
export type { DossierRelecture }
