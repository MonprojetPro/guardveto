'use server'

// ============================================================
// GUARDVETO — Importer un ancien planning : écrire, défaire
// ============================================================
//   enregistrerPlanningImporte() — écrit, APRÈS que l'admin a vu et validé.
//   supprimerPlanningImporte()   — défait l'import, en entier.
//
// LA LECTURE N'EST PLUS ICI. Elle vit dans `POST /api/import/lire` depuis le
// 2026-08-18 : en Server Action, le document voyageait dans les arguments, que
// le décodeur de Next borne à ~1 Mo — tout fichier un peu lourd échouait sur
// « Maximum array nesting exceeded » avant même d'atteindre notre code. La
// frontière lecture / écriture, elle, n'a pas bougé : lire n'écrit JAMAIS, et
// l'écriture attend que l'admin ait relu ligne par ligne.
//
// POURQUOI ÉCRIRE DE VRAIES GARDES plutôt qu'un compteur de départ à part.
// Les compteurs (`compteurs_gardes`) et le planning affiché
// (`planning_semaine`) sont des VUES SQL au-dessus de `gardes` : en écrivant
// des gardes réelles, tout s'alimente sans qu'on invente un second chemin de
// lecture — et la mémoire du moteur suit aussi, parce que le lookback
// inter-périodes lit `gardes` PAR DATE, toutes périodes confondues
// (cf. `engine/loader.ts`). Un compteur stocké à part aurait donné des
// chiffres justes sur un écran et un moteur toujours aveugle.
//
// RÉVERSIBLE, et c'est non négociable : une lecture ratée le jour de la
// démonstration ne doit pas polluer les compteurs pour de bon. La période
// porte `importe = true`, et sa suppression emporte les gardes en cascade.
//
// ⚠️ Ce fichier est un `'use server'` : il n'exporte QUE des fonctions
// asynchrones. Aucun type n'y est déclaré ni réexporté — un type exporté
// depuis un module serveur donne une page blanche en production alors que
// tout compile (piège déjà payé ; `tests/lib/use-server-exports.test.ts`
// monte la garde).
// ============================================================

import { contexteAdmin } from '@/lib/import/contexteAdmin'
import { revalidatePath } from 'next/cache'
import { queryCompteurs, queryTotalWE } from '@/hooks/useCompteurs'
import { calculerBilans } from '@/engine/bilan'
import {
  ancrerSamedi,
  dimancheDeLaSemaine,
  lundiDeLaSemaine,
  saisonDe,
} from '@/lib/ia/lirePlanningImporte'
import type { ReponseEcritureImport, LigneAEcrire } from '@/lib/ia/importTypes'



/**
 * Écrit ce que l'humain a validé. C'est le SEUL endroit qui écrit.
 *
 * Ne fait aucune confiance à ce que le navigateur renvoie : les identifiants
 * de vétérinaires sont revérifiés contre le cabinet, les dates revalidées, et
 * les week-ends réancrés sur leur samedi.
 */
