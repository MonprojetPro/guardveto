// ============================================================
// GUARDVETO — /admin/journal-emails
// ============================================================
// Backlog audit 360° #9 — Monitoring d'erreurs (volet traçabilité).
//
// Expose la table `email_log` à l'admin : chaque email (planning publié, garde
// modifiée, rappel de publication, appel aux volontaires, dépannage confirmé)
// y laisse une trace « envoyé » ou « erreur ». Avant, un échec d'envoi Brevo
// n'était visible que dans un `console.error` Vercel que personne ne lit.
//
// Le canal d'alerte TEMPS RÉEL des échecs reste la cloche (notif in-app
// `incident_technique`, cf. signalerIncidentTechnique) : cette page est le
// JOURNAL consultable, pas le système d'alerte.
//
// SÉCURITÉ multi-tenant : `email_log` n'a pas de colonne cabinet_id. On borne
// donc EXPLICITEMENT la lecture aux emails des vétos DU cabinet de l'admin
// (défense applicative), en plus de la RLS cabinet posée par la migration
// 20260706190000. Double barrière : l'app filtre ET la RLS borne.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { MailWarning, CheckCircle2, AlertTriangle, Inbox } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface EmailLogRow {
  id: string
  type: string
  destinataire: string
  veterinaire_id: string | null
  statut: string
  erreur: string | null
  created_at: string
}

const TYPE_LABEL: Record<string, string> = {
  planning_publie:    'Planning publié',
  garde_modifiee:     'Garde modifiée',
  rappel_publication: 'Rappel de publication',
  appel_volontaires:  'Appel aux volontaires',
  depannage_confirme: 'Dépannage confirmé',
  conge_valide:       'Congé validé',
  conge_refuse:       'Congé refusé',
}

function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type
}

function formatDateHeure(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function JournalEmailsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentVeto } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()

  if (currentVeto?.role_app !== 'admin') redirect('/planning')

  // ── Borne cabinet (défense applicative, cf. en-tête) ──────────────────────
  let cabinetId: string | null = null
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch {
    cabinetId = null
  }

  // Vétos du cabinet → on ne lit QUE les logs qui les concernent.
  interface VetLite { id: string; nom: string; prenom: string }
  const { data: vetsRaw } = cabinetId
    ? await supabase.from('veterinaires').select('id, nom, prenom').eq('cabinet_id', cabinetId)
    : { data: null }
  const vetsCabinet = (vetsRaw ?? []) as VetLite[]

  const vetIds = vetsCabinet.map((v) => v.id)
  const nomParVet = new Map<string, string>(
    vetsCabinet.map((v) => [v.id, `${v.prenom} ${v.nom}`]),
  )

  let logs: EmailLogRow[] = []
  if (vetIds.length > 0) {
    const { data } = await supabase
      .from('email_log')
      .select('id, type, destinataire, veterinaire_id, statut, erreur, created_at')
      .in('veterinaire_id', vetIds)
      .order('created_at', { ascending: false })
      .limit(200)
    logs = (data ?? []) as EmailLogRow[]
  }

  const nbErreurs = logs.filter((l) => l.statut === 'erreur').length
  const nbEnvoyes = logs.length - nbErreurs

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      {/* En-tête */}
      <div className="mb-6 flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <MailWarning className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Journal des e-mails</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Trace de chaque e-mail envoyé aux vétérinaires (publication, modification,
            rappels, gestion de crise). Un envoi en échec apparaît ici en rouge — et
            déclenche aussi une alerte dans la cloche.
          </p>
        </div>
      </div>

      {/* Résumé */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-2xl font-semibold tabular-nums">{nbEnvoyes}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">Envoyés (200 derniers)</p>
        </div>
        <div
          className={
            'rounded-lg border px-4 py-3 ' +
            (nbErreurs > 0 ? 'border-red-300 bg-red-50' : 'border-border bg-card')
          }
        >
          <div className={'flex items-center gap-2 ' + (nbErreurs > 0 ? 'text-red-600' : 'text-muted-foreground')}>
            <AlertTriangle className="h-4 w-4" />
            <span className="text-2xl font-semibold tabular-nums">{nbErreurs}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">En échec</p>
        </div>
      </div>

      {/* Liste */}
      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Aucun e-mail journalisé pour le moment.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {logs.map((log) => {
            const erreur = log.statut === 'erreur'
            const nom = log.veterinaire_id ? nomParVet.get(log.veterinaire_id) : null
            return (
              <li
                key={log.id}
                className={
                  'rounded-lg border px-4 py-3 ' +
                  (erreur ? 'border-red-300 bg-red-50/60' : 'border-border bg-card')
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ' +
                        (erreur
                          ? 'bg-red-100 text-red-700'
                          : 'bg-emerald-100 text-emerald-700')
                      }
                    >
                      {erreur ? (
                        <AlertTriangle className="h-3 w-3" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3" />
                      )}
                      {erreur ? 'Échec' : 'Envoyé'}
                    </span>
                    <span className="text-sm font-medium text-foreground">{typeLabel(log.type)}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDateHeure(log.created_at)}</span>
                </div>

                <p className="mt-1 text-xs text-muted-foreground">
                  {nom ? <span className="text-foreground">{nom}</span> : null}
                  {nom ? ' — ' : null}
                  {log.destinataire}
                </p>

                {erreur && log.erreur ? (
                  <p className="mt-2 rounded border border-red-200 bg-white/70 px-2.5 py-1.5 text-xs font-mono leading-relaxed text-red-700">
                    {log.erreur}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
