'use client'

// ============================================================
// GUARDVETO — Bandeau de diagnostic d'impasse (Lot 5)
// ============================================================
// Remplace l'ancien rapport « N créneaux non couverts » brut d'ActionBar
// par un diagnostic ACTIONNABLE et lisible :
//   1. Titre honnête : « Aucun planning possible avec les règles actuelles ».
//   2. Le créneau réellement bloquant, formaté en français.
//   3. Les règles en cause, triées par occurrences, en langage naturel.
//   4. Des suggestions d'assouplissement. Seules les suggestions VÉRIFIÉES
//      (rejouées et confirmées) portent un bouton « Assouplir cette règle »
//      qui mène à /regles?focus=<cible>. Les non vérifiées = texte informatif.
//   5. Fallback effectif : si aucune suggestion vérifiée et la cause est un
//      manque d'effectif → message clair (pas une liste vide).
//   6. La liste brute des créneaux non couverts → repliée (« Voir le détail »).
//
// Honnêteté : un bouton ne GARANTIT PAS un planning optimal — il rend le
// planning à nouveau POSSIBLE. La copy le reflète strictement.
//
// Le composant ne mute RIEN côté client : « Assouplir » est une simple
// navigation (lien) vers l'écran /regles ciblé. Le diagnostic est éphémère.
// ============================================================

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, SlidersHorizontal, Users } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import type {
  DiagnosticImpasse as DiagnosticImpasseData,
  RegleEnCause,
  SuggestionAssouplissement,
} from '@/engine/diagnostic'
import type { JourNonCouvert } from '@/components/planning/types-impasse'

// ── Helpers de formatage FR ──────────────────────────────

