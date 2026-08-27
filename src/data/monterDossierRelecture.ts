// ============================================================
// GUARDVETO — Ce que Filou a sous les yeux pour relire un planning (B-062)
// ============================================================
// Assemble le dossier que Filou reçoit : le planning place par place, l'équipe
// avec ses compteurs, ses absences et ses règles, et l'historique cumulé des
// périodes précédentes.
//
// ── UNE SEULE RÈGLE DE FOND ─────────────────────────────────────────────────
//
// Les compteurs de la période sont calculés DEPUIS LE PLANNING qu'on montre à
// Filou, jamais lus ailleurs. C'est la leçon du 26/08 (B-065) : deux calculs
// qui vivent dans deux fichiers finissent par diverger en silence, et ici la
// divergence serait invisible — Filou raisonnerait sur des chiffres qui ne
// décrivent pas le planning affiché sous ses yeux, et son constat serait faux
// avec le même aplomb qu'un vrai.
//
// L'historique cumulé, lui, vient bien de la base (`compteurs_gardes` sur les
// périodes ANTÉRIEURES) : c'est une information que le planning courant ne
// contient pas.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlanningPartiel } from '@/engine/types'
import type {
  DossierRelecture, PersonneLisible, PlaceLisible,
} from '@/lib/ia/relecturePlanning'
import { dateFr, periodeFr } from '@/lib/dates-fr'
import { phraseRegle, type RegleNommable } from '@/lib/regles/libelle'

/** Le contexte du moteur, réduit à ce que le dossier consomme. */
export interface ContextePourDossier {
  dateDebut: string
  dateFin: string
  saison: 'ete' | 'hiver'
  vets: Array<{
    id: string
    prenom: string
    dernier_recours?: boolean
    conges?: Array<{ date_debut: string; date_fin: string; type?: string }>
  }>
  roleAvantageFinancier?: string | null
  creneaux?: Array<{ code?: string | null; nom?: string | null }>
}

/** Un créneau du moteur, dit en français. Repli sur le code si inconnu. */
function creneauEnFrancais(
  type: string,
  nomsParCode: Map<string, string>,
): string {
  const connu = nomsParCode.get(type)
  if (connu) return connu
  if (type === 'semaine_soir') return 'nuit de semaine'
  if (type === 'vendredi_soir') return 'vendredi soir'
  if (type === 'weekend') return 'week-end'
  if (type === 'ferie') return 'jour férié'
  return type
}

/**
 * Compte les gardes de chacun DANS ce planning.
 *
 * `premierWeekend` compte le rôle qui porte l'avantage financier sur les
 * créneaux de week-end — c'est le compteur de B-061, celui dont l'absence a
 * laissé Fanny à zéro sans que rien ne le dise.
 */
export function compterDansPlanning(
  planning: PlanningPartiel,
  roleAvantage: string | null,
): Map<string, { total: number; weekends: number; premierWeekend: number }> {
  const compte = new Map<string, { total: number; weekends: number; premierWeekend: number }>()
  const prendre = (vetId: string) => {
    let c = compte.get(vetId)
    if (!c) { c = { total: 0, weekends: 0, premierWeekend: 0 }; compte.set(vetId, c) }
    return c
  }

  for (const a of planning.attributions) {
    const estWeekend = a.type === 'weekend'
    for (const p of a.placements) {
      if (!p.vetId) continue
      const c = prendre(p.vetId)
      c.total += 1
      if (estWeekend) {
        c.weekends += 1
        if (roleAvantage && p.role === roleAvantage) c.premierWeekend += 1
      }
    }
  }
  return compte
}

/**
 * Construit le dossier. Ne lit la base QUE pour l'historique cumulé — tout le
 * reste vient du planning et du contexte déjà chargés par l'appelant.
 *
 * `historiqueIndisponible` est remonté plutôt qu'avalé : sans historique,
 * « équilibre global » ne veut rien dire, et Filou doit pouvoir le taire au
 * lieu d'affirmer un équilibre qu'il n'a pas pu regarder.
 */
