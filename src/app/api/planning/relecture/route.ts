// ============================================================
// GUARDVETO — API Route POST /api/planning/relecture (B-062, lot 1)
// ============================================================
// La dernière couche : Filou relit le planning que le moteur vient de produire,
// propose des changements, le moteur contrôle leur légalité, et ce qui est
// légal est appliqué.
//
// ── POURQUOI UNE ROUTE SÉPARÉE DE LA GÉNÉRATION ─────────────────────────────
//
// Contrainte mesurable : `/api/generate` tient dans 60 secondes, dont 30 pour
// le seed et 12 pour le rattrapage. Un appel Opus sur 12 semaines de planning
// n'y entre pas. Mais ce n'est pas la seule raison, ni la meilleure :
//
//   • Si Filou échoue, le planning du moteur est DÉJÀ en base et intact. Une
//     relecture ratée ne peut pas emporter une génération réussie.
//   • On peut relire un planning sans le régénérer — donc après une retouche
//     manuelle, ou simplement parce que l'admin veut un deuxième avis.
//   • Le coût est isolé et mesurable, au lieu d'être noyé dans la génération.
//
// L'écran enchaîne automatiquement dessus après une génération : pour l'admin,
// c'est une seule opération en deux temps, pas deux boutons.
//
// ── CE QUI FAIT VETO, ET CE QUI NE FAIT PAS VETO ────────────────────────────
//
// Seule la LÉGALITÉ fait veto (arbitrage MiKL du 27/08). Le score est mesuré et
// affiché, il ne refuse rien — Filou juge sur des critères humains que le score
// n'exprime pas, donc un score qui baisse ne prouve pas que c'est pire. Le
// raisonnement complet est dans `engine/relecture/arbitrer.ts`.
//
// Accès : admin uniquement. Période en BROUILLON uniquement — on ne retouche
// pas un planning que l'équipe a déjà sous les yeux.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resoudreContexte } from '@/data/resoudreContexte'
import { monterValidationPeriode } from '@/data/monterValidationPeriode'
import { monterDossierRelecture } from '@/data/monterDossierRelecture'
import { relirePlanningIA, modeleRelecture } from '@/lib/ia/relecturePlanning'
import { assistantIaDisponible } from '@/lib/ia/proposerRegle'
import { arbitrerChangements, type ChangementArbitre } from '@/engine/relecture/arbitrer'
import { remplacantsPossibles } from '@/engine/relecture/remplacants'
import { mouvementsPossibles, prioriserMouvements } from '@/engine/relecture/mouvements'
import { effetsDesMouvements } from '@/engine/relecture/effet'
import { personnesAuxExtremes } from '@/engine/relecture/cibles'
import { preferencesEnfreintes } from '@/engine/relecture/preferences'
import { tracerRelecture } from '@/data/tracerRelecture'
import { persisterPropositionsEnAttente } from '@/data/propositionsRelecture'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
// B-112 — LA clé d'identité d'une place, celle du moteur. Jamais une seconde
// fabrication locale : deux clés qu'il faudrait garder d'accord divergent, et
// ce garde-fou se tairait au lieu de refuser.
import { clePlaceFigee } from '@/engine/figees'
// B-122 lot 1 — « Antoine 27 -> 25 » : ce que les compteurs diront SI on
// applique. Le chiffre remplace les paragraphes d'explication de Filou.
import { projeterCompteurs, type AffectationProjetee } from '@/lib/planning/compteursProjetes'
import { queryCompteurs } from '@/hooks/useCompteurs'
import type { CodeCreneau, RoleGarde } from '@/engine/types'
import { persisterResultat } from '@/data/persisterResultat'
import { ecrirePlanningV1 } from '@/data/ecrirePlanningV1'
import { signalerIncidentTechnique } from '@/lib/notifications-inapp'
import { critereParCle } from '@/lib/planning/criteres-humains'
import { enFrancais } from '@/lib/planning/traductionRelecture'

