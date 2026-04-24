import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Calendar } from 'lucide-react'

export default async function PlanningPage() {
  const supabase = await createClient()

  const { data: periodes } = await supabase
    .from('periodes')
    .select('*')
    .order('date_debut', { ascending: false })
    .limit(5)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Planning</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Vue mensuelle des gardes
        </p>
      </div>

      {/* Placeholder — STORY-011 implémentera la vraie vue calendrier */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2 text-base">
            <Calendar className="w-5 h-5 text-primary" />
            Planning en cours de construction
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            La vue mensuelle du planning sera disponible après les Sprints 3 et 4.
          </p>
          {periodes && periodes.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Périodes créées
              </p>
              {periodes.map(p => (
                <div key={p.id} className="flex items-center gap-2 text-sm">
                  <span className="capitalize">{p.saison}</span>
                  <span className="text-muted-foreground">
                    {new Date(p.date_debut).toLocaleDateString('fr-FR')} →{' '}
                    {new Date(p.date_fin).toLocaleDateString('fr-FR')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
