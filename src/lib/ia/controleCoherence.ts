// ============================================================
// GUARDVETO — Contrôle de cohérence : GRATUIT, et c'est le point
// ============================================================
// SERVER-ONLY. Aucun appel au modèle : que des lectures en base. Il peut donc
// tourner autant de fois qu'on veut, avant chaque livraison, sans rien coûter.
//
// POURQUOI (MiKL, 2026-07-29 : « je suis pas sûr de tes tests qui me coûtent à
// chaque fois, trouve un autre moyen »). Le constat qui lui donne raison :
//
//   • Le banc payant est passé 5/5 sur un système qui avait DEUX trous.
//   • Ces deux trous, je les ai trouvés avec des REQUÊTES — pas avec le modèle.
//
// Ce que le modèle sait faire, c'est comprendre une phrase. Il ne sait pas si
// deux tables se parlent : ça, une requête le dit, et pour rien. Ce fichier
// reprend donc exactement les contrôles qui ont débusqué les vrais défauts.
//
// Chaque contrôle répond à une question qu'on s'est réellement posée en
// production, et rend un verdict lisible plutôt qu'un tableau à interpréter.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  placesAttendues,
  manqueSurGarde,
  codeCatalogue,
  effectifNuitSemaine as effectifNuitSemaineLocal,
} from '@/lib/planning/placesAttendues'
import type { PeriodeEffectif, ProfilEffectif } from '@/lib/planning/placesAttendues'
import { lignesLues } from './outils/lecture'

export interface Controle {
  /** Ce qui est vérifié, en français. */
  quoi: string
  /** `ok` : rien à signaler. `alerte` : à regarder. `info` : constat utile. */
  etat: 'ok' | 'alerte' | 'info'
  /** Le verdict, avec les chiffres. */
  verdict: string
  /** Le détail, une ligne par élément — jamais « 3 problèmes » sans dire lesquels. */
  lignes: string[]
}

export interface RapportCoherence {
  controles: Controle[]
  alertes: number
  ms: number
}

/**
 * Passe tous les contrôles. Ne modifie rien, ne coûte rien.
 */
