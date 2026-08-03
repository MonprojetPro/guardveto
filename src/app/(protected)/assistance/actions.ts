'use server'

// ============================================================
// GUARDVETO — Quand le système atteint sa limite
// ============================================================
// PALIER 4 de l'audit du 2026-08-03. Demande de MiKL, mot pour mot :
//
//   « avec toujours ce garde-fou en fond qui est qu'on pourra pas anticiper
//     tous les scénarios, et que c'est là que Filou intervient encore pour
//     informer l'utilisateur de la limite du système et que Filou me contacte
//     pour que je puisse régler ça à distance et faire évoluer le produit
//     toujours plus et mieux. »
//
// Les trois premiers paliers empêchent ce qu'on sait prévoir. Celui-ci traite
// ce qu'on n'a PAS prévu — et il n'y a aucune honte à ça : un moteur de
// planning rencontre des configurations que personne n'a imaginées. La faute
// serait de laisser le cabinet seul devant, sans que quiconque l'apprenne.
//
// CE QUI PART, ET POURQUOI
//
// Le contexte TECHNIQUE, pas les données du cabinet : quel écran, quelle
// période, quel diagnostic, quelles règles en cause. De quoi reproduire et
// corriger à distance — pas de quoi reconstituer un planning nominatif. Le
// message libre de l'utilisateur part tel qu'il l'a écrit : c'est souvent la
// phrase la plus utile du signalement.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { sendBrevoEmail } from '@/lib/brevo'

/** Où arrivent les signalements. L'adresse de l'éditeur, pas du cabinet. */
const DESTINATAIRE = process.env.GUARDVETO_ASSISTANCE_EMAIL?.trim() || 'contact@monprojet-pro.com'

export interface SignalementLimite {
  /** D'où vient le signalement : « génération », « règles », « congés »… */
  origine: string
  /** Ce que l'utilisateur a écrit — la phrase la plus utile du lot. */
  message?: string
  /** Le contexte technique déjà connu de l'écran (diagnostic, période, codes). */
  contexte?: Record<string, unknown>
}

function echapper(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Prévient l'éditeur qu'un cas n'est pas couvert.
 *
 * BEST-EFFORT ASSUMÉ : un signalement qui échoue ne doit pas ajouter une panne
 * à la panne. On renvoie alors de quoi le dire honnêtement à l'utilisateur —
 * « je n'ai pas réussi à prévenir l'équipe » — plutôt qu'un faux « c'est
 * envoyé » qui le laisserait attendre une réponse qui ne viendra jamais.
 */
export async function signalerLimite(signalement: SignalementLimite) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('prenom, nom, role_app')
    .eq('user_id', user.id)
    .maybeSingle()

  let cabinetId = 'inconnu'
  let cabinetNom = 'inconnu'
  try {
    cabinetId = await resoudreCabinetId(supabase)
    const { data: cab } = await supabase
      .from('cabinets')
      .select('nom')
      .eq('id', cabinetId)
      .maybeSingle()
    cabinetNom = (cab as { nom?: string } | null)?.nom ?? 'sans nom'
  } catch {
    // On envoie quand même : un signalement incomplet vaut mieux qu'aucun.
  }

  const qui = vet
    ? `${(vet as { prenom: string }).prenom} ${(vet as { nom: string }).nom} (${(vet as { role_app: string }).role_app})`
    : user.email ?? 'utilisateur inconnu'

  const lignesContexte = Object.entries(signalement.contexte ?? {})
    .map(([k, v]) => `<li><b>${echapper(k)}</b> : <code>${echapper(
      typeof v === 'string' ? v : JSON.stringify(v),
    )}</code></li>`)
    .join('')

  const html = `
    <h2>Signalement GuardVeto — ${echapper(signalement.origine)}</h2>
    <p><b>Cabinet</b> : ${echapper(cabinetNom)} (<code>${echapper(cabinetId)}</code>)<br/>
       <b>Par</b> : ${echapper(qui)}</p>
    ${signalement.message
      ? `<h3>Ce que dit l’utilisateur</h3><blockquote>${echapper(signalement.message)}</blockquote>`
      : '<p><i>Aucun message libre.</i></p>'}
    ${lignesContexte ? `<h3>Contexte technique</h3><ul>${lignesContexte}</ul>` : ''}
  `

  try {
    await sendBrevoEmail({
      to: DESTINATAIRE,
      toName: 'Assistance GuardVeto',
      subject: `[GuardVeto] ${signalement.origine} — ${cabinetNom}`,
      htmlContent: html,
    })
  } catch (e) {
    console.error('[assistance] signalement non transmis :', e)
    return { error: 'Je n’ai pas réussi à prévenir l’équipe. Réessaie dans un moment.' }
  }

  return { success: true }
}
