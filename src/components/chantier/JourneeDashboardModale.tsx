'use client'

// ============================================================
// GUARDVETO — LE TABLEAU DE BORD D'UNE JOURNÉE
// ============================================================
// B-163d ② / B-165. MiKL, 15/10 : « je mettrais bien une icône en haut de
// chaque journée, sur l'extrémité droite où y a la date, qui permettrait
// d'ouvrir une pop up pour visualiser chaque journée en gros, avec tous les
// détails… et des flèches pour passer les journées, sans avoir à fermer la pop
// up et ouvrir la journée suivante ».
//
// Puis, le 16/10, la précision qui change la nature de l'écran : « il faut
// vraiment penser cette fenêtre comme un vrai dashboard journalier, où la
// personne peut également ADMINISTRER et pas que consulter ».
//
// ── POURQUOI UN NOUVEAU FICHIER, ET PAS `JourneeDuJourModale` ──────────────
//
// 🔴 `JourneeDuJourModale` est importée par `PlanningV2`, l'écran du CLIENT.
//    L'enrichir ici aurait livré au client un chantier qu'il n'a pas demandé —
//    c'est exactement le défaut payé le 09/10 : un garde-fou de périmètre borne
//    le RENDU, jamais la DÉPENDANCE. Un fichier partagé n'a pas de porte de
//    chantier. Celui-ci vit dans `components/chantier/`, donc dans le chantier.
//
// ── CE QUI EST ADMINISTRÉ ICI, ET CE QUI PASSE LA MAIN ─────────────────────
//
// GESTES LÉGERS, EN LIGNE : poser et retirer une présence, poser et lever un
// cadenas. Ce sont des gestes d'un clic, sans formulaire.
//
// GESTES LOURDS, PAR PASSAGE DE MAIN : réattribuer une garde et déclarer une
// absence rouvrent les fenêtres QUI EXISTENT DÉJÀ (`GardeDetailModal`,
// `CriseModal`), et ce tableau se rouvre tout seul sur le même jour à leur
// fermeture.
//
// ⚠️ LA RAISON EST UNE LEÇON, PAS UN CONFORT : réécrire ces deux formulaires
//    ici en créerait une SECONDE VERSION du même geste — et c'est toujours la
//    version oubliée qui se met à mentir (défaut payé le 22/08). Accessoirement,
//    une fenêtre dans une fenêtre perd le piège de focus du `Dialog` partagé.
//
// ⚠️ AUCUNE RÈGLE N'EST REJOUÉE ICI. Les effectifs viennent de
//    `lignesDeLaSemaine` + `effectifsDemiJournee` — les briques de la grille —
//    et le recouvrement d'une tranche par une présence vient de `recouvre`,
//    exporté par `CellulePresenceModale`. Recopier l'une des deux, c'est la
//    voir diverger un jour sans que rien ne le dise.
// ============================================================

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { poserPresence, retirerPresence } from '@/app/(v2)/journee/presences-actions'
import { estJourFerie } from '@/engine/utils'
import { stylePoint } from '@/lib/couleurs'
import { lirePerimetre, phrasePerimetre } from '@/lib/absences/perimetre'
import {
  effectifsDemiJournee,
  lignesDeLaSemaine,
  type GardeGrille,
  type PersonneGrille,
  type RailBornes,
} from '@/lib/planning/grilleSemaines'
import { plageCourte, type JourneeAffichee } from '@/lib/planning/presencesDuJour'
import { recouvre, type TranchePosable } from './CellulePresenceModale'

const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Paris',
})

/** Une indisponibilité du jour, quelle que soit son origine. */
export interface IndispoDuJour {
  vetId: string | null
  prenom: string
  /** `valide` = congé accordé · `souhait` = demande non tranchée. */
  statut: string
  origine: 'conge' | 'absence'
  /**
   * ⚠️ `undefined` est admis À DESSEIN : un congé ancien n'a pas de périmètre
   *    en base, et le champ arrive absent plutôt que `null`. Le refuser ici
   *    obligerait l'appelant à normaliser — donc à décider, dans un `??`, ce
   *    qu'un périmètre manquant veut dire. C'est `lirePerimetre` qui le décide,
   *    et elle seule : elle est l'unique autorité sur ce qu'une absence couvre.
   */
  perimetre: string | null | undefined
  heureDebut: string | null | undefined
  heureFin: string | null | undefined
}