export async function monterDossierRelecture(
  supabase: SupabaseClient,
  planning: PlanningPartiel,
  contexte: ContextePourDossier,
  periodeId: string,
  cabinetId: string,
  /** Place → identifiants pouvant la tenir (cf. `engine/relecture/remplacants`). */
  remplacants?: Map<string, string[]>,
): Promise<{ dossier: DossierRelecture; historiqueIndisponible: boolean }> {
  const roleAvantage = contexte.roleAvantageFinancier ?? null

  const nomsParCode = new Map<string, string>()
  for (const c of contexte.creneaux ?? []) {
    if (c.code && c.nom) nomsParCode.set(c.code, c.nom)
  }

  // ── Qui pourrait tenir chaque place ──
  // Calculé par le MOTEUR, pas déduit par Filou : c'est ce qui transforme un
  // observateur impuissant en quelqu'un qui propose des choses applicables.
  const possibles = remplacants ?? new Map<string, string[]>()

  // ── Les places, dans l'ordre du calendrier ──
  const prenomParId = new Map(contexte.vets.map((v) => [v.id, v.prenom]))
  const places: PlaceLisible[] = []
  const attributionsTriees = [...planning.attributions].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.type < b.type ? -1 : 1,
  )
  for (const a of attributionsTriees) {
    for (const p of a.placements) {
      places.push({
        date: a.date,
        jour: dateFr(a.date),
        creneau: creneauEnFrancais(a.type, nomsParCode),
        type: a.type,
        role: p.role,
        prenom: p.vetId ? (prenomParId.get(p.vetId) ?? null) : null,
        vetId: p.vetId,
        remplacants: (possibles.get(`${a.date}|${a.type}|${p.role}`) ?? [])
          .map((id) => prenomParId.get(id))
          .filter((x): x is string => Boolean(x)),
      })
    }
  }

  // ── Les compteurs de CETTE période, depuis ce planning ──
  const compteurs = compterDansPlanning(planning, roleAvantage)

  // ── L'historique cumulé des périodes ANTÉRIEURES ──
  let historiqueIndisponible = false
  const historique = new Map<string, { total: number; weekends: number; premierWeekend: number }>()
  {
    const { data: periodesAnterieures, error: errPeriodes } = await supabase
      .from('periodes')
      .select('id')
      .eq('cabinet_id', cabinetId)
      .lt('date_debut', contexte.dateDebut)

    if (errPeriodes) {
      historiqueIndisponible = true
    } else {
      const ids = (periodesAnterieures ?? []).map((p) => (p as { id: string }).id)
      if (ids.length > 0) {
        const { data: lignes, error: errCompteurs } = await supabase
          .from('compteurs_gardes')
          .select('veterinaire_id, we_total, we_premier, total_gardes')
          .in('periode_id', ids)

        if (errCompteurs) {
          // Une erreur ne devient JAMAIS « zéro ligne » : sans ce drapeau,
          // l'absence d'historique se lirait « tout le monde part de zéro »,
          // et Filou déclarerait un équilibre qu'il n'a pas pu vérifier.
          historiqueIndisponible = true
        } else {
          for (const l of (lignes ?? []) as Array<{
            veterinaire_id: string
            we_total: number | null
            we_premier: number | null
            total_gardes: number | null
          }>) {
            const cumul = historique.get(l.veterinaire_id)
              ?? { total: 0, weekends: 0, premierWeekend: 0 }
            cumul.total += l.total_gardes ?? 0
            cumul.weekends += l.we_total ?? 0
            cumul.premierWeekend += l.we_premier ?? 0
            historique.set(l.veterinaire_id, cumul)
          }
        }
      }
    }
  }

  // ── Les règles, dites par la SOURCE UNIQUE du produit ──
  //
  // `phraseRegle` est la même fonction qui écrit les règles sur l'écran Règles
  // et sur la fiche du véto. Écrire ici une seconde traduction ferait diverger
  // les deux au premier réglage ajouté, et Filou raisonnerait sur une règle
  // formulée autrement que celle que l'admin lit (défaut B-023, corrigé le 26/08).
  const nomVeto = (id: string) => prenomParId.get(id) ?? 'quelqu’un'
  const reglesParVet = new Map<string, string[]>()
  const reglesCabinet: string[] = []
  {
    const { data: regles } = await supabase
      .from('regles_cabinet')
      .select('id, brique_id, params_json, actif')
      .eq('cabinet_id', cabinetId)
      .eq('actif', true)

    for (const r of (regles ?? []) as Array<RegleNommable & { actif: boolean }>) {
      let phrase: string
      try {
        phrase = phraseRegle(r, nomVeto)
      } catch {
        // Une règle qu'on ne sait pas dire est TUE, pas approximée : une phrase
        // inventée ferait raisonner Filou sur une règle qui n'existe pas. Elle
        // reste appliquée par les gardiens, qui la connaissent.
        continue
      }
      const refs = ((r.params_json as { qui?: { refs?: unknown } } | null)?.qui?.refs ?? []) as unknown[]
      const cibles = refs.filter((x): x is string => typeof x === 'string')
      if (cibles.length === 0) {
        reglesCabinet.push(phrase)
      } else {
        for (const id of cibles) {
          reglesParVet.set(id, [...(reglesParVet.get(id) ?? []), phrase])
        }
      }
    }
  }

  // ── L'équipe ──
  const equipe: PersonneLisible[] = contexte.vets.map((v) => {
    const absences = (v.conges ?? []).map((c) => {
      const quand = c.date_debut === c.date_fin
        ? dateFr(c.date_debut)
        : periodeFr(c.date_debut, c.date_fin)
      // Le TYPE compte : une formation et un arrêt maladie se respectent
      // autant que des vacances, mais ne se déplacent pas de la même façon —
      // et Filou ne doit pas proposer « décale ton congé » à quelqu'un en
      // arrêt. L'omettre reviendrait à les rendre interchangeables.
      return c.type && c.type !== 'vacances' ? `${quand} (${c.type})` : quand
    })
    const regles = reglesParVet.get(v.id) ?? []
    return {
      vetId: v.id,
      prenom: v.prenom,
      gardesPeriode: compteurs.get(v.id) ?? { total: 0, weekends: 0, premierWeekend: 0 },
      historique: historique.get(v.id),
      absences,
      regles: v.dernier_recours
        ? ['DERNIER RECOURS : le moteur ne la programme jamais spontanément. Ne la propose pas.', ...regles]
        : regles,
    }
  })

  return {
    dossier: {
      periode: periodeFr(contexte.dateDebut, contexte.dateFin),
      saison: contexte.saison,
      places,
      equipe,
      reglesCabinet,
      roleAvantageFinancier: roleAvantage,
    },
    historiqueIndisponible,
  }
}
