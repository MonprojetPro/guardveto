// ============================================================
// GUARDVETO V2 — Historique & compteurs
// ============================================================
// Cinquième écran de la bascule (maquette M4, section 3). Il REGROUPE ce qui
// était éclaté sur deux entrées de menu — `/compteurs` et `/admin/periodes` —
// parce que c'est une seule question : qui a fait quoi, et sur quelle période.
//
// `/admin/periodes` a depuis été SUPPRIMÉE — c'était un doublon complet de la
// section « périodes » ci-dessous, et le planning V2 renvoyait vers elle plutôt
// que vers ici. Cet écran est désormais le seul endroit où l'on gère les
// périodes ; son fichier d'actions, lui, survit et sert aussi les outils de
// Filou.
//
// Tous les chiffres viennent du moteur : la vue `compteurs_gardes`, la table
// `compensations`, et `calculerBilans` pour les écarts — le MÊME calcul que le
// bilan officiel de fin de période. Rien n'est ré-additionné ici.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import '@/styles/v2-historique.css'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { EnteteHistoriqueVide } from '@/components/v2/ImportPlanningLanceur'
import { HistoriqueV2, type CumulLigne } from '@/components/v2/HistoriqueV2'
import { BonusMalusCard } from '@/components/compteurs/BonusMalusCard'
import { HistoriqueFetesCard } from '@/components/compteurs/HistoriqueFetesCard'
import { chargerDock } from '@/data/v2/dock'
import { calculerBilans } from '@/engine/bilan'
import {
  queryCompteurs,
  queryCompteursPlage,
  completerCompteursPourAffichage,
  queryTotalWE,
  queryDepannages,
  queryBonusMalusHeritage,
  queryBonusMalusCourant,
  queryVetsInfo,
  queryHistoriqueFetes,
  type CompteursRow,
} from '@/hooks/useCompteurs'
import type { Periode, Veterinaire } from '@/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'GuardVeto — Historique & compteurs' }

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/

function libellePeriode(p: Periode): string {
  if (p.libelle) return p.libelle
  const saison = p.saison === 'ete' ? 'Été' : 'Hiver'
  return `${saison} ${p.date_debut.slice(0, 4)}${p.numero ? ` — P${p.numero}` : ''}`
}

function nbSemaines(p: Periode): number {
  const jours =
    (new Date(p.date_fin).getTime() - new Date(p.date_debut).getTime()) / 86_400_000 + 1
  return Math.max(1, Math.round(jours / 7))
}

// La cascade « effectif de nuit réellement appliqué » (période > profil >
// saison) vivait ici pour l'encart des périodes, retiré le 2026-08-19. Elle
// reste réimplémentée ailleurs dans le projet — un endroit de moins où la
// « cécité params » peut mordre.