/** Tout ce que le tableau de bord sait d'un jour — la forme de la grille. */
export interface JourDuDashboard {
  date: string
  horsMois: boolean
  horsPeriode: boolean
  gardes: GardeGrille[]
  journee?: JourneeAffichee
  absences: IndispoDuJour[]
  vacances: string | null
}

export function JourneeDashboardModale({
  date,
  jours,
  equipe,
  rail,
  periodeId,
  tranches,
  today,
  peutPoser,
  vetsFiges,
  rendreCadenas,
  onAller,
  onFermer,
  onOuvrirGarde,
  onDeclarerAbsent,
}: {
  /** `AAAA-MM-JJ`, ou `null` quand rien n'est ouvert. */
  date: string | null
  /**
   * Les jours de la grille affichée, DANS L'ORDRE. C'est lui qui borne les
   * flèches : on ne navigue pas au-delà de ce que l'écran a chargé, sinon la
   * fenêtre montrerait un jour que la grille derrière ne connaît pas.
   */
  jours: readonly JourDuDashboard[]
  equipe: readonly PersonneGrille[]
  /** Les bornes du rail — pour que l'effectif soit CELUI de la grille. */
  rail: RailBornes
  /** `null` = le jour ne tombe dans aucune période : rien à enregistrer. */
  periodeId: string | null
  tranches: readonly TranchePosable[]
  today: string
  /**
   * L'administratrice peut-elle poser ou retirer une présence ?
   *
   * ⚠️ Le MÊME prédicat que celui de la grille (`onOuvrirCellule`), calculé par
   *    l'appelant et passé ici. Le recalculer rendrait possible qu'un écran
   *    propose un geste que l'autre refuse, pour la même personne au même
   *    moment. Le serveur tranche de toute façon : ici on évite seulement de
   *    promettre un bouton qui mènerait à un refus.
   */
  peutPoser: boolean
  vetsFiges: (gardeId: string) => ReadonlySet<string>
  /** Le bouton cadenas, rendu par l'appelant — `undefined` quand il n'a pas lieu d'être. */
  rendreCadenas?: (garde: GardeGrille, vetId: string, fige: boolean) => React.ReactNode
  /** Aller à un autre jour SANS fermer — c'est la demande d'origine. */
  onAller: (date: string) => void
  onFermer: () => void
  /** Passage de main : la fenêtre de garde (réattribution, échange). */
  onOuvrirGarde?: (gardeId: string, retourSur: string) => void
  /** Passage de main : la déclaration d'absence. */
  onDeclarerAbsent?: (date: string, vetId: string, retourSur: string) => void
}) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  /** La personne pour qui on est en train d'ajouter une présence. */
  const [ajoutPour, setAjoutPour] = useState<string | null>(null)

  const index = date ? jours.findIndex((j) => j.date === date) : -1
  const precedent = index > 0 ? jours[index - 1].date : null
  const suivant = index >= 0 && index < jours.length - 1 ? jours[index + 1].date : null

  // Les flèches du clavier font ce que font les boutons — pas un second
  // chemin : le même `onAller`, les mêmes bornes.
  useEffect(() => {
    if (!date) return
    function auClavier(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft' && precedent) onAller(precedent)
      if (e.key === 'ArrowRight' && suivant) onAller(suivant)
    }
    window.addEventListener('keydown', auClavier)
    return () => window.removeEventListener('keydown', auClavier)
  }, [date, precedent, suivant, onAller])

  const jour = index >= 0 ? jours[index] : null

  // Les effectifs de la grille, par les briques de la grille. Le tableau de
  // bord montre TOUT, quel que soit l'axe choisi sur l'écran derrière : c'est
  // le détail d'une journée, pas une seconde vue filtrée.
  const effectifs = useMemo(
    () =>
      jour
        ? effectifsDemiJournee(
            lignesDeLaSemaine(equipe, jour, rail, {
              gardesVisibles: true,
              journeeVisible: true,
            }),
          )
        : { matin: 0, apresMidi: 0 },
    [jour, equipe, rail],
  )

  if (!date || !jour) return null

  const presences = jour.journee?.presences ?? []
  const anomalies = presences.filter((p) => p.anomalie)

  // Groupé par tranche : c'est la question réellement posée (« qui est là ce
  // matin ? »). L'ordre vient de `composerPresencesParJour`, qui suit celui
  // voulu par l'admin — on ne retrie pas, sinon deux écrans classeraient la
  // même donnée différemment.
  const parTranche: { tranche: string; heures: string; gens: typeof presences }[] = []
  for (const p of presences) {
    const dernier = parTranche[parTranche.length - 1]
    if (dernier && dernier.tranche === p.tranche) dernier.gens.push(p)
    else parTranche.push({ tranche: p.tranche, heures: p.heures, gens: [p] })
  }

  const ferie = estJourFerie(jour.date)
  const passe = jour.date < today
  /** Les tranches encore posables pour la personne en cours d'ajout. */
  const posables = ajoutPour
    ? tranches.filter(
        (t) => !presences.filter((p) => p.vetId === ajoutPour).some((p) => recouvre(p, t)),
      )
    : []

  function poser(vetId: string, trancheId: string) {
    if (!periodeId || !date) return
    demarrer(async () => {
      const r = await poserPresence({
        veterinaire_id: vetId,
        bloc_id: trancheId,
        date,
        periode_id: periodeId,
      })
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(r.message)
      setAjoutPour(null)
      // La fenêtre RESTE ouverte : c'est tout l'intérêt d'un tableau de bord.
      // `router.refresh()` rafraîchit la page serveur dessous, et les props
      // redescendent — la fenêtre se redessine sans se fermer.
      router.refresh()
    })
  }

  function retirer(id: string) {
    demarrer(async () => {
      const r = await retirerPresence(id)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(r.message)
      router.refresh()
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !enCours) onFermer()
      }}
    >
      <DialogContent className="gv-modale jdb-modale">
        <DialogHeader>
          <DialogTitle className="jdb-titre">
            {/* Les flèches encadrent la date : c'est la demande littérale —
                passer d'une journée à l'autre sans fermer. Désactivées aux
                bornes plutôt que masquées : un bouton qui disparaît déplace
                tout le reste et se lit comme une panne. */}
            <button
              type="button"
              className="jdb-fleche"
              disabled={!precedent}
              onClick={() => precedent && onAller(precedent)}
              aria-label="Journée précédente"
            >
              ‹
            </button>
            <span className="jdb-date">
              {DATE_LONGUE.format(new Date(jour.date + 'T12:00:00Z'))}
            </span>
            <button
              type="button"
              className="jdb-fleche"
              disabled={!suivant}
              onClick={() => suivant && onAller(suivant)}
              aria-label="Journée suivante"
            >
              ›
            </button>
          </DialogTitle>
          <DialogDescription className="jdb-sous-titre">
            {/* Ce qui qualifie la journée, et qui change ce qu'on peut en
                attendre. Rien d'inventé : chacun de ces états est déjà porté
                par la grille. */}
            <span className="jdb-etiquettes">
              {jour.date === today && <span className="jdb-etq auj">Aujourd’hui</span>}
              {passe && <span className="jdb-etq">Passé</span>}
              {ferie && <span className="jdb-etq ferie">Férié</span>}
              {jour.vacances && <span className="jdb-etq vac">{jour.vacances}</span>}
              {jour.horsPeriode && <span className="jdb-etq hors">Hors période</span>}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* ── L'EFFECTIF, EN TÊTE ────────────────────────────────────────────
            Deux chiffres NEUTRES, sans seuil : le minimum d'effectif n'existe
            pas au schéma et MiKL l'a écarté le 06/10. Les afficher en rouge
            ferait de ce dessin un juge sans règle. */}
        <div className="jdb-effectifs">
          <span className="jdb-eff">
            <b>{jour.journee?.personnes ?? 0}</b> au cabinet
          </span>
          <span className="jdb-eff">
            <b>{effectifs.matin}</b> le matin
          </span>
          <span className="jdb-eff">
            <b>{effectifs.apresMidi}</b> l’après-midi
          </span>
          <span className="jdb-eff">
            <b>{jour.gardes.reduce((s, g) => s + g.places.filter((p) => p.vetId).length, 0)}</b> de
            garde
          </span>
        </div>

        {/* ── QUI EST LÀ ─────────────────────────────────────────────────── */}
        <section className="jdb-bloc">
          <h4>Au cabinet</h4>
          {parTranche.length === 0 ? (
            /* ⚠️ « Personne n'est inscrit » et « la journée n'a pas été
               remplie » ne sont PAS la même chose, et les confondre est le
               défaut du tableau d'accueil qui annonçait « Rien à vérifier » :
               une salle vide et un angle mort se lisent pareil, et personne ne
               va vérifier une bonne nouvelle. */
            <p className="jdb-vide">
              Aucune présence n’est inscrite ce jour-là. Ça ne veut pas dire que le cabinet est
              fermé — seulement que rien n’a encore été posé sur cette journée.
            </p>
          ) : (
            <div className="jdb-tranches">
              {parTranche.map((t) => (
                <div className="jdb-tranche" key={t.tranche}>
                  <div className="jdb-tr-head">
                    <b>{t.tranche}</b>
                    {t.heures && <span className="jdb-heures">{t.heures}</span>}
                    <span className="jdb-compte">
                      {t.gens.length} personne{t.gens.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <ul className="jdb-gens">
                    {t.gens.map((p) => (
                      <li key={p.id} className={p.anomalie ? 'jdb-gen a-verifier' : 'jdb-gen'}>
                        <span
                          className="vdot"
                          style={stylePoint(p.couleur)}
                          aria-hidden="true"
                        />
                        <span className="jdb-prenom">{p.prenom}</span>
                        {/* L'origine se dit, parce qu'elle change ce qui se
                            passe ensuite : une présence venue d'une récurrence
                            revient si on réapplique les récurrences. */}
                        <span className="jdb-origine">
                          {p.deLaTrame ? 'par sa récurrence' : 'posée à la main'}
                        </span>
                        {peutPoser && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={enCours}
                            onClick={() => retirer(p.id)}
                          >
                            Retirer
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* ── AJOUTER UNE PRÉSENCE ─────────────────────────────────────────
              En deux temps, QUI puis QUAND : la fenêtre de cellule connaît déjà
              la personne (on y arrive en cliquant sur sa ligne), celle-ci non.
              Sans le premier temps, il faudrait une grille de 7 personnes × 4
              tranches, illisible et pleine de boutons qui mèneraient à un
              refus. */}
          {peutPoser && periodeId && (
            <div className="jdb-ajout">
              <h5>Ajouter une présence</h5>
              <div className="jdb-qui">
                {equipe.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={ajoutPour === v.id ? 'jdb-pers actif' : 'jdb-pers'}
                    disabled={enCours}
                    onClick={() => setAjoutPour((a) => (a === v.id ? null : v.id))}
                  >
                    <span className="vdot" style={stylePoint(v.couleur)} aria-hidden="true" />
                    {v.prenom}
                  </button>
                ))}
              </div>
              {ajoutPour && (
                <div className="jdb-quand">
                  {posables.length === 0 ? (
                    <p className="jdb-vide">
                      {tranches.length === 0
                        ? 'Aucune tranche horaire n’est définie. Réglez-les dans « Journée ».'
                        : 'Toutes les tranches sont déjà prises pour cette personne.'}
                    </p>
                  ) : (
                    posables.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="jdb-tr-btn"
                        disabled={enCours}
                        onClick={() => poser(ajoutPour, t.id)}
                      >
                        <b>{t.nom}</b>
                        <small>{plageCourte(t.debut, t.fin)}</small>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* ⚠️ LA LIMITE S'ÉCRIT. Un retrait qui ne tient pas la prochaine
              application des récurrences, découvert après coup, se lit comme
              une panne — alors que c'est le comportement voulu. */}
          {peutPoser && presences.some((p) => p.deLaTrame) && (
            <p className="jdb-note">
              Une présence venue d’une récurrence <b>reviendra</b> si vous réappliquez les
              récurrences sur ce planning.
            </p>
          )}
        </section>

        {/* ── LA NUIT ────────────────────────────────────────────────────── */}
        <section className="jdb-bloc">
          <h4>De garde cette nuit</h4>
          {jour.gardes.length === 0 ? (
            <p className="jdb-vide">Aucun créneau de garde n’est posé sur ce jour.</p>
          ) : (
            jour.gardes.map((g) => {
              const figes = vetsFiges(g.id)
              return (
                <div className="jdb-garde" key={g.id}>
                  <div className="jdb-g-head">
                    <b>{g.type}</b>
                    {g.manque > 0 && (
                      <span className="jdb-manque">
                        {g.manque} place{g.manque > 1 ? 's' : ''} à pourvoir
                      </span>
                    )}
                    {onOuvrirGarde && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onOuvrirGarde(g.id, jour.date)}
                      >
                        Ouvrir la garde
                      </Button>
                    )}
                  </div>
                  <ul className="jdb-places">
                    {g.places.map((p) => (
                      <li key={`${g.id}-${p.index}`} className="jdb-place">
                        <span className="jdb-role">{p.role}</span>
                        {p.vetId ? (
                          <>
                            <span
                              className="vdot"
                              style={stylePoint(p.couleur)}
                              aria-hidden="true"
                            />
                            <span className="jdb-prenom">{p.prenom}</span>
                            {/* Le cadenas, en ligne : un clic, pas un
                                formulaire. C'est le MÊME bouton que la grille —
                                rendu par l'appelant, jamais recopié. */}
                            {rendreCadenas?.(g, p.vetId, figes.has(p.vetId))}
                          </>
                        ) : (
                          <span className="jdb-apourvoir">à pourvoir</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })
          )}
        </section>

        {/* ── CE QUI MANQUE À L'APPEL ────────────────────────────────────── */}
        <section className="jdb-bloc">
          <h4>Absences et congés</h4>
          {jour.absences.length === 0 ? (
            <p className="jdb-vide">Personne n’est déclaré indisponible ce jour-là.</p>
          ) : (
            <ul className="jdb-indispos">
              {jour.absences.map((a, i) => {
                const phrase = phrasePerimetre(
                  lirePerimetre(a.perimetre),
                  a.heureDebut && a.heureFin
                    ? { heure_debut: a.heureDebut, heure_fin: a.heureFin }
                    : null,
                )
                return (
                  <li key={`${a.vetId ?? 'x'}-${i}`} className="jdb-indispo">
                    <span className="jdb-prenom">{a.prenom}</span>
                    <b>
                      {a.origine === 'conge'
                        ? a.statut === 'souhait'
                          ? 'Souhait de congé'
                          : 'Congé'
                        : 'Absence'}
                    </b>
                    {/* `phrasePerimetre` rend `null` sur « la journée et la
                        nuit » — le cas général n'a rien à préciser, et une
                        mention permanente cesse d'être lue. */}
                    <span className="jdb-perimetre">{phrase ?? 'Toute la journée et la nuit'}</span>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Passage de main vers la fenêtre QUI EXISTE DÉJÀ. Le choix de la
              personne y est fait : le proposer ici aussi dupliquerait la moitié
              du formulaire. */}
          {onDeclarerAbsent && equipe.length > 0 && (
            <div className="jdb-declarer">
              <span>Quelqu’un manque à l’appel ?</span>
              {equipe.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="jdb-pers"
                  onClick={() => onDeclarerAbsent(jour.date, v.id, jour.date)}
                >
                  <span className="vdot" style={stylePoint(v.couleur)} aria-hidden="true" />
                  {v.prenom}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Les anomalies ne sont pas décoratives : une présence sur une tranche
            retirée, ou sur quelqu'un qui a quitté l'équipe, COMPTE dans
            l'effectif affiché. La taire rendrait le chiffre faux sans qu'une
            seule ligne l'explique. */}
        {anomalies.length > 0 && (
          <div className="jdb-anomalies" role="status">
            <b>À vérifier</b>
            <ul>
              {anomalies.map((p) => (
                <li key={`a-${p.id}`}>
                  {p.prenom} — {p.anomalie}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* La consigne dit ce que CETTE personne peut faire. L'annoncer à
            quelqu'un qui n'y a pas droit, c'est lui faire chercher un bouton
            que le serveur refuse — le défaut relevé le 20/08. */}
        <p className="jdb-pied">
          {peutPoser ? (
            <>
              Les flèches <b>‹</b> et <b>›</b> (ou les touches du clavier) passent d’une journée à
              l’autre sans fermer.
            </>
          ) : (
            'Consultation seule. Les flèches passent d’une journée à l’autre sans fermer.'
          )}
        </p>
      </DialogContent>
    </Dialog>
  )
}
