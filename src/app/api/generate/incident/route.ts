// ============================================================
// GUARDVETO — Ce que le NAVIGATEUR a vu quand la fenêtre s'est fermée (B-104)
// ============================================================
// MiKL, le 2026-09-02 : « ça commence quelques secondes puis la fenêtre se
// ferme ». Le serveur ne voit rien de tout ça — il finit son travail ou il
// meurt, et dans les deux cas il ignore ce que l'écran a fait.
//
// La lecture du code a établi un fait qui rend cette route nécessaire : TOUS
// les chemins d'erreur du parcours affichent un message (« la génération s'est
// interrompue », « impossible de joindre le serveur »). Aucun ne ferme la
// fenêtre. Donc ce que MiKL observe n'est aucun d'eux — et c'est précisément ce
// qu'aucune trace serveur ne pourra jamais expliquer.
//
// ── POURQUOI UNE BALISE, ET PAS UN `fetch` ORDINAIRE ───────────────────────
//
// Un `fetch` lancé pendant qu'un composant se démonte, qu'un onglet se ferme ou
// qu'une page navigue est annulé par le navigateur — au moment exact où on a
// besoin de lui. `navigator.sendBeacon` est fait pour ça : il confie le message
// au navigateur, qui l'envoie même si la page a disparu.
//
// ── AUCUNE CONFIANCE ACCORDÉE AU CORPS REÇU ────────────────────────────────
//
// Ce que le client envoie est un TÉMOIGNAGE, pas un fait : on l'enregistre à
// part (`incident_client`), jamais dans les colonnes que le serveur remplit.
// Un client qui se tromperait ou mentirait ne peut pas altérer le verdict.
// L'écriture passe par la session de l'appelant, donc la RLS s'applique : on ne
// peut annoter que les traces de son propre cabinet.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Court, à dessein : une balise se déclenche quand tout va mal. */
export const maxDuration = 10

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false }, { status: 401 })

  let corps: Record<string, unknown>
  try {
    corps = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const traceId = typeof corps?.traceId === 'string' && corps.traceId ? corps.traceId : null
  const periodeId = typeof corps?.periodeId === 'string' && corps.periodeId ? corps.periodeId : null

  // ── B-104 (2e passe) — LE CAS SANS TRACE EST LE PLUS IMPORTANT ──────────
  //
  // Cette route refusait tout témoignage sans `traceId`, « pour ne pas créer
  // de ligne orpheline ». C'était exactement le mauvais arbitrage : le 02/09,
  // la fenêtre de MiKL s'est fermée AVANT que le serveur n'ait ouvert sa
  // trace, et les deux moitiés de l'instrument se sont tues ensemble.
  //
  // Une ligne sans génération n'est pas orpheline : elle dit « quelqu'un a
  // essayé, et rien n'a démarré ». C'est le fait le plus utile de toute la
  // table, parce que c'est le seul que le serveur ne peut PAS constater.
  if (!traceId && !periodeId) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  // On borne ce qu'on accepte : un témoignage utile tient en peu de champs, et
  // une balise ne doit jamais devenir une porte d'écriture libre en base.
  const temoignage = {
    raison: typeof corps.raison === 'string' ? corps.raison.slice(0, 200) : 'inconnue',
    etape: typeof corps.etape === 'string' ? corps.etape.slice(0, 200) : null,
    message: typeof corps.message === 'string' ? corps.message.slice(0, 1000) : null,
    // Depuis combien de temps le parcours travaillait quand ça a lâché.
    apresMs: typeof corps.apresMs === 'number' ? corps.apresMs : null,
    // Le navigateur : un incident qui ne frappe qu'un moteur de rendu se voit
    // ici, et nulle part ailleurs.
    agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    recuLe: new Date().toISOString(),
  }

  // Cas nominal : le serveur avait démarré, on annote SA ligne.
  if (traceId) {
    const { error } = await supabase
      .from('generations_trace')
      .update({ incident_client: temoignage })
      .eq('id', traceId)

    if (error) {
      console.error('[generate/incident] annotation refusée :', error.message)
      return NextResponse.json({ ok: false }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  // Cas décisif : RIEN n'a démarré côté serveur, et seul le navigateur le sait.
  // On crée la ligne — `issue: 'abandon_client'`, fermée d'emblée puisqu'il n'y
  // a aucun travail à attendre. À ne pas confondre avec une ligne restée
  // OUVERTE, qui signifie l'inverse : le serveur avait commencé et il est mort.
  const cabinetId = user.app_metadata?.cabinet_id as string | undefined
  if (!cabinetId) return NextResponse.json({ ok: false }, { status: 403 })

  const { error } = await supabase.from('generations_trace').insert({
    cabinet_id: cabinetId,
    periode_id: periodeId,
    lance_par: user.id,
    fermee_le: new Date().toISOString(),
    issue: 'abandon_client',
    incident_client: temoignage,
  })

  if (error) {
    console.error('[generate/incident] tentative non enregistrée :', error.message)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
