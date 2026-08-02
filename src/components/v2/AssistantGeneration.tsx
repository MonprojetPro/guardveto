'use client'

// ============================================================
// GUARDVETO V2 — L'assistant de génération
// ============================================================
// Le bouton « Générer » n'agit plus en aveugle sur la période du mois affiché.
// Il pose d'abord LA question (décision MiKL du 2026-08-02) :
//
//     « Je fais un nouveau planning »   → dates + période type, le planning
//                                         est créé puis rempli dans la foulée
//     « J'en refais un existant »       → on choisit lequel
//
// C'est le seul endroit d'où naît un planning : `/historique` a perdu son
// bouton « + Créer une période ». Raison de fond — vocabulaire acté le
// 2026-08-01 : Historique CONSULTE (qui a fait quoi), Organisation FIXE la
// structure, et le planning est un GESTE, il se déclenche là où on le regarde.
//
// Ce que l'assistant ne fait PAS : les garde-fous de génération (confirmation
// de régénération d'un planning publié, diagnostic d'impasse, pré-vol) restent
// entiers dans `outils-planning.tsx`. Il choisit la cible, il ne décide rien.
// ============================================================

import { useMemo, useState } from 'react'
import { CalendarPlus, RotateCcw, Wand2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import { creerPeriode } from '@/app/(protected)/admin/periodes/actions'
import { estLundi, dureeProposee, finApres } from '@/lib/planning/duree'
import type { Periode, ProfilPlanning } from '@/types'

// Radix Select interdit la valeur vide → sentinelle pour « selon la saison ».
const AUTO = '__auto__'

function dateLongue(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function dateCourte(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function nomPlanning(p: Periode): string {
  return p.libelle ?? `${p.saison === 'ete' ? 'Été' : 'Hiver'} ${p.date_debut.slice(0, 4)}`
}

const STATUT: Record<Periode['statut'], string> = {
  brouillon: 'Brouillon',
  publie: 'Publié',
  verrouille: 'Verrouillé',
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Plannings du cabinet, les plus récents d'abord (déjà scopés par RLS). */
  periodes: Periode[]
  /** Le planning du mois regardé — pré-coché sur la voie « en refaire un ». */
  periodeAffichee: Periode | null
  /** Les périodes types actives du cabinet (`profils_planning`). */
  periodesTypes: ProfilPlanning[]
  /** Lance la génération sur ce planning. L'assistant se ferme avant. */
  onGenerer: (periodeId: string) => void
  /** Après création : aller sur le mois du nouveau planning. */
  onNaviguerVersMois: (anneeMois: string) => void
}

type Etape = 'choix' | 'nouveau' | 'existant'

export function AssistantGeneration({
  open,
  onOpenChange,
  periodes,
  periodeAffichee,
  periodesTypes,
  onGenerer,
  onNaviguerVersMois,
}: Props) {
  const [etape, setEtape] = useState<Etape>('choix')
  const [creation, setCreation] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  // ── Voie « en refaire un existant » ────────────────────
  const [cible, setCible] = useState<string>('')

  // ── Voie « nouveau planning » ──────────────────────────
  const [libelle, setLibelle] = useState('')
  const [debut, setDebut] = useState('')
  const [semaines, setSemaines] = useState<string>('')
  const [datesPrecises, setDatesPrecises] = useState(false)
  const [finSaisie, setFinSaisie] = useState('')
  const [typeChoisi, setTypeChoisi] = useState<string>(AUTO)

  // La durée par défaut suit la saison de la date de départ tant que l'admin
  // n'a rien tapé lui-même : 17 semaines l'été, 12 le reste de l'année.
  const semainesEffectives = semaines === '' ? dureeProposee(debut) : Number(semaines)
  const finCalculee = finApres(debut, semainesEffectives)
  const fin = datesPrecises ? (finSaisie || null) : finCalculee

  const typesProposables = useMemo(
    () => periodesTypes.filter((p) => !p.est_defaut),
    [periodesTypes],
  )

  function reinitialiser() {
    setEtape('choix')
    setErreur(null)
    setCreation(false)
    setLibelle('')
    setDebut('')
    setSemaines('')
    setDatesPrecises(false)
    setFinSaisie('')
    setTypeChoisi(AUTO)
    setCible(periodeAffichee?.id ?? '')
  }

  function fermer(o: boolean) {
    if (creation) return
    onOpenChange(o)
    if (!o) reinitialiser()
  }

  /** Voie « existant » : on ne crée rien, on relance juste le moteur. */
  function genererExistant() {
    if (!cible) return
    onOpenChange(false)
    reinitialiser()
    onGenerer(cible)
  }

  /** Voie « nouveau » : créer le planning PUIS enchaîner la génération. */
  async function creerPuisGenerer() {
    setErreur(null)

    const nom = libelle.trim()
    if (!nom) return setErreur('Donne un nom à ce planning (« Hiver 2027 », « Été P2 »…).')
    if (!debut) return setErreur('Indique le lundi de départ.')
    if (!estLundi(debut)) return setErreur('Un planning commence un lundi — choisis le lundi de la semaine.')
    if (!fin) {
      return setErreur(
        datesPrecises
          ? 'Indique la date de fin.'
          : 'Indique une durée d’au moins une semaine.',
      )
    }
    if (fin < debut) return setErreur('La date de fin doit venir après le lundi de départ.')

    setCreation(true)
    const fd = new FormData()
    fd.set('libelle', nom)
    fd.set('date_debut', debut)
    fd.set('date_fin', fin)
    if (typeChoisi !== AUTO) fd.set('profil_id', typeChoisi)

    const res = await creerPeriode(fd)
    setCreation(false)

    // Un refus reste DANS la modale : chevauchement de dates, jour non lundi,
    // profil étranger… ce sont des explications, pas des notifications qui
    // s'effacent (cf. « les refus en modale, les succès en toast »).
    if ('error' in res && res.error) return setErreur(res.error)
    if (!('id' in res) || !res.id) {
      return setErreur('Le planning a été créé mais reste introuvable — recharge la page.')
    }

    const nouvelId = res.id
    onOpenChange(false)
    reinitialiser()
    // On se place sur le mois de départ AVANT de générer : sinon le planning
    // se remplit hors du champ de vision et l'écran semble n'avoir rien fait.
    onNaviguerVersMois(debut.slice(0, 7))
    onGenerer(nouvelId)
  }

  return (
    <Dialog open={open} onOpenChange={fermer}>
      <DialogContent className="gv-modale">
        <DialogHeader>
          <p className="gm-kicker">Planning · génération</p>
          <DialogTitle>
            {etape === 'choix' && 'Quel planning veux-tu remplir ?'}
            {etape === 'nouveau' && 'Un nouveau planning'}
            {etape === 'existant' && 'Refaire un planning existant'}
          </DialogTitle>
          <DialogDescription>
            {etape === 'choix' && 'Le moteur remplit une fenêtre de dates. Dis-moi laquelle.'}
            {etape === 'nouveau' && 'Je le crée, puis je le remplis dans la foulée. Il apparaîtra aussitôt dans l’historique et les compteurs.'}
            {etape === 'existant' && 'Le planning choisi sera recalculé de zéro, sauf les gardes verrouillées.'}
          </DialogDescription>
        </DialogHeader>

        {/* ── Étape 1 : la question ─────────────────────── */}
        {etape === 'choix' && (
          <div className="gen-choix">
            <button
              type="button"
              className="gen-carte"
              onClick={() => { setEtape('nouveau'); setErreur(null) }}
            >
              <CalendarPlus className="gen-carte-ico" aria-hidden="true" />
              <span className="gen-carte-titre">Je fais un nouveau planning</span>
              <span className="gen-carte-sous">
                Des dates, une période type — et c’est parti.
              </span>
            </button>

            <button
              type="button"
              className="gen-carte"
              disabled={periodes.length === 0}
              onClick={() => {
                setCible(periodeAffichee?.id ?? periodes[0]?.id ?? '')
                setEtape('existant')
                setErreur(null)
              }}
            >
              <RotateCcw className="gen-carte-ico" aria-hidden="true" />
              <span className="gen-carte-titre">J’en refais un existant</span>
              <span className="gen-carte-sous">
                {periodes.length === 0
                  ? 'Aucun planning pour l’instant.'
                  : periodeAffichee
                    ? `Par exemple « ${nomPlanning(periodeAffichee)} », celui que tu regardes.`
                    : `${periodes.length} planning${periodes.length > 1 ? 's' : ''} au choix.`}
              </span>
            </button>
          </div>
        )}

        {/* ── Étape 2a : le nouveau planning ────────────── */}
        {etape === 'nouveau' && (
          <div className="gen-form">
            <label className="gen-champ">
              <span className="gen-label">Nom du planning</span>
              <input
                type="text"
                className="gen-input"
                placeholder="ex. Hiver 2027 — P1"
                value={libelle}
                onChange={(e) => setLibelle(e.target.value)}
                autoFocus
              />
            </label>

            <label className="gen-champ">
              <span className="gen-label">
                Il commence le <em>lundi</em>
              </span>
              <input
                type="date"
                className="gen-input"
                value={debut}
                onChange={(e) => setDebut(e.target.value)}
              />
              {debut && !estLundi(debut) && (
                <span className="gen-aide alerte">
                  Ce jour n’est pas un lundi — les semaines de garde démarrent le lundi.
                </span>
              )}
            </label>

            {!datesPrecises ? (
              <div className="gen-champ">
                <span className="gen-label">Il dure</span>
                <div className="gen-duree">
                  <input
                    type="number"
                    min={1}
                    max={104}
                    className="gen-input gen-input-nb"
                    value={semaines === '' ? String(dureeProposee(debut)) : semaines}
                    onChange={(e) => setSemaines(e.target.value)}
                  />
                  <span className="gen-unite">semaines</span>
                </div>
                <span className="gen-aide">
                  {debut && finCalculee
                    ? <>→ jusqu’au <b>{dateLongue(finCalculee)}</b></>
                    : 'Choisis d’abord le lundi de départ.'}
                </span>
                <button
                  type="button"
                  className="gen-lien"
                  onClick={() => {
                    setFinSaisie(finCalculee ?? '')
                    setDatesPrecises(true)
                  }}
                >
                  Choisir une date de fin précise
                </button>
              </div>
            ) : (
              <div className="gen-champ">
                <span className="gen-label">Il se termine le</span>
                <input
                  type="date"
                  className="gen-input"
                  value={finSaisie}
                  onChange={(e) => setFinSaisie(e.target.value)}
                />
                <button
                  type="button"
                  className="gen-lien"
                  onClick={() => { setDatesPrecises(false); setFinSaisie('') }}
                >
                  Revenir à une durée en semaines
                </button>
              </div>
            )}

            {typesProposables.length > 0 && (
              <div className="gen-champ">
                <span className="gen-label">Période type</span>
                <Select value={typeChoisi} onValueChange={(v) => v && setTypeChoisi(v)}>
                  <SelectTrigger className="w-full">
                    {typeChoisi === AUTO
                      ? 'Selon la saison'
                      : typesProposables.find((p) => p.id === typeChoisi)?.nom ?? 'Selon la saison'}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO}>Selon la saison</SelectItem>
                    {typesProposables.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.nom}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="gen-aide">
                  Elle décide des gardes à couvrir et de l’effectif. « Selon la saison »
                  prend celle réglée pour l’été ou l’hiver dans l’Organisation.
                </span>
              </div>
            )}

            {erreur && <p className="gen-erreur">{erreur}</p>}
          </div>
        )}

        {/* ── Étape 2b : reprendre un planning existant ─── */}
        {etape === 'existant' && (
          <div className="gen-liste">
            {periodes.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`gen-ligne${p.id === cible ? ' active' : ''}`}
                aria-pressed={p.id === cible}
                onClick={() => setCible(p.id)}
              >
                <span className="gen-ligne-nom">{nomPlanning(p)}</span>
                <span className="gen-ligne-dates">
                  du {dateCourte(p.date_debut)} au {dateCourte(p.date_fin)}
                </span>
                <span className={`gm-badge ${p.statut === 'publie' ? 'publie' : p.statut === 'verrouille' ? 'lock' : 'brouillon'}`}>
                  {STATUT[p.statut]}
                </span>
              </button>
            ))}
            {erreur && <p className="gen-erreur">{erreur}</p>}
          </div>
        )}

        <DialogFooter>
          {etape === 'choix' ? (
            <Button variant="outline" onClick={() => fermer(false)}>Annuler</Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => { setEtape('choix'); setErreur(null) }}
                disabled={creation}
              >
                Retour
              </Button>
              {etape === 'nouveau' ? (
                <Button onClick={creerPuisGenerer} disabled={creation}>
                  {creation
                    ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    : <Wand2 className="w-4 h-4 mr-2" />}
                  {creation ? 'Création…' : 'Créer et générer'}
                </Button>
              ) : (
                <Button onClick={genererExistant} disabled={!cible}>
                  <Wand2 className="w-4 h-4 mr-2" />
                  Générer
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
