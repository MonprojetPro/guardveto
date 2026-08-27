'use client'

// ============================================================
// GUARDVETO V2 — Absences & échanges : une seule porte
// ============================================================
// Porté de `maquette/m3-absences-echanges.html`. L'idée de l'écran est une
// FUSION : les anciens écrans « Congés », « Demandes », « Échanges » et
// « Dépannages » devenaient quatre entrées de menu pour une même question —
// qui n'est pas là, et qu'est-ce qu'on fait. Ici, trois onglets, une porte.
//
// Chaque souhait en attente arrive avec son verdict de conflit DÉJÀ CALCULÉ
// contre le planning publié (`detecterConflitPlanningPublie`, côté serveur) :
// rien ne surprend au moment de valider.
//
// Les dialogues restent ceux du produit (validation, refus, création,
// conflit) : ils portent les règles métier et les effets de bord (notifs,
// re-synchro agenda). On ne redessine pas un dialogue au risque d'en perdre
// les garde-fous.
// ============================================================

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
// Modale de confirmation : on réutilise le Dialog du produit (celui des
// dialogues congés) plutôt qu'un habillage maison — il porte le focus trap,
// la fermeture au clavier et les jetons de couleur déjà arbitrés.
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
// Le `Select` MAISON — le `<select>` natif est interdit sur ce projet.
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { CongeForm } from '@/components/conges/CongeForm'
import { deleteConge } from '@/app/(protected)/conges/actions'
import { ValiderCongeDialog } from '@/components/conges/ValiderCongeDialog'
import { RefuserCongeDialog } from '@/components/conges/RefuserCongeDialog'
import { ConflitPlanningDialog } from '@/components/conges/ConflitPlanningDialog'
import type { ConflitPlanning } from '@/app/(protected)/conges/actions'
import { CriseModal, type VetCrise } from '@/components/planning/CriseModal'
import type { EchangeRow, GardeLite, VetLite } from '@/components/echanges/EchangesClient'
import type { CompensationLigne } from '@/components/admin/DepannagesClient'
import { EchangesV2 } from './EchangesV2'
import { DepannagesV2 } from './DepannagesV2'
import { FilouEdge } from './FilouEdge'
import type { OrigineFilou } from '@/lib/v2/filou-origine'
import type { CreneauImpacte } from '@/lib/crise/contexte'
import type { VerdictSouhait } from '@/lib/conges/detection-conflit'
import type { Conge, TypeConge, Veterinaire } from '@/types'
import { stylePastilleVar, stylePointVar } from '@/lib/couleurs'
import { horodatageFr } from '@/lib/dates-fr'
// Le tri vit dans `lib/` : c'est de la logique pure, testable sans monter un
// composant, et la V1 pourra s'en servir si elle en a besoin un jour.
import { comparerConges, LIBELLE_TRI_CONGES, type TriConges } from '@/lib/conges/tri'

type Onglet = 'conges' | 'echanges' | 'depannages'

interface Props {
  conges: Conge[]
  vets: Veterinaire[]
  moiId: string
  isAdmin: boolean
  /**
   * Verdict de conflit pré-calculé par souhait : { congeId → verdict }.
   * Couvre les plannings PUBLIÉS **et** les BROUILLONS — un souhait validé sur
   * un brouillon oblige à régénérer, l'admin doit le savoir avant de trancher.
   * Une entrée absente = détection en échec → l'écran n'affirme rien.
   */
  verdicts: Record<string, VerdictSouhait>
  echanges: EchangeRow[]
  gardesFutures: GardeLite[]
  vetsEchange: VetLite[]
  vetsCrise: VetCrise[]
  depannages: CompensationLigne[]
  statsDepannages: { ouvertes: number; compensees: number }
}

const LIBELLE_TYPE: Record<TypeConge, string> = {
  vacances: 'Vacances',
  formation: 'Formation',
  sante: 'Santé',
  indisponibilite: 'Indisponibilité',
  autre: 'Autre',
}

/** Le suffixe de classe qui donne sa couleur à la pastille de type. */
const CLASSE_TYPE: Record<TypeConge, string> = {
  vacances: 't-vacances',
  formation: 't-formation',
  sante: 't-sante',
  indisponibilite: 't-indispo',
  autre: 't-autre',
}

const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Paris',
})