/** Date ISO (YYYY-MM-DD) → « mercredi 14 février » (midi UTC pour neutraliser le fuseau). */
function formatDateFr(dateIso: string): string {
  return new Date(dateIso + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

/** Date courte « lun. 14 févr. » pour la liste détaillée. */
function formatDateCourteFr(dateIso: string): string {
  return new Date(dateIso + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

/** Rôle moteur → libellé « 1er de garde » / « 2nd de garde ». */
function labelRole(role: string): string {
  return role === 'premier' ? '1er de garde' : '2nd de garde'
}

/** Type de créneau → libellé lisible. */
function labelType(type: string): string {
  switch (type) {
    case 'weekend':
      return 'le week-end'
    case 'vendredi_soir':
      return 'le vendredi soir'
    case 'ferie':
      return 'un jour férié'
    case 'semaine_soir':
    default:
      return 'une nuit de semaine'
  }
}

/** Phrase complète du créneau bloquant : « le week-end du mercredi 14 février, 2nd de garde ». */
function phraseCreneauBloquant(date: string, type: string, role: string): string {
  return `${labelType(type)} du ${formatDateFr(date)}, ${labelRole(role)}`
}

// ── Composant ────────────────────────────────────────────

/**
 * B-046 — la note qui NOMME l'exclusion volontaire du dernier recours.
 *
 * Sans elle, une impasse due à ce réglage ressemble à une impasse due aux
 * règles : l'admin passe une heure à assouplir des contraintes qui n'y sont
 * pour rien. Exportée à part parce qu'elle sert AUSSI au calcul interrompu,
 * où il n'y a pas de diagnostic à afficher.
 */
export function NoteDernierRecoursExclus({ prenoms }: { prenoms: string[] }) {
  if (prenoms.length === 0) return null
  const pluriel = prenoms.length > 1
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">
        {prenoms.join(', ')} {pluriel ? 'ne comptent pas' : 'ne compte pas'} dans ce calcul
      </span>{' '}
      {/* ⚠️ Les espaces qui suivent une expression sont écrits `{' '}`, jamais
          laissés au hasard du retour à la ligne : MiKL a lu « la fiche est
          régléesur » et « Pour larendre disponible » le 27/08. Deux mots
          collés au même endroit — après une expression — ne sont pas une
          coïncidence, et un texte abîmé décrédibilise ce qu'il explique. */}
      :{' '}
      {pluriel ? 'ils sont réglés' : 'la fiche est réglée'}{' '}
      sur «&nbsp;dernier recours uniquement&nbsp;», et le moteur ne{' '}
      {pluriel ? 'les' : 'la'} mobilise jamais tout seul.
      {pluriel ? ' Ils restent' : ' Elle reste'} proposable{pluriel ? 's' : ''} quand tu
      modifies une garde à la main. Pour {pluriel ? 'les' : 'la'}{' '}
      rendre disponible à la génération, décoche le réglage sur l&apos;écran Équipe.
    </p>
  )
}

interface DiagnosticImpasseProps {
  diagnostic: DiagnosticImpasseData | null
  joursNonCouverts: JourNonCouvert[]
  /** Prénoms des « dernier recours » écartés de la génération (B-046). */
  exclusDernierRecours?: string[]
}

export function DiagnosticImpasse({
  diagnostic,
  joursNonCouverts,
  exclusDernierRecours = [],
}: DiagnosticImpasseProps) {
  const [detailOuvert, setDetailOuvert] = useState(false)

  // Règles en cause triées par occurrences décroissantes (les plus bloquantes d'abord).
  const reglesTriees: RegleEnCause[] = diagnostic
    ? [...diagnostic.reglesEnCause].sort((a, b) => b.occurrences - a.occurrences)
    : []

  const suggestions: SuggestionAssouplissement[] = diagnostic?.suggestions ?? []
  const suggestionsVerifiees = suggestions.filter((s) => s.verifiee)
  const suggestionsInfo = suggestions.filter((s) => !s.verifiee)

  // Fallback effectif : aucune piste vérifiée ET la cause dominante est un manque d'effectif.
  const causeEffectif =
    reglesTriees.some((r) => r.origine === 'effectif') ||
    diagnostic?.creneauBloquant.reglesEnCause.some((r) => r.origine === 'effectif')
  const afficherFallbackEffectif = suggestionsVerifiees.length === 0 && !!causeEffectif

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-4">
      {/* 1. Titre honnête */}
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium text-destructive">
            Aucun planning possible avec les règles actuelles
          </p>
          {diagnostic && (
            <p className="text-xs text-muted-foreground">
              Le blocage survient sur{' '}
              <span className="font-medium text-foreground">
                {phraseCreneauBloquant(
                  diagnostic.creneauBloquant.date,
                  diagnostic.creneauBloquant.type,
                  diagnostic.creneauBloquant.role,
                )}
              </span>
              . Aucun vétérinaire ne pouvait être assigné sans enfreindre une règle.
            </p>
          )}
          {!diagnostic && (
            <p className="text-xs text-muted-foreground">
              Le moteur n'a pas pu couvrir {joursNonCouverts.length} créneau
              {joursNonCouverts.length > 1 ? 'x' : ''}. Vérifie les règles et les congés des
              vétérinaires.
            </p>
          )}
          <NoteDernierRecoursExclus prenoms={exclusDernierRecours} />
        </div>
      </div>

      {/* 3. Règles en cause (triées par occurrences) */}
      {reglesTriees.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground/80">Ce qui bloque :</p>
          <ul className="space-y-1">
            {reglesTriees.map((r, i) => (
              <li
                key={`${r.code}-${r.vetId ?? r.contrainteId ?? i}`}
                className="flex items-baseline gap-2 text-xs text-muted-foreground"
              >
                <span className="text-destructive/70 shrink-0" aria-hidden>
                  •
                </span>
                <span>
                  <span className="text-foreground">{r.libelle}</span>
                  {r.occurrences > 0 && (
                    <span className="text-muted-foreground/70">
                      {' '}
                      (bloque {r.occurrences} créneau{r.occurrences > 1 ? 'x' : ''})
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 4. Suggestions vérifiées → cartes avec bouton « Assouplir cette règle » */}
      {suggestionsVerifiees.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground/80">
            Pistes pour rendre un planning à nouveau possible :
          </p>
          {suggestionsVerifiees.map((s, i) => (
            <div
              key={`sugg-${s.action.cible}-${i}`}
              className="flex items-start gap-3 rounded-md border bg-card p-3"
            >
              <SlidersHorizontal className="w-4 h-4 text-accent mt-0.5 shrink-0" aria-hidden />
              <div className="flex-1 min-w-0 space-y-2">
                <p className="text-xs text-foreground leading-5">{s.texte}</p>
                <p className="text-[11px] text-muted-foreground/70">
                  Cet assouplissement rend un planning possible — il ne garantit pas qu'il soit
                  optimal.
                </p>
                <a
                  href={`/regles?focus=${encodeURIComponent(s.action.cible)}`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Assouplir cette règle
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 4bis. Suggestions non vérifiées → texte informatif SANS bouton */}
      {suggestionsInfo.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground/80">Pistes à explorer :</p>
          <ul className="space-y-1">
            {suggestionsInfo.map((s, i) => (
              <li
                key={`info-${i}`}
                className="flex items-baseline gap-2 text-xs text-muted-foreground"
              >
                <span className="text-muted-foreground/50 shrink-0" aria-hidden>
                  •
                </span>
                <span>{s.texte}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 5. Fallback effectif : aucune piste vérifiée + cause = effectif */}
      {afficherFallbackEffectif && (
        <div className="flex items-start gap-3 rounded-md border border-amber-300/50 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-900/20">
          <Users className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" aria-hidden />
          <p className="text-xs text-amber-800 dark:text-amber-200 leading-5">
            Le nombre de vétérinaires disponibles est insuffisant pour couvrir ce créneau. Aucun
            assouplissement de règle ne peut le débloquer — il faudrait plus de vétérinaires
            disponibles (ou lever des congés sur cette période).
          </p>
        </div>
      )}

      {/* 6. Liste brute repliée derrière « Voir le détail » (anti-bruit) */}
      {joursNonCouverts.length > 0 && (
        <div className="border-t border-destructive/15 pt-3">
          <button
            type="button"
            onClick={() => setDetailOuvert((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={detailOuvert}
          >
            {detailOuvert ? (
              <ChevronUp className="w-3.5 h-3.5" aria-hidden />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" aria-hidden />
            )}
            Voir le détail ({joursNonCouverts.length} créneau
            {joursNonCouverts.length > 1 ? 'x' : ''} non couvert
            {joursNonCouverts.length > 1 ? 's' : ''})
          </button>

          {detailOuvert && (
            <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
              {joursNonCouverts.slice(0, 50).map((j, i) => (
                <div
                  key={`jnc-${i}`}
                  className="flex items-baseline gap-2 text-xs rounded bg-destructive/10 px-2 py-1"
                >
                  <span className="font-medium text-destructive shrink-0">
                    {formatDateCourteFr(j.date)}
                  </span>
                  <span className="text-muted-foreground">{labelRole(j.role)}</span>
                  {j.contrainteBloquante && (
                    <span className="text-muted-foreground/70 truncate">
                      — {j.contrainteBloquante}
                    </span>
                  )}
                </div>
              ))}
              {joursNonCouverts.length > 50 && (
                <p className="text-xs text-muted-foreground px-2">
                  … et {joursNonCouverts.length - 50} autres créneaux non couverts.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
