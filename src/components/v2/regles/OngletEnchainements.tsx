'use client'

// ============================================================
// GUARDVETO V2 — Onglet « Enchaînements » entre types de garde
// ============================================================
// Un enchaînement dit que deux types de garde ne s'attribuent pas indépendamment l'un de
// l'autre : soit les mêmes vétérinaires enchaînent les deux gardes (« même
// équipe » — le vendredi soir et le week-end qui suit), soit un vétérinaire
// présent sur les deux doit y changer de rôle (« rôles différents »).
//
// CE QUE CET ONGLET RÉPARE. En V1, le sujet était COUPÉ EN DEUX ÉCRANS : on
// créait la liaison dans `/admin/structure` (table `relation_creneau`) mais on
// réglait sa fermeté dans `/regles` (table `regles_cabinet`, briques
// `liaison_creneaux` et `inversion_role`). Deux tables, donc deux pages — sauf
// que « quels types de garde sont liés » et « à quel point c'est impératif »
// sont UNE seule question pour l'admin. Un cabinet pouvait créer son enchaînement
// vendredi → week-end et ne jamais comprendre pourquoi le moteur ne la
// respectait pas : le niveau, lui, était resté désactivé sur l'autre écran.
// Ici, le niveau est affiché EN PREMIER, et chaque enchaînement rappelle sous son
// nom ce que ce niveau lui fait faire.
//
// La frontière de persistance reste inchangée : deux tables, deux actions
// serveur (`setStructureRegle` pour le niveau, `creerRelationCreneau` /
// `setRelationActive` / `supprimerRelation` pour les liaisons). C'est
// l'affichage qui recolle les deux moitiés, pas la base.
//
// ⚠️ Le vocabulaire de fermeté n'est JAMAIS écrit à la main ici : il vient de
// `lib/regles/libelle.ts`, source unique. Quatre niveaux, quatre formulations,
// et une seule liste à maintenir le jour où elles bougent.
//
// ⚠️ AUCUN `<select>` natif. Un menu natif s'ouvre avec l'habillage du système
// — cadre carré, surlignage bleu — à côté de boutons arrondis couleur terrier.
// Tous les choix passent donc par le `Select` du projet, habillé de bout en
// bout dans `v2-terrier.css`. Conséquence technique : il refuse la valeur vide,
// d'où les deux sentinelles ci-dessous.
// ============================================================

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowRight, Info, Link2, Plus, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { aideForce, choixForce, motForce, symboleDe } from '@/lib/regles/libelle'
import { setStructureRegle } from '@/app/(protected)/regles/actions'
import {
  creerRelationCreneau,
  setRelationActive,
  supprimerRelation,
} from '@/app/(protected)/admin/structure/actions'
import { AideFilou } from './AideFilou'
import type { GenreRelationUI, NiveauLiaisonUI, ProfilUI, RelationUI } from './types'

interface Props {
  /** La période type courante, avec ses types de garde et ses enchaînements. */
  profil: ProfilUI
  /** Le niveau (ferme/souple) de chaque genre de liaison, lu dans `regles_cabinet`. */
  niveaux: Record<GenreRelationUI, NiveauLiaisonUI>
  /** `?focus=` : ancre venue du diagnostic d'impasse du planning. */
  focus?: string
}

/** Le genre de liaison → la brique de `regles_cabinet` qui porte son niveau. */
const BRIQUE_DU_GENRE: Record<GenreRelationUI, string> = {
  meme_binome: 'liaison_creneaux',
  inversion_role: 'inversion_role',
}

/**
 * L'ancre historique de chaque brique. Le diagnostic d'impasse du planning
 * désigne les règles par leur numéro de moteur (R8, R9) ; il ne connaît pas les
 * noms de briques, et il n'a pas à les connaître.
 */
const ANCRE_ALT: Record<GenreRelationUI, string> = {
  meme_binome: 'r9_liaison',
  inversion_role: 'r8_inversion',
}

