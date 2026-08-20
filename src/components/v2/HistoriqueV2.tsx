'use client'

// ============================================================
// GUARDVETO V2 — Écran « Historique & compteurs »
// ============================================================
// Porté de `maquette/m4-accueil-equipe-historique-connexions.html` (section 3).
//
// Ce qui est PORTÉ (le look) : la barre de filtres à segments, les cartes de
// compteurs avec l'écart à la juste part, la liste des périodes, le cumul.
//
// Ce qui est RÉUTILISÉ tel quel (les règles métier) : `calculerBilans` pour
// les écarts — le MÊME calcul que le bilan officiel de fin de période, sinon
// une carte dirait « +2 » là où le bilan dit « +1 » ; et les composants
// `BonusMalusCard`, `HistoriqueFetesCard`,
// `EffectifPeriodeSelect`, `ProfilPeriodeSelect`, `SupprimerPeriodeButton`,
// greffés tels quels : ils écrivent en base et portent leurs garde-fous.
//
// Les filtres passent par l'URL (comme la V1 `/compteurs`) : tout le calcul
// est côté serveur, donc un lien vers un filtre précis reste partageable.
// ============================================================

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import type { Periode } from '@/types'
import type { CompteursRow, DepannagesRow } from '@/hooks/useCompteurs'
import type { BilanVet } from '@/engine/bilan'
import { useImportPlanning } from './ImportPlanningLanceur'
import { Ecart } from './Ecart'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'

// ── Ce que la page a préparé ──────────────────────────────────────────────

export interface CumulLigne {
  veterinaire_id: string
  prenom: string
  couleur: string
  we: number
  sem: number
  feries: number
}

interface Props {
  periodes: Periode[]
  /** Filtres actifs, lus dans l'URL par la page. */
  mode: 'periode' | 'plage'
  periodeId: string
  debut: string
  fin: string
  perimetre: 'tout' | 'valide'
  /**
   * Ce que montrent les cartes, phrasé par la page, en morceaux.
   * Surtout PAS une chaîne de HTML : elle contiendrait des libellés de période
   * saisis par l'admin, et les injecter tels quels ouvrirait une porte XSS
   * pour économiser deux balises.
   */
  legende: Array<{ texte: string; fort?: boolean }>
  /**
   * Ce qui a empêché de LIRE les compteurs, s'il y a lieu. À ne surtout pas
   * confondre avec `compteurs: []` : l'un veut dire « je ne sais pas », l'autre
   * « personne n'a de garde ». Un écran qui affiche le second à la place du
   * premier ment avec aplomb.
   */
  erreurLecture?: string | null

  compteurs: CompteursRow[]
  bilans: BilanVet[]
  depannages: DepannagesRow[]
  /** Les vétos « dernier recours » sortent de la répartition. */
  derniersRecours: string[]
  moiId: string | null
  estAdmin: boolean

  cumul: CumulLigne[]
  cumulResume: string | null

  /** Rendus côté serveur par la page (le bilan porte sa propre carte V2). */
  slotBilan?: React.ReactNode
  slotFetes?: React.ReactNode
}

// ── Petits utilitaires d'affichage ────────────────────────────────────────

function libellePeriode(p: Periode): string {
  if (p.libelle) return p.libelle
  const saison = p.saison === 'ete' ? 'Été' : 'Hiver'
  return `${saison} ${p.date_debut.slice(0, 4)}${p.numero ? ` — P${p.numero}` : ''}`
}

