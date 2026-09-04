'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, AlertTriangle, ArrowLeftRight, ArrowUpDown, Lock, Wrench, UserMinus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import type { GardeDenormalisee } from '@/types'
import type { VetDispo, DisponibilitesData } from '@/app/api/gardes/[id]/disponibilites/route'
import { libelleTypeGardeDb } from '@/lib/libelles-gardes'
import { placesDeGarde, vetsDeGarde } from '@/lib/gardes/places'
import { ViolationDialog } from './ViolationDialog'
import { stylePastille, stylePoint } from '@/lib/couleurs'
import { sansCodeTechnique } from '@/lib/regles/sansCodeTechnique'

// ── Types ────────────────────────────────────────────────

interface GardeDetailModalProps {
  garde: GardeDenormalisee | null
  date: string | null
  isAdmin: boolean
  /** Id du véto connecté — pour « proposer un échange » sur SES gardes. */
  moiVetId?: string
  /** Libellés du catalogue (code → nom) pour les types sur-mesure (P3b). */
  nomsTypes?: Record<string, string>
  onClose: () => void
  onSaved: () => void
  /**
   * Admin : déclarer le véto assigné comme absent (gestion de crise). Reçoit la
   * date de la garde et l'id du véto. Absent → bouton masqué.
   */
  onDeclarerAbsent?: (date: string, vetId: string) => void
}

// ── Helpers ──────────────────────────────────────────────

