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
  /**
   * Passage de main : la déclaration d'absence.
   *
   * 🔴 PLUS DE `vetId` DEPUIS LE 16/10 (B-165a ③). La fenêtre affichait les sept
   *    prénoms sous « Quelqu'un manque à l'appel ? » — deux lignes de hauteur
   *    permanente pour un choix que `CriseModal` propose déjà, puisque son
   *    `vetDefautId` est OPTIONNEL (vérifié). MiKL, 16/10 : « pkoi remettre les
   *    noms comme ça, faudrait juste remettre les boutons ».
   */
  onDeclarerAbsent?: (date: string, retourSur: string) => void
}) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  /**
   * La TRANCHE pour laquelle on choisit quelqu'un à poser, ou `null`.
   *
   * 🔑 L'ORDRE EST INVERSÉ DEPUIS LE 16/10 : c'était « qui, puis quand ». Le
   *    « quand » est maintenant donné par le `+` de la colonne où l'on clique,
   *    et il ne reste qu'une question à poser. Un temps de moins, et surtout
   *    un bloc d'ajout qui ne coûte plus de hauteur tant qu'on ne l'ouvre pas —
   *    la contrainte dure de cette recette : « voir toutes les infos sans
   *    scroller ».
   */
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

  /**
   * 🔴 CE QUI MANQUAIT, ET QUI A LAISSÉ POSER ANNE-SOPHIE (B-165b).
   * MiKL, 16/10 : « j'ai pu mettre Anne-Sophie le matin alors qu'elle est notée
   * absente, je n'ai aucune info qui me le signalait ».
   *
   * ⚠️ ON NE REJOUE PAS LA RÈGLE ICI. Savoir si une absence « du matin » couvre
   *    exactement telle tranche demande le CRÉNEAU du bloc, que cette fenêtre
   *    n'a pas — et le deviner dessinerait une précision fausse. C'est le
   *    serveur qui tranche (`estAbsentSurCeBloc`, une seule autorité).
   *    L'écran, lui, dit ce qu'il sait : « cette personne a une indisponibilité
   *    ce jour-là, la voici ». L'administratrice juge.
   */
  function indispoDe(vetId: string): IndispoDuJour | null {
    return jour!.absences.find((a) => a.vetId === vetId) ?? null
  }

  function phraseIndispo(a: IndispoDuJour): string {
    const quoi =
      a.origine === 'conge' ? (a.statut === 'souhait' ? 'Souhait de congé' : 'Congé') : 'Absence'
    const p = phrasePerimetre(
      lirePerimetre(a.perimetre),
      a.heureDebut && a.heureFin ? { heure_debut: a.heureDebut, heure_fin: a.heureFin } : null,
    )
    return `${quoi} — ${p ?? 'toute la journée et la nuit'}`
  }

  // Groupé par tranche : c'est la question réellement posée (« qui est là ce
  // matin ? »). L'ordre vient de `composerPresencesParJour`, qui suit celui
  // voulu par l'admin — on ne retrie pas, sinon deux écrans classeraient la
  // même donnée différemment.
  const parTranche: {
    cle: string
    nom: string
    heures: string
    /** La tranche posable correspondante, quand elle existe encore au cabinet. */
    posable: TranchePosable | null
    gens: typeof presences
  }[] = []
  for (const t of tranches) {
    parTranche.push({
      cle: t.id,
      nom: t.nom,
      heures: plageCourte(t.debut, t.fin),
      posable: t,
      gens: [],
    })
  }
  for (const p of presences) {
    // Rattachée par le NOM de la tranche : `PresenceAffichee` ne porte pas
    // l'identifiant du bloc, et une tranche retirée du cabinet n'a plus de
    // colonne. On en ouvre alors une, plutôt que de taire la présence : elle
    // compte dans l'effectif affiché, la cacher rendrait le chiffre faux.
    const colonne = parTranche.find((c) => c.nom === p.tranche)
    if (colonne) colonne.gens.push(p)
    else
      parTranche.push({
        cle: `hors-${p.tranche}`,
        nom: p.tranche,
        heures: p.heures,
        posable: null,
        gens: [p],
      })
  }

  const ferie = estJourFerie(jour.date)
  const passe = jour.date < today
  const placesTenues = jour.gardes.flatMap((g) =>
    g.places.filter((p) => p.vetId).map((p) => ({ garde: g, place: p })),
  )
  const trous = jour.gardes.reduce((s, g) => s + g.manque, 0)

  /** Qui peut encore être posé sur cette tranche ? */
  function posablesSur(t: TranchePosable) {
    return equipe.filter(
      (v) => !presences.filter((p) => p.vetId === v.id).some((p) => recouvre(p, t)),
    )
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
      //    et c'est justement pour ça qu'un simple « Présence ajoutée » serait
      //    trompeur : il répondrait à côté de ce que l'administratrice avait
      //    besoin de savoir.
      if (r.avertissement) toast.warning(r.avertissement)
      else toast.success(r.message)
      setAjoutSur(null)
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

        {/* ══ LE BANDEAU DE SYNTHÈSE ════════════════════════════════════════
            🔴 LA GARDE Y A ÉTÉ REMONTÉE LE 16/10. MiKL : « les infos de garde
               devraient se retrouver en haut avec le reste des infos ». Elle
               occupait une section à elle en bas de fenêtre, alors que « qui
               est de garde » est une information de SYNTHÈSE — on la lit en
               même temps que l'effectif, pas après avoir fait défiler.

            ⚠️ Les chiffres restent NEUTRES, sans seuil : le minimum d'effectif
               n'existe pas au schéma et MiKL l'a écarté le 06/10. */}
        <div className="jdb-synthese">
          <span className="jdb-eff">
            <b>{jour.journee?.personnes ?? 0}</b> au cabinet
          </span>
          <span className="jdb-eff">
            <b>{effectifs.matin}</b> le matin
          </span>
          <span className="jdb-eff">
            <b>{effectifs.apresMidi}</b> l’après-midi
          </span>

          <span className="jdb-nuit">
            <span className="jdb-nuit-ico" aria-hidden="true">
              🌙
            </span>
            {placesTenues.length === 0 && trous === 0 ? (
              <span className="jdb-nuit-vide">aucune garde</span>
            ) : (
              placesTenues.map(({ garde, place }) => (
                <span className="jdb-tenue" key={`${garde.id}-${place.index}`}>
                  <span className="vdot" style={stylePoint(place.couleur)} aria-hidden="true" />
                  <span className="jdb-prenom">{place.prenom}</span>
                  <small>{place.role}</small>
                  {/* Le cadenas, en ligne : un clic, pas un formulaire. C'est
                      le MÊME bouton que la grille — rendu par l'appelant. */}
                  {place.vetId &&
                    rendreCadenas?.(garde, place.vetId, vetsFiges(garde.id).has(place.vetId))}
                </span>
              ))
            )}
            {trous > 0 && (
              <span className="jdb-manque">
                {trous} place{trous > 1 ? 's' : ''} à pourvoir
              </span>
            )}
            {/* ⋯ plutôt qu'un bouton « Ouvrir la garde » : l'action existe, et
                elle ne coûte plus la largeur d'un libellé. */}
            {onOuvrirGarde && jour.gardes.length > 0 && (
              <button
                type="button"
                className="jdb-ico"
                onClick={() => onOuvrirGarde(jour.gardes[0].id, jour.date)}
                aria-label="Ouvrir le détail de la garde"
                title="Ouvrir la garde — réattribuer, échanger"
              >
                ⋯
              </button>
            )}
          </span>
        </div>

        {/* ══ CE QUI MANQUE À L'APPEL, EN TÊTE ══════════════════════════════
            🔴 REMONTÉ LE 16/10, et c'est la moitié visible du correctif
               B-165b. L'information existait — en bas de fenêtre, après deux
               écrans de défilement. Une information qu'il faut aller chercher
               ne prévient personne. */}
        {jour.absences.length > 0 && (
          <div className="jdb-absents" role="status">
            <b>Absents</b>
            {jour.absences.map((a, i) => (
              <span className="jdb-absent" key={`${a.vetId ?? 'x'}-${i}`} title={phraseIndispo(a)}>
                {a.prenom}
                <small>
                  {phrasePerimetre(
                    lirePerimetre(a.perimetre),
                    a.heureDebut && a.heureFin
                      ? { heure_debut: a.heureDebut, heure_fin: a.heureFin }
                      : null,
                  ) ?? 'toute la journée'}
                </small>
              </span>
            ))}
          </div>
        )}

        {/* ══ LES TRANCHES ══════════════════════════════════════════════════
            🔴 REFONDU LE 16/10. MiKL : « à 2 écrans ça marche, à 3 ça marche
               plus visuellement » — captures à l'appui : « Anne-Sophie » se
               coupait en deux lignes et « posée à la main » en trois, parce
               que le bouton « Retirer » mangeait la moitié de la carte.

            ➜ Le bouton devient une ICÔNE, l'origine passe en infobulle, et la
               grille n'impose plus de largeur minimale : les colonnes se
               partagent la place à égalité et passent à la ligne au-delà de
               trois. */}
        <div className="jdb-colonnes">
          {parTranche.map((c) => (
            <section className="jdb-colonne" key={c.cle}>
              <header className="jdb-col-tete">
                <b>{c.nom}</b>
                {c.heures && <span className="jdb-heures">{c.heures}</span>}
                <span className="jdb-compte">{c.gens.length}</span>
              </header>

              {c.gens.length === 0 ? (
                <p className="jdb-col-vide">personne</p>
              ) : (
                <ul className="jdb-gens">
                  {c.gens.map((p) => {
                    const ind = indispoDe(p.vetId)
                    return (
                      <li
                        key={p.id}
                        className={p.anomalie ? 'jdb-gen a-verifier' : 'jdb-gen'}
                        title={
                          p.anomalie
                            ? `${p.deLaTrame ? 'Par sa récurrence' : 'Posée à la main'} · ${p.anomalie}`
                            : p.deLaTrame
                              ? 'Par sa récurrence'
                              : 'Posée à la main'
                        }
                      >
                        <span
                          className="vdot"
                          style={stylePoint(p.couleur)}
                          aria-hidden="true"
                        />
                        <span className="jdb-prenom">{p.prenom}</span>
                        {/* 🔴 LE SIGNAL QUI MANQUAIT, SUR LA LIGNE MÊME. */}
                        {ind && (
                          <span className="jdb-alerte" title={phraseIndispo(ind)} aria-label={phraseIndispo(ind)}>
                            !
                          </span>
                        )}
                        {peutPoser && (
                          <button
                            type="button"
                            className="jdb-ico retirer"
                            disabled={enCours}
                            onClick={() => retirer(p.id)}
                            aria-label={`Retirer ${p.prenom} de ${c.nom}`}
                            title="Retirer cette présence"
                          >
                            −
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              {/* Le `+` ne coûte qu'une ligne tant qu'on ne l'ouvre pas —
                  « si on a besoin de générer une action, soit on envisage des
                  icônes ou des ouvertures de section » (MiKL, 16/10). */}
              {peutPoser && periodeId && c.posable && (
                <>
                  <button
                    type="button"
                    className={ajoutSur === c.cle ? 'jdb-plus ouvert' : 'jdb-plus'}
                    disabled={enCours}
                    onClick={() => setAjoutSur((a) => (a === c.cle ? null : c.cle))}
                    aria-expanded={ajoutSur === c.cle}
                    aria-label={`Ajouter quelqu’un sur ${c.nom}`}
                  >
                    {ajoutSur === c.cle ? '×' : '+'}
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
                              {/* 🔴 LE MARQUAGE AU MOMENT DU CHOIX. Le serveur
                                  avertit après coup (B-165b) ; ici on le dit
                                  AVANT, pendant qu'il est encore temps. */}
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
        </div>

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

        {/* ══ LE PIED : LES GESTES LOURDS, EN UN BOUTON ═════════════════════
            🔴 LES SEPT PRÉNOMS ONT DISPARU LE 16/10. `CriseModal` propose déjà
               le choix de la personne (`vetDefautId` est optionnel) : les
               répéter ici coûtait deux lignes de hauteur permanente pour un
               geste qui a déjà son formulaire. */}
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
          <span className="jdb-aide">
            {peutPoser
              ? '− retire · + ajoute · ← → changent de journée'
              : 'Consultation seule · ← → changent de journée'}
          </span>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
