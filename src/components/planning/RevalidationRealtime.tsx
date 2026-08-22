'use client'

// ============================================================
// GUARDVETO — RevalidationRealtime (Chantier B)
// ============================================================
// Bandeau d'alerte ADMIN qui re-valide en CONTINU le planning publié.
//
// Pourquoi : avant ce chantier, le planning n'était vérifié qu'à la génération.
// Une fois publié, un congé validé a posteriori, une règle modifiée, une
// édition manuelle ou une réparation de crise pouvaient casser une contrainte
// dure sans aucune alerte. Ici on rebranche `validerPlanning` en prod.
//
// Temps réel : on s'abonne aux tables dont un changement peut introduire une
// violation (gardes, conges, periodes, veterinaires, regles_cabinet). À chaque
// event, on relance la re-validation côté serveur (debounce) et on rafraîchit
// le bandeau — sans rechargement de page.
//
// La re-validation initiale est calculée en SSR (cohérence au 1er rendu) puis
// remplacée par les résultats temps réel.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { revaliderPlanningPublie } from '@/data/revaliderPlanning'
import { grouperViolations } from '@/lib/regles/libelleViolation'
import { CartesViolations } from './CartesViolations'
import type { ViolationRevalidation } from './types-revalidation'

interface RevalidationRealtimeProps {
  /** Période(s) publiée(s) visibles sur le mois affiché, à re-valider. */
  periodeIds: string[]
  /** Violations calculées en SSR au 1er rendu (évite un flash vide). */
  initialViolations: ViolationRevalidation[]
}

// Tables dont un changement peut rendre le planning publié non conforme.
const TABLES_SURVEILLEES = [
  'gardes',
  'conges',
  'periodes',
  'veterinaires',
  'regles_cabinet',
] as const

export function RevalidationRealtime({
  periodeIds,
  initialViolations,
}: RevalidationRealtimeProps) {
  const [violations, setViolations] = useState<ViolationRevalidation[]>(initialViolations)
  // Replié par défaut : c'est un signal, pas un rapport. Déplié d'office, il
  // repoussait le calendrier hors de l'écran (retour MiKL du 2026-08-02).
  const [ouvert, setOuvert] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-validation serveur (debounced) — déclenchée par les events Realtime.
  const revalider = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await revaliderPlanningPublie(periodeIds)
        setViolations(res)
      } catch {
        // best-effort : on garde l'état précédent en cas d'échec réseau
      }
    }, 800)
  }, [periodeIds])

  useEffect(() => {
    if (periodeIds.length === 0) return
    const supabase = createClient()
    const channel = supabase.channel('revalidation-planning-publie')

    for (const table of TABLES_SURVEILLEES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => revalider()
      )
    }

    channel.subscribe()

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [periodeIds, revalider])

  if (violations.length === 0) return null

  // Regroupé par CAUSE : « 64 incohérences » n'est presque jamais 64 problèmes,
  // c'est deux règles qui se répètent sur 64 dates. Le tout à plat rendait le
  // planning invisible sous le bandeau, sans dire quoi corriger.
  const causes = grouperViolations(violations)

  return (
    <div className="gv-alerte danger" role="alert">
      <div className="gva-tete">
        <AlertTriangle className="gva-ico" aria-hidden />
        <div className="gva-titres">
          <p className="gva-titre">
            {violations.length === 1
              ? 'Une incohérence sur le planning publié'
              : `${violations.length} incohérences sur le planning publié`}
            {causes.length > 1 && (
              <span className="gva-compte">
                {' '}· {causes.length} causes
              </span>
            )}
          </p>
          <p className="gva-sous">
            Depuis sa publication, le planning ne respecte plus toutes les règles
            (congé validé, règle modifiée, garde réattribuée…).
          </p>
        </div>
        <button
          type="button"
          className="gva-toggle"
          aria-expanded={ouvert}
          onClick={() => setOuvert((v) => !v)}
        >
          {ouvert ? 'Masquer' : 'Voir le détail'}
          <ChevronDown className={`gva-chevron${ouvert ? ' ouvert' : ''}`} aria-hidden />
        </button>
      </div>

      {ouvert && (
        <div className="gva-corps">
          <CartesViolations violations={violations} />

          <div className="gva-actions">
            <Link href="/regles" className="gva-lien">Revoir les règles →</Link>
            <span className="gva-note">
              Régénérer le planning depuis « Générer » le remet d’aplomb — il
              repassera en brouillon jusqu’à sa republication.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
