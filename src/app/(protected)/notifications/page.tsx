import { getNotifications } from '@/data/notifications'
import { HistoriqueNotifications } from '@/components/notifications/HistoriqueNotifications'

export const metadata = {
  title: 'Notifications — GuardVeto',
}

export default async function NotificationsPage() {
  const initial = await getNotifications(100)

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 font-heading text-2xl font-bold text-foreground">Notifications</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Tout ce qui concerne vos gardes et le planning, au même endroit.
      </p>

      <HistoriqueNotifications initial={initial} />
    </div>
  )
}
