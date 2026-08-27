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
import { persisterResultat } from '@/data/persisterResultat'
import { ecrirePlanningV1 } from '@/data/ecrirePlanningV1'
import { signalerIncidentTechnique } from '@/lib/notifications-inapp'
import { critereParCle } from '@/lib/planning/criteres-humains'

// Un appel Opus sur une période entière, puis l'arbitrage et la réécriture.
export const maxDuration = 120

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

  const { dossier, historiqueIndisponible } = await monterDossierRelecture(
    supabase, planningActuel, contexte, periodeId, cabinetId, remplacants,
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
  const enFrancais = (texte: string): string => {
    let sortie = texte
    for (const [id, prenom] of prenomParId) {
      // Avec et sans crochets : le validateur emploie les deux formes.
      sortie = sortie.split(`[${id}]`).join(prenom).split(id).join(prenom)
    }
    // Un identifiant qui n'appartient à personne de l'équipe (véto retiré,
    // donnée orpheline) ne doit pas rester à l'écran non plus.
    return sortie.replace(
      /\[?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]?/gi,
      'quelqu’un qui n’est plus dans l’équipe',
    )
  }
  const jourParDate = new Map(dossier.places.map((p) => [p.date, p.jour]))
  const creneauParType = new Map(dossier.places.map((p) => [p.type, p.creneau]))

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
    objections: a.violations.map((v) => enFrancais(v.detail)),
    effetScore: a.effetScore,
  })

  const appliques = arbitrage.arbitrages.filter((a) => a.verdict === 'applique').map(enLigne)
  const aTrancher = arbitrage.arbitrages.filter((a) => a.verdict === 'refuse').map(enLigne)
  const ecartes = arbitrage.arbitrages.filter((a) => a.verdict === 'sans_objet').length

  return reponse({
    issue: 'relu',
    synthese: relecture.synthese,
    // La revue, critère par critère — y compris les critères où tout va bien.
    // C'est la pièce qui empêche « Filou n'a rien à redire » d'être la seule
    // chose que l'admin lit : elle montre ce qui a été REGARDÉ, pas seulement
    // ce qui a été trouvé.
    revue: relecture.revue.map((r) => ({
      critere: critereParCle(r.critere)?.titre ?? r.critere,
      verdict: r.verdict,
      constat: r.constat,
      detail: r.detail,
      corrigeable: r.corrigeable,
    })),
    // Une revue incomplète ne doit PAS ressembler à une revue clean.
    criteresNonTraites: relecture.criteresNonTraites,
    appliques,
    aTrancher,
    // Compté et dit : une proposition écartée en silence laisserait croire que
    // Filou n'avait rien vu.
    ecartes,
    planningModifie: ecrit,
    historiqueIndisponible,
    modele: modeleRelecture(),
  })
}