export default async function HistoriquePage({
  searchParams,
}: {
  searchParams: Promise<{
    periodeId?: string
    mode?: string
    debut?: string
    fin?: string
    perimetre?: string
  }>
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: moi } = await supabase
    .from('veterinaires')
    .select('*')
    .eq('user_id', user.id)
    .eq('actif', true)
    .single()

  if (!moi) {
    await supabase.auth.signOut()
    redirect('/login')
  }

  const vet = moi as Veterinaire
  const estAdmin = vet.role_app === 'admin'

  // ── Périodes ───────────────────────────────────────────────────────────
  const { data: periodesDb } = await supabase
    .from('periodes')
    .select('*')
    .order('date_debut', { ascending: false })
    .limit(20)

  const periodes = (periodesDb as Periode[] | null) ?? []
  const dock = await chargerDock(supabase, vet, periodes)

  // Quels plannings ont réellement des gardes : la corbeille doit prévenir
  // qu'elle en efface (le serveur accepte de supprimer un brouillon rempli
  // depuis le 2026-08-03 — il n'a jamais été vu par l'équipe). Seuls les
  // BROUILLONS portent un bouton de suppression : inutile d'interroger les
  // autres.

  if (periodes.length === 0) {
    // Écran d'un cabinet neuf — c'est le PREMIER que voit un nouvel abonné.
    // Il n'avait aucune sortie : un titre, un paragraphe, et rien à faire.
    // Une page qui explique ce qui manque doit dire où on va le chercher.
    return (
      <>
        <Satin />
        <div className="shell">
          <BarreV2 prenom={vet.prenom} estAdmin={estAdmin} dock={dock} />
          {/* En-tête + import : un composant client, parce que les deux
              actions vivent dans la rangée du haut tandis que le panneau de
              relecture s'ouvre dessous — deux endroits, un seul état. */}
          <EnteteHistoriqueVide estAdmin={estAdmin} />
          <section className="card rise rise-2">
            <div className="card-head">
              <h2>Ce qui apparaîtra ici</h2>
            </div>
            <p className="count-vide">
              {estAdmin
                ? "Les week-ends, nuits et fériés tenus par chacun, l'écart de chaque vétérinaire à sa juste part, les dépannages, et le cumul de toutes les périodes validées. Tout se remplit tout seul à la première génération : commence par créer un planning."
                : "Les week-ends, nuits et fériés que tu auras tenus, et ton écart à la juste part. Ta ligne apparaîtra dès que l'administrateur aura généré le premier planning."}
            </p>
          </section>
        </div>
      </>
    )
  }

  // ── Résolution des filtres ─────────────────────────────────────────────
  // La PLAGE LIBRE est réservée à l'administrateur : elle traverse les
  // périodes et donne une vue de gestion du cabinet (« qui a fait quoi entre
  // ces deux dates »), là où un vétérinaire consulte une période. Le filtre
  // vit dans l'URL : le refuser ici, côté serveur, est le seul contrôle qui
  // vaille — cacher le bouton ne ferme pas la porte, il la rend juste
  // discrète.
  const params = await searchParams
  const mode = params.mode === 'plage' && estAdmin ? 'plage' : 'periode'
  const perimetre = params.perimetre === 'valide' ? 'valide' : 'tout'

  const today = new Date().toISOString().slice(0, 10)
  const periodesAsc = [...periodes].reverse()
  const periodeCourante =
    periodes.find((p) => p.date_debut <= today && p.date_fin >= today) ??
    periodesAsc.find((p) => p.date_debut >= today) ??
    periodes[0]
  const periodeSelectionnee = periodes.find((p) => p.id === params.periodeId) ?? periodeCourante

  const plageValide =
    mode === 'plage' &&
    !!params.debut &&
    RE_DATE.test(params.debut) &&
    !!params.fin &&
    RE_DATE.test(params.fin) &&
    params.debut <= params.fin

  const debut = plageValide
    ? params.debut!
    : params.debut && RE_DATE.test(params.debut)
      ? params.debut
      : periodeSelectionnee.date_debut
  const fin = plageValide
    ? params.fin!
    : params.fin && RE_DATE.test(params.fin)
      ? params.fin
      : periodeSelectionnee.date_fin

  // ── Compteurs du filtre courant ────────────────────────────────────────
  // `erreurLecture` n'est PAS la même chose qu'une liste vide : vide veut dire
  // « personne n'a de garde ici », l'erreur veut dire « je n'ai pas pu
  // compter ». Les confondre afficherait un tableau serein et faux.
  let compteurs: CompteursRow[]
  let totalWE: number
  let erreurLecture: string | null = null
  if (plageValide) {
    const res = await queryCompteursPlage(supabase, debut, fin, perimetre === 'valide')
    compteurs = res.compteurs
    totalWE = res.totalWE
    erreurLecture = res.erreur
  } else if (perimetre === 'valide' && periodeSelectionnee.statut === 'brouillon') {
    // Périmètre « validées seulement » sur une période encore en brouillon :
    // il n'y a rien à compter. On le dit plutôt que d'afficher les gardes du
    // brouillon sous une étiquette « validées ».
    compteurs = []
    totalWE = 0
  } else {
    const [resC, resWE] = await Promise.all([
      queryCompteurs(supabase, periodeSelectionnee.id),
      queryTotalWE(supabase, periodeSelectionnee.id),
    ])
    compteurs = resC.compteurs
    totalWE = resWE.totalWE
    erreurLecture = resC.erreur ?? resWE.erreur
  }

  const bilans = calculerBilans(compteurs, totalWE)
  const depannages = [...(await queryDepannages(supabase, debut, fin)).values()]

  // ── Qui est hors répartition ───────────────────────────────────────────
  const { data: vetsDb } = await supabase
    .from('veterinaires')
    .select('id, dernier_recours')
    .eq('dernier_recours', true)
  const derniersRecours = ((vetsDb as { id: string }[] | null) ?? []).map((v) => v.id)

  // L'équipe active — les gestes de correction de Filou en ont besoin quand un
  // réglage d'effectif se corrige en posant une étiquette, et le tableau des
  // compteurs en a besoin pour ne laisser personne de côté (juste en dessous).
  const { data: actifsDb } = await supabase
    .from('veterinaires')
    .select('id, prenom, nom, statut, couleur')
    .eq('actif', true)
    .order('nom')
  const vetsActifs = (actifsDb ?? []) as Array<{
    id: string
    prenom: string
    nom: string
    statut: 'associe' | 'salarie'
    couleur: string
  }>

  // ── Personne ne disparaît du tableau ───────────────────────────────────
  // Un vétérinaire sans aucune garde sur le filtre courant n'a PAS de ligne
  // dans la vue : il ne s'affiche pas à zéro, il disparaît. Sur un écran qui
  // prétend montrer la répartition de toute l'équipe, c'est un mensonge par
  // omission — et il frappe d'abord le vétérinaire de dernier recours, dont le
  // rôle EST de n'avoir aucune garde tant que tout va bien.
  //
  // Le complément se fait APRÈS `calculerBilans` (ci-dessus) et volontairement :
  // la quote-part reste calculée sur les seuls vétérinaires qui participent à
  // la rotation, donc aucun écart affiché ne bouge. Les lignes rajoutées n'ont
  // pas de bilan, ce que `CompteursPanel` rend déjà « hors répartition ».
  compteurs = completerCompteursPourAffichage(compteurs, vetsActifs)

  // ── Légende du filtre ──────────────────────────────────────────────────
  const legende: Array<{ texte: string; fort?: boolean }> = []
  if (plageValide) {
    legende.push({ texte: 'Plage libre', fort: true })
    legende.push({
      texte: `du ${new Date(`${debut}T12:00:00`).toLocaleDateString('fr-FR')} au ${new Date(
        `${fin}T12:00:00`,
      ).toLocaleDateString('fr-FR')}`,
    })
    const chevauchees = periodes
      .filter((p) => p.date_debut <= fin && p.date_fin >= debut)
      .map((p) => libellePeriode(p))
    legende.push({
      texte: chevauchees.length > 0 ? `chevauche : ${chevauchees.join(', ')}` : 'aucune période',
    })
  } else {
    legende.push({ texte: libellePeriode(periodeSelectionnee), fort: true })
    legende.push({
      texte: `${nbSemaines(periodeSelectionnee)} semaines · ${new Date(
        `${periodeSelectionnee.date_debut}T12:00:00`,
      ).toLocaleDateString('fr-FR')} → ${new Date(
        `${periodeSelectionnee.date_fin}T12:00:00`,
      ).toLocaleDateString('fr-FR')}`,
    })
  }
  legende.push({
    texte:
      perimetre === 'valide'
        ? 'gardes validées seulement (publiées ou verrouillées)'
        : 'tout compris, brouillons inclus',
  })

  // Les réglages d'une période (effectif de nuit, période type) et sa
  // suppression ne sont plus proposés ici : la période type et l'effectif
  // appartiennent à Organisation, la suppression vit dans l'écran Planning et
  // dans « Générer ». Cet écran CONSULTE — il ne lit donc plus ni les profils
  // de planning ni les périodes qui portent des gardes.
  // (2026-08-19, demande de MiKL.)

  // ── Cumul sur toutes les périodes validées ─────────────────────────────
  // Le cumul ne suit PAS le filtre : c'est justement la vue d'ensemble que le
  // moteur relit d'une période à l'autre. Il ne compte que le validé — un
  // brouillon peut encore changer.
  const periodesValidees = periodes.filter((p) => p.statut !== 'brouillon')
  let cumul: CumulLigne[] = []
  let cumulResume: string | null = null
  if (periodesValidees.length > 0) {
    const bornes = periodesValidees.reduce(
      (acc, p) => ({
        debut: p.date_debut < acc.debut ? p.date_debut : acc.debut,
        fin: p.date_fin > acc.fin ? p.date_fin : acc.fin,
      }),
      { debut: periodesValidees[0].date_debut, fin: periodesValidees[0].date_fin },
    )
    const res = await queryCompteursPlage(supabase, bornes.debut, bornes.fin, true)
    // Un cumul partiel serait pire que pas de cumul : il additionne plusieurs
    // périodes, personne ne peut vérifier le total de tête.
    if (res.erreur) erreurLecture = erreurLecture ?? res.erreur
    cumul = res.compteurs.map((r) => ({
      veterinaire_id: r.veterinaire_id,
      prenom: r.prenom,
      couleur: r.couleur,
      we: r.we_total,
      sem: r.sem_total,
      feries: r.feries_total,
    }))
    const semaines = periodesValidees.reduce((s, p) => s + nbSemaines(p), 0)
    const brouillons = periodes.length - periodesValidees.length
    cumulResume = `${periodesValidees.length} période${
      periodesValidees.length > 1 ? 's' : ''
    } validée${periodesValidees.length > 1 ? 's' : ''} · ${semaines} semaines${
      brouillons > 0
        ? ` · ${brouillons} brouillon${brouillons > 1 ? 's' : ''} non compté${brouillons > 1 ? 's' : ''}`
        : ''
    }`
  }

  // ── Greffes V1 : bilan de période et historique des fêtes ──────────────
  const afficherBilan =
    estAdmin && mode === 'periode' && periodeSelectionnee.statut !== 'brouillon'

  const [bonusMalusHeritage, bonusMalusCourant, vetsInfo, historiqueFetes] = await Promise.all([
    estAdmin && mode === 'periode'
      ? queryBonusMalusHeritage(supabase, periodeSelectionnee, periodes)
      : Promise.resolve([]),
    afficherBilan ? queryBonusMalusCourant(supabase, periodeSelectionnee.id) : Promise.resolve([]),
    afficherBilan ? queryVetsInfo(supabase) : Promise.resolve([]),
    estAdmin ? queryHistoriqueFetes(supabase) : Promise.resolve([]),
  ])

  return (
    <>
      <Satin />
      <div className="shell">
        <BarreV2 prenom={vet.prenom} estAdmin={estAdmin} dock={dock} />
        <HistoriqueV2
          periodes={periodes}
          mode={plageValide ? 'plage' : mode}
          periodeId={periodeSelectionnee.id}
          debut={debut}
          fin={fin}
          perimetre={perimetre}
          legende={legende}
          erreurLecture={erreurLecture}
          compteurs={compteurs}
          bilans={bilans}
          depannages={depannages}
          derniersRecours={derniersRecours}
          moiId={vet.id}
          estAdmin={estAdmin}
          cumul={cumul}
          cumulResume={cumulResume}
          slotBilan={
            afficherBilan ? (
              <BonusMalusCard
                periodeId={periodeSelectionnee.id}
                periodeStatut={periodeSelectionnee.statut}
                existingBilan={bonusMalusCourant}
                heritage={bonusMalusHeritage}
                vetsInfo={vetsInfo}
              />
            ) : undefined
          }
          slotFetes={
            estAdmin && historiqueFetes.length > 0 ? (
              <HistoriqueFetesCard rows={historiqueFetes} />
            ) : undefined
          }
        />
      </div>
    </>
  )
}