export async function enregistrerPlanningImporte(
  libelle: string,
  lignes: LigneAEcrire[],
): Promise<ReponseEcritureImport> {
  const c = await contexteAdmin()
  if ('error' in c) return c
  const { supabase, cabinetId } = c

  if (!Array.isArray(lignes) || lignes.length === 0) {
    return { error: "Il n'y a aucune garde à enregistrer." }
  }
  if (lignes.length > 800) {
    return { error: 'Cet import couvre plus de 800 gardes — découpe-le en deux périodes.' }
  }

  // ── Qui existe vraiment ────────────────────────────────────
  const { data: vetsDb } = await supabase
    .from('veterinaires')
    .select('id')
    .eq('cabinet_id', cabinetId)
    .eq('actif', true)
  const idsConnus = new Set(((vetsDb as { id: string }[] | null) ?? []).map((v) => v.id))

  const typesValides = new Set(['weekend', 'semaine', 'ferie'])
  const parCle = new Map<string, { date: string; type: string; premier: string | null; second: string | null }>()

  for (const l of lignes) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date) || Number.isNaN(Date.parse(l.date))) {
      return { error: `Une des dates n’en est pas une (« ${l.date} »).` }
    }
    if (!typesValides.has(l.type)) {
      return { error: `Un des types de garde n’existe pas (« ${l.type} »).` }
    }
    const premier = l.premierId && idsConnus.has(l.premierId) ? l.premierId : null
    const second = l.secondId && idsConnus.has(l.secondId) ? l.secondId : null
    // Une garde sans personne n'apprend rien à un compteur : on ne l'écrit pas.
    if (!premier && !second) continue

    const date = ancrerSamedi(l.date, l.type)
    // Un seul enregistrement par (date, type) : la base porte un index UNIQUE
    // là-dessus, et deux lignes lues pour le même week-end feraient tomber
    // l'insertion entière.
    parCle.set(`${date}|${l.type}`, { date, type: l.type, premier, second })
  }

  const retenues = [...parCle.values()]
  if (retenues.length === 0) {
    return { error: "Aucune garde n'a de vétérinaire rattaché : il n'y a rien à enregistrer." }
  }

  const dates = retenues.map((g) => g.date).sort()
  const dateDebut = lundiDeLaSemaine(dates[0])
  // Un week-end ancré au samedi couvre jusqu'au dimanche : on clôt donc à la
  // fin de la semaine de la dernière garde, sinon la période s'arrêterait au
  // milieu d'un week-end qu'elle contient.
  const dateFin = dimancheDeLaSemaine(dates[dates.length - 1])

  // ── Le créneau est-il déjà occupé ? ────────────────────────
  // `gardes` porte un index UNIQUE (cabinet_id, date, type) : réimporter un
  // planning déjà importé ferait échouer l'insertion à mi-course, après la
  // création de la période. On regarde avant, et on le dit en français.
  const { data: dejaLa } = await supabase
    .from('gardes')
    .select('date, type')
    .eq('cabinet_id', cabinetId)
    .gte('date', dateDebut)
    .lte('date', dateFin)

  const occupees = new Set(
    ((dejaLa as { date: string; type: string }[] | null) ?? []).map((g) => `${g.date}|${g.type}`),
  )
  const collisions = retenues.filter((g) => occupees.has(`${g.date}|${g.type}`))
  if (collisions.length > 0) {
    return {
      error: `Ces dates portent déjà des gardes dans l’application (${collisions.length} au total, à partir du ${collisions[0].date}). Supprime l’import précédent avant de recommencer.`,
    }
  }

  // ── La période ─────────────────────────────────────────────
  const titre = (libelle || '').trim().slice(0, 80) || `Planning importé du ${dateDebut}`
  const { data: periode, error: errPeriode } = await supabase
    .from('periodes')
    .insert({
      cabinet_id: cabinetId,
      saison: saisonDe(dateDebut),
      date_debut: dateDebut,
      date_fin: dateFin,
      // « verrouillé » et pas « publié » : cette période est de l'histoire, pas
      // une annonce. Verrouillée, le moteur refuse de la régénérer — ce qui est
      // exactement ce qu'on veut d'un passé recopié à la main.
      statut: 'verrouille',
      libelle: titre,
      importe: true,
    })
    .select('id')
    .single()

  if (errPeriode || !periode) {
    return { error: `Je n’ai pas pu créer la période : ${errPeriode?.message ?? 'raison inconnue'}` }
  }
  const periodeId = periode.id as string

  // ── Les gardes ─────────────────────────────────────────────
  const { error: errGardes } = await supabase.from('gardes').insert(
    retenues.map((g) => ({
      periode_id: periodeId,
      cabinet_id: cabinetId,
      date: g.date,
      type: g.type,
      premier_id: g.premier,
      second_id: g.second,
      verrouille: true,
      modifie_manuellement: true,
    })),
  )

  if (errGardes) {
    // On ne laisse pas une période vide derrière soi : une coquille dans
    // l'historique ferait croire à un import réussi.
    await supabase.from('periodes').delete().eq('id', periodeId).eq('cabinet_id', cabinetId)
    return { error: `Je n’ai pas pu enregistrer les gardes : ${errGardes.message}` }
  }

  // ── Le bilan : ce qui fait vraiment démarrer l'équité ───────
  // Sans lui, les compteurs affichent bien l'historique mais la génération
  // suivante repartirait à égalité parfaite : c'est `bonus_malus` que le
  // moteur relit pour rattraper les écarts (cf. `engine/loader.ts`, R20).
  // Best-effort : un bilan raté ne doit pas annuler un import réussi.
  let bilanEcrit = false
  try {
    const [{ compteurs, erreur: errCompteurs }, { totalWE, erreur: errWE }] = await Promise.all([
      queryCompteurs(supabase, periodeId),
      queryTotalWE(supabase, periodeId),
    ])
    // Une lecture en échec ne doit PAS repartir dans la branche « pas de
    // compteurs » ci-dessous : `bonus_malus` est ce que le moteur relit pour
    // rattraper les écarts. Un bilan écrit sur des compteurs qu'on n'a pas su
    // lire fabriquerait une injustice durable, sans jamais rien signaler.
    const erreurLecture = errCompteurs ?? errWE
    if (erreurLecture) {
      console.error(
        `[import-actions] compteurs illisibles pour la periode ${periodeId} (${erreurLecture}) — bilan NON écrit`,
      )
    } else if (compteurs.length > 0) {
      const bilans = calculerBilans(compteurs, totalWE)
      const { error: errBilan } = await supabase.from('bonus_malus').upsert(
        bilans.map((b) => ({
          cabinet_id: cabinetId,
          veterinaire_id: b.veterinaire_id,
          periode_id: periodeId,
          ecart_we: b.ecart_we,
          ecart_semaine: b.ecart_semaine,
          ecart_feries: b.ecart_feries,
          ecart_grands_we: b.ecart_grands_we,
        })),
        { onConflict: 'cabinet_id,veterinaire_id,periode_id' },
      )
      bilanEcrit = !errBilan
    }
  } catch {
    bilanEcrit = false
  }

  // Les écrans qui lisent la base côté serveur (accueil, planning, historique,
  // compteurs) doivent voir la nouvelle période sans qu'on recharge à la main.
  for (const chemin of ['/accueil', '/planning', '/historique', '/compteurs', '/equipe']) {
    revalidatePath(chemin)
  }

  return {
    success: true,
    periodeId,
    libelle: titre,
    nbGardes: retenues.length,
    dateDebut,
    dateFin,
    bilanEcrit,
  }
}