function formatDateLongue(dateISO: string): string {
  return new Date(dateISO + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function labelTypeGarde(type: string, nomsTypes?: Record<string, string>): string {
  if (type === 'weekend') return 'Week-end (sam → lun)'
  if (type === 'ferie') return 'Jour férié'
  if (type === 'semaine') return 'Garde de semaine (soir)'
  // Type SUR-MESURE (P3b) : nom du catalogue, sinon code humanisé.
  return libelleTypeGardeDb(type, nomsTypes)
}

/** Les trois états de disponibilité, dans l'ordre où la maquette les trie. */
type Tone = 'vert' | 'ambre' | 'rouge'
const ORDRE_TONE: Record<Tone, number> = { vert: 0, ambre: 1, rouge: 2 }

function toneDe(dispo: { ok: boolean; warning?: string }): Tone {
  if (!dispo.ok) return 'rouge'
  return dispo.warning ? 'ambre' : 'vert'
}

/**
 * Retire le préfixe technique des messages de règle.
 *
 * Délègue à la source unique (B-053) : la copie locale ne connaissait que
 * `R\d+ : ` et laissait donc passer `ESPACEMENT : `, `FREQ_WE : `, `R3/R5 : `.
 */
const sansCodeRegle = (texte?: string): string => sansCodeTechnique(texte)

/**
 * Le SEUL geste qu'un vétérinaire peut poser sur une garde depuis le planning :
 * proposer un échange, sur une des SIENNES, tant qu'elle est encore à venir.
 *
 * ⚠️ Exporté exprès, et utilisé par les DEUX bouts : la grille s'en sert pour
 * décider si une ligne est cliquable, la modale pour décider si le bouton
 * existe. Deux tests séparés finiraient par diverger, et la divergence a une
 * seule forme possible — une case qui ouvre une fenêtre sans aucune action,
 * c'est-à-dire un bouton qui ne fait rien.
 *
 * `vetsDeGarde` plutôt que `premier_id`/`second_id` : un créneau sur-mesure
 * peut compter jusqu'à quatre places, et le titulaire d'une 3e place a
 * exactement les mêmes raisons de vouloir échanger.
 */
export function peutProposerUnEchange(
  garde: GardeDenormalisee | null | undefined,
  moiVetId: string | undefined,
  aujourdHui: string,
): boolean {
  if (!garde || !moiVetId) return false
  // Non publiée : le véto n'est pas censé la connaître. Passée ou verrouillée :
  // il n'y a plus rien à échanger.
  if (garde.periode_statut !== 'publie') return false
  if (garde.date <= aujourdHui) return false
  if (garde.verrouille) return false
  return vetsDeGarde(garde).includes(moiVetId)
}

// ── Une place de garde : qui la tient, et de quoi en changer ──

function PlaceGarde({
  label,
  role,
  vets,
  selected,
  onSelect,
  modeEdition,
  ouvert,
  onToggle,
  typeGarde,
  partenaireId,
  onDeclarerAbsent,
}: {
  label: string
  role: 'premier' | 'second'
  vets: VetDispo[]
  selected: string | null
  onSelect: (id: string | null) => void
  modeEdition: boolean
  /** La liste des vétérinaires est-elle dépliée pour cette place ? */
  ouvert: boolean
  onToggle: () => void
  typeGarde: string
  /** Véto tenant l'AUTRE place ce jour-là — il n'est pas proposé ici. */
  partenaireId: string | null
  /** Admin, garde publiée : signaler l'absence de celui qui tient la place. */
  onDeclarerAbsent?: (vetId: string) => void
}) {
  const titulaire = vets.find((v) => v.id === selected) ?? null

  // Les disponibles d'abord : le bon choix saute aux yeux (maquette).
  const lignes = vets
    .filter((v) => v.id !== partenaireId)
    .map((v) => ({ v, tone: toneDe(role === 'premier' ? v.dispo_premier : v.dispo_second) }))
    .sort((a, b) => ORDRE_TONE[a.tone] - ORDRE_TONE[b.tone])

  return (
    <div className={`gm-section${modeEdition ? '' : ' disabled'}`}>
      <div className="gm-slot-row">
        <span className="gm-slot-label">{label}</span>

        {titulaire ? (
          <span className="gm-current">
            <span className="dot" style={stylePastille(titulaire.couleur)}>
              {titulaire.prenom.charAt(0)}
            </span>
            <span className="gm-nom">{titulaire.prenom} {titulaire.nom}</span>
          </span>
        ) : (
          <span className="gm-current none">Aucun · à pourvoir</span>
        )}

        {/* ── B-113 · LES COMMANDES SONT GROUPÉES, JAMAIS DISPERSÉES ──
            MiKL, 04/09 : sur sa capture, « Réattribuer » était sur une ligne
            en dessous du nom pour le 1er de garde, et sur la même ligne pour
            le 2nd. Les deux places passent pourtant par CE composant : la
            différence ne venait pas de la construction mais du `flex-wrap`,
            qui cassait la ligne dès que le prénom-nom était un peu long.
            Le défaut se serait donc déplacé d'un vétérinaire à l'autre.

            Les actions vivent maintenant dans un bloc à part, poussé à
            droite et insécable. C'est le NOM qui cède (troncature), jamais
            les boutons : un nom coupé reste lisible, un bouton qui saute de
            ligne fait douter de l'écran entier. */}
        <div className="gm-slot-actions">
          {onDeclarerAbsent && titulaire && (
            <button
              type="button"
              className="gm-absent-link"
              title={`Déclarer ${titulaire.prenom} absent·e`}
              onClick={() => onDeclarerAbsent(titulaire.id)}
            >
              <UserMinus className="w-3.5 h-3.5" />
              Absent·e
            </button>
          )}

          {modeEdition && (
            <button
              type="button"
              className="gm-reassign"
              aria-expanded={ouvert}
              onClick={onToggle}
            >
              {ouvert ? 'Fermer' : 'Réattribuer'}
            </button>
          )}
        </div>
      </div>

      {modeEdition && ouvert && (
        <>
          <ul className="av-list">
            {lignes.map(({ v, tone }) => {
              const dispo = role === 'premier' ? v.dispo_premier : v.dispo_second
              const raison = sansCodeRegle(dispo.raison ?? dispo.warning)
              // L'impact compteur : ce que ce choix ferait au total. Seul le
              // décompte des week-ends nous est renvoyé — on ne l'affiche donc
              // que là, plutôt que d'inventer un chiffre pour les autres types.
              const impact =
                typeGarde === 'weekend' && tone !== 'rouge'
                  ? `${v.nb_gardes_we_mois} → ${v.nb_gardes_we_mois + 1} WE`
                  : ''
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    className={`av-row ${tone}`}
                    aria-current={selected === v.id ? 'true' : undefined}
                    onClick={() => onSelect(v.id)}
                  >
                    <span className="dot" style={stylePoint(v.couleur)} />
                    <span>{v.prenom} {v.nom}</span>
                    <span className={`av-state ${tone}`}>●</span>
                    <span className="av-reason">{raison || 'Disponible'}</span>
                    <span className="av-count">{impact}</span>
                  </button>
                </li>
              )
            })}
            <li>
              <button
                type="button"
                className="av-row"
                aria-current={selected === null ? 'true' : undefined}
                onClick={() => onSelect(null)}
              >
                <span className="dot none" />
                <span>Aucun</span>
                <span className="av-state">·</span>
                <span className="av-reason">Laisser la place à pourvoir</span>
                <span className="av-count" />
              </button>
            </li>
          </ul>

          <p className="av-legende">
            <span><i style={{ background: 'var(--ok)' }} /> Disponible</span>
            <span><i style={{ background: 'var(--warn)' }} /> Sous réserve</span>
            <span><i style={{ background: 'var(--danger)' }} /> Indisponible</span>
          </p>
        </>
      )}
    </div>
  )
}

// ── Modal principale ─────────────────────────────────────

export function GardeDetailModal({ garde, date, isAdmin, moiVetId, nomsTypes, onClose, onSaved, onDeclarerAbsent }: GardeDetailModalProps) {
  const router = useRouter()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState<DisponibilitesData | null>(null)
  const [premierSel, setPremierSel] = useState<string | null>(null)
  const [secondSel, setSecondSel] = useState<string | null>(null)
  const [correctionMode, setCorrectionMode] = useState(false)
  // Backlog 8 bis — les deux questions du remplacement d'un seul jour. `null`
  // = pas encore répondu, et c'est volontaire : ni l'une ni l'autre n'a de
  // défaut raisonnable. Pré-cocher « tout le week-end » réattribuerait trois
  // jours à l'insu de l'admin ; pré-cocher l'avantage financier déciderait
  // d'une question de paie à sa place.
  const [perimetre, setPerimetre] = useState<'jour' | 'bloc' | null>(null)
  const [compte1erWe, setCompte1erWe] = useState<boolean | null>(null)
  const [showCorriger, setShowCorriger] = useState(false)
  // Une seule liste de vétérinaires dépliée à la fois : on ne change qu'une
  // place à la fois, et la modale reste courte (maquette).
  const [placeOuverte, setPlaceOuverte] = useState<'premier' | 'second' | null>(null)
  // Violation de règle à confirmer avant sauvegarde
  const [violation, setViolation] = useState<{
    type: 'dure' | 'souple'
    message: string
    vetPrenom: string
  } | null>(null)
  // Avertissements métier renvoyés par le SERVEUR (véto inactif / en congé
  // validé) — garde-fou au moment de l'écriture (backlog n°12). À confirmer.
  const [avertServeur, setAvertServeur] = useState<string[] | null>(null)

  const isOpen = date !== null

  useEffect(() => {
    if (!garde || !isOpen) return
    // ⛔ ON N'INTERROGE PAS `/api/gardes/[id]/disponibilites` POUR UN VÉTO.
    //
    // Cette route ne lui sert AUCUNE ligne de `vets` — la liste porte les
    // raisons d'indisponibilité de toute l'équipe, réservées à l'admin (D8).
    // La modale s'en servait quand même pour retrouver qui tient la place :
    // avec une liste vide, elle affichait « Aucun · à pourvoir » sur une garde
    // que la grille montrait pourvue (constat MiKL du 2026-08-20). Un écran qui
    // se contredit lui-même est pire qu'un écran qui se tait.
    //
    // Tout ce dont la vue lecture seule a besoin (titulaires, verrouillage,
    // statut de période) est DÉJÀ dans `garde`, servi par `planning_semaine` —
    // la même source que la case du calendrier, donc aucune divergence possible.
    if (!isAdmin) return
    // Réinitialisation volontaire de l'état à chaque ouverture de la modale,
    // juste avant de recharger les disponibilités de la garde sélectionnée.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true)
    setData(null)
    setCorrectionMode(false)
    setShowCorriger(false)
    setPlaceOuverte(null)
    // Les deux questions du backlog 8 bis repartent SANS réponse à chaque
    // ouverture : garder celle de la garde précédente, c'est appliquer au
    // dimanche suivant un choix fait pour un autre week-end.
    setPerimetre(null)
    setCompte1erWe(null)
    /* eslint-enable react-hooks/set-state-in-effect */

    fetch(`/api/gardes/${garde.id}/disponibilites`)
      .then((r) => r.json())
      .then((d: DisponibilitesData) => {
        setData(d)
        setPremierSel(d.garde.premier_id)
        setSecondSel(d.garde.second_id)
      })
      .catch(() => toast.error('Impossible de charger les disponibilités.'))
      .finally(() => setLoading(false))
    // On ne dépend que de l'id de la garde (pas de l'objet entier) pour éviter
    // un rechargement à chaque changement de référence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garde?.id, isOpen])

  function handleClose() {
    setData(null)
    onClose()
  }

  /** Vérifie si un vet sélectionné viole une règle (comparé à l'attribution originale) */
  function detecterViolation(): { type: 'dure' | 'souple'; message: string; vetPrenom: string } | null {
    if (!data) return null

    // Vérification premier de garde
    if (premierSel && premierSel !== data.garde.premier_id) {
      const vet = data.vets.find((v) => v.id === premierSel)
      if (vet) {
        if (!vet.dispo_premier.ok && vet.dispo_premier.raison) {
          return {
            type: 'dure',
            message: sansCodeRegle(vet.dispo_premier.raison),
            vetPrenom: vet.prenom,
          }
        }
        if (vet.dispo_premier.warning) {
          return {
            type: 'souple',
            message: sansCodeRegle(vet.dispo_premier.warning),
            vetPrenom: vet.prenom,
          }
        }
      }
    }

    // Vérification second de garde (si visible)
    if (!masquerSecond && secondSel && secondSel !== data.garde.second_id) {
      const vet = data.vets.find((v) => v.id === secondSel)
      if (vet) {
        if (!vet.dispo_second.ok && vet.dispo_second.raison) {
          return {
            type: 'dure',
            message: sansCodeRegle(vet.dispo_second.raison),
            vetPrenom: vet.prenom,
          }
        }
        if (vet.dispo_second.warning) {
          return {
            type: 'souple',
            message: sansCodeRegle(vet.dispo_second.warning),
            vetPrenom: vet.prenom,
          }
        }
      }
    }

    return null
  }

  async function performSave(confirmerAvertissements = false) {
    if (!garde) return
    setSaving(true)
    try {
      const res = await fetch(`/api/gardes/${garde.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // En périmètre JOUR, ce sont les rôles AFFICHÉS ce jour-là qui
          // partent (le vendredi peut être inversé) ; en périmètre BLOC, les
          // rôles natifs de la garde, comme avant.
          premier_id: perimetre === 'jour' ? premierDuJour : premierSel,
          second_id: perimetre === 'jour' ? secondDuJour : secondSel,
          force: correctionMode,
          confirmerAvertissements,
          // Absent = bloc, soit exactement le comportement d'avant.
          perimetre: perimetre ?? 'bloc',
          jour: jourAffiche,
          compte1erWe: compte1erWe === true,
        }),
      })
      const json = await res.json()
      // Garde-fou serveur (backlog n°12) : véto inactif / en congé validé →
      // 409 avec la liste des avertissements. On les affiche pour confirmation.
      if (res.status === 409 && json?.needsConfirmation) {
        setAvertServeur(Array.isArray(json.warnings) && json.warnings.length > 0
          ? json.warnings
          : [json.error ?? 'Affectation à confirmer.'])
        return
      }
      if (!res.ok) { toast.error(json.error ?? 'Erreur lors de la sauvegarde.'); return }
      toast.success('Garde mise à jour.')
      onSaved()
      router.refresh()
      handleClose()
    } catch {
      toast.error('Impossible de joindre le serveur.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    // Garde-fou immédiat : le même véto ne peut pas être 1er ET 2nd
    if (premierSel && secondSel && premierSel === secondSel) {
      toast.error('Le même vétérinaire ne peut pas être à la fois 1er et 2nd de garde.')
      return
    }
    // Backlog 8 bis — les deux questions doivent avoir une réponse. On refuse
    // d'enregistrer plutôt que de choisir un défaut : « tout le week-end » et
    // « ce seul jour » n'ont pas du tout les mêmes conséquences, et l'admin
    // ne verrait la différence qu'après coup.
    if (estBlocMultiJours && perimetre === null) {
      toast.error('Précisez si le changement concerne ce seul jour ou tout le week-end.')
      return
    }
    if (perimetre === 'jour' && premierChange && compte1erWe === null) {
      toast.error('Précisez si ce jour compte comme un jour de 1er de garde.')
      return
    }
    const v = detecterViolation()
    if (v) {
      setViolation(v)
      return
    }
    await performSave()
  }

  // Effectif configurable : on masque le 2nd seulement si la nuit de semaine est
  // à 1 véto (repli saison été) ET qu'aucun 2nd n'a été généré. Si un 2nd existe
  // (période avec effectif semaine forcé à 2), on l'affiche même en été.
  // Type SUR-MESURE (P3b) : un créneau à 1 place n'a pas de 2nd → masqué aussi.
  const estTypeV1 = ['semaine', 'weekend', 'ferie'].includes(data?.garde.type ?? '')
  const masquerSecond =
    (data?.garde.saison === 'ete' && data?.garde.type === 'semaine' && !data?.garde.second_id)
    || (!estTypeV1 && !data?.garde.second_id)
  // Le verrouillage vient de l'API pour l'admin, et de la garde affichée pour
  // le véto (même colonne, deux chemins) : la modale véto ne fait plus d'appel.
  const estVerrouille = data?.garde.verrouille ?? garde?.verrouille ?? false
  const modeEdition = isAdmin && (!estVerrouille || correctionMode)

  // ── Backlog 8 bis : le jour, et le bloc ──────────────────
  //
  // `garde.date` vient de la vue `planning_semaine` : c'est le jour CLIQUÉ au
  // calendrier (le dimanche, si on a cliqué dimanche). `data.garde.date`, lui,
  // vient de la table et vaut toujours le samedi. Les confondre, c'est poser
  // l'exception sur le mauvais jour — ou proposer de modifier « le samedi »
  // à quelqu'un qui a cliqué sur le dimanche.
  const jourAffiche = date ?? garde?.date ?? ''
  const estBlocMultiJours = (data?.garde.type ?? garde?.type) === 'weekend'

  // ⚠️ DEUX RÉFÉRENTIELS DE RÔLES, et il ne faut pas les confondre.
  //
  // Les listes de cette modale (`premierSel` / `secondSel`) portent les rôles
  // NATIFS, ceux de la ligne `gardes`. Mais le vendredi s'affiche au
  // calendrier avec les rôles INVERSÉS quand le cabinet l'a configuré ainsi :
  // le 1er du week-end y est 2nd, et réciproquement.
  //
  // Tant qu'on modifiait le bloc entier, aucune importance — on écrivait dans
  // la garde, en natif. Une exception, elle, porte sur le rôle TEL QU'IL
  // S'AFFICHE ce jour-là. Envoyer le rôle natif un vendredi inversé
  // remplacerait donc l'autre personne que celle sur laquelle l'admin a
  // cliqué. On détecte l'inversion en croisant ce que montre la vue (`garde`,
  // issue de `planning_semaine`) avec le natif (`data.garde`, issu de la
  // table).
  const estVendrediDuBloc = Boolean(
    data?.garde.date && jourAffiche && jourAffiche < data.garde.date,
  )
  const rolesInversesCeJour = Boolean(
    estVendrediDuBloc &&
      garde?.premier_id &&
      data?.garde.second_id &&
      garde.premier_id === data.garde.second_id,
  )
  /** Qui tiendra le rôle affiché « 1er de garde » ce jour-là. */
  const premierDuJour = rolesInversesCeJour ? secondSel : premierSel
  const secondDuJour = rolesInversesCeJour ? premierSel : secondSel
  const premierChange = premierDuJour !== (garde?.premier_id ?? null)

  // Places 3 et 4 (créneaux sur-mesure). Elles viennent de la garde affichée
  // dans la grille, pas de l'API de disponibilités : celle-ci ne raisonne
  // qu'en « premier / second ».
  const placesSup = [...(garde?.places_sup ?? [])]
    .filter((p) => p.place_index >= 2)
    .sort((a, b) => a.place_index - b.place_index)

  // Véto : « proposer un échange » sur SA garde (publiée, future, non
  // verrouillée). Le test vit dans `peutProposerUnEchange`, partagé avec la
  // grille — c'est lui qui décide aussi qu'une case est cliquable, donc une
  // modale ouverte a forcément ce bouton.
  const aujourdHui = new Date().toISOString().slice(0, 10)
  const peutProposerEchange = !isAdmin && peutProposerUnEchange(garde, moiVetId, aujourdHui)

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose() }}>
        <DialogContent className="gv-modale">
          <DialogHeader>
            {garde && (
              <p className="gm-kicker">{labelTypeGarde(garde.type, nomsTypes)}</p>
            )}
            <DialogTitle className="capitalize">
              {date && formatDateLongue(date)}
            </DialogTitle>
            {/* Les badges disent l'état INTERNE du planning — verrouillage,
                retouche manuelle, brouillon. C'est le vocabulaire de celle qui
                prépare le planning, pas de celui qui le subit : un véto n'a
                rien à faire de « Modifiée à la main », et « Verrouillée » lui
                annonce une porte qu'on ne lui a jamais proposé d'ouvrir. */}
            {garde && isAdmin && (
              <div className="gm-badges">
                {garde.periode_statut === 'publie' && (
                  <span className="gm-badge publie">● Publiée</span>
                )}
                {garde.periode_statut === 'brouillon' && (
                  <span className="gm-badge brouillon">● Brouillon</span>
                )}
                {estVerrouille && <span className="gm-badge lock">🔒 Verrouillée</span>}
                {garde.modifie_manuellement && (
                  <span className="gm-badge warn">✎ Modifiée à la main</span>
                )}
              </div>
            )}
          </DialogHeader>

          {!garde && <p className="text-sm text-muted-foreground py-4">Aucune garde planifiée ce jour.</p>}

          {/* ── La garde vue par un vétérinaire ───────────────────────
                 Qui est de garde, et rien d'autre. Les places viennent de
                 `placesDeGarde`, exactement comme la case du calendrier : c'est
                 ce qui garantit que la modale ne pourra jamais raconter autre
                 chose que la grille dont elle sort. Aucun réglage n'est
                 affiché — pas même grisé : proposer un geste impossible est
                 une promesse en l'air. */}
          {garde && !isAdmin && (
            <div className="gm-lecture">
              {placesDeGarde(garde).map((p) => (
                <div className="gm-section lecture" key={p.index}>
                  <div className="gm-slot-row">
                    <span className="gm-slot-label">
                      {placesDeGarde(garde).length > 1 ? `${p.role} de garde` : 'De garde'}
                    </span>
                    <span className="gm-current">
                      <span className="dot" style={stylePastille(p.couleur)}>
                        {(p.prenom ?? '?').charAt(0)}
                      </span>
                      <span className="gm-nom">{p.prenom} {p.nom}</span>
                      {p.vetId === moiVetId && <em className="gm-moi">— toi</em>}
                    </span>
                  </div>
                </div>
              ))}
              {placesDeGarde(garde).length === 0 && (
                <p className="text-sm text-muted-foreground py-2">
                  Personne n’est encore affecté à cette garde.
                </p>
              )}
            </div>
          )}

          {garde && isAdmin && loading && (
            <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Chargement…
            </div>
          )}

          {garde && data && !loading && (
            <>
              {/* ── Garde verrouillée : l'encart, et sa confirmation EN LIGNE.
                     La maquette confirme ici plutôt que dans une seconde
                     pop-up par-dessus la première — même garde-fou, une
                     fenêtre de moins à l'écran. ──────────────────────── */}
              {estVerrouille && isAdmin && !correctionMode && (
                <div className="lock-encart">
                  <b><Lock className="inline w-3.5 h-3.5 mb-0.5" /> Cette garde est verrouillée</b>{' '}
                  : elle est passée, ou les vétérinaires en ont déjà été notifiés. On ne la
                  modifie pas par accident.
                  {!showCorriger ? (
                    <div className="reform-actions">
                      <button type="button" className="btn btn-corriger" onClick={() => setShowCorriger(true)}>
                        <Wrench className="w-3.5 h-3.5 mr-1.5" />
                        Corriger cette garde
                      </button>
                    </div>
                  ) : (
                    <div className="lock-confirm">
                      Les vétérinaires concernés seront prévenus de la correction, et Google
                      Agenda resynchronisé. On continue ?
                      <div className="reform-actions">
                        <button
                          type="button"
                          className="btn btn-valider"
                          onClick={() => { setCorrectionMode(true); setShowCorriger(false) }}
                        >
                          Oui, corriger
                        </button>
                        <button type="button" className="btn btn-corriger" onClick={() => setShowCorriger(false)}>
                          Annuler
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {estVerrouille && correctionMode && (
                <div className="lock-encart">
                  <b>🔓 Correction ouverte</b> · les vétérinaires seront prévenus à
                  l’enregistrement.
                </div>
              )}

              {/* ── Périmètre du changement (backlog 8 bis) ───
                  Une garde de week-end occupe trois jours du calendrier.
                  Avant de savoir QUI remplace, il faut savoir SUR QUOI porte
                  le remplacement : ce seul jour, ou le bloc entier. La
                  question est posée sans réponse pré-cochée — un défaut
                  déciderait à la place de l'admin, et il ne s'en rendrait
                  compte qu'une fois le week-end entier réattribué. */}
              {modeEdition && estBlocMultiJours && (
                <div className="gm-section perimetre-choix">
                  <p className="gm-label">Ce changement concerne…</p>
                  <label className="perimetre-option">
                    <input
                      type="radio"
                      name="perimetre"
                      checked={perimetre === 'jour'}
                      onChange={() => setPerimetre('jour')}
                    />
                    <span>
                      <b>ce seul jour</b> — {formatDateLongue(jourAffiche)}
                      <small>
                        Exceptionnel. Le reste du week-end ne bouge pas, et les
                        compteurs non plus.
                      </small>
                    </span>
                  </label>
                  <label className="perimetre-option">
                    <input
                      type="radio"
                      name="perimetre"
                      checked={perimetre === 'bloc'}
                      onChange={() => { setPerimetre('bloc'); setCompte1erWe(null) }}
                    />
                    <span>
                      <b>tout le week-end</b>, vendredi compris
                      <small>
                        Réattribution ordinaire. Les compteurs et l’équité
                        suivent.
                      </small>
                    </span>
                  </label>
                </div>
              )}

              {/* ── Les places de garde ─────────────────────── */}
              <PlaceGarde
                label="1er de garde"
                role="premier"
                vets={data.vets}
                selected={premierSel}
                onSelect={(id) => { setPremierSel(id); setPlaceOuverte(null) }}
                modeEdition={modeEdition}
                ouvert={placeOuverte === 'premier'}
                onToggle={() => setPlaceOuverte((p) => (p === 'premier' ? null : 'premier'))}
                typeGarde={garde.type}
                partenaireId={masquerSecond ? null : secondSel}
                onDeclarerAbsent={
                  onDeclarerAbsent && garde.periode_statut === 'publie'
                    ? (vetId) => onDeclarerAbsent(garde.date, vetId)
                    : undefined
                }
              />

              {/* ── B-076 · ÉCHANGER LES DEUX RÔLES D'UN GESTE ──────────────
                  MiKL, 27/08 : « rajouter la fonction alterner pour éviter de
                  changer manuellement un par un les 1er et 2nd ».

                  Le geste était possible, mais coûtait deux réattributions
                  successives en retenant de tête qui était où — et c'est
                  précisément la correction la plus fréquente, puisque le défaut
                  le plus signalé par Filou est « X n'est jamais premier du
                  week-end ».

                  ⚠️ Il ENREGISTRE RIEN : il échange les deux sélections, et
                  l'admin voit le résultat avant de valider. L'inversion passe
                  donc par les mêmes gardiens que n'importe quelle retouche —
                  aucun raccourci, aucun chemin d'écriture de plus (leçon des
                  « trois chemins d'écriture, deux gardiens », 22/08).

                  Sur un week-end, le périmètre choisi plus haut fait le reste :
                  « tout le week-end » inverse le bloc vendredi compris, « ce
                  seul jour » ne touche que ce jour. */}
              {modeEdition && !masquerSecond && (premierSel || secondSel) && (
                <button
                  type="button"
                  className="gm-alterner"
                  onClick={() => {
                    const avant = premierSel
                    setPremierSel(secondSel)
                    setSecondSel(avant)
                    setPlaceOuverte(null)
                  }}
                >
                  <ArrowUpDown className="w-3.5 h-3.5" aria-hidden />
                  Alterner les deux rôles
                </button>
              )}

              {!masquerSecond && (
                <PlaceGarde
                  label="2nd de garde"
                  role="second"
                  vets={data.vets}
                  selected={secondSel}
                  onSelect={(id) => { setSecondSel(id); setPlaceOuverte(null) }}
                  modeEdition={modeEdition}
                  ouvert={placeOuverte === 'second'}
                  onToggle={() => setPlaceOuverte((p) => (p === 'second' ? null : 'second'))}
                  typeGarde={garde.type}
                  partenaireId={premierSel}
                  onDeclarerAbsent={
                    onDeclarerAbsent && garde.periode_statut === 'publie'
                      ? (vetId) => onDeclarerAbsent(garde.date, vetId)
                      : undefined
                  }
                />
              )}

              {/* ── L'avantage financier du 1er de garde (backlog 8 bis) ──
                  Dans ce cabinet, le 1er de garde d'un week-end est payé
                  davantage. Quand quelqu'un ne prend qu'UN jour à la place du
                  titulaire, la question « est-ce que ce jour compte comme un
                  jour de 1er de garde ? » n'a pas de réponse évidente : elle
                  dépend de l'arrangement pris entre les deux. On la POSE donc,
                  au moment du geste, plutôt que de trancher à leur place —
                  et seulement quand elle se pose vraiment : périmètre « jour »
                  et 1er de garde effectivement changé. */}
              {modeEdition && perimetre === 'jour' && premierChange && (
                <div className="gm-section avantage-choix">
                  <p className="gm-label">
                    Ce jour compte-t-il comme un jour de 1er de garde&nbsp;?
                  </p>
                  <p className="gm-hint">
                    C’est le rôle qui porte l’avantage financier du week-end.
                  </p>
                  <label className="perimetre-option">
                    <input
                      type="radio"
                      name="compte1erWe"
                      checked={compte1erWe === true}
                      onChange={() => setCompte1erWe(true)}
                    />
                    <span><b>Oui</b> — jour de 1er de garde exceptionnel</span>
                  </label>
                  <label className="perimetre-option">
                    <input
                      type="radio"
                      name="compte1erWe"
                      checked={compte1erWe === false}
                      onChange={() => setCompte1erWe(false)}
                    />
                    <span><b>Non</b> — un jour comme un autre</span>
                  </label>
                </div>
              )}

              {/* Places 3 et 4 d'un créneau sur-mesure. Elles s'AFFICHENT —
                  ne pas les montrer laisserait croire que la garde n'a que
                  deux vétérinaires. Leur réattribution passe encore par la
                  régénération : le calcul de disponibilité ne connaît que les
                  rôles « premier » et « second ». On le DIT plutôt que de
                  laisser un bouton inerte. */}
              {placesSup.map((p) => (
                <div className="gm-section disabled" key={p.place_index}>
                  <div className="gm-slot-row">
                    <span className="gm-slot-label">
                      {p.role || `${p.place_index + 1}e de garde`}
                    </span>
                    <span className="gm-current">
                      <span className="dot" style={stylePastille(p.couleur)}>
                        {p.prenom.charAt(0)}
                      </span>
                      <span className="gm-nom">{p.prenom} {p.nom}</span>
                    </span>
                    {/* Même groupe d'actions que les places 1 et 2 (B-113) :
                        réparer deux blocs sur trois aurait juste déplacé
                        l'impression d'écran à moitié fini plus bas. */}
                    <div className="gm-slot-actions">
                      {onDeclarerAbsent && garde.periode_statut === 'publie' && (
                        <button
                          type="button"
                          className="gm-absent-link"
                          title={`Déclarer ${p.prenom} absent·e`}
                          onClick={() => onDeclarerAbsent(garde.date, p.id)}
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                          Absent·e
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {placesSup.length > 0 && modeEdition && (
                <p className="av-legende" style={{ borderTop: 'none', paddingTop: 0 }}>
                  Les places au-delà de la deuxième se modifient en régénérant
                  le planning — pas encore à la main depuis cet écran.
                </p>
              )}
            </>
          )}

          <DialogFooter>
            {peutProposerEchange && garde && (
              <Button
                variant="outline"
                className="sm:mr-auto"
                onClick={() => router.push(`/echanges?proposer=${garde.id}`)}
              >
                <ArrowLeftRight className="w-4 h-4 mr-2" />
                Proposer un échange
              </Button>
            )}
            <Button variant="outline" onClick={handleClose} disabled={saving}>
              {modeEdition && garde ? 'Annuler' : 'Fermer'}
            </Button>
            {modeEdition && garde && (
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Enregistrement…</> : 'Enregistrer'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Violation de règle ──────────────────────────── */}
      {violation && (
        <ViolationDialog
          open={!!violation}
          type={violation.type}
          message={violation.message}
          vetPrenom={violation.vetPrenom}
          onAccept={async () => {
            setViolation(null)
            await performSave()
          }}
          onAnnuler={() => setViolation(null)}
        />
      )}

      {/* ── Avertissement métier serveur (véto inactif / en congé) ──
             La confirmation de garde verrouillée, elle, se fait désormais
             dans l'encart de la modale principale : plus de pop-up par-dessus
             la pop-up. ─────────────────────────────────────────────── */}
      <Dialog open={!!avertServeur} onOpenChange={(open) => { if (!open) setAvertServeur(null) }}>
        <DialogContent className="gv-modale">
          <DialogHeader>
            <p className="gm-kicker">Garde · vérification</p>
            <DialogTitle>Affectation à confirmer</DialogTitle>
          </DialogHeader>
          <div className="gf-card souple">
            <p className="gf-title">
              <AlertTriangle className="w-3.5 h-3.5" />
              Ce que la vérification a relevé
            </p>
            {(avertServeur ?? []).map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Veux-tu enregistrer cette affectation malgré tout ?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAvertServeur(null)} disabled={saving}>
              Annuler
            </Button>
            <Button
              disabled={saving}
              onClick={async () => { setAvertServeur(null); await performSave(true) }}
            >
              Enregistrer quand même
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
