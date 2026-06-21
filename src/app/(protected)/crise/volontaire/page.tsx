// ============================================================
// GUARDVETO — Page /crise/volontaire (Gestion de crise — LOT 4)
// ============================================================
// Cible du lien email « Je prends ce créneau » (envoyé par sendAppelVolontaires).
// Query params : ?absence=…&garde=…&role=premier|second
//
// Page pour un VÉTO authentifié (le layout (protected) garantit déjà une session
// + un profil véto actif). On y affiche le créneau concerné (date FR + type +
// rôle) et une question « Veux-tu prendre ce créneau ? ». La confirmation POST
// l'endpoint /api/absences/[id]/volontaire (qui REVALIDE tout côté serveur :
// auth + cabinet + éligibilité + anti-collision). Cette page ne fait AUCUNE
// écriture : elle ne sert qu'à afficher le créneau et déclencher l'action.
//
// Robustesse :
//   • params manquants / rôle invalide → message d'erreur propre (pas de crash).
//   • garde introuvable dans le cabinet (RLS) → message « créneau introuvable ».
//   • L'éligibilité réelle est tranchée par l'endpoint, pas ici (un lien forwardé
//     ne contourne aucun contrôle).
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { CircleAlert } from 'lucide-react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import { VolontaireConfirm } from '@/components/crise/VolontaireConfirm'
import type { RoleGarde } from '@/engine/types'

// ── Helpers d'affichage FR ───────────────────────────────
function formatDateFr(dateIso: string): string {
  return new Date(dateIso + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function labelTypeDb(type: string): string {
  if (type === 'weekend') return 'Week-end'
  if (type === 'ferie') return 'Jour férié'
  return 'Soir de semaine'
}

function labelRole(role: RoleGarde): string {
  return role === 'premier' ? '1er de garde' : '2nd de garde'
}

function estRole(v: string | undefined): v is RoleGarde {
  return v === 'premier' || v === 'second'
}

// ── Carte d'erreur générique (params manquants / introuvable) ──
function ErreurCard({ titre, message }: { titre: string; message: string }) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <CircleAlert className="w-5 h-5" aria-hidden />
            {titre}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}

export default async function VolontairePage({
  searchParams,
}: {
  searchParams: Promise<{ absence?: string; garde?: string; role?: string }>
}) {
  const { absence: absenceId, garde: gardeId, role } = await searchParams

  // ── Params manquants / invalides → message propre (pas de crash) ──
  if (!absenceId || !gardeId || !estRole(role)) {
    return (
      <ErreurCard
        titre="Lien incomplet"
        message="Ce lien d'appel aux volontaires est incomplet ou invalide. Ouvrez-le depuis l'email que vous avez reçu, ou rendez-vous sur votre planning."
      />
    )
  }

  const supabase = await createClient()

  // Le créneau concerné, pour l'afficher (date + type). RLS borne déjà la lecture
  // au cabinet du véto connecté : une garde d'un autre cabinet revient « null ».
  const { data: garde } = await supabase
    .from('gardes')
    .select('id, date, type')
    .eq('id', gardeId)
    .single()

  if (!garde) {
    return (
      <ErreurCard
        titre="Créneau introuvable"
        message="Cette garde n'existe plus ou n'est pas accessible depuis votre compte. Elle a peut-être déjà été réattribuée."
      />
    )
  }

  const dateLabel = formatDateFr(garde.date as string)
  const typeLabel = labelTypeDb(garde.type as string)
  const roleLabel = labelRole(role)

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <VolontaireConfirm
        absenceId={absenceId}
        gardeId={gardeId}
        role={role}
        dateLabel={dateLabel}
        typeLabel={typeLabel}
        roleLabel={roleLabel}
      />
    </div>
  )
}