/**
 * Défait un import, en entier.
 *
 * Refuse tout ce qui n'est pas une période importée : la suppression d'un vrai
 * planning ne doit pas pouvoir passer par cette porte-là.
 */
export async function supprimerPlanningImporte(
  periodeId: string,
): Promise<{ error: string } | { success: true }> {
  const c = await contexteAdmin()
  if ('error' in c) return c
  const { supabase, cabinetId } = c

  const { data: periode } = await supabase
    .from('periodes')
    .select('id, importe')
    .eq('id', periodeId)
    .eq('cabinet_id', cabinetId)
    .maybeSingle()

  if (!periode) return { error: 'Cette période n’existe pas (ou plus).' }
  if (!(periode as { importe: boolean }).importe) {
    return { error: 'Cette période n’a pas été importée : je ne la supprime pas depuis ici.' }
  }

  // `bonus_malus` n'est pas en cascade sur la période : laissé derrière, il
  // continuerait de peser sur l'équité de la génération suivante alors que les
  // gardes qui l'ont produit n'existent plus.
  await supabase.from('bonus_malus').delete().eq('periode_id', periodeId).eq('cabinet_id', cabinetId)

  const { error } = await supabase
    .from('periodes')
    .delete()
    .eq('id', periodeId)
    .eq('cabinet_id', cabinetId)

  if (error) return { error: `Je n’ai pas pu supprimer l’import : ${error.message}` }

  for (const chemin of ['/accueil', '/planning', '/historique', '/compteurs', '/equipe']) {
    revalidatePath(chemin)
  }
  return { success: true }
}
