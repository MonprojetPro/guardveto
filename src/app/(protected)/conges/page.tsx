import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CalendarOff } from 'lucide-react'

export default function CongesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Congés</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Gestion des congés et indisponibilités
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2 text-base">
            <CalendarOff className="w-5 h-5 text-primary" />
            Module congés — Sprint 2
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            La gestion des congés (STORY-004 à 006) sera disponible au Sprint 2.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
