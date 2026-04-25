'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ChevronLeft, ChevronRight, List, Grid3x3, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DayCell } from './DayCell'
import { GardeBadge } from './GardeBadge'
import { GardeDetailModal } from '@/components/planning/GardeDetailModal'
import { usePeriodeActuelle } from '@/hooks/usePeriode'
import { estJourFerie } from '@/engine/utils'
import type { GardeDenormalisee, Periode } from '@/types'

// ── Types ────────────────────────────────────────────────

interface MonthViewProps {
  gardes: GardeDenormalisee[]
  periodes: Periode[]
  /** Format "YYYY-MM" (ex : "2026-09") */
  anneeMois: string
  isAdmin?: boolean
}

// ── Helpers calendrier ───────────────────────────────────

const JOURS_NOMS_COURTS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const JOURS_NOMS_LONGS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

const MOIS_NOMS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

function daysInMonth(annee: number, mois: number): number {
  return new Date(annee, mois, 0).getDate()
}

/** Génère la grille du mois (array de string ISO | null pour le remplissage) */
function genererGrille(annee: number, mois: number): Array<string | null> {
  const premierJour = new Date(Date.UTC(annee, mois - 1, 1))
  const nbJours = daysInMonth(annee, mois)
  // Offset : 0=Lun, 1=Mar, …, 6=Dim (semaine commence le lundi)
  const offsetDepart = (premierJour.getUTCDay() + 6) % 7

  const cellules: Array<string | null> = Array(offsetDepart).fill(null)

  for (let d = 1; d <= nbJours; d++) {
    cellules.push(
      `${annee}-${String(mois).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    )
  }

  while (cellules.length % 7 !== 0) cellules.push(null)
  return cellules
}

function estWeekend(dateISO: string): boolean {
  const j = new Date(dateISO + 'T12:00:00Z').getUTCDay()
  return j === 0 || j === 6
}

function estPasse(dateISO: string): boolean {
  const aujourd = new Date()
  const today = `${aujourd.getFullYear()}-${String(aujourd.getMonth() + 1).padStart(2, '0')}-${String(aujourd.getDate()).padStart(2, '0')}`
  return dateISO < today
}

function estAujourdhui(dateISO: string): boolean {
  const aujourd = new Date()
  const today = `${aujourd.getFullYear()}-${String(aujourd.getMonth() + 1).padStart(2, '0')}-${String(aujourd.getDate()).padStart(2, '0')}`
  return dateISO === today
}


// ── Composant principal ──────────────────────────────────

export function MonthView({ gardes, periodes, anneeMois, isAdmin = false }: MonthViewProps) {
  const router = useRouter()
  const [vueListeMobile, setVueListeMobile] = useState(false)
  const [gardeModal, setGardeModal] = useState<GardeDenormalisee | null>(null)
  const [dateModal, setDateModal] = useState<string | null>(null)

  const [annee, mois] = anneeMois.split('-').map(Number)
  const grille = genererGrille(annee, mois)
  const periode = usePeriodeActuelle(gardes, periodes)

  // Index gardes par date pour accès O(1)
  const gardesParDate = new Map<string, GardeDenormalisee>()
  for (const g of gardes) {
    gardesParDate.set(g.date, g)
  }

  // Vétérinaires uniques (pour la légende)
  const vetsLegende = new Map<string, { prenom: string; nom: string; couleur: string }>()
  for (const g of gardes) {
    if (g.premier_id && g.premier_prenom && g.premier_couleur) {
      vetsLegende.set(g.premier_id, { prenom: g.premier_prenom, nom: g.premier_nom ?? '', couleur: g.premier_couleur })
    }
    if (g.second_id && g.second_prenom && g.second_couleur) {
      vetsLegende.set(g.second_id, { prenom: g.second_prenom, nom: g.second_nom ?? '', couleur: g.second_couleur })
    }
  }

  // Navigation mois précédent / suivant
  function navMois(delta: number) {
    const d = new Date(Date.UTC(annee, mois - 1 + delta, 1))
    const newMois = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    router.push(`/planning?mois=${newMois}`)
  }

  function ouvrirModal(date: string) {
    const g = gardesParDate.get(date) ?? null
    setDateModal(date)
    setGardeModal(g)
  }

  // ── Rendu ─────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Barre de navigation */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => navMois(-1)} aria-label="Mois précédent">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <h2 className="font-heading text-lg font-semibold text-foreground min-w-[160px] text-center">
            {MOIS_NOMS[mois - 1]} {annee}
          </h2>
          <Button variant="outline" size="icon" onClick={() => navMois(1)} aria-label="Mois suivant">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {/* Toggle vue liste / grille (mobile) */}
        <Button
          variant="outline"
          size="sm"
          className="md:hidden"
          onClick={() => setVueListeMobile((v) => !v)}
          aria-label={vueListeMobile ? 'Vue grille' : 'Vue liste'}
        >
          {vueListeMobile ? <Grid3x3 className="w-4 h-4" /> : <List className="w-4 h-4" />}
          <span className="ml-1.5 text-xs">{vueListeMobile ? 'Grille' : 'Liste'}</span>
        </Button>
      </div>

      {/* Info période */}
      {periode && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
          <span className="capitalize">{periode.saison}</span>
          <span>·</span>
          <span>
            {new Date(periode.date_debut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
            {' → '}
            {new Date(periode.date_fin).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <span>·</span>
          {periode.statut === 'publie'
            ? <Badge variant="default">Publié</Badge>
            : periode.statut === 'verrouille'
              ? <Badge variant="secondary">Verrouillé</Badge>
              : <Badge variant="outline">Brouillon</Badge>
          }
        </div>
      )}

      {gardes.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Aucune garde planifiée pour ce mois.
        </p>
      )}

      {/* ── Vue grille (desktop + mobile non-liste) ─────── */}
      {!vueListeMobile && (
        <div>
          {/* En-têtes des jours */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {JOURS_NOMS_COURTS.map((j, i) => (
              <div
                key={i}
                className={`text-center text-xs font-semibold py-1 rounded ${
                  i >= 5 ? 'text-primary/80' : 'text-muted-foreground'
                }`}
              >
                {/* Court sur mobile, long sur desktop */}
                <span className="md:hidden">{j}</span>
                <span className="hidden md:inline">{JOURS_NOMS_LONGS[i]}</span>
              </div>
            ))}
          </div>

          {/* Grille des jours */}
          <div className="grid grid-cols-7 gap-1">
            {grille.map((date, i) => (
              <DayCell
                key={i}
                date={date}
                garde={date ? (gardesParDate.get(date) ?? null) : null}
                estAujourdhui={date ? estAujourdhui(date) : false}
                estPasse={date ? estPasse(date) : false}
                estWeekend={date ? estWeekend(date) : false}
                estFerie={date ? estJourFerie(date) : false}
                compact={true}
                onClick={() => date && ouvrirModal(date)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Vue liste (mobile toggle) ────────────────────── */}
      {vueListeMobile && (
        <div className="space-y-2">
          {gardes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Aucune garde planifiée pour ce mois.
            </p>
          ) : (
            gardes
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((garde) => (
                <button
                  key={garde.id}
                  className="w-full flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => ouvrirModal(garde.date)}
                >
                  {/* Date */}
                  <div className="shrink-0 text-center min-w-[48px]">
                    <div className="text-xs text-muted-foreground">
                      {new Date(garde.date + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'short' })}
                    </div>
                    <div className="text-lg font-bold text-foreground leading-tight">
                      {parseInt(garde.date.split('-')[2])}
                    </div>
                  </div>

                  {/* Type + gardes */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {garde.type === 'weekend' ? 'Week-end' : garde.type === 'ferie' ? 'Jour férié' : 'Soir semaine'}
                      </span>
                      {estJourFerie(garde.date) && (
                        <Star className="w-3 h-3 text-amber-500 fill-amber-400" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {garde.premier_prenom && (
                        <GardeBadge
                          prenom={garde.premier_prenom}
                          nom={garde.premier_nom}
                          couleur={garde.premier_couleur}
                          role="premier"
                        />
                      )}
                      {garde.second_prenom && (
                        <GardeBadge
                          prenom={garde.second_prenom}
                          nom={garde.second_nom}
                          couleur={garde.second_couleur}
                          role="second"
                        />
                      )}
                    </div>
                  </div>
                </button>
              ))
          )}
        </div>
      )}

      {/* ── Légende ──────────────────────────────────────── */}
      {vetsLegende.size > 0 && (
        <div className="pt-2 border-t border-border/50">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Légende
          </p>
          <div className="flex flex-wrap gap-2">
            {Array.from(vetsLegende.values()).map((v) => (
              <GardeBadge
                key={v.prenom + v.nom}
                prenom={v.prenom}
                nom={v.nom}
                couleur={v.couleur}
                role="premier"
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Modale de détail / édition ───────────────────── */}
      <GardeDetailModal
        garde={gardeModal}
        date={dateModal}
        isAdmin={isAdmin}
        onClose={() => { setDateModal(null); setGardeModal(null) }}
        onSaved={() => router.refresh()}
      />
    </div>
  )
}