function dateCourte(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const LIBELLE_STATUT: Record<Periode['statut'], { texte: string; classe: string }> = {
  brouillon: { texte: 'Brouillon', classe: 'st-brouillon' },
  publie: { texte: 'Publiée', classe: 'st-publiee' },
  verrouille: { texte: 'Verrouillée', classe: 'st-archivee' },
}

function Nombre({ n }: { n: number }) {
  return <td className={n === 0 ? 'zero' : undefined}>{n}</td>
}

// ── Composant ─────────────────────────────────────────────────────────────

export function HistoriqueV2({
  periodes,
  mode,
  periodeId,
  debut,
  fin,
  perimetre,
  legende,
  erreurLecture,
  compteurs,
  bilans,
  depannages,
  derniersRecours,
  moiId,
  estAdmin,
  cumul,
  cumulResume,
  slotBilan,
  slotFetes,
}: Props) {
  const router = useRouter()
  const [du, setDu] = useState(debut)
  const [au, setAu] = useState(fin)
  // Tout le calcul est côté serveur : sans ça, une seconde s'écoule entre le
  // clic et le nouveau tableau, pendant laquelle les segments ont l'air morts
  // et on reclique.
  const [enCours, demarrer] = useTransition()
  const imp = useImportPlanning()

  // Les deux dates de la plage vivent dans un MENU, pas dans la barre : elles
  // s'y ajoutaient en poussant le périmètre à la ligne, donc l'encart changeait
  // de forme au clic. Même mécanique que la pilule de période du planning —
  // on sort en cliquant ailleurs ou avec Échap, jamais par la seule flèche.
  const [plageOuverte, setPlageOuverte] = useState(false)
  const plageRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!plageOuverte) return
    function auClic(e: MouseEvent) {
      if (!plageRef.current?.contains(e.target as Node)) setPlageOuverte(false)
    }
    function auClavier(e: KeyboardEvent) {
      if (e.key === 'Escape') setPlageOuverte(false)
    }
    document.addEventListener('mousedown', auClic)
    document.addEventListener('keydown', auClavier)
    return () => {
      document.removeEventListener('mousedown', auClic)
      document.removeEventListener('keydown', auClavier)
    }
  }, [plageOuverte])

  const recours = new Set(derniersRecours)
  const bilanDe = new Map(bilans.map((b) => [b.veterinaire_id, b]))
  const depannageDe = new Map(depannages.map((d) => [d.veterinaire_id, d]))

  const aller = (url: string) => demarrer(() => router.push(url))

  const versPeriode = (id: string) =>
    aller(`/historique?mode=periode&periodeId=${id}&perimetre=${perimetre}`)
  const versPlage = (d: string, f: string, peri: 'tout' | 'valide' = perimetre) =>
    aller(`/historique?mode=plage&debut=${d}&fin=${f}&perimetre=${peri}`)
  const changerPerimetre = (peri: 'tout' | 'valide') =>
    mode === 'plage'
      ? versPlage(du, au, peri)
      : aller(`/historique?mode=periode&periodeId=${periodeId}&perimetre=${peri}`)

  const aucuneDonnee = compteurs.length === 0

  return (
    <>
      {/* ── Tête de page ─────────────────────────────────────────────── */}
      <div className="page-head rise">
        <div>
          <p className="page-kicker">Historique &amp; compteurs</p>
          <h1>Qui a fait quoi, sur la période que tu veux.</h1>
          <p className="lede">
            Les compteurs sont ceux du moteur, pas une addition faite ici : c&apos;est exactement
            ce qu&apos;il relit à chaque génération pour rattraper les écarts de la période
            précédente.
          </p>
        </div>
        {/* La création d'un planning a quitté cet écran (2026-08-02) : elle est
            devenue la première étape de « Générer », là où on le regarde.
            Historique CONSULTE. On laisse le chemin, pas un cul-de-sac. */}
        {/* Deux actions du même niveau : partir de zéro, ou partir de ce
            qu'on a déjà. Elles se présentent ensemble, au moment où l'on
            choisit — « Créer » reste l'action principale, « Importer » la
            secondaire (retour MiKL, 2026-08-15). */}
        {estAdmin && (
          <div className="page-actions">
            <Link href="/planning" className="hist-vers-planning">
              Créer un planning →
            </Link>
            {imp.bouton}
          </div>
        )}
      </div>

      {/* Le résultat de la lecture s'ouvre sous l'en-tête, pas dans la rangée
          d'actions : le lien entre le geste et son résultat reste vertical. */}
      {imp.attente}
      {imp.panneau}
      {imp.dialogueErreur}

      {/* ── Filtres ──────────────────────────────────────────────────── */}
      <div className="hist-filters rise rise-2" aria-busy={enCours}>
        <span className="hf-label">Période</span>
        <div className="seg" role="group" aria-label="Choix de la période">
          {/* Un MENU, pas une rangée de boutons : la barre listait toutes les
              périodes côte à côte, donc elle grandissait à chaque planning
              généré. Le menu porte aussi ce que la rangée ne pouvait pas dire
              — les dates et le statut — ce qui rend inutile l'ancien encart
              « Périodes planifiées » plus bas dans la page (retiré). */}
          <Select
            value={mode === 'periode' ? periodeId : ''}
            onValueChange={(v) => {
              if (typeof v === 'string' && v) versPeriode(v)
            }}
          >
            <SelectTrigger
              className="hf-periode"
              data-actif={mode === 'periode' ? 'true' : undefined}
              disabled={enCours || periodes.length === 0}
            >
              {mode === 'periode'
                ? (periodes.find((p) => p.id === periodeId)
                    ? libellePeriode(periodes.find((p) => p.id === periodeId)!)
                    : 'Choisir un planning')
                : periodes.length === 0
                  ? 'Aucun planning'
                  : 'Choisir un planning'}
            </SelectTrigger>
            <SelectContent>
              {periodes.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="hf-opt">
                    <b>{libellePeriode(p)}</b>
                    <small>
                      {dateCourte(p.date_debut)} → {dateCourte(p.date_fin)} ·{' '}
                      {LIBELLE_STATUT[p.statut].texte.toLowerCase()}
                    </small>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* La plage libre traverse les périodes : c'est une vue de gestion du
              cabinet, réservée à l'admin — et refusée côté serveur, pas
              seulement cachée ici. Ses deux dates s'ouvrent EN MENU : dans la
              barre, elles la faisaient changer de forme au clic. */}
          {estAdmin && (
            <div className="hf-plage" ref={plageRef}>
              <button
                type="button"
                aria-pressed={mode === 'plage'}
                aria-expanded={plageOuverte}
                disabled={enCours}
                onClick={() => setPlageOuverte((v) => !v)}
              >
                Plage libre
              </button>

              {plageOuverte && (
                <div className="hf-pop" role="dialog" aria-label="Choisir une plage de dates">
                  <p className="hf-pop-titre">Sur quelles dates ?</p>
                  <p className="hf-pop-sous">
                    Les compteurs se calculent sur l’intervalle choisi, toutes périodes
                    confondues.
                  </p>
                  <div className="hf-pop-dates">
                    <label>
                      <span>Du</span>
                      <input
                        type="date"
                        value={du}
                        onChange={(e) => setDu(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>Au</span>
                      <input
                        type="date"
                        value={au}
                        onChange={(e) => setAu(e.target.value)}
                      />
                    </label>
                  </div>
                  {du && au && du > au && (
                    <p className="range-erreur" role="alert">
                      La date de fin est avant la date de début.
                    </p>
                  )}
                  <div className="hf-pop-actions">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => setPlageOuverte(false)}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      className="btn btn-accent btn-sm"
                      onClick={() => {
                        setPlageOuverte(false)
                        versPlage(du, au)
                      }}
                      disabled={enCours || !du || !au || du > au}
                    >
                      {enCours ? 'Calcul…' : 'Voir ces dates'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <span className="hf-label" style={{ marginLeft: 'auto' }}>
          Périmètre
        </span>
        <div className="seg" role="group" aria-label="Périmètre des gardes comptées">
          <button
            type="button"
            aria-pressed={perimetre === 'tout'}
            disabled={enCours}
            onClick={() => changerPerimetre('tout')}
          >
            Tout, brouillons compris
          </button>
          <button
            type="button"
            aria-pressed={perimetre === 'valide'}
            disabled={enCours}
            onClick={() => changerPerimetre('valide')}
          >
            Gardes validées seulement
          </button>
        </div>

        <p className="hist-caption">
          {legende.map((seg, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {seg.fort ? <b>{seg.texte}</b> : seg.texte}
            </span>
          ))}
          {enCours && <span className="hist-encours"> · recalcul en cours…</span>}
        </p>
      </div>

      {/* ── Les cartes de compteurs ──────────────────────────────────── */}
      {erreurLecture ? (
        /* « Je n'ai pas pu compter » — surtout pas un tableau à zéro, qui se
           lirait comme « personne n'a de garde ». */
        <section className="card rise rise-3">
          <div className="card-head">
            <h2>Les compteurs n&apos;ont pas pu être lus</h2>
          </div>
          <p className="count-vide">
            Aucun chiffre n&apos;est affiché ici, volontairement : ce n&apos;est pas
            « zéro garde », c&apos;est « je ne sais pas ». Réessaie dans un instant ; si
            cela persiste, signale-le avec ce détail technique.
            <br />
            <code className="hist-detail-technique">{erreurLecture}</code>
          </p>
        </section>
      ) : aucuneDonnee ? (
        <section className="card rise rise-3">
          <div className="card-head">
            <h2>Aucune garde sur ce filtre</h2>
          </div>
          <p className="count-vide">
            {perimetre === 'valide'
              ? "Rien de validé ici : le planning de cette période est peut-être encore en brouillon. Passe le périmètre sur « Tout, brouillons compris » pour le voir."
              : "Aucune garde n'a été attribuée sur cet intervalle."}
          </p>
        </section>
      ) : (
        <div className="count-grid rise rise-3">
          {/* Week-ends */}
          <section className="card count-card" aria-label="Compteur des week-ends">
            <div className="card-head">
              <h3>🧡 Week-ends</h3>
              <span className="sub spacer">1er / 2nd de garde · écart à la juste part</span>
            </div>
            <table className="count-table">
              <thead>
                <tr>
                  <th>Vétérinaire</th>
                  <th>1er</th>
                  <th>2nd</th>
                  <th>Total</th>
                  <th>Écart</th>
                </tr>
              </thead>
              <tbody>
                {compteurs.map((r) => (
                  <tr key={r.veterinaire_id} className={r.veterinaire_id === moiId ? 'moi' : undefined}>
                    <td>
                      <span className="ct-vet">
                        <i style={{ background: r.couleur }} />
                        {r.prenom}
                        {r.statut === 'salarie' && <span className="sal">sal.</span>}
                      </span>
                      {/* Un remplacement d'UN SEUL jour (backlog 8 bis) ne
                          bouge AUCUN des chiffres de cette ligne : l'équité
                          reste indexée sur le week-end, qui n'a pas changé de
                          titulaire. Sans ce repère, le jour exceptionnel
                          n'existe donc nulle part à l'écran — MiKL l'a
                          cherché en vain après en avoir posé un.
                          Un badge plutôt qu'une colonne : ces jours ne
                          s'additionnent pas aux week-ends, les mettre côte à
                          côte inviterait à les confondre. */}
                      {(r.jours_1er_we_exceptionnels ?? 0) > 0 && (
                        <span
                          className="except"
                          title={`${r.jours_1er_we_exceptionnels} jour(s) de 1er de garde pris à titre exceptionnel — compté à part, sans effet sur les week-ends ci-contre`}
                        >
                          ⚡ {r.jours_1er_we_exceptionnels} j. 1ᵉʳ except.
                        </span>
                      )}
                      {(r.jours_exceptionnels_pris ?? 0) > (r.jours_1er_we_exceptionnels ?? 0) && (
                        <span
                          className="except neutre"
                          title="Jours pris en remplacement exceptionnel, sans effet sur l’équité ni sur l’avantage financier"
                        >
                          ⚡ {(r.jours_exceptionnels_pris ?? 0) - (r.jours_1er_we_exceptionnels ?? 0)} j. except.
                        </span>
                      )}
                    </td>
                    <Nombre n={r.we_premier} />
                    <Nombre n={r.we_second} />
                    <td>{r.we_total}</td>
                    <td>
                      <Ecart
                        valeur={bilanDe.get(r.veterinaire_id)?.ecart_we ?? 0}
                        horsRepartition={recours.has(r.veterinaire_id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Nuits de semaine */}
          <section className="card count-card" aria-label="Compteur des nuits de semaine">
            <div className="card-head">
              <h3>🌙 Semaine · 1er / 2nd</h3>
              <span className="sub spacer">nuits en semaine</span>
            </div>
            <table className="count-table">
              <thead>
                <tr>
                  <th>Vétérinaire</th>
                  <th>1er</th>
                  <th>2nd</th>
                  <th>Total</th>
                  <th>Écart</th>
                </tr>
              </thead>
              <tbody>
                {compteurs.map((r) => (
                  <tr key={r.veterinaire_id} className={r.veterinaire_id === moiId ? 'moi' : undefined}>
                    <td>
                      <span className="ct-vet">
                        <i style={{ background: r.couleur }} />
                        {r.prenom}
                      </span>
                    </td>
                    <Nombre n={r.sem_premier} />
                    <Nombre n={r.sem_second} />
                    <td>{r.sem_total}</td>
                    <td>
                      <Ecart
                        valeur={bilanDe.get(r.veterinaire_id)?.ecart_semaine ?? 0}
                        horsRepartition={recours.has(r.veterinaire_id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Fériés */}
          <section className="card count-card" aria-label="Compteur des jours fériés">
            <div className="card-head">
              <h3>🎈 Fériés</h3>
              <span className="sub spacer">jours fériés de la zone du cabinet</span>
            </div>
            <table className="count-table">
              <thead>
                <tr>
                  <th>Vétérinaire</th>
                  <th>Total</th>
                  <th>Écart</th>
                </tr>
              </thead>
              <tbody>
                {compteurs.map((r) => (
                  <tr key={r.veterinaire_id} className={r.veterinaire_id === moiId ? 'moi' : undefined}>
                    <td>
                      <span className="ct-vet">
                        <i style={{ background: r.couleur }} />
                        {r.prenom}
                      </span>
                    </td>
                    <Nombre n={r.feries_total} />
                    <td>
                      <Ecart
                        valeur={bilanDe.get(r.veterinaire_id)?.ecart_feries ?? 0}
                        horsRepartition={recours.has(r.veterinaire_id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Le compteur « Week-ends libres » vivait ici (retiré le 2026-08-19,
              demande de MiKL). Il n'affichait qu'une SOUSTRACTION du tableau
              ci-dessus (libres = total − de garde), avec deux pièges de
              lecture : le moteur compte des week-ends « perdus » là où l'écran
              disait « libres », et son « + » voulait dire « a été libre plus
              souvent » alors que partout ailleurs sur cette page « + » veut
              dire « a travaillé plus que sa part ».

              ⚠️ La RÈGLE, elle, continue de s'appliquer : R15 (équité des
              grands week-ends entre salariés) est une dimension d'équité à
              part entière, de poids « important », réglable dans Organisation
              (« Grands week-ends (salariés) »). Seul son affichage disparaît —
              et il n'entrait pas dans le rattrapage inter-périodes, que le
              moteur fonde sur le seul `ecart_we`. */}

          {/* Dépannages */}
          <section className="card count-card" aria-label="Compteur des dépannages">
            <div className="card-head">
              <h3>🤝 Dépannages</h3>
              <span className="sub spacer">qui a repris la garde de qui, suite à une absence</span>
            </div>
            <table className="count-table">
              <thead>
                <tr>
                  <th>Vétérinaire</th>
                  <th>Rendus</th>
                  <th>Reçus</th>
                  <th>Solde</th>
                </tr>
              </thead>
              <tbody>
                {compteurs.map((r) => {
                  const d = depannageDe.get(r.veterinaire_id)
                  const rendus = d?.rendus ?? 0
                  const recus = d?.recus ?? 0
                  const solde = rendus - recus
                  return (
                    <tr key={r.veterinaire_id} className={r.veterinaire_id === moiId ? 'moi' : undefined}>
                      <td>
                        <span className="ct-vet">
                          <i style={{ background: r.couleur }} />
                          {r.prenom}
                        </span>
                        {(d?.dettesOuvertes ?? 0) > 0 && (
                          <span
                            className="dette"
                            title="Dépannage encore à rendre — visible dans Absences & échanges"
                          >
                            🤝 {d?.dettesOuvertes} à rendre
                          </span>
                        )}
                      </td>
                      <Nombre n={rendus} />
                      <Nombre n={recus} />
                      <td>
                        <span
                          className={`ecart ${solde === 0 ? 'ok' : solde > 0 ? 'ok' : 'warn'}`}
                          title={
                            solde > 0
                              ? "A dépanné plus souvent qu'il n'a été dépanné"
                              : solde < 0
                                ? 'A été dépanné plus souvent — la dette reste ouverte tant qu\'elle n\'est pas soldée'
                                : 'Entraide équilibrée'
                          }
                        >
                          {solde === 0 ? '=' : solde > 0 ? `+${solde}` : `−${Math.abs(solde)}`}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="count-note">
              Le solde n&apos;est pas un écart à une moyenne : un dépannage a toujours deux
              faces, il s&apos;équilibre tout seul à l&apos;échelle du cabinet.
            </p>
          </section>
        </div>
      )}

      {/* ── Bilan de fin de période ──────────────────────────────────
          Plus une greffe : le composant porte désormais sa propre carte V2
          (`.card.count-card`). Pas de `.v2-greffe` ici, sinon carte dans
          carte — le cadre d'accueil ne sert qu'aux composants restés V1. */}
      {slotBilan && <div className="hist-greffe rise">{slotBilan}</div>}

      {/* ── Historique des fêtes (composant V1 greffé) ───────────────── */}
      {slotFetes && <div className="hist-greffe v2-greffe rise">{slotFetes}</div>}

      {/* L'encart « Périodes planifiées » vivait ici. Il faisait doublon avec
          le menu de la barre de filtres (choisir une période) et portait des
          réglages qui appartiennent à Organisation — la période type et
          l'effectif de nuit se règlent là-bas, la suppression d'un planning
          depuis l'écran Planning et depuis « Générer ». Rien n'est perdu.
          (Retiré le 2026-08-19, demande de MiKL.) */}

      {/* ── Compteurs cumulés ────────────────────────────────────────── */}
      {cumul.length > 0 && (
        <section className="card rise" aria-label="Compteurs cumulés sur toutes les périodes validées">
          <div className="card-head">
            <div>
              <h3>Compteurs cumulés</h3>
              <p className="sub">{cumulResume}</p>
            </div>
          </div>
          <div className="cumul-body">
            <div className="cm-row cm-header" aria-hidden="true">
              <span>Vétérinaire</span>
              <span>Week-ends</span>
              <span>Nuits de semaine</span>
              <span>Fériés</span>
            </div>
            {(() => {
              const maxWE = Math.max(1, ...cumul.map((c) => c.we))
              const maxSem = Math.max(1, ...cumul.map((c) => c.sem))
              const maxFer = Math.max(1, ...cumul.map((c) => c.feries))
              return cumul.map((c) => (
                <div className="cm-row" key={c.veterinaire_id}>
                  <span className="cm-vet">
                    <i style={{ background: c.couleur }} />
                    {c.prenom}
                  </span>
                  <span className="cm-cell">
                    <b>{c.we}</b>
                    <span className="bar">
                      <i style={{ width: `${(c.we / maxWE) * 100}%`, background: c.couleur }} />
                    </span>
                  </span>
                  <span className="cm-cell">
                    <b>{c.sem}</b>
                    <span className="bar">
                      <i style={{ width: `${(c.sem / maxSem) * 100}%`, background: c.couleur }} />
                    </span>
                  </span>
                  <span className="cm-cell">
                    <b>{c.feries}</b>
                    <span className="bar">
                      <i style={{ width: `${(c.feries / maxFer) * 100}%`, background: c.couleur }} />
                    </span>
                  </span>
                </div>
              ))
            })()}
          </div>
          <p className="lookback-note">
            ⚖️ L&apos;équité entre les périodes est déjà dans le moteur : à chaque génération, il
            relit ces compteurs et rattrape les écarts de la période précédente. Personne ne
            « perd » un week-end en changeant de saison.
          </p>
        </section>
      )}
    </>
  )
}