function dateLongue(iso: string) {
  return DATE_LONGUE.format(new Date(iso + 'T12:00:00Z'))
}

function nbJours(debut: string, fin: string) {
  return Math.round((Date.parse(fin) - Date.parse(debut)) / 86_400_000) + 1
}

/**
 * L'HISTORIQUE d'une demande, en une phrase — « Demandé le 12 août à 14:32 ·
 * Validé le 14 août à 09:10 par Anne-Sophie ».
 *
 * Ces informations existaient en base depuis le premier jour (`created_at`,
 * `saisi_par`, `valide_par`) et n'étaient affichées NULLE PART : elles étaient
 * écrites à chaque demande et à chaque décision, et lues par personne (B-066).
 *
 * ⚠️ Une décision sans `decide_le` reste MUETTE sur sa date. C'est le cas de
 * toutes celles prises avant le 2026-08-27 : la date n'est pas reconstituable,
 * et servir `created_at` à la place daterait la décision du jour de la demande
 * — un chiffre faux s'affiche avec le même aplomb qu'un vrai (arbitrage MiKL).
 * On dit alors « Validé » sans quand, ce qui est exactement ce qu'on sait.
 */
function historiqueDemande(
  c: Conge,
  nomDe: (id: string | null) => string | null,
): string | null {
  const parts: string[] = []
  if (c.created_at) parts.push(`Demandé le ${horodatageFr(c.created_at)}`)

  if (c.statut !== 'souhait') {
    const verbe = c.statut === 'valide' ? 'Validé' : 'Refusé'
    const quand = c.decide_le ? ` le ${horodatageFr(c.decide_le)}` : ''
    const qui = nomDe(c.valide_par)
    parts.push(`${verbe}${quand}${qui ? ` par ${qui}` : ''}`)
  }

  return parts.length > 0 ? parts.join(' · ') : null
}

/** « Du lundi 16 au dimanche 22 mars 2026 · 7 jours », ou le jour seul. */
function periodeLisible(c: Conge) {
  if (c.date_debut === c.date_fin) {
    // Le créneau (matin / après-midi / soirée) ne s'affiche plus : le moteur ne
    // l'a jamais lu, et le produit ne planifie que les soirs et week-ends (B-043).
    return dateLongue(c.date_debut)
  }
  const n = nbJours(c.date_debut, c.date_fin)
  return `Du ${dateLongue(c.date_debut)} au ${dateLongue(c.date_fin)} · ${n} jours`
}

/**
 * Le verdict d'un souhait, en QUATRE états distincts.
 *
 * L'écran n'en affichait qu'un : « ✓ Aucun conflit avec le planning publié »,
 * servi même quand le cabinet n'avait AUCUN planning publié (retour MiKL du
 * 2026-08-20). Le message était littéralement vrai et pratiquement trompeur :
 * il a l'air d'un contrôle rassurant, alors qu'il n'a rien contrôlé. Les six
 * souhaits tombaient en réalité dans un planning en brouillon, dont trois sur
 * une garde déjà attribuée.
 *
 * Les quatre états répondent à la seule question que se pose qui décide :
 * « si je valide, qu'est-ce que ça casse ? »
 */
function VerdictConflit({ verdict }: { verdict?: VerdictSouhait }) {
  // Détection en échec (fail-open) : on ne dit RIEN plutôt que d'affirmer une
  // absence de conflit qu'on n'a pas vérifiée. Le silence est honnête.
  if (!verdict) return null

  const { publiees, brouillon, aucunPlanning } = verdict
  const pluriel = (n: number) => (n > 1 ? 's' : '')

  // ① Le plus grave : le planning est parti chez les vétérinaires.
  if (publiees.length > 0) {
    return (
      <span
        className="conflict warn"
        title={publiees.map((g) => `${g.date} · ${g.role}`).join('\n')}
      >
        ⚠ {publiees.length} garde{pluriel(publiees.length)} déjà publiée
        {pluriel(publiees.length)} — {publiees[0].periodeLibelle}
      </span>
    )
  }

  // ② Conflit avec un brouillon : réel, mais réparable par une régénération.
  //    On le dit AVEC la sortie, pour que l'information ouvre une décision
  //    plutôt que d'inquiéter.
  if (brouillon.length > 0) {
    return (
      <span
        className="conflict info"
        title={brouillon.map((g) => `${g.date} · ${g.role}`).join('\n')}
      >
        ◆ {brouillon.length} garde{pluriel(brouillon.length)} en brouillon —{' '}
        {brouillon[0].periodeLibelle} · à regénérer après validation
      </span>
    )
  }

  // ③ Vérifié, et il n'y a réellement rien sur ces dates.
  if (aucunPlanning) {
    return <span className="conflict ok">✓ Aucune garde prévue sur ces dates</span>
  }

  // ④ Des gardes existent, mais dans une période verrouillée : plus modifiable,
  //    donc rien à décider. Alerter devant une porte fermée n'aide personne.
  return <span className="conflict ok">✓ Sans effet sur les plannings en cours</span>
}