export async function controlerCoherence(
  supabase: SupabaseClient,
  cabinetId: string,
): Promise<RapportCoherence> {
  const depart = Date.now()

  // ⚠️ Même exigence que la borne `cabinet_id` juste en dessous, et pour la même
  // raison : « un diagnostic faux est pire qu'une absence de diagnostic, parce
  // qu'on le croit ». Une lecture en panne lue comme un vide ferait annoncer
  // « aucune incohérence » sur un cabinet qu'on n'a pas regardé. On lève —
  // l'action serveur du banc rattrape et affiche la panne telle quelle.
  const [repGardes, repCreneaux, repPeriodes, repProfils] =
    await Promise.all([
      supabase
        .from('planning_semaine')
        // La vue n'a AUCUNE RLS. Sans cette borne, le rapport de cohérence du
        // cabinet A intégrait les gardes du cabinet B et annonçait des trous
        // imaginaires — un diagnostic faux est pire qu'une absence de
        // diagnostic, parce qu'on le croit.
        .select('date, type, premier_prenom, second_prenom, periode_statut')
        .eq('cabinet_id', cabinetId)
        .order('date'),
      supabase
        .from('creneau_modele')
        .select('code, nom, nb_places, actif, profil_id')
        .eq('cabinet_id', cabinetId),
      supabase
        .from('periodes')
        .select('libelle, saison, numero, date_debut, date_fin, statut, profil_id, nb_vetos_semaine_soir')
        .order('date_debut', { ascending: false })
        .limit(50),
      supabase
        .from('profils_planning')
        .select('id, nom, nb_vetos_semaine_soir')
        .eq('cabinet_id', cabinetId),
    ])

  const gardes = lignesLues<{
    date: string
    type: string
    premier_prenom: string | null
    second_prenom: string | null
    periode_statut: string
  }>(repGardes, 'le planning du cabinet')

  const creneaux = lignesLues<{
    code: string | null
    nom: string
    nb_places: number | null
    actif: boolean
    profil_id: string | null
  }>(repCreneaux, 'les types de garde du cabinet')

  const periodes = lignesLues<PeriodeEffectif & { libelle: string | null; statut: string }>(
    repPeriodes,
    'la liste des plannings du cabinet',
  )
  const profils = lignesLues<ProfilEffectif & { nom: string }>(repProfils, 'les périodes types du cabinet')
  const profilParId = new Map(profils.map((p) => [p.id, p]))

  // Le catalogue, avec la même règle de désaccord que l'outil : deux profils qui
  // ne s'accordent pas sur un code → indéterminé plutôt que faux.
  const catalogue = new Map<string, number | null>()
  for (const c of creneaux) {
    if (!c.code) continue
    const n = typeof c.nb_places === 'number' ? c.nb_places : null
    if (!catalogue.has(c.code)) catalogue.set(c.code, n)
    else if (catalogue.get(c.code) !== n) catalogue.set(c.code, null)
  }

  const controles: Controle[] = []

  // ── ① Les deux vocabulaires se parlent-ils ? ────────────────
  // LE contrôle qui a trouvé le trou du 29 juillet : 57 lignes de planning sur
  // 100 dont le code n'existait nulle part dans le catalogue.
  const typesPlanning = new Map<string, number>()
  for (const g of gardes) typesPlanning.set(g.type, (typesPlanning.get(g.type) ?? 0) + 1)

  const orphelins: string[] = []
  for (const [type, n] of typesPlanning) {
    const connu = catalogue.has(type) || catalogue.has(codeCatalogue(type))
    if (!connu) orphelins.push(`« ${type} » : ${n} jour${n > 1 ? 's' : ''} de planning, aucun créneau correspondant`)
  }
  controles.push({
    quoi: 'Chaque type de garde du planning correspond-il à un créneau du catalogue ?',
    etat: orphelins.length > 0 ? 'alerte' : 'ok',
    verdict:
      orphelins.length > 0
        ? `${orphelins.length} type${orphelins.length > 1 ? 's' : ''} de garde sans créneau : Filou ne peut pas savoir combien de personnes y sont attendues.`
        : `Les ${typesPlanning.size} types de garde utilisés sont tous rattachés à un créneau.`,
    lignes: orphelins,
  })

  // ── ② Sait-on, pour chaque garde, combien de personnes sont attendues ? ──
  // Un « indéterminé » n'est pas une faute, mais c'est un angle mort : sur ces
  // jours-là, Filou ne peut ni confirmer ni infirmer un manque.
  let indetermines = 0
  const manquants: string[] = []
  for (const g of gardes) {
    const attendues = placesAttendues({
      typePlanning: g.type,
      date: g.date,
      catalogue,
      periodes,
      profils: profilParId,
    })
    if (attendues === null) {
      indetermines += 1
      continue
    }
    const pourvues = [g.premier_prenom, g.second_prenom].filter(Boolean).length
    const manque = manqueSurGarde(attendues, pourvues)
    if (manque && manque > 0) {
      manquants.push(
        `${g.date} (${g.type}) : ${pourvues} sur ${attendues} — planning ${g.periode_statut}`,
      )
    }
  }
  controles.push({
    quoi: 'Sait-on, pour chaque jour, combien de personnes sont attendues ?',
    etat: indetermines > 0 ? 'alerte' : 'ok',
    verdict:
      indetermines > 0
        ? `${indetermines} jour${indetermines > 1 ? 's' : ''} sur ${gardes.length} sans réponse : angle mort pour Filou.`
        : `Les ${gardes.length} jours de planning ont un effectif attendu connu.`,
    lignes: [],
  })

  // ── ③ Des trous réels dans le planning ? ────────────────────
  controles.push({
    quoi: 'Y a-t-il des gardes réellement incomplètes ?',
    etat: manquants.length > 0 ? 'alerte' : 'ok',
    verdict:
      manquants.length > 0
        ? `${manquants.length} garde${manquants.length > 1 ? 's' : ''} incomplète${manquants.length > 1 ? 's' : ''}.`
        : 'Aucune garde incomplète sur tout le planning connu.',
    lignes: manquants.slice(0, 20),
  })

  // ── ④ Deux profils qui se contredisent sur un même créneau ──
  // Cause d'« indéterminé » la plus sournoise : tout a l'air réglé, mais on ne
  // sait pas quel réglage s'applique.
  const conflits = [...catalogue.entries()]
    .filter(([, n]) => n === null)
    .map(([code]) => `« ${code} » : nombre de places différent selon le profil`)
  controles.push({
    quoi: 'Les profils s’accordent-ils sur le nombre de places de chaque créneau ?',
    etat: conflits.length > 0 ? 'alerte' : 'ok',
    verdict:
      conflits.length > 0
        ? `${conflits.length} créneau${conflits.length > 1 ? 'x' : ''} en désaccord entre profils.`
        : 'Tous les créneaux ont un nombre de places cohérent d’un profil à l’autre.',
    lignes: conflits,
  })

  // ── ⑤ Des créneaux déclarés mais jamais utilisés ────────────
  // Pas une faute : un profil d'hiver a des créneaux qui ne servent pas l'été.
  // Mais un créneau que le planning n'utilise JAMAIS peut signaler un
  // vocabulaire qui a divergé — c'est ce qu'était devenu « vendredi_soir ».
  const codesUtilises = new Set([...typesPlanning.keys()].map((t) => codeCatalogue(t)))
  const jamaisVus = [...new Set(creneaux.filter((c) => c.code && c.actif).map((c) => c.code!))]
    .filter((code) => !codesUtilises.has(code))
  controles.push({
    quoi: 'Des créneaux actifs n’apparaissent-ils jamais dans le planning ?',
    etat: jamaisVus.length > 0 ? 'info' : 'ok',
    verdict:
      jamaisVus.length > 0
        ? `${jamaisVus.length} créneau${jamaisVus.length > 1 ? 'x' : ''} actif${jamaisVus.length > 1 ? 's' : ''} jamais utilisé${jamaisVus.length > 1 ? 's' : ''} — normal hors saison, suspect sinon.`
        : 'Tous les créneaux actifs sont utilisés quelque part.',
    lignes: jamaisVus.map((code) => {
      const c = creneaux.find((x) => x.code === code)
      return `« ${code} » (${c?.nom ?? '—'})`
    }),
  })

  // ── ⑥ Le férié : deux règles qui se contredisent ────────────
  // Trouvé le 29 juillet grâce à ce contrôle même. Le moteur traite un jour
  // férié comme un soir de semaine ; le catalogue lui déclare son propre nombre
  // de places. Tant que les deux disent la même chose, personne ne voit rien.
  // Dès qu'ils divergent — un férié d'été, où la semaine n'attend qu'une
  // personne mais le créneau en déclare deux — le planning généré paraît
  // incomplet alors qu'il respecte le moteur.
  //
  // On ne tranche pas ici : c'est une décision de cabinet, pas de code.
  const placesFerie = catalogue.get('ferie')
  const desaccordsFerie: string[] = []
  if (typeof placesFerie === 'number') {
    for (const p of periodes) {
      // `null` depuis le 2026-08-04 = aucune surcharge de planning, donc c'est
      // le créneau du soir qui décide. Il n'y a alors PLUS de désaccord
      // possible : les deux lisent le même catalogue. On ne compare que les
      // périodes qui portent une surcharge — les seules à pouvoir contredire.
      const effectif = effectifNuitSemaineLocal(p, profilParId)
      if (effectif !== null && effectif !== placesFerie) {
        desaccordsFerie.push(
          `${p.libelle ?? p.date_debut} : le moteur programme ${effectif} vétérinaire${effectif > 1 ? 's' : ''} un jour férié (règle de la nuit de semaine), le catalogue en déclare ${placesFerie}.`,
        )
      }
    }
  }
  controles.push({
    quoi: 'Un jour férié : le moteur et le catalogue s’accordent-ils ?',
    etat: desaccordsFerie.length > 0 ? 'alerte' : 'ok',
    verdict:
      desaccordsFerie.length > 0
        ? `Désaccord sur ${desaccordsFerie.length} période${desaccordsFerie.length > 1 ? 's' : ''}. Le planning suit le moteur ; à trancher avec le cabinet.`
        : 'Le moteur et le catalogue programment le même effectif les jours fériés.',
    lignes: desaccordsFerie,
  })

  // ── ⑦ L'effectif de nuit de semaine, période par période ────
  // Affiché en clair : c'est le réglage qui a produit le faux « second
  // manquant », et personne ne pouvait le lire depuis l'application.
  const lignesEffectif = periodes.slice(0, 8).map((p) => {
    // Deux provenances depuis le 2026-08-04 (la troisième, « hérité de la
    // période type », a disparu avec le réglage qui la portait).
    const duCatalogue = catalogue.get('semaine_soir')
    const effectif =
      typeof p.nb_vetos_semaine_soir === 'number'
        ? `${p.nb_vetos_semaine_soir} (réglé sur ce planning)`
        : typeof duCatalogue === 'number'
          ? `${duCatalogue} (structure des gardes de sa période type)`
          : `${p.saison === 'hiver' ? 2 : 1} (aucune structure : défaut de la saison ${p.saison === 'hiver' ? 'hiver' : 'été'})`
    return `${p.libelle ?? p.date_debut} — ${effectif}`
  })
  controles.push({
    quoi: 'Combien de vétérinaires une nuit de semaine attend-elle, période par période ?',
    etat: 'info',
    verdict: 'Le réglage tel que le moteur et Filou le lisent.',
    lignes: lignesEffectif,
  })

  return {
    controles,
    alertes: controles.filter((c) => c.etat === 'alerte').length,
    ms: Date.now() - depart,
  }
}
