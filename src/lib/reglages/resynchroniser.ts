// ============================================================
// GUARDVETO — Réglages : renvoyer un planning publié vers Google Agenda
// ============================================================
// Appelé depuis le navigateur par l'écran actuel ET par l'écran refondu
// (B-202). Une seule traduction de la réponse de `/api/calendar-sync` : c'est
// elle qui dit POURQUOI rien n'est parti, et deux copies finiraient par ne pas
// dire la même chose.
// ============================================================

export interface ResultatResync {
  ok: boolean
  message: string
}

/** La réponse de la route, telle qu'elle arrive (rien n'y est garanti). */
export interface ReponseResync {
  error?: string
  skipped?: boolean
  raison?: string
  synced?: number
  errors?: string[]
}

/** Traduit la réponse de `/api/calendar-sync` en une phrase pour l'admin. */
export function lireReponseResync(httpOk: boolean, data: ReponseResync | null): ResultatResync {
  if (!httpOk) {
    return { ok: false, message: data?.error ?? 'La synchronisation a échoué.' }
  }
  if (data?.skipped) {
    // Le serveur dit POURQUOI il n'a rien envoyé. « Aucun agenda branché »
    // était le seul motif imaginé, et il est faux depuis qu'un planning non
    // publié est refusé.
    return {
      ok: false,
      message: data?.raison ?? "Rien n'a été envoyé : aucun agenda n'est branché pour ce cabinet.",
    }
  }
  const erreurs = data?.errors ?? []
  const n = data?.synced ?? 0
  if (erreurs.length === 0) {
    return { ok: true, message: `${n} garde${n > 1 ? 's' : ''} envoyée${n > 1 ? 's' : ''} vers l'agenda.` }
  }
  return { ok: false, message: `${n} envoyée(s), ${erreurs.length} en échec : ${erreurs[0]}` }
}

const APPEL_ECHOUE: ResultatResync = { ok: false, message: "L'appel n'a pas abouti. Réessayez dans un instant." }

/** Lance la synchronisation d'une période publiée et rend la phrase à afficher. */
export async function resynchroniserPeriode(periodeId: string): Promise<ResultatResync> {
  try {
    const res = await fetch('/api/calendar-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodeId }),
    })
    // Une réponse illisible (page d'erreur de la plateforme, délai dépassé)
    // n'est PAS « 0 garde envoyée » : sans corps, on ne sait rien de ce qui
    // est parti. Même message qu'une coupure réseau, comme avant B-202.
    const data = (await res.json()) as ReponseResync | null
    return lireReponseResync(res.ok, data)
  } catch {
    return APPEL_ECHOUE
  }
}