/** Toutes les ancres qui atterrissent sur un bloc de niveau, quel que soit leur nom. */
const FOCUS_VERS_GENRE: Record<string, GenreRelationUI> = {
  liaison_creneaux: 'meme_binome',
  r9_liaison: 'meme_binome',
  inversion_role: 'inversion_role',
  r8_inversion: 'inversion_role',
}

/** Les quatre niveaux de fermeté, du plus dur au plus souple (cf. `FORCE_META`). */
const FORCES = ['jamais', 'sauf_crise', 'evitee', 'si_possible'] as const

/**
 * Valeur sentinelle du sélecteur de niveau : « Désactivée » n'existe pas en
 * base — c'est le drapeau `actif` de la brique, pas une cinquième force.
 */
const DESACTIVEE = '__desactivee__'

/** Sentinelle du « Choisir… » des menus de création (la valeur vide est refusée). */
const CHOISIR = '__choisir__'

/** Ce que chaque genre veut dire, en une phrase, pour l'admin qui arrive ici. */
const GENRE_TITRE: Record<GenreRelationUI, string> = {
  meme_binome: 'Même équipe',
  inversion_role: 'Rôles différents',
}

const GENRE_EXPLICATION: Record<GenreRelationUI, string> = {
  meme_binome:
    'Les mêmes vétérinaires assurent les deux gardes liées. C’est ce qui fait qu’un vendredi soir et le week-end qui suit sont tenus par la même équipe, au lieu d’être tirés séparément.',
  inversion_role:
    'Un vétérinaire présent sur les deux gardes liées doit y changer de rôle — 1er sur l’une, 2nd sur l’autre. Personne ne cumule deux fois la même place sur un enchaînement.',
}

/** L'étiquette posée sur chaque ligne d'enchaînement. */
const GENRE_ETIQ: Record<GenreRelationUI, string> = {
  meme_binome: 'Même équipe',
  inversion_role: 'Rôles différents',
}

/**
 * Une force venue de la base peut être vide (brique jamais réglée) ou porter un
 * étage non proposé ici (`invariant`, `reglementaire`). Le sélecteur ne montre
 * que les quatre niveaux réglables : on retombe sur le plus dur, qui est aussi
 * celui du seed pour ces deux briques.
 */
function forceValide(force: string): string {
  return (FORCES as readonly string[]).includes(force) ? force : 'jamais'
}

/** Le message d'erreur d'une action serveur, quelle que soit la forme du retour. */
function messageErreur(res: unknown): string | null {
  if (res && typeof res === 'object' && 'error' in res) {
    const e = (res as { error: unknown }).error
    return typeof e === 'string' ? e : 'Action impossible.'
  }
  return null
}