// Un appel au modèle sur une période entière, puis l'arbitrage et la réécriture.
//
// ⚠️ 120 s ÉTAIT TROP COURT, et ce n'est pas une prévision : le banc du 31/08 a
// mesuré 152,1 s pour la configuration alors en production (Opus 4.8 sans
// réglage d'application) et 128,3 s à `medium`, sur 48 places — les deux
// au-dessus du plafond. La relecture ne tenait déjà plus dans son propre budget
// de temps, et l'échec se serait présenté comme un « Filou n'a pas pu relire »
// sans jamais dire que c'était une question de secondes.
//
// 300 s : la même valeur que la page du banc, qui a laissé passer un appel de
// 173,5 s sans être coupée — la plateforme accepte donc au moins cela. Ce n'est
// pas une estimation, c'est ce qui a tourné.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  // ── Authentification ────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Non authentifié. Veuillez vous connecter.' },
      { status: 401 },
    )
  }

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()

  if (vet?.role_app !== 'admin') {
    return NextResponse.json(
      { error: 'Accès réservé aux administrateurs.' },
      { status: 403 },
    )
  }

  // Règle C1 : le cabinet vient d'app_metadata, jamais d'user_metadata —
  // ce dernier est modifiable par l'utilisateur (escalade triviale).
  const cabinetId = user.app_metadata?.cabinet_id as string | undefined
  if (!cabinetId) {
    return NextResponse.json(
      { error: 'Cabinet non configuré pour cet utilisateur.' },
      { status: 403 },
    )
  }

  // ── Corps ───────────────────────────────────────────────
  let periodeId: string
  try {
    const body = await req.json()
    periodeId = body?.periodeId
    if (!periodeId || typeof periodeId !== 'string') {
      return NextResponse.json(
        { error: 'Corps invalide. Attendu : { periodeId: string }' },
        { status: 400 },
      )
    }
  } catch {
    return NextResponse.json(
      { error: 'Corps de requête non parsable (JSON attendu).' },
      { status: 400 },
    )
  }

  // ── La relecture ne touche QU'UN BROUILLON ──────────────
  //
  // Un planning publié est sous les yeux de l'équipe : le modifier sans
  // republier ferait diverger ce que chacun a noté de ce que l'application
  // affiche. Un planning verrouillé est de l'histoire. Dans les deux cas,
  // Filou peut relire — mais pas appliquer. Pour le lot 1, on refuse
  // franchement plutôt que de proposer une relecture en lecture seule qui
  // n'aurait pas de bouton pour agir.
  const { data: periode } = await supabase
    .from('periodes')
    .select('statut')
    .eq('id', periodeId)
    .single()

  if (!periode) {
    return NextResponse.json({ error: 'Période introuvable.' }, { status: 404 })
  }
  if ((periode as { statut: string }).statut !== 'brouillon') {
    return NextResponse.json(
      {
        error:
          'La relecture ne s’applique qu’à un planning en brouillon. Celui-ci est déjà publié ou verrouillé.',
      },
      { status: 409 },
    )
  }

  if (!assistantIaDisponible()) {
    return NextResponse.json(
      { error: 'Filou n’est pas configuré sur cette installation (clé API manquante).' },
      { status: 503 },
    )
  }

  // ── LE FLUX : la relecture raconte ce qu'elle fait ──────
  // Même principe que la génération : le SERVEUR dit où il en est, l'écran
  // relaie. Un décompte joué côté client, sans lien avec le travail réel,
  // serait du théâtre — et c'est exactement ce qu'on a passé le 26/08 à
  // corriger ailleurs.
  const FIN_DE_LIGNE = String.fromCharCode(10)
  const encodeur = new TextEncoder()
  const flux = new ReadableStream({
    async start(controleur) {
      const ecrire = (objet: unknown) => {
        controleur.enqueue(encodeur.encode(JSON.stringify(objet) + FIN_DE_LIGNE))
      }
      const emettre = (message: string) => ecrire({ type: 'progres', message })

      try {
        const { status, corps } = await executerRelecture(
          supabase, periodeId, cabinetId, emettre,
        )
        ecrire({ type: 'resultat', status, corps })
      } catch (err) {
        console.error('[relecture] exception :', err)
        ecrire({
          type: 'resultat',
          status: 500,
          corps: { error: err instanceof Error ? err.message : String(err) },
        })
      } finally {
        controleur.close()
      }
    },
  })

  return new Response(flux, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
    },
  })
}

// ── Le travail ───────────────────────────────────────────

function reponse(corps: unknown, init?: { status?: number }) {
  return { status: init?.status ?? 200, corps }
}

