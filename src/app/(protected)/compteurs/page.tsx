import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart3 } from 'lucide-react'

export default function CompteursPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Compteurs</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Suivi des gardes et bilan d&apos;équité
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2 text-base">
            <BarChart3 className="w-5 h-5 text-primary" />
            Compteurs — Sprint 5
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Les compteurs individuels et le bilan bonus/malus (STORY-015 à 017) seront disponibles au Sprint 5.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