export function OngletEnchainements({ profil, niveaux, focus }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Copie locale des niveaux : le sélecteur bouge tout de suite, et on la
  // repose telle qu'elle était si le serveur refuse.
  //
  // La resynchronisation sur le serveur se fait PENDANT LE RENDU, pas dans un
  // effet : après un `router.refresh()`, un effet redessinerait d'abord avec
  // l'ancienne valeur puis avec la nouvelle — un aller-retour visible sur le
  // sélecteur qu'on vient de changer. (Pattern « ajuster un état quand une
  // prop change » de la doc React.)
  const [niveauxServeur, setNiveauxServeur] = useState(niveaux)
  const [niveauxLocaux, setNiveauxLocaux] = useState(niveaux)
  if (niveauxServeur !== niveaux) {
    setNiveauxServeur(niveaux)
    setNiveauxLocaux(niveaux)
  }

  // Changer de période type remonte tout le composant (`key` posée par la
  // coquille) : les types de garde d'un panneau à demi rempli n'existent
  // peut-être plus dans la période type qu'on vient d'ouvrir.
  const [panneauOuvert, setPanneauOuvert] = useState(false)
  const [sourceId, setSourceId] = useState(CHOISIR)
  const [cibleId, setCibleId] = useState(CHOISIR)
  const [genre, setGenre] = useState<GenreRelationUI>('meme_binome')
  const [aSupprimer, setASupprimer] = useState<RelationUI | null>(null)

  const creneaux = profil.creneaux
  const relations = useMemo(
    () =>
      [...profil.relations].sort(
        (a, b) =>
          Number(b.actif) - Number(a.actif) ||
          a.sourceNom.localeCompare(b.sourceNom, 'fr') ||
          a.cibleNom.localeCompare(b.cibleNom, 'fr'),
      ),
    [profil.relations],
  )
  const nbActives = relations.filter((r) => r.actif).length

  // ── Le halo de `?focus=` ────────────────────────────────────
  // On arrive ici depuis un diagnostic d'impasse qui désigne UN réglage. Sans
  // le halo et le défilement, on atterrit dans une liste et on cherche.
  const genreCible = focus ? FOCUS_VERS_GENRE[focus] : undefined
  const blocs = useRef<Partial<Record<GenreRelationUI, HTMLDivElement | null>>>({})

  useEffect(() => {
    if (!genreCible) return
    const el = blocs.current[genreCible]
    if (!el) return
    const doux = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: doux ? 'smooth' : 'auto', block: 'center' })
  }, [genreCible])

  // ── Le niveau d'un genre (table `regles_cabinet`) ───────────

  function changerNiveau(g: GenreRelationUI, valeur: string) {
    const avant = niveauxLocaux[g]
    // « Désactivée » ne change pas la force : on garde la dernière choisie, pour
    // que réactiver retrouve le réglage d'avant au lieu d'un défaut arbitraire.
    const forceRetenue = valeur === DESACTIVEE ? forceValide(avant.force) : valeur
    const apres: NiveauLiaisonUI = { actif: valeur !== DESACTIVEE, force: forceRetenue }

    setNiveauxLocaux((n) => ({ ...n, [g]: apres }))

    startTransition(async () => {
      const res = await setStructureRegle(BRIQUE_DU_GENRE[g], apres.actif, apres.force)
      const err = messageErreur(res)
      if (err) {
        setNiveauxLocaux((n) => ({ ...n, [g]: avant }))
        toast.error(err)
        return
      }
      toast.success(
        apres.actif
          ? `« ${GENRE_TITRE[g]} » : ${motForce(apres.force)} — appliqué à la prochaine génération.`
          : `« ${GENRE_TITRE[g]} » désactivé — le moteur n’en tiendra plus compte.`,
      )
      router.refresh()
    })
  }

  // ── Les liaisons elles-mêmes (table `relation_creneau`) ─────

  /** Le libellé affiché sur le déclencheur d'un menu de créneau. */
  function nomCreneau(id: string): string {
    const c = creneaux.find((x) => x.id === id)
    if (!c) return 'Choisir…'
    return c.actif ? c.nom : `${c.nom} (inactif)`
  }

  const choixComplet = sourceId !== CHOISIR && cibleId !== CHOISIR

  function creer() {
    startTransition(async () => {
      const res = await creerRelationCreneau({
        profil_id: profil.id,
        source_id: sourceId,
        cible_id: cibleId,
        genre,
      })
      const err = messageErreur(res)
      if (err) {
        toast.error(err)
        return
      }
      toast.success('Enchaînement créé — il s’applique dès la prochaine génération.')
      setPanneauOuvert(false)
      setSourceId(CHOISIR)
      setCibleId(CHOISIR)
      router.refresh()
    })
  }

  function basculer(r: RelationUI) {
    startTransition(async () => {
      const res = await setRelationActive(r.id, !r.actif)
      const err = messageErreur(res)
      if (err) {
        toast.error(err)
        return
      }
      toast.success(
        r.actif
          ? 'Enchaînement désactivé — le moteur ne l’appliquera plus.'
          : 'Enchaînement réactivé.',
      )
      router.refresh()
    })
  }

  function supprimer() {
    if (!aSupprimer) return
    const cible = aSupprimer
    startTransition(async () => {
      const res = await supprimerRelation(cible.id)
      const err = messageErreur(res)
      if (err) {
        toast.error(err)
        return
      }
      toast.success('Enchaînement supprimé.')
      setASupprimer(null)
      router.refresh()
    })
  }

  /**
   * Ce que CETTE liaison fait vraiment, en tenant compte du niveau de son genre.
   * C'est la phrase qui manquait en V1 : la liaison existait, son niveau dormait
   * sur l'autre écran, et le moteur ne faisait rien sans que personne ne
   * comprenne. Même forme que sous les sélecteurs de niveau (`.consequence`) :
   * c'est la même nature de texte — le résultat d'un choix, pas une définition.
   */
  function consequenceLigne(r: RelationUI) {
    const niveau = niveauxLocaux[r.genre]
    if (!r.actif) {
      return (
        <>
          <b>Inactif</b> — le moteur apparie ces deux types de garde comme s’ils n’étaient pas liés.
        </>
      )
    }
    if (!niveau?.actif) {
      return (
        <>
          <b>Sans effet pour l’instant</b> — le réglage « {GENRE_TITRE[r.genre]} » est désactivé
          plus haut, le moteur ne lit aucun enchaînement de ce genre.
        </>
      )
    }
    const force = forceValide(niveau.force)
    return (
      <>
        <b>
          {symboleDe(force)} {motForce(force)}
        </b>{' '}
        — {aideForce(force)}
      </>
    )
  }

  return (
    <>
      {/* ══ Le niveau : ce que les liaisons IMPOSENT ══════════════
          En premier, exprès. Régler une liaison sans savoir si elle est ferme
          ou souple, c'est régler la moitié de la question. */}
      <section className="card" aria-label="Ce que les enchaînements imposent">
        <div className="card-head">
          <h2>Ce que les enchaînements imposent</h2>
          <span className="spacer" />
          <AideFilou sujet="comprendre ce qu’un niveau change, ou décrire l’enchaînement voulu" />
          <p className="sub">
            Deux réglages pour tout le cabinet : à quel point le moteur doit tenir les
            enchaînements que vous avez déclarés plus bas. Ils valent pour tous les enchaînements
            de ce genre, sur toutes les périodes types.
          </p>
        </div>

        <div className="ench-niveaux">
          {(['meme_binome', 'inversion_role'] as GenreRelationUI[]).map((g) => {
            const niveau = niveauxLocaux[g] ?? { actif: false, force: 'jamais' }
            const brique = BRIQUE_DU_GENRE[g]
            const cible = genreCible === g
            return (
              <div
                key={g}
                ref={(el) => {
                  blocs.current[g] = el
                }}
                className={`ench-niveau${cible ? ' cible-focus' : ''}`}
                data-regle-cible={brique}
                data-regle-cible-alt={ANCRE_ALT[g]}
              >
                <h3>{GENRE_TITRE[g]}</h3>
                <p className="note">{GENRE_EXPLICATION[g]}</p>

                <div>
                  <Select
                    value={niveau.actif ? forceValide(niveau.force) : DESACTIVEE}
                    disabled={isPending}
                    onValueChange={(v) => {
                      if (typeof v === 'string' && v) changerNiveau(g, v)
                    }}
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label={`Niveau du réglage « ${GENRE_TITRE[g]} »`}
                    >
                      <span className="min-w-0 truncate">
                        {niveau.actif
                          ? `${symboleDe(forceValide(niveau.force))} ${choixForce(forceValide(niveau.force))}`
                          : 'Désactivée'}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DESACTIVEE}>Désactivée</SelectItem>
                      {FORCES.map((f) => (
                        <SelectItem key={f} value={f}>
                          {symboleDe(f)} {choixForce(f)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Ce que le moteur fera AVEC le choix ci-dessus. La `.note`
                      du dessus dit de quoi on parle, celle-ci dit ce qui va se
                      passer : deux pavés gris identiques se lisaient comme un
                      seul, et on ne voyait plus lequel répondait au réglage. */}
                  <p className="consequence">
                    <Info size={15} aria-hidden="true" />
                    <span>
                      {niveau.actif ? (
                        <>
                          <b>{motForce(forceValide(niveau.force))}</b> —{' '}
                          {aideForce(forceValide(niveau.force))}
                        </>
                      ) : (
                        <>
                          <b>Désactivé</b> — le moteur attribue ces types de garde sans regarder les
                          enchaînements de ce genre. Ils restent enregistrés et se rallument d’un
                          choix.
                        </>
                      )}
                    </span>
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ══ Les enchaînements de la période type ══════════════════ */}
      <section className="card" aria-label="Créneaux liés">
        <div className="card-head">
          <h2>Créneaux liés</h2>
          {nbActives > 0 && <span className="section-count">{nbActives}</span>}
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-accent btn-sm"
            disabled={isPending || creneaux.length < 2}
            onClick={() => setPanneauOuvert((o) => !o)}
          >
            <Plus size={15} aria-hidden="true" />
            Lier deux types de garde
          </button>
          <p className="sub">
            Les enchaînements de la période type « {profil.nom} ». Le moteur relie chaque garde du
            second type de garde à la garde du premier qui la précède immédiatement, dans les sept
            jours.
          </p>
        </div>

        {/* ── Créer une liaison ────────────────────────────────── */}
        {panneauOuvert && (
          <div className="panneau">
            <p className="panneau-titre">Nouvel enchaînement</p>

            <div className="grille">
              <div>
                <label htmlFor="ench-source">Premier type de garde</label>
                <Select
                  value={sourceId}
                  disabled={isPending}
                  onValueChange={(v) => {
                    if (typeof v !== 'string' || !v) return
                    setSourceId(v)
                    if (v === cibleId) setCibleId(CHOISIR)
                  }}
                >
                  <SelectTrigger id="ench-source" className="w-full">
                    <span className="min-w-0 truncate">{nomCreneau(sourceId)}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CHOISIR}>Choisir…</SelectItem>
                    {creneaux.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nom}
                        {c.actif ? '' : ' (inactif)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label htmlFor="ench-genre">Ce que l’enchaînement impose</label>
                <Select
                  value={genre}
                  disabled={isPending}
                  onValueChange={(v) => {
                    if (typeof v === 'string' && v) setGenre(v as GenreRelationUI)
                  }}
                >
                  <SelectTrigger id="ench-genre" className="w-full">
                    <span className="min-w-0 truncate">
                      {genre === 'meme_binome'
                        ? 'Même équipe sur les deux'
                        : 'Rôles différents entre les deux'}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meme_binome">Même équipe sur les deux</SelectItem>
                    <SelectItem value="inversion_role">Rôles différents entre les deux</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label htmlFor="ench-cible">Second type de garde</label>
                <Select
                  value={cibleId}
                  disabled={isPending}
                  onValueChange={(v) => {
                    if (typeof v === 'string' && v) setCibleId(v)
                  }}
                >
                  <SelectTrigger id="ench-cible" className="w-full">
                    <span className="min-w-0 truncate">{nomCreneau(cibleId)}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CHOISIR}>Choisir…</SelectItem>
                    {creneaux
                      .filter((c) => c.id !== sourceId)
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nom}
                          {c.actif ? '' : ' (inactif)'}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Ce que le genre choisi juste au-dessus implique — dont la garde
                  métier R22, annoncée AVANT le refus : un vétérinaire ne peut
                  pas tenir deux gardes le même jour, donc exiger la même équipe
                  sur deux créneaux qui partagent un jour, c'est se fabriquer un
                  planning ingénérable. Le serveur refuse, et il a raison. */}
              <p className="consequence large">
                <Info size={15} aria-hidden="true" />
                <span>
                  {genre === 'meme_binome' ? (
                    <>
                      Deux types de garde qui couvrent <b>un même jour</b> ne peuvent pas exiger la même
                      équipe : personne ne tient deux gardes le même jour. Pour ce cas-là,
                      choisissez « rôles différents ».
                    </>
                  ) : (
                    <>
                      Un vétérinaire qui se retrouve sur les deux gardes y{' '}
                      <b>change de place</b>. Les autres sont attribués normalement.
                    </>
                  )}
                </span>
              </p>
            </div>

            <div className="panneau-pied">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={isPending}
                onClick={() => setPanneauOuvert(false)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-accent btn-sm"
                disabled={isPending || !choixComplet}
                onClick={creer}
              >
                <Link2 size={15} aria-hidden="true" />
                Créer l’enchaînement
              </button>
            </div>
          </div>
        )}

        {/* ── La liste ─────────────────────────────────────────── */}
        {relations.length === 0 ? (
          <p className="empty-row">
            Aucun enchaînement pour cette période type : chaque type de garde est attribué indépendamment
            des autres. Un enchaînement sert à dire qu’un type de garde ne se tire pas tout seul — par
            exemple que le vendredi soir et le week-end qui suit reviennent à la même équipe,
            pour ne pas couper une continuité de soins en deux.
          </p>
        ) : (
          <ul className="rows">
            {relations.map((r) => (
              <li key={r.id}>
                <div className="row">
                  <div className="row-main">
                    <div className="ench-lien">
                      <span className="ench-creneau">{r.sourceNom}</span>
                      <span className="ench-fleche" aria-hidden="true">
                        <ArrowRight size={17} />
                      </span>
                      <span className="ench-creneau">{r.cibleNom}</span>
                      <span className="etiq">{GENRE_ETIQ[r.genre]}</span>
                      {!r.actif && <span className="etiq eteint">Inactive</span>}
                    </div>
                    <p className="consequence">
                      <Info size={15} aria-hidden="true" />
                      <span>{consequenceLigne(r)}</span>
                    </p>
                  </div>

                  <div className="row-side">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={isPending}
                        onClick={() => basculer(r)}
                      >
                        {r.actif ? 'Désactiver' : 'Activer'}
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Supprimer l’enchaînement ${r.sourceNom} vers ${r.cibleNom}`}
                        disabled={isPending}
                        onClick={() => setASupprimer(r)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Confirmation avant de supprimer. La V1 posait un `window.confirm()` —
          une boîte grise du navigateur, hors du terrier, qui ne disait pas ce
          que le geste changeait vraiment. */}
      <Dialog
        open={Boolean(aSupprimer)}
        onOpenChange={(o) => {
          if (!o && !isPending) setASupprimer(null)
        }}
      >
        <DialogContent className="gv-modale">
          <DialogHeader>
            <DialogTitle>Supprimer cet enchaînement ?</DialogTitle>
            <DialogDescription>
              Dès la prochaine génération, le moteur cessera d’apparier ces deux types de garde : il
              les attribuera séparément. Les plannings déjà générés ne bougent pas. Pour
              suspendre l’enchaînement sans le perdre, préférez « Désactiver ».
            </DialogDescription>
          </DialogHeader>

          {aSupprimer && (
            <div className="gv-rappel">
              <p>
                {aSupprimer.sourceNom} → {aSupprimer.cibleNom}
              </p>
              <p className="gv-appoint">{GENRE_ETIQ[aSupprimer.genre]}</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setASupprimer(null)} disabled={isPending}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={supprimer} disabled={isPending}>
              {isPending ? 'Un instant…' : 'Supprimer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
