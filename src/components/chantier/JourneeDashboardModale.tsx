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

import { useEffect, useState, useTransition } from 'react'
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
// B-165d — LES DEUX AUTORITÉS QUI RANGENT UN ABSENT DANS SA COLONNE.
// `blocsRetires` dit quels créneaux un périmètre retire, `toucheLesGardes` dit
// s'il mord sur la nuit. Aucune des deux n'est recopiée : déduire du nom d'une
// tranche (« Matin » → le matin) serait faux, le cabinet les règle librement.
import {
  blocsRetires,
  lirePerimetre,
  phrasePerimetre,
  toucheLesGardes,
} from '@/lib/absences/perimetre'
import type { GardeGrille, PersonneGrille } from '@/lib/planning/grilleSemaines'
import { plageCourte, type JourneeAffichee } from '@/lib/planning/presencesDuJour'
import type { CreneauBlocJournee } from '@/types'
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
   *    moment.
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
  /** Passage de main : la déclaration d'absence, sans personne pré-choisie. */
  onDeclarerAbsent?: (date: string, retourSur: string) => void
}) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  /** La colonne dont le choix de personnes est déplié, ou `null`. */
  const [ajoutSur, setAjoutSur] = useState<string | null>(null)

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
  if (!date || !jour) return null

  const presences = jour.journee?.presences ?? []
  const anomalies = presences.filter((p) => p.anomalie)

  function phraseIndispo(a: IndispoDuJour): string {
    const quoi =
      a.origine === 'conge' ? (a.statut === 'souhait' ? 'Souhait de congé' : 'Congé') : 'Absence'
    const p = phrasePerimetre(
      lirePerimetre(a.perimetre),
      a.heureDebut && a.heureFin ? { heure_debut: a.heureDebut, heure_fin: a.heureFin } : null,
    )
    return `${quoi} — ${p ?? 'toute la journée et la nuit'}`
  }

  /**
   * 🔑 LES ABSENTS DESCENDENT DANS LA COLONNE QU'ILS CONCERNENT (B-165d).
   * MiKL, 16/10 : « dans chaque colonne les présents ET les absents ».
   *
   * ⚠️ LE RANGEMENT NE SE DEVINE PAS, IL SE DEMANDE À L'AUTORITÉ.
   *    `blocsRetires` dit quels créneaux un périmètre retire, et `creneau` dit
   *    ce que la tranche couvre. Déduire du NOM (« Matin » → le matin) serait
   *    faux : le cabinet règle ses tranches librement, et « Matin » couvrait
   *    bel et bien 8h-18h en base le 01/10.
   *
   * ⚠️ Un périmètre `ponctuel` ne retire RIEN, par décision du 13/10 : il
   *    n'apparaît donc dans aucune colonne d'absents. L'y mettre annoncerait
   *    une absence qui n'en est pas une — et un signal qui crie pour rien
   *    cesse d'être lu.
   */
  function absentsDuCreneau(creneau: CreneauBlocJournee): IndispoDuJour[] {
    return jour!.absences.filter((a) =>
      blocsRetires(lirePerimetre(a.perimetre)).includes(creneau),
    )
  }

  /** Les absents dont le périmètre touche la NUIT — la colonne de garde. */
  const absentsDeNuit = jour.absences.filter((a) => toucheLesGardes(lirePerimetre(a.perimetre)))

  /**
   * Les colonnes de journée : une par tranche ACTIVE, dans l'ordre du cabinet.
   *
   * ⚠️ Plus une colonne par tranche RETIRÉE qui porte encore des présences :
   *    elles comptent dans l'effectif, et les taire rendrait le chiffre faux
   *    sans qu'une ligne l'explique.
   */
  const colonnes: {
    cle: string
    nom: string
    heures: string
    posable: TranchePosable | null
    gens: typeof presences
    absents: IndispoDuJour[]
  }[] = tranches.map((t) => ({
    cle: t.id,
    nom: t.nom,
    heures: plageCourte(t.debut, t.fin),
    posable: t,
    gens: presences.filter((p) => p.tranche === t.nom),
    absents: absentsDuCreneau(t.creneau),
  }))
  for (const p of presences) {
    if (colonnes.some((c) => c.nom === p.tranche)) continue
    const deja = colonnes.find((c) => c.cle === `hors-${p.tranche}`)
    if (deja) deja.gens.push(p)
    else
      colonnes.push({
        cle: `hors-${p.tranche}`,
        nom: p.tranche,
        heures: p.heures,
        posable: null,
        gens: [p],
        absents: [],
      })
  }

  const ferie = estJourFerie(jour.date)
  const passe = jour.date < today
  const places = jour.gardes.flatMap((g) => g.places.map((place) => ({ garde: g, place })))
  // `trous` vivait ici : il comptait les places à pourvoir pour un bouton de
  // pied de colonne, retiré le 16/10 au profit d'une pastille PAR PLACE. Code
  // mort dès lors — on le retire dans le même geste plutôt que de le laisser
  // attendre un usage qui ne viendra pas. Chaque place vide porte désormais
  // son propre « + », ce qui dit la même chose en montrant LAQUELLE.

  /** Qui peut encore être posé sur cette tranche ? */
  function posablesSur(t: TranchePosable) {
    return equipe.filter(
      (v) => !presences.filter((p) => p.vetId === v.id).some((p) => recouvre(p, t)),
    )
  }

  function indispoDe(vetId: string): IndispoDuJour | null {
    return jour!.absences.find((a) => a.vetId === vetId) ?? null
  }

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
      // 🔴 B-165b — L'AVERTISSEMENT PASSE DEVANT LE SUCCÈS. Le geste a réussi,
      //    et c'est justement pour ça qu'un « Présence ajoutée » seul serait
      //    trompeur : il répondrait à côté de ce qu'il fallait savoir.
      if (r.avertissement) toast.warning(r.avertissement)
      else toast.success(r.message)
      setAjoutSur(null)
      // La fenêtre RESTE ouverte : c'est tout l'intérêt d'un tableau de bord.
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

  /**
   * 🔴 LA BANDE D'ABSENTS EST UNE RANGÉE DU TABLEAU, PAS UN PIED DE COLONNE.
   *
   * MiKL, 16/10 (3e passe) : « il faut que la ligne absence soit juste en
   * dessous de tout le tableau, collée, juste séparée mais en lien avec le
   * tableau, sinon c'est pas aligné et c'est fouillis ».
   *
   * ⚠️ CECI RÉVISE B-165d ② (« dans chaque colonne les présents ET les
   *    absents »). Placés DANS la colonne, les absents tombaient à une hauteur
   *    différente selon le nombre de présents au-dessus — trois « CONGÉ » à
   *    trois hauteurs sur la capture. L'information restait juste ; c'est sa
   *    ligne de base commune qui manquait.
   *
   * 🔑 Et c'est pour ça que le tableau est passé en GRILLE : l'alignement
   *    devient structurel. Avec les colonnes en `flex`, il aurait fallu
   *    répliquer les largeurs à la main dans un second conteneur — donc le
   *    voir diverger au premier changement.
   */
  function celluleAbsents(gens: IndispoDuJour[], cle: string) {
    return (
      <div className="jdb-abs-cell" key={`abs-${cle}`}>
        {gens.map((a, i) => (
          <span className="jdb-abs" key={`${a.vetId ?? 'x'}-${i}`} title={phraseIndispo(a)}>
            <span className="jdb-abs-pt" aria-hidden="true" />
            <span className="jdb-prenom">{a.prenom}</span>
            <small>{a.origine === 'conge' ? 'congé' : 'absent'}</small>
          </span>
        ))}
      </div>
    )
  }

  /** Y a-t-il quelqu'un d'absent quelque part ? Sinon, pas de rangée du tout. */
  const ilYADesAbsents =
    colonnes.some((c) => c.absents.length > 0) || absentsDeNuit.length > 0

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
            {/* Les flèches encadrent la date : c'est la demande d'origine —
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
            <span className="jdb-etiquettes">
              {jour.date === today && <span className="jdb-etq auj">Aujourd’hui</span>}
              {passe && <span className="jdb-etq">Passé</span>}
              {ferie && <span className="jdb-etq ferie">Férié</span>}
              {jour.vacances && <span className="jdb-etq vac">{jour.vacances}</span>}
              {jour.horsPeriode && <span className="jdb-etq hors">Hors période</span>}
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
          <DialogDescription className="jdb-sr">
            Tableau de bord de la journée — présences, gardes et absences.
          </DialogDescription>
        </DialogHeader>

        {/* ══ LE TABLEAU ════════════════════════════════════════════════════
            🔴 REFONDU LE 16/10 (B-165d). MiKL : « plutôt que de mettre un
               encart à part pour les gardes, je ferais un tableau à 4 colonnes
               avec matin, aprem, journée, garde, et dans chaque colonne les
               présents ET les absents ».

            🔴 ET LES TROIS PASTILLES DE SYNTHÈSE ONT DISPARU : « 2 présents,
               2 matin, 2 aprem, ça ne sert à rien puisqu'il y a le tableau
               juste en dessous ». Le compteur de chaque colonne dit la même
               chose, à l'endroit où on le lit. */}
        {/* `--jdb-cols` porte le nombre de colonnes à la grille CSS : c'est ce
            qui garantit que la rangée d'absents s'aligne EXACTEMENT sous les
            colonnes. Un `auto-fit` ferait tomber la 4e colonne à la ligne dès
            que la place manque, et la rangée du bas ne correspondrait plus. */}
        <div
          className={ilYADesAbsents ? 'jdb-tableau avec-absents' : 'jdb-tableau'}
          style={{ '--jdb-cols': colonnes.length + 1 } as React.CSSProperties}
        >
          {colonnes.map((c) => (
            <section className="jdb-col" key={c.cle}>
              <header className="jdb-col-tete">
                <b>{c.nom}</b>
                {c.heures && <span className="jdb-heures">{c.heures}</span>}
                <span className="jdb-compte">{c.gens.length}</span>
              </header>

              <div className="jdb-col-corps">
                {c.gens.length === 0 && c.absents.length === 0 && (
                  <p className="jdb-col-vide">personne</p>
                )}

                {c.gens.map((p) => {
                  const ind = indispoDe(p.vetId)
                  return (
                    <div
                      key={p.id}
                      className={p.anomalie ? 'jdb-ligne a-verifier' : 'jdb-ligne'}
                      title={p.deLaTrame ? 'Par sa récurrence' : 'Posée à la main'}
                    >
                      <span className="vdot" style={stylePoint(p.couleur)} aria-hidden="true" />
                      <span className="jdb-prenom">{p.prenom}</span>
                      {/* 🔴 LE SIGNAL QUI MANQUAIT (B-165b), sur la ligne même. */}
                      {ind && (
                        <span
                          className="jdb-alerte"
                          title={phraseIndispo(ind)}
                          aria-label={phraseIndispo(ind)}
                        >
                          !
                        </span>
                      )}
                      {/* 🔴 3e DESSIN DE CE BOUTON, ET LE PREMIER QUI REGARDE
                          LA BONNE CHOSE. Libellé large (trop de place) → icône
                          nue (invisible) → libellé bordé (« trop grossier, ça
                          fait moche »). Le problème n'a jamais été le libellé
                          ni l'icône : c'est que l'action PESAIT AUTANT QUE LA
                          DONNÉE qu'elle sert. Une pastille ronde à fond doux
                          se lit comme un bouton (forme fermée, fond plein) et
                          s'efface devant le prénom. */}
                      {peutPoser && (
                        <button
                          type="button"
                          className="jdb-pastille retirer"
                          disabled={enCours}
                          onClick={() => retirer(p.id)}
                          aria-label={`Retirer ${p.prenom} de ${c.nom}`}
                          title={`Retirer ${p.prenom}`}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M6 12h12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* 🔴 UN VRAI BOUTON, PAS UNE ICÔNE NUE. MiKL, 16/10 : « le + et
                  le − sont trop discrets et pas très beaux ». Au tour
                  précédent j'étais passé de « trop de place » à « on ne les
                  voit plus » — une icône sans cadre ni libellé ne se lit pas
                  comme une commande. */}
              {peutPoser && periodeId && c.posable && (
                <>
                  <button
                    type="button"
                    className={ajoutSur === c.cle ? 'jdb-ajout ouvert' : 'jdb-ajout'}
                    disabled={enCours}
                    onClick={() => setAjoutSur((a) => (a === c.cle ? null : c.cle))}
                    aria-expanded={ajoutSur === c.cle}
                  >
                    <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                      {ajoutSur === c.cle ? (
                        <path d="M7 7l10 10M17 7L7 17" />
                      ) : (
                        <path d="M12 6v12M6 12h12" />
                      )}
                    </svg>
                    {ajoutSur === c.cle ? 'Annuler' : 'Ajouter'}
                  </button>
                  {ajoutSur === c.cle && (
                    <div className="jdb-choix">
                      {posablesSur(c.posable).length === 0 ? (
                        <p className="jdb-col-vide">tout le monde y est déjà</p>
                      ) : (
                        posablesSur(c.posable).map((v) => {
                          const ind = indispoDe(v.id)
                          return (
                            <button
                              key={v.id}
                              type="button"
                              className={ind ? 'jdb-pers absent' : 'jdb-pers'}
                              disabled={enCours}
                              onClick={() => poser(v.id, c.posable!.id)}
                              title={
                                ind
                                  ? `${phraseIndispo(ind)} — vous pouvez quand même la poser`
                                  : undefined
                              }
                            >
                              <span
                                className="vdot"
                                style={stylePoint(v.couleur)}
                                aria-hidden="true"
                              />
                              {v.prenom}
                              {/* Le serveur avertit après coup (B-165b) ; ici
                                  on le dit AVANT, pendant qu'il est temps. */}
                              {ind && <span className="jdb-alerte">!</span>}
                            </button>
                          )
                        })
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          ))}

          {/* ── LA GARDE, QUATRIÈME COLONNE ────────────────────────────────
              Elle n'est plus un encart : c'est une colonne comme les autres,
              avec ses présents (les places tenues), ses absents (ceux dont le
              périmètre touche la nuit) et ses CTA. */}
          <section className="jdb-col garde">
            <header className="jdb-col-tete">
              <b>Garde</b>
              <span className="jdb-heures">la nuit</span>
              <span className="jdb-compte">{places.filter((x) => x.place.vetId).length}</span>
            </header>

            <div className="jdb-col-corps">
              {places.length === 0 && absentsDeNuit.length === 0 && (
                <p className="jdb-col-vide">aucune garde ce jour-là</p>
              )}

              {places.map(({ garde, place }) =>
                place.vetId ? (
                  <div className="jdb-ligne" key={`${garde.id}-${place.index}`}>
                    <span className="vdot" style={stylePoint(place.couleur)} aria-hidden="true" />
                    <span className="jdb-prenom">{place.prenom}</span>
                    <small className="jdb-role">{place.role}</small>
                    {/* Le cadenas : le MÊME bouton que la grille, rendu par
                        l'appelant, jamais recopié. */}
                    {rendreCadenas?.(garde, place.vetId, vetsFiges(garde.id).has(place.vetId))}
                    {/* 🔴 « POUR LES GARDES ON VOIT PAS LES NOMS SÉRIEUX » —
                        la colonne affichait « M... 1ER » parce que le bouton
                        « Changer » mangeait la largeur du prénom. Une grille
                        nominative qui ne nomme plus a perdu sa raison d'être.
                        Le libellé devient donc une icône, comme demandé. */}
                    {onOuvrirGarde && (
                      <button
                        type="button"
                        className="jdb-pastille"
                        onClick={() => onOuvrirGarde(garde.id, jour.date)}
                        aria-label={`Changer la garde de ${place.prenom}`}
                        title="Changer qui est de garde"
                      >
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                          <path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17v3z" />
                        </svg>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="jdb-ligne vide" key={`${garde.id}-vide-${place.index}`}>
                    <span className="jdb-abs-pt" aria-hidden="true" />
                    <span className="jdb-apourvoir">à pourvoir</span>
                    <small className="jdb-role">{place.role}</small>
                    {onOuvrirGarde && (
                      <button
                        type="button"
                        className="jdb-pastille"
                        onClick={() => onOuvrirGarde(garde.id, jour.date)}
                        aria-label={`Pourvoir la place ${place.role}`}
                        title="Pourvoir cette place"
                      >
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                          <path d="M12 6v12M6 12h12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ),
              )}
            </div>
          </section>

          {/* ══ LA RANGÉE DES ABSENTS ════════════════════════════════════════
              Collée au tableau, séparée par un filet, et alignée sur les mêmes
              colonnes parce qu'elle appartient à la MÊME grille. */}
          {ilYADesAbsents && (
            <>
              {colonnes.map((c) => celluleAbsents(c.absents, c.cle))}
              {celluleAbsents(absentsDeNuit, 'garde')}
            </>
          )}
        </div>

        {/* Les anomalies ne sont pas décoratives : une présence sur une tranche
            retirée, ou sur quelqu'un qui a quitté l'équipe, COMPTE dans
            l'effectif affiché. La taire rendrait le chiffre faux. */}
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

        <footer className="jdb-pied">
          {onDeclarerAbsent && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onDeclarerAbsent(jour.date, jour.date)}
            >
              Signaler une absence
            </Button>
          )}
          <span className="jdb-aide">← → changent de journée</span>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
