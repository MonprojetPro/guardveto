import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Settings } from 'lucide-react'
import type { Veterinaire } from '@/types'

export default async function AdminVeterinairesPage() {
  const supabase = await createClient()

  // Vérifie le rôle admin côté serveur
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentVeto } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()

  if (currentVeto?.role_app !== 'admin') {
    redirect('/planning')
  }

  const { data: veterinaires } = await supabase
    .from('veterinaires')
    .select('*')
    .order('nom')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Gestion des vétérinaires
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Administration des profils et contraintes
        </p>
      </div>

      {/* Liste des vétérinaires — STORY-002 ajoutera le CRUD complet */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2 text-base">
            <Settings className="w-5 h-5 text-primary" />
            Vétérinaires ({veterinaires?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {veterinaires?.map((veto: Veterinaire) => (
              <div
                key={veto.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background"
              >
                {/* Avatar couleur */}
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                  style={{ backgroundColor: veto.couleur }}
                >
                  {veto.prenom.charAt(0)}
                </div>

                {/* Infos */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground">
                    {veto.prenom} {veto.nom}
                  </p>
                  <p className="text-xs text-muted-foreground">{veto.email}</p>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-xs capitalize">
                    {veto.statut}
                  </Badge>
                  <Badge
                    variant={veto.role_app === 'admin' ? 'default' : 'secondary'}
                    className="text-xs"
                  >
                    {veto.role_app}
                  </Badge>
                  {veto.dernier_recours && (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      Dernier recours
                    </Badge>
                  )}
                  {!veto.user_id && (
                    <Badge variant="destructive" className="text-xs">
                      Sans compte
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border">
            Le CRUD complet (ajout, modification, contraintes) sera disponible à STORY-002.
            Les vétérinaires marqués &quot;Sans compte&quot; n&apos;ont pas encore été invités via Supabase Auth.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