/** Ce qu'un arbitrage devient une fois mis en forme pour l'écran. */
interface LigneRapport {
  id: string
  /** Le POURQUOI de Filou, en français. */
  motif: string
  /** Le titre du critère humain visé. */
  critere: string
  /** Ce que le changement fait, en français : « Fanny prend la place d'Antoine ». */
  geste: string[]
  /** Ce que dit le moteur quand il refuse. Vide sinon. */
  objections: string[]
  effetScore?: 'ameliore' | 'egal' | 'degrade'
  /**
   * B-122 lot 1 — ce que le tableau des compteurs affichera SI on applique.
   *
   * Seules les personnes dont le total bouge y figurent : lister toute
   * l'équipe avec « 22 → 22 » noierait les deux lignes qui comptent.
   *
   * Absent si les compteurs n'ont pas pu être lus — un chiffre manquant se
   * remarque, un chiffre faux se croit.
   */
  compteursProjetes?: { prenom: string; avant: number; apres: number }[]
}

async function executerRelecture(
  supabase: Awaited<ReturnType<typeof createClient>>,
  periodeId: string,
  cabinetId: string,
  emettre: (message: string) => void,
) {
  emettre('Je relis le planning et les compteurs de chacun…')

  // ── Le contexte, vu comme le moteur le voit ──
  //
  // ⚠️ SANS `pourGeneration` : cette option retire les « dernier recours » de
  // l'effectif, et le validateur ne reconnaîtrait alors pas une personne déjà
  // posée sur une garde — il crierait des violations fantômes. La doctrine
  // « on ne les programme pas spontanément » est portée autrement : le dossier
  // le DIT à Filou, personne par personne.
  let contexte
  try {
    contexte = await resoudreContexte(periodeId, cabinetId)
  } catch (err) {
    return reponse(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    )
  }

  const montage = await monterValidationPeriode(supabase, periodeId, cabinetId)
  if (!montage) {
    return reponse(
      { error: 'Aucun planning à relire pour cette période.' },
      { status: 404 },
    )
  }

  const planningActuel = montage.construirePlanning(montage.gardes)

  // B-075 — le moteur calcule qui pourrait tenir chaque place, AVANT d'appeler
  // Filou. Sans cette liste il voyait les problèmes sans savoir si un échange
  // était légal, devait deviner, et s'abstenait : 6 constats sur 7 ressortaient
  // « pas de correction automatique ». C'est ce qui rendait la relecture
  // inutile aux yeux de MiKL — à raison.
  emettre('Je calcule qui pourrait aller où…')
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

  // B-093 — les MOUVEMENTS, sans lesquels la liste ci-dessus est presque
  // toujours vide. Mesuré le 2026-09-01 sur Hiver P2 : 53 places sur 118 sans
  // aucun remplaçant simple. Filou lisait ces vides comme « rien n'est
  // possible » et se taisait.
  //
  // CIBLAGE : sans filtre, la combinatoire noierait le signal et le budget de
  // jetons. On ne garde que les mouvements touchant les personnes aux EXTRÊMES
  // — voir `personnesAuxExtremes`, dont le critère a changé en B-096.
  emettre('Je cherche quels mouvements le moteur accepterait…')
  const vetsCibles = personnesAuxExtremes(planningActuel, {
    vets: contexte.vets,
    roleAvantageFinancier: contexte.roleAvantageFinancier,
    calendrier: contexte.calendrier,
  })

  const mouvementsBruts = mouvementsPossibles(planningActuel, {
    vets: contexte.vets,
    dateDebut: contexte.dateDebut,
    dateFin: contexte.dateFin,
    saison: contexte.saison,
    calendrier: contexte.calendrier,
    nbVetosSemaineSoir: contexte.nbVetosSemaineSoir,
    structureConfig: contexte.structureConfig,
    creneaux: contexte.creneaux,
    contexteAnterieur: contexte.contexteAnterieur,
    vetsCibles,
  })

  // B-096 lot 4 — CE QUE CHAQUE MOUVEMENT FAIT AU PLANNING.
  //
  // Sans cette mesure, la liste disait « le moteur accepte » sans jamais dire
  // « ça vaut le coup » : légal et souhaitable confondus. Filou devait choisir
  // son levier sans balance — et le 02/09 il a répondu, à raison, qu'il ne
  // pouvait rien corriger. Le scoreur est celui du moteur, pas une estimation.
  //
  // ⚠️ ON BORNE AVANT DE SCORER, et on le dit. Mesure du 02/09 sur une période
  // d'hiver complète : **3012 mouvements**, dont 2736 échanges simples — ceux-là
  // existaient déjà depuis B-093. Le dossier de la relecture du matin même en
  // portait donc des milliers : Filou ne choisissait pas dans une aide, il
  // choisissait dans un mur. Scorer les 3012 coûterait en plus le temps que
  // l'admin passe devant l'écran d'attente.
  // B-112 — ON RETIRE D'ABORD LES MOUVEMENTS QUI TOUCHENT UN CADENAS.
  //
  // C'est la moitié AMONT du garde-fou, et elle ne remplace pas celle d'aval
  // (`arbitrerChangements`, qui refuse) : le modèle reste libre de proposer un
  // mouvement absent de sa liste. La leçon du 26/08 est explicite — « une
  // exclusion posée en amont ne protège que les chemins existant ce jour-là ».
  //
  // Ce qu'elle apporte, c'est le RÉSULTAT PRATIQUE : sans elle, Filou passerait
  // son temps à proposer des mouvements systématiquement bloqués, et l'admin
  // lirait « proposition écartée » à chaque relecture sans jamais rien obtenir.
  // Elle épargne aussi le scoring de mouvements qui seraient refusés ensuite.
  const figeesIndex = new Set(
    (contexte.placesFigees ?? []).map((p) => clePlaceFigee(p.date, p.type, p.role)),
  )
  const mouvementsHorsCadenas = figeesIndex.size === 0
    ? mouvementsBruts
    : mouvementsBruts.filter((m) =>
        !m.affectations.some((a) =>
          figeesIndex.has(clePlaceFigee(a.date, a.type as CodeCreneau, a.role as RoleGarde)),
        ),
      )

  const { retenus: mouvementsLegaux, ecartes: mouvementsEcartes } =
    prioriserMouvements(mouvementsHorsCadenas)

  emettre('Je mesure ce que chaque mouvement changerait…')
  const effets = effetsDesMouvements(planningActuel, mouvementsLegaux, {
    vets: normaliserContraintesVets(contexte.vets),
    saison: contexte.saison,
    weights: contexte.equityWeights,
    structureConfig: contexte.structureConfig,
    roleAvantageFinancier: contexte.roleAvantageFinancier,
    calendrier: contexte.calendrier,
    contexteAnterieur: contexte.contexteAnterieur,
  })
  const mouvements = mouvementsLegaux.map((mouvement, i) => ({ mouvement, effet: effets[i] }))

  // B-096 lot 2 — LES PRÉFÉRENCES QUE LE PLANNING ENFREINT.
  //
  // Le moteur les connaît : il les a payées en pénalité en construisant. Rien
  // ne les transmettait à Filou, qui aurait dû soustraire des dates de tête sur
  // 118 lignes pour les retrouver — et n'a donc rien dit du rythme d'Antoine,
  // un week-end sur deux quatre fois de suite.
  const preferences = preferencesEnfreintes(planningActuel, {
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
    supabase, planningActuel, contexte, periodeId, cabinetId, remplacants, mouvements, preferences,
    mouvementsEcartes,
  )

  // ── Filou lit ──
  emettre('Filou prend du recul sur l’ensemble de la période…')
  let relecture
  try {
    relecture = await relirePlanningIA(dossier)
  } catch (err) {
    // Zone d'ombre 5, tranchée par MiKL le 27/08 : jamais un silence qui se
    // lirait « tout va bien ». Le planning du moteur reste en base, intact.
    console.error('[relecture] Filou n’a pas répondu :', err)
    // B-096 lot 1 — l'ÉCHEC se garde aussi. Un historique où tout s'est
    // toujours bien passé ne sert à rien, et c'est justement quand Filou ne
    // répond pas qu'on veut pouvoir le montrer.
    await tracerRelecture(supabase, periodeId, cabinetId, {
      issue: 'indisponible',
      modele: modeleRelecture(),
      erreur: err instanceof Error ? err.message : String(err),
    })
    return reponse({
      issue: 'indisponible',
      error:
        'Filou n’a pas pu relire ce planning. Le planning généré est bien enregistré et reste utilisable tel quel.',
      detail: err instanceof Error ? err.message : String(err),
      modele: modeleRelecture(),
    })
  }

  // ── Le moteur contrôle ──
  emettre(
    relecture.changements.length > 0
      ? `Je vérifie ${relecture.changements.length} proposition${relecture.changements.length > 1 ? 's' : ''} contre les règles du cabinet…`
      : 'Je note ce que Filou a relevé…',
  )

  const arbitrage = arbitrerChangements(planningActuel, relecture.changements, {
    vets: contexte.vets,
    dateDebut: contexte.dateDebut,
    dateFin: contexte.dateFin,
    saison: contexte.saison,
    calendrier: contexte.calendrier,
    nbVetosSemaineSoir: contexte.nbVetosSemaineSoir,
    structureConfig: contexte.structureConfig,
    creneaux: contexte.creneaux,
    contexteAnterieur: contexte.contexteAnterieur,
    roleAvantageFinancier: contexte.roleAvantageFinancier ?? null,
    // B-112 — les places que l'admin a cadenassées. La relecture est un CHEMIN
    // DE PLUS qui choisit des personnes : sans cette ligne, Filou pouvait
    // proposer de retirer quelqu'un que l'admin venait de figer, et le moteur
    // validait — le mouvement étant parfaitement légal.
    //
    // ⚠️ Même source que la génération (`contexte.placesFigees`, rempli par le
    // loader), jamais une seconde lecture en base : deux chargements qu'il
    // faudrait penser à garder d'accord finissent toujours par diverger.
    placesFigees: contexte.placesFigees,
  })

  // ── Ce qui est légal est écrit ──
  let ecrit = false
  if (arbitrage.modifie) {
    emettre('J’applique ce que le moteur a validé…')
    try {
      await persisterResultat(arbitrage.planning, periodeId, cabinetId)
    } catch (err) {
      return reponse(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      )
    }

    const ecriture = await ecrirePlanningV1(
      supabase, arbitrage.planning, periodeId, cabinetId, contexte.calendrier,
    )
    if (!ecriture.ok) {
      return reponse({ error: ecriture.erreur }, { status: 500 })
    }
    ecrit = true

    if (ecriture.placementsEchoues) {
      await signalerIncidentTechnique(
        supabase, cabinetId,
        'Écriture des placements incomplète',
        'La copie technique des attributions (garde_placements) a échoué pendant la relecture. Le planning affiché est correct ; signale-le si ça se répète.',
      )
    }
    if (ecriture.realignementEchoue) {
      await signalerIncidentTechnique(
        supabase, cabinetId,
        'Copie technique du planning (V2) désynchronisée',
        'La relecture a bien été appliquée, mais sa copie technique (attributions) n\'a pas pu être réalignée sur les gardes verrouillées.',
      )
    }
  }

  // ── Le rapport ──
  const prenomParId = new Map(contexte.vets.map((v) => [v.id, v.prenom]))

  /**
   * Remplace tout identifiant technique par le prénom qu'il désigne.
   *
   * ⚠️ Les messages du validateur sont écrits pour un développeur : ils citent
   * les vétérinaires par leur identifiant. Affichés tels quels, ils donnaient
   * « le duo WE [00000000-0000-0000-0000-000000000006] diffère du duo vendredi
   * soir » — vu par MiKL le 27/08.
   *
   * C'est le défaut B-023, déjà payé le 26/08 sur l'écran des règles. La
   * traduction se fait ICI, à la frontière entre le moteur et l'écran, plutôt
   * que dans le validateur : celui-ci doit rester lisible par un développeur
   * qui débogue, et c'est l'affichage qui doit parler français.
   */
  const jourParDate = new Map(dossier.places.map((p) => [p.date, p.jour]))
  const creneauParType = new Map(dossier.places.map((p) => [p.type, p.creneau]))

  // B-122 lot 1 — LES COMPTEURS TELS QU'ILS SONT AUJOURD'HUI.
  //
  // Lus une seule fois pour toutes les propositions. La projection part de ces
  // valeurs REELLES (la vue `compteurs_gardes`) et n'y applique que l'effet du
  // mouvement : jamais un recomptage maison, qui finirait par diverger de la
  // vue sans que rien ne le dise.
  //
  // Une lecture en echec ne fait pas echouer la relecture : on rend alors le
  // rapport SANS compteurs projetes. Un chiffre absent se remarque ; un chiffre
  // faux se croit.
  const { compteurs: compteursActuels } = await queryCompteurs(supabase, periodeId)

  /** « Antoine 27 -> 25 », pour un changement donne. */
  const projectionDe = (a: ChangementArbitre) => {
    if (compteursActuels.length === 0) return undefined

    const affectations: AffectationProjetee[] = a.changement.affectations.map((voulue, i) => ({
      date: voulue.date,
      type: voulue.type,
      role: voulue.role,
      vetId: voulue.vetId,
      // `avant` est rempli par l'arbitrage ; absent sur les verdicts ou rien
      // n'a pu etre simule, et on ne devine alors personne.
      avantVetId: a.avant[i]?.vetId ?? null,
    }))

    const apres = projeterCompteurs(compteursActuels, affectations, contexte.calendrier)
    const avantPar = new Map(compteursActuels.map((r) => [r.veterinaire_id, r]))

    // Seules les personnes dont le total BOUGE sont citees : lister toute
    // l'equipe avec « 22 -> 22 » noierait les deux lignes qui comptent.
    return apres
      .map((r) => ({
        prenom: r.prenom,
        avant: avantPar.get(r.veterinaire_id)?.total_gardes ?? r.total_gardes,
        apres: r.total_gardes,
      }))
      .filter((c) => c.avant !== c.apres)
      .sort((x, y) => (x.apres - x.avant) - (y.apres - y.avant))
  }

  const enLigne = (a: ChangementArbitre): LigneRapport => ({
    id: a.changement.id,
    motif: a.changement.motif,
    critere: critereParCle(a.changement.critere)?.titre ?? a.changement.critere,
    geste: a.changement.affectations.map((voulue, i) => {
      const avant = a.avant[i]
      const jour = jourParDate.get(voulue.date) ?? voulue.date
      const creneau = creneauParType.get(voulue.type) ?? voulue.type
      const nouveau = voulue.vetId ? (prenomParId.get(voulue.vetId) ?? '?') : 'personne'
      const ancien = avant?.vetId ? (prenomParId.get(avant.vetId) ?? '?') : null
      return ancien
        ? `${jour} · ${creneau} · ${voulue.role} : ${nouveau} à la place de ${ancien}`
        : `${jour} · ${creneau} · ${voulue.role} : ${nouveau} sur une place vide`
    }),
    objections: a.violations.map((v) => enFrancais(v.detail, prenomParId)),
    effetScore: a.effetScore,
    // B-122 lot 1 — ce que le tableau des compteurs affichera si on applique.
    // ⚠️ Calcule sur les AFFECTATIONS reelles, pas en relisant les phrases du
    // geste : `effetSurLesPersonnes` compte des GESTES, la vue compte des
    // GARDES, et le vendredi soir n'est pas une garde en base. Les deux ne
    // peuvent donc pas coincider des qu'un vendredi est implique.
    compteursProjetes: projectionDe(a),
  })

  const appliques = arbitrage.arbitrages.filter((a) => a.verdict === 'applique').map(enLigne)
  const aTrancher = arbitrage.arbitrages.filter((a) => a.verdict === 'refuse').map(enLigne)
  const ecartes = arbitrage.arbitrages.filter((a) => a.verdict === 'sans_objet').length

  // B-112 — les propositions écartées parce qu'elles touchaient un cadenas.
  //
  // ⚠️ SANS CE TRI, ELLES DISPARAISSAIENT PUREMENT ET SIMPLEMENT : ni appliquées,
  //    ni à trancher, ni même comptées dans `ecartes`. L'admin n'aurait eu aucun
  //    moyen de savoir que Filou avait vu quelque chose — et un cadenas qui fait
  //    taire une proposition sans le dire est un silence, pas une protection.
  //    C'est la règle maison : le système INFORME, il n'interdit pas en cachette.
  //
  // On dit aussi QUELS jours sont concernés : « tu as fixé le 1er de garde du
  // lundi 3 novembre » se décide, « un cadenas bloque » ne se décide pas.
  const bloquesParCadenas = arbitrage.arbitrages
    .filter((a) => a.verdict === 'refuse_cadenas')
    .map((a) => ({
      ...enLigne(a),
      placesFigees: (a.placesFigeesTouchees ?? []).map((p) => {
        const jour = jourParDate.get(p.date) ?? p.date
        const creneau = creneauParType.get(p.type) ?? p.type
        return `${jour} · ${creneau} · ${p.role}`
      }),
    }))

  const revuePourEcran = relecture.revue.map((r) => ({
    critere: critereParCle(r.critere)?.titre ?? r.critere,
    verdict: r.verdict,
    constat: r.constat,
    detail: r.detail,
    corrigeable: r.corrigeable,
    // B-109 (03/09) — Filou a dit « je propose un changement » et n'en a
    // proposé aucun. Doit rester visible : c'est pire qu'un « pas de
    // correction automatique » honnête, puisque ça se lit comme une action en
    // cours alors qu'il ne s'est rien passé.
    promesseNonTenue: r.promesseNonTenue,
  }))

  // B-096 lot 1 — la trace, avant de rendre la main. On garde EXACTEMENT ce que
  // l'écran affiche : sans quoi l'historique raconterait une autre relecture
  // que celle qu'on a lue. Cette écriture ne peut pas faire échouer la réponse.
  const relectureId = await tracerRelecture(supabase, periodeId, cabinetId, {
    issue: 'relu',
    modele: modeleRelecture(),
    synthese: relecture.synthese,
    revue: revuePourEcran,
    criteresNonTraites: relecture.criteresNonTraites,
    appliques,
    aTrancher,
    ecartes,
    // B-112 — gardes dans l'historique aussi : savoir qu'un cadenas a ecarte
    // une proposition explique, six mois plus tard, pourquoi ce planning-la
    // n'a pas bouge.
    bloquesParCadenas,
    planningModifie: ecrit,
    // B-096 — ce que Filou AVAIT, pas seulement ce qu'il a répondu. Sans ces
    // compteurs, cinq recettes de suite ont buté sur la même question sans
    // réponse : le levier était-il dans sa liste, ou ne l'a-t-il pas pris ?
    // Deux causes opposées, deux chantiers opposés, et rien pour trancher.
    dossier: {
      mouvementsParGenre: mouvements.reduce<Record<string, number>>((acc, { mouvement }) => {
        acc[mouvement.genre] = (acc[mouvement.genre] ?? 0) + 1
        return acc
      }, {}),
      effets: effets.reduce<Record<string, number>>((acc, e) => {
        acc[e.sens] = (acc[e.sens] ?? 0) + 1
        return acc
      }, {}),
      personnesAllegeables: [...new Set(dossier.mouvements.flatMap((m) => m.allege ?? []))],
      ecartes: mouvementsEcartes,
      preferencesEnfreintes: preferences.length,
    },
  })

  // B-122 lot 2 — LES PROPOSITIONS REFUSÉES SURVIVENT À L'ONGLET.
  //
  // « à trancher » n'est plus qu'un tableau de la réponse HTTP : c'est un état
  // du planning, affiché en mode aperçu, jusqu'à ce que l'admin l'accepte ou
  // le rejette. On remplace donc le lot `en_attente` précédent de cette
  // période par celui-ci — la relecture qui vient de tourner en est la
  // version la plus à jour. Best-effort, comme la trace elle-même : un échec
  // d'écriture ici ne doit pas faire perdre le rapport déjà produit.
  const propositionsRefusees = arbitrage.arbitrages.filter((a) => a.verdict === 'refuse')
  await persisterPropositionsEnAttente(
    supabase, cabinetId, periodeId, relectureId,
    propositionsRefusees.map((a) => ({
      changement: a.changement,
      violations: a.violations,
      compteursProjetes: projectionDe(a) ?? [],
    })),
  )

  return reponse({
    issue: 'relu',
    synthese: relecture.synthese,
    // La revue, critère par critère — y compris les critères où tout va bien.
    // C'est la pièce qui empêche « Filou n'a rien à redire » d'être la seule
    // chose que l'admin lit : elle montre ce qui a été REGARDÉ, pas seulement
    // ce qui a été trouvé.
    revue: revuePourEcran,
    // Une revue incomplète ne doit PAS ressembler à une revue clean.
    criteresNonTraites: relecture.criteresNonTraites,
    appliques,
    aTrancher,
    // Compté et dit : une proposition écartée en silence laisserait croire que
    // Filou n'avait rien vu.
    ecartes,
    // B-112 — ce que Filou proposait et qu'un cadenas de l'admin a ecarte.
    // Elle reste libre de retirer le cadenas si la proposition l'interesse :
    // on l'informe, on ne decide pas a sa place.
    bloquesParCadenas,
    planningModifie: ecrit,
    historiqueIndisponible,
    modele: modeleRelecture(),
  })
}
