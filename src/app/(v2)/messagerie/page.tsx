// ============================================================
// GUARDVETO V2 — Écran « Messagerie » (B-193, chantier 5 du cadrage V3)
// ============================================================
// MiKL, 06/11 : « comme WhatsApp mais en interne » — le fil de toute l'équipe,
// et des conversations privées à deux. Ouvert aux TROIS rôles : vétérinaires,
// administratrice, et secrétariat (« s'ils ont des questions »).
//
// Le partage de territoire décidé le 10/09 tient toujours : on y met ce qui
// touche au cabinet et au planning ; leur groupe WhatsApp garde l'informel.
//
// Trois portes, dans cet ordre : le compte (`exigerIdentite`), le module
// (`modulesDuCabinet` → écran « éteint » plutôt qu'une page vide), puis la
// BASE, qui refuse d'elle-même tout ce que la personne n'a pas le droit de
// lire — ce fichier ne filtre rien, il affiche ce qu'on lui rend.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import '@/styles/v2-messagerie.css'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { ModuleEteint } from '@/components/v2/ModuleEteint'
import { MessagerieV2 } from '@/components/v2/MessagerieV2'
import { chargerDock } from '@/data/v2/dock'
import { exigerIdentite } from '@/lib/identite'
import { modulesDuCabinet } from '@/lib/produit/modules-serveur'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { lireConversations } from './actions'
import { estUuid, type MembreAnnuaire } from '@/lib/messagerie/regles'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'GuardVeto — Messagerie' }

export default async function MessageriePage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const identite = await exigerIdentite(supabase)
  const estAdmin = identite.role === 'admin'
  const estSecretaire = identite.role === 'secretaire'

  const [dock, modules] = await Promise.all([
    chargerDock(supabase, { role_app: identite.role }),
    modulesDuCabinet(supabase),
  ])

  const barre = (
    <BarreV2
      prenom={identite.nomAffiche}
      estAdmin={estAdmin}
      estSecretaire={estSecretaire}
      dock={dock}
    />
  )

  if (!modules.includes('chat')) {
    return (
      <>
        <Satin />
        <div className="shell">
          {barre}
          <ModuleEteint module="chat" estAdmin={estAdmin} />
        </div>
      </>
    )
  }

  // Le fil d'équipe naît à la première ouverture : sans lui, la liste serait
  // vide et l'écran n'offrirait rien à quelqu'un qui veut écrire à tous.
  const { error: erreurEquipe } = await supabase.rpc('messagerie_conversation_equipe')
  if (erreurEquipe) {
    console.error('[Messagerie] Fil d’équipe introuvable :', erreurEquipe.message)
  }

  const [liste, annuaireRes, utilisateur] = await Promise.all([
    lireConversations(),
    supabase.rpc('messagerie_annuaire'),
    supabase.auth.getUser(),
  ])

  let cabinetId: string | null = null
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch {
    cabinetId = null
  }

  if (annuaireRes.error) {
    console.error('[Messagerie] Annuaire illisible :', annuaireRes.error.message)
  }
  const annuaire: MembreAnnuaire[] = (
    (annuaireRes.data ?? []) as { user_id: string; nom: string; role: string; a_email: boolean | null }[]
  ).map((m) => ({
    userId: m.user_id,
    nom: m.nom,
    role: m.role === 'admin' || m.role === 'secretaire' ? m.role : 'veto',
    aEmail: m.a_email === true,
  }))

  const conversations = liste.ok ? liste.conversations : []
  const demandee = estUuid(params.c) ? params.c : null
  const ouverte =
    (demandee && conversations.find((c) => c.id === demandee)?.id) ??
    conversations.find((c) => c.genre === 'equipe')?.id ??
    null

  return (
    <>
      <Satin />
      <div className="shell">
        {barre}
        <MessagerieV2
          moiUserId={utilisateur.data.user?.id ?? ''}
          cabinetId={cabinetId}
          estAdmin={estAdmin}
          conversationsInitiales={conversations}
          erreurInitiale={liste.ok ? (erreurEquipe ? 'Le fil de l’équipe n’a pas pu être ouvert.' : null) : liste.error}
          annuaire={annuaire}
          conversationOuverte={ouverte}
          // L'adresse demandait une conversation qui n'est pas (ou plus) la
          // sienne : on le dit, au lieu d'ouvrir le fil d'équipe sans un mot.
          introuvable={Boolean(demandee) && ouverte !== demandee}
          ouvrirFil={Boolean(demandee) && ouverte === demandee}
        />
      </div>
    </>
  )
}
