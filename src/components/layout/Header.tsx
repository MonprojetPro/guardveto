'use client'

import { logout } from '@/app/login/actions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { Veterinaire } from '@/types'
import { LogOut } from 'lucide-react'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  veto: 'Vétérinaire',
}

interface HeaderProps {
  veterinaire: Veterinaire
}

export function Header({ veterinaire }: HeaderProps) {
  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
      {/* Titre page — remplacé dynamiquement par chaque page si besoin */}
      {/* Logo — visible uniquement sur mobile (la sidebar l'affiche sur desktop) */}
      <div className="flex items-center gap-2">
        <span className="font-heading font-bold text-primary text-xl block md:hidden">
          GuardVeto
        </span>
      </div>

      {/* Utilisateur + déconnexion */}
      <div className="flex items-center gap-3">
        {/* Avatar couleur veto */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
          style={{ backgroundColor: veterinaire.couleur }}
          title={`${veterinaire.prenom} ${veterinaire.nom}`}
        >
          {veterinaire.prenom.charAt(0).toUpperCase()}
        </div>

        {/* Nom + rôle */}
        <div className="hidden sm:flex flex-col items-start leading-tight">
          <span className="text-sm font-medium text-foreground">
            {veterinaire.prenom}
          </span>
          <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">
            {ROLE_LABELS[veterinaire.role_app] ?? veterinaire.role_app}
          </Badge>
        </div>

        {/* Bouton déconnexion */}
        <form action={logout}>
          <Button
            variant="ghost"
            size="icon"
            type="submit"
            title="Se déconnecter"
            className="text-muted-foreground hover:text-destructive"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </header>
  )
}