export function AbsencesV2({
  conges,
  vets,
  moiId,
  isAdmin,
  verdicts,
  echanges,
  gardesFutures,
  vetsEchange,
  vetsCrise,
  depannages,
  statsDepannages,
}: Props) {
  const router = useRouter()
  const [onglet, setOnglet] = useState<Onglet>('conges')
  const [creerOuvert, setCreerOuvert] = useState(false)
  const [criseOuverte, setCriseOuverte] = useState(false)
  const [aValider, setAValider] = useState<Conge | null>(null)
  const [aRefuser, setARefuser] = useState<Conge | null>(null)
  const [aEditer, setAEditer] = useState<Conge | null>(null)
  const [aSupprimer, setASupprimer] = useState<Conge | null>(null)
  const [suppressionEnCours, demarrerSuppression] = useTransition()
  const [conflit, setConflit] = useState<ConflitPlanning | null>(null)
  const [repareConflit, setRepareConflit] = useState(false)
  const [filtreVet, setFiltreVet] = useState('tous')
  const [filtreType, setFiltreType] = useState('tous')
  // Le défaut reprend l'ordre le plus utile au quotidien : le congé le plus
  // proche d'abord — c'est celui sur lequel on agit.
  const [tri, setTri] = useState<TriConges>('chrono')

  const parVet = useMemo(() => new Map(vets.map((v) => [v.id, v])), [vets])

  /**
   * Le prénom de qui a tranché, ou `null`.
   *
   * `null` dans deux cas qu'il ne faut PAS confondre à l'écriture : personne
   * n'est enregistré (décision d'avant que le refus signe, cf. B-066), ou la
   * personne n'est plus dans l'équipe visible. Dans les deux, on préfère taire
   * l'auteur plutôt qu'écrire « par Vétérinaire », qui n'apprend rien et donne
   * l'illusion d'une traçabilité.
   */
  const nomDe = useMemo(
    () => (id: string | null) => (id ? (parVet.get(id)?.prenom ?? null) : null),
    [parVet],
  )

  const vetDuConflit = conflit ? parVet.get(conflit.veterinaire_id) : undefined
  const nomConflit = vetDuConflit
    ? `${vetDuConflit.prenom} ${vetDuConflit.nom}`.trim()
    : 'Cette vétérinaire'

  /** Le prénom, jamais vide : un tri ne doit pas dépendre d'une jointure ratée. */
  const prenomDe = useMemo(
    () => (id: string) => parVet.get(id)?.prenom ?? 'zzz',
    [parVet],
  )

  const souhaits = useMemo(
    () =>
      conges
        .filter((c) => c.statut === 'souhait')
        .sort((a, b) => comparerConges(tri, a, b, prenomDe)),
    [conges, tri, prenomDe],
  )

  // PÉRIMÈTRE DE LECTURE — aligné sur la V1 (`CongesList.tsx:101-105`), qui
  // reste la référence connue du cabinet :
  //   • admin    → tout le cabinet, souhaits présentés à part (bloc au-dessus) ;
  //   • véto     → SES congés seulement, souhaits INCLUS dans la liste.
  // Deux corrections en une :
  //   1. la liste s'appelait « Mes congés » pour un véto mais montrait ceux de
  //      TOUT LE MONDE — le titre mentait ;
  //   2. un véto ne voyait sa propre demande en attente NULLE PART (le bloc
  //      « souhaits » est réservé à l'admin) : il posait un congé et le perdait
  //      de vue jusqu'à la décision.
  const traites = useMemo(() => {
    const visibles = isAdmin ? conges : conges.filter((c) => c.veterinaire_id === moiId)
    return visibles
      .filter((c) => (isAdmin ? c.statut !== 'souhait' : true))
      .sort((a, b) => comparerConges(tri, a, b, prenomDe))
  }, [conges, isAdmin, moiId, tri, prenomDe])

  const traitesFiltres = traites.filter(
    (c) =>
      (filtreVet === 'tous' || c.veterinaire_id === filtreVet) &&
      (filtreType === 'tous' || c.type === filtreType),
  )

  // Le compteur intégré aux chips : combien de congés traités par véto.
  const compteParVet = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of traites) m.set(c.veterinaire_id, (m.get(c.veterinaire_id) ?? 0) + 1)
    return m
  }, [traites])

  const echangesAAgir = echanges.filter(
    (e) => e.statut === 'proposee' || (isAdmin && e.statut === 'acceptee'),
  ).length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Absences &amp; échanges</h1>
        </div>
      </div>

      {/* Les deux commandes se posent sur la ligne des ONGLETS, pas sur celle du
          titre : elles agissent sur ce que les onglets montrent, et le titre
          seul respire mieux depuis qu'il a grandi. Même rangée, donc même
          hauteur de regard que le choix d'onglet. */}
      <div className="abs-barre">
      <nav className="tabs" role="tablist" aria-label="Sections d'Absences et échanges">
        <button
          type="button"
          role="tab"
          aria-selected={onglet === 'conges'}
          onClick={() => setOnglet('conges')}
        >
          Congés {souhaits.length > 0 && <span className="count">{souhaits.length}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={onglet === 'echanges'}
          onClick={() => setOnglet('echanges')}
        >
          Échanges de gardes {echangesAAgir > 0 && <span className="count">{echangesAAgir}</span>}
        </button>
        {isAdmin && (
          <button
            type="button"
            role="tab"
            aria-selected={onglet === 'depannages'}
            onClick={() => setOnglet('depannages')}
          >
            Dépannages{' '}
            {statsDepannages.ouvertes > 0 && (
              <span className="count">{statsDepannages.ouvertes}</span>
            )}
          </button>
        )}
      </nav>

        <div className="page-actions">
          <button type="button" className="btn btn-outline" onClick={() => setCreerOuvert(true)}>
            + {isAdmin ? 'Créer un congé' : 'Poser un congé'}
          </button>
          {isAdmin && vetsCrise.length > 0 && (
            <button type="button" className="btn btn-accent" onClick={() => setCriseOuverte(true)}>
              🚨 Déclarer une absence
            </button>
          )}
        </div>
      </div>

      {/* La scène porte Filou accroché au rebord DROIT des cartes. Il repart
          avec la mémoire de l'onglet ouvert (`#filou=conges`…) : c'est ce qui
          lui permet d'accueillir par la bonne question au lieu d'un bonjour
          générique. Cf. `src/lib/v2/filou-origine.ts`. */}
      <div className="abs-scene">
        <FilouEdge origine={onglet as OrigineFilou} cote="droite" />

      {/* ── Onglet 1 · les congés ───────────────────────────── */}
      {onglet === 'conges' && (
        <section className="tab-panel" role="tabpanel">
          {/* LE TRI EST EN TÊTE parce qu'il commande les DEUX listes de
              l'onglet — les souhaits en attente comme les congés traités.
              Le poser dans l'un des deux blocs aurait laissé croire qu'il ne
              range que celui-là.

              C'est aussi ce qui règle une incohérence ancienne : les deux
              listes suivaient des ordres OPPOSÉS (arrivée croissante en haut,
              date de congé décroissante en bas) sans que rien ne le dise. Il
              n'y a plus qu'un ordre à l'écran, et il est nommé. */}
          <div className="tri-bar">
            <span className="f-label">Trier</span>
            <Select value={tri} onValueChange={(v) => v && setTri(v as TriConges)}>
              <SelectTrigger aria-label="Ordre des listes de congés">
                {LIBELLE_TRI_CONGES[tri]}
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(LIBELLE_TRI_CONGES) as TriConges[])
                  // « Par vétérinaire » n'a aucun sens pour un vétérinaire :
                  // il ne voit que ses propres congés, la liste serait
                  // simplement triée par date. Une option qui ne fait rien est
                  // pire qu'une option absente.
                  .filter((t) => isAdmin || t !== 'vet')
                  .map((t) => (
                    <SelectItem key={t} value={t}>
                      {LIBELLE_TRI_CONGES[t]}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {isAdmin && (
            <section className="card" aria-label="Souhaits de congé en attente">
              <div className="card-head">
                <h2>Souhaits en attente</h2>
                {souhaits.length > 0 && <span className="section-count">{souhaits.length}</span>}
                <p className="sub">
                  Le verdict de conflit est calculé d&apos;avance sur chaque demande : les
                  gardes que ce congé toucherait, qu&apos;elles soient déjà publiées ou
                  encore en brouillon.
                </p>
              </div>

              {souhaits.length === 0 ? (
                <p className="empty-row">
                  Aucun souhait en attente. Les prochaines demandes des vétérinaires arriveront ici.
                </p>
              ) : (
                <ul className="rows">
                  {souhaits.map((c) => {
                    const vet = parVet.get(c.veterinaire_id)
                    return (
                      <li key={c.id}>
                        <div className="row">
                          <span
                            className="vet-dot"
                            style={stylePastilleVar(vet?.couleur)}
                          >
                            {(vet?.prenom ?? '?').slice(0, 1)}
                          </span>
                          <div className="row-main">
                            <p className="row-line">
                              <b>{vet?.prenom ?? 'Vétérinaire'}</b>
                              <span className={`type-chip ${CLASSE_TYPE[c.type]}`}>
                                {LIBELLE_TYPE[c.type]}
                              </span>
                            </p>
                            <p className="row-dates">{periodeLisible(c)}</p>
                            {c.commentaire && <p className="row-motif">« {c.commentaire} »</p>}
                            {/* Depuis quand cette demande attend-elle ? La
                                question se pose à chaque coup d'œil du matin,
                                et la réponse était en base sans être nulle
                                part à l'écran (B-066). */}
                            {historiqueDemande(c, nomDe) && (
                              <p className="row-histo">{historiqueDemande(c, nomDe)}</p>
                            )}
                          </div>
                          <div className="row-side">
                            <VerdictConflit verdict={verdicts[c.id]} />
                            <div className="row-actions">
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => setARefuser(c)}
                              >
                                Refuser…
                              </button>
                              <button
                                type="button"
                                className="btn btn-ok btn-sm"
                                onClick={() => setAValider(c)}
                              >
                                Valider…
                              </button>
                            </div>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )}

          {/* « Souhaits traités » et non « Congés du cabinet » : les deux
              encarts de cet onglet montrent la MÊME chose à deux moments de sa
              vie — un souhait en attente, puis ce souhait une fois tranché.
              Deux noms sans rapport laissaient croire à deux natures
              différentes, et on cherchait où était passée la demande qu'on
              venait de valider (demande MiKL du 2026-08-21). */}
          <section className="card" aria-label="Souhaits de congé traités">
            <div className="card-head">
              <h2>{isAdmin ? 'Souhaits traités' : 'Mes congés'}</h2>
              {traites.length > 0 && <span className="section-count">{traites.length}</span>}
              <p className="sub">
                Validés et refusés. Chaque prénom compte et filtre d&apos;un même geste.
              </p>
            </div>

            {isAdmin && (
              <div className="filters">
                <span className="f-label">Filtrer</span>
                <button
                  type="button"
                  className="vet-filter"
                  aria-pressed={filtreVet === 'tous'}
                  onClick={() => setFiltreVet('tous')}
                >
                  <i style={{ ['--c' as string]: 'var(--t-accent)' }} />
                  Toute l&apos;équipe
                </button>
                {vets
                  .filter((v) => (compteParVet.get(v.id) ?? 0) > 0)
                  .map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="vet-filter"
                      aria-pressed={filtreVet === v.id}
                      onClick={() => setFiltreVet(v.id)}
                    >
                      <i style={stylePointVar(v.couleur)} />
                      {v.prenom} · {compteParVet.get(v.id)}
                    </button>
                  ))}
                {/* ⚠️ Le composant maison, PAS un `<select>` natif : le projet
                    l'interdit, et cet écran était le seul à en avoir gardé un
                    (la V1 utilisait pourtant déjà le bon). Trouvé en traitant
                    B-067. */}
                <Select
                  value={filtreType}
                  onValueChange={(v) => v && setFiltreType(v)}
                >
                  <SelectTrigger aria-label="Filtrer par type de congé">
                    {filtreType === 'tous' ? 'Tous les types' : LIBELLE_TYPE[filtreType as TypeConge]}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tous">Tous les types</SelectItem>
                    {(Object.keys(LIBELLE_TYPE) as TypeConge[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {LIBELLE_TYPE[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}


            {traitesFiltres.length === 0 ? (
              <p className="empty-row">
                {traites.length === 0
                  ? 'Aucun congé enregistré pour le moment.'
                  : 'Aucun congé ne correspond à ce filtre.'}
              </p>
            ) : (
              <ul className="rows">
                {traitesFiltres.map((c) => {
                  const vet = parVet.get(c.veterinaire_id)
                  return (
                    <li key={c.id}>
                      <div className="row">
                        <span
                          className="vet-dot"
                          style={stylePastilleVar(vet?.couleur)}
                        >
                          {(vet?.prenom ?? '?').slice(0, 1)}
                        </span>
                        <div className="row-main">
                          <p className="row-line">
                            <b>{vet?.prenom ?? 'Vétérinaire'}</b>
                            <span className={`type-chip ${CLASSE_TYPE[c.type]}`}>
                              {LIBELLE_TYPE[c.type]}
                            </span>
                          </p>
                          <p className="row-dates">{periodeLisible(c)}</p>
                          {c.statut === 'refuse' && c.raison_refus && (
                            <p className="row-motif">Refusé : « {c.raison_refus} »</p>
                          )}
                          {historiqueDemande(c, nomDe) && (
                            <p className="row-histo">{historiqueDemande(c, nomDe)}</p>
                          )}
                        </div>
                        <div className="row-side">
                          <span
                            className={`status-pill ${
                              c.statut === 'souhait'
                                ? 'st-attente-validation'
                                : c.statut === 'valide'
                                  ? 'st-valide'
                                  : 'st-refuse'
                            }`}
                          >
                            {c.statut === 'souhait'
                              ? 'En attente'
                              : c.statut === 'valide'
                                ? 'Validé'
                                : 'Refusé'}
                          </span>
                          {/* Modifier / supprimer — mêmes droits qu'en V1
                              (`CongesList.tsx:133-135`) : l'admin touche à tout,
                              un véto ne modifie qu'un souhait encore en attente
                              mais peut toujours ANNULER un congé à lui. */}
                          <div className="row-actions">
                            {(isAdmin || c.statut === 'souhait') && (
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => setAEditer(c)}
                                aria-label={`Modifier le congé de ${vet?.prenom ?? 'ce vétérinaire'}`}
                              >
                                Modifier
                              </button>
                            )}
                            {/* Un véto ne peut supprimer QUE son propre souhait
                                encore en attente — c'est ce qu'autorise la RLS
                                (`conges_veto_delete_souhait`). La V1 proposait
                                le bouton sur n'importe quel congé à lui : sur un
                                congé validé, la base refusait et l'utilisateur
                                se prenait une erreur brute. On n'affiche donc
                                que les portes que le serveur ouvre vraiment. */}
                            {(isAdmin || (c.veterinaire_id === moiId && c.statut === 'souhait')) && (
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                onClick={() => setASupprimer(c)}
                                aria-label={`Supprimer le congé de ${vet?.prenom ?? 'ce vétérinaire'}`}
                              >
                                {c.statut === 'souhait' && !isAdmin ? 'Annuler ma demande' : 'Supprimer'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </section>
      )}

      {/* ── Onglet 2 · les échanges de gardes ───────────────── */}
      {onglet === 'echanges' && (
        <section className="tab-panel" role="tabpanel">
          <EchangesV2
            moiId={moiId}
            isAdmin={isAdmin}
            echanges={echanges}
            gardesFutures={gardesFutures}
            vets={vetsEchange}
          />
        </section>
      )}

      {/* ── Onglet 3 · qui a dépanné qui ────────────────────── */}
      {onglet === 'depannages' && isAdmin && (
        <section className="tab-panel" role="tabpanel">
          <DepannagesV2 lignes={depannages} stats={statsDepannages} vets={vets} />
        </section>
      )}
      </div>

      {/* ── Les dialogues du produit ────────────────────────── */}
      <CongeForm
        open={creerOuvert}
        onClose={() => {
          setCreerOuvert(false)
          router.refresh()
        }}
        vets={vets}
        currentUserId={moiId}
        isAdmin={isAdmin}
        onConflit={setConflit}
      />

      {/* Édition — MÊME dialogue que la création : `CongeForm` bascule en mode
          édition dès qu'on lui passe un `conge` (il porte déjà les règles et
          les effets de bord). La clé force le remontage d'un congé à l'autre,
          sinon le formulaire garderait les valeurs du précédent. */}
      {aEditer && (
        <CongeForm
          key={`edit-${aEditer.id}`}
          open
          onClose={() => {
            setAEditer(null)
            router.refresh()
          }}
          conge={aEditer}
          vets={vets}
          currentUserId={moiId}
          isAdmin={isAdmin}
          onConflit={setConflit}
        />
      )}

      {/* Suppression TOUJOURS confirmée — reprise de la V1, où la règle vient
          d'un audit (2026-07-03) : c'était la seule suppression de l'app sans
          garde-fou, et un tap de travers sur mobile effaçait un congé validé
          sans retour arrière. Ne pas retirer cette confirmation. */}
      {aSupprimer && (
        <Dialog open onOpenChange={(o) => { if (!o) setASupprimer(null) }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-heading">Supprimer ce congé ?</DialogTitle>
              <DialogDescription>
                {parVet.get(aSupprimer.veterinaire_id)?.prenom ?? 'Ce vétérinaire'} ·{' '}
                {periodeLisible(aSupprimer)}
                <br />
                C’est définitif. Si le planning est déjà publié, les gardes ne se
                réattribuent pas toutes seules — il faudra les reprendre.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setASupprimer(null)}
                disabled={suppressionEnCours}
              >
                Annuler
              </Button>
              <Button
                variant="destructive"
                disabled={suppressionEnCours}
                onClick={() => {
                  const cible = aSupprimer
                  demarrerSuppression(async () => {
                    const res = await deleteConge(cible.id)
                    if (res?.error) {
                      toast.error(res.error)
                      return
                    }
                    toast.success('Congé supprimé')
                    setASupprimer(null)
                    router.refresh()
                  })
                }}
              >
                {suppressionEnCours ? 'Suppression…' : 'Supprimer'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {aValider && (
        <ValiderCongeDialog
          open
          onClose={() => {
            setAValider(null)
            router.refresh()
          }}
          conge={aValider}
          vet={parVet.get(aValider.veterinaire_id)}
          currentVetoId={moiId}
          onConflit={setConflit}
        />
      )}

      {aRefuser && (
        <RefuserCongeDialog
          open
          onClose={() => {
            setARefuser(null)
            router.refresh()
          }}
          conge={aRefuser}
          vet={parVet.get(aRefuser.veterinaire_id)}
        />
      )}

      {/* Conflit congé ↔ planning publié (cas « Antoine ») : l'alerte, puis la
          réparation par le flux de crise EXISTANT, pré-rempli. Le parcours
          complet est repris de la V1 — s'arrêter à l'alerte laisserait
          l'administratrice devant un problème sans porte de sortie. */}
      {conflit && (
        <ConflitPlanningDialog
          open={!repareConflit}
          onOpenChange={(o) => {
            if (!o) {
              setConflit(null)
              router.refresh()
            }
          }}
          vetNom={nomConflit}
          creneauxImpactes={conflit.creneauxImpactes}
          onGerer={() => setRepareConflit(true)}
        />
      )}

      {conflit && repareConflit && vetsCrise.length > 0 && (
        <CriseModal
          key={`crise-${conflit.veterinaire_id}-${conflit.date_debut}`}
          open
          onOpenChange={(o) => {
            setRepareConflit(o)
            if (!o) {
              setConflit(null)
              router.refresh()
            }
          }}
          vets={vetsCrise}
          vetDefautId={conflit.veterinaire_id}
          dateDebutDefaut={conflit.date_debut}
          dateFinDefaut={conflit.date_fin}
        />
      )}

      {/* Signalement d'absence « à froid », depuis le bouton de la tête de page. */}
      {isAdmin && vetsCrise.length > 0 && (
        <CriseModal open={criseOuverte} onOpenChange={setCriseOuverte} vets={vetsCrise} />
      )}
    </>
  )
}
