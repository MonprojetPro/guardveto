// ============================================================
// GUARDVETO — Page /crise/volontaire (Gestion de crise — LOT 4)
// ============================================================
// Cible du lien email « Je prends ce créneau » (envoyé par sendAppelVolontaires).
// Query params : ?absence=…&garde=…&role=premier|second&pour=<veterinaire_id>
//
// Page pour un VÉTO authentifié (le layout (protected) garantit déjà une session
// + un profil véto actif). On y affiche le créneau concerné (date FR + type +
// rôle) et une question « Veux-tu prendre ce créneau ? ». La confirmation POST
// l'endpoint /api/absences/[id]/volontaire (qui REVALIDE tout côté serveur :
// auth + cabinet + identité + éligibilité + anti-collision). Cette page ne fait
// AUCUNE écriture : elle ne sert qu'à afficher le créneau et déclencher l'action.
//
// ⚠️ `pour` — À QUI l'e-mail a été envoyé (B-034, 2026-08-26).
// Le volontaire est TOUJOURS la session ouverte dans le navigateur. Tant que le
// lien ne portait pas son destinataire, ouvrir l'e-mail de Jean depuis la
// session d'Anne-Sophie proposait le créneau de Jean… à Anne-Sophie, sans un
// mot. Ce n'était pas une faille — le serveur refuse les non-candidats — mais un
// trou d'IDENTITÉ : rien ne disait « ce message n'est pas le tien ». Deux cas
// tout à fait ordinaires : le poste partagé du cabinet, et l'e-mail transféré.
// On compare donc ici, et l'endpoint recompare : un garde-fou qui ne vit que
// dans l'écran est contournable par une simple requête.
//
// Robustesse :
//   • params manquants / rôle invalide → message d'erreur propre (pas de crash).
//   • lien d'avant B-034 (sans `pour`) → traité comme incomplet, avec la marche
//     à suivre. Le tolérer laisserait le trou ouvert pour tous les e-mails déjà
//     partis, c'est-à-dire précisément ceux qui circulent.
//   • destinataire ≠ session ouverte → écran dédié + bouton pour se reconnecter
//     SANS perdre le créneau (on revient sur ce lien après connexion).
//   • garde introuvable dans le cabinet (RLS) → message « créneau introuvable ».
//   • L'éligibilité réelle est tranchée par l'endpoint, pas ici (un lien forwardé
//     ne contourne aucun contrôle).
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { CircleAlert, UserX } from 'lucide-react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { VolontaireConfirm } from '@/components/crise/VolontaireConfirm'
import { changerDeCompte } from '@/app/login/actions'
import { resoudreIdentite } from '@/lib/identite'
import type { RoleGarde } from '@/engine/types'
import { humaniserCodeGarde } from '@/lib/libelles-gardes'

// ── Helpers d'affichage FR ───────────────────────────────
function formatDateFr(dateIso: string): string {
  return new Date(dateIso + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function labelTypeDb(type: string): string {
  if (type === 'weekend') return 'Week-end'
  if (type === 'ferie') return 'Jour férié'
  if (type === 'semaine') return 'Soir de semaine'
  // Type SUR-MESURE (P3b) : son nom humanisé.
  return humaniserCodeGarde(type)
}

function labelRole(role: RoleGarde): string {
  return role === 'premier' ? '1er de garde' : '2nd de garde'
}

function estRole(v: string | undefined): v is RoleGarde {
  return v === 'premier' || v === 'second'
}

// ── Carte d'erreur générique (params manquants / introuvable) ──
function ErreurCard({ titre, message }: { titre: string; message: string }) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <CircleAlert className="w-5 h-5" aria-hidden />
            {titre}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}

/**
 * « Ce lien n'est pas le tien » — le destinataire de l'e-mail n'est pas la
 * personne connectée.
 *
 * Le ton n'accuse personne : ouvrir le mauvais e-mail sur un poste partagé
 * n'est pas une faute. On dit à qui le message était adressé, qui est connecté,
 * et on offre LA sortie utile — se connecter au bon compte et revenir ici. Sans
 * ce retour, la personne perdrait le créneau qu'elle venait prendre.
 */
function MauvaisCompteCard({
  destinataire,
  connecteNom,
  suite,
}: {
  destinataire: string | null
  connecteNom: string | null
  suite: string
}) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-600">
            <UserX className="w-5 h-5" aria-hidden />
            Cet appel ne t&apos;était pas adressé
          </CardTitle>
          <CardDescription>
            {destinataire
              ? `Cet e-mail a été envoyé à ${destinataire}.`
              : "Cet e-mail a été envoyé à un autre membre de l'équipe."}{' '}
            {connecteNom
              ? `Tu es connecté·e en tant que ${connecteNom}.`
              : 'Le compte ouvert dans ce navigateur est un autre compte.'}{' '}
            Si tu prenais ce créneau maintenant, il te serait attribué à toi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            C&apos;est le cas classique de l&apos;ordinateur partagé du cabinet, ou d&apos;un
            e-mail transféré. Connecte-toi avec le bon compte : tu reviendras
            directement sur ce créneau.
          </p>
        </CardContent>
        <CardFooter>
          <form action={changerDeCompte}>
            <input type="hidden" name="suite" value={suite} />
            <Button type="submit">Me connecter avec le bon compte</Button>
          </form>
        </CardFooter>
      </Card>
    </div>
  )
}

export default async function VolontairePage({
  searchParams,
}: {
  searchParams: Promise<{
    absence?: string
    garde?: string
    role?: string
    pour?: string
  }>
}) {
  const { absence: absenceId, garde: gardeId, role, pour } = await searchParams

  // ── Params manquants / invalides → message propre (pas de crash) ──
  if (!absenceId || !gardeId || !estRole(role)) {
    return (
      <ErreurCard
        titre="Lien incomplet"
        message="Ce lien d'appel aux volontaires est incomplet ou invalide. Ouvrez-le depuis l'email que vous avez reçu, ou rendez-vous sur votre planning."
      />
    )
  }

  // Lien d'avant B-034 : il ne dit pas à qui il était destiné, donc on ne peut
  // pas garantir que celui qui clique est le bon. On refuse plutôt que de
  // laisser passer — c'est exactement le cas qu'on vient de fermer.
  if (!pour) {
    return (
      <ErreurCard
        titre="Lien d'une ancienne version"
        message="Ce lien a été envoyé avant une mise à jour de sécurité et ne précise pas à qui il était destiné. Ouvrez votre planning pour voir les gardes à pourvoir, ou demandez à l'administratrice de relancer l'appel aux volontaires."
      />
    )
  }

  const supabase = await createClient()

  // ── QUI est connecté ? Le volontaire sera CETTE personne, pas le destinataire
  // de l'e-mail. Si les deux diffèrent, on s'arrête ici.
  const resultat = await resoudreIdentite(supabase)

  // Le layout (protected) garantit déjà une session ; ce cas couvre la base
  // muette et le compte sans rattachement. On ne déconnecte pas depuis ici (la
  // décision de déconnecter vit dans `identite.ts`), on explique.
  if (!resultat.ok) {
    return (
      <ErreurCard
        titre="Compte non reconnu"
        message="Impossible de rattacher le compte connecté à un vétérinaire pour le moment. Réessayez dans un instant, ou contactez l'administratrice."
      />
    )
  }

  const suite = `/crise/volontaire?absence=${encodeURIComponent(absenceId)}&garde=${encodeURIComponent(gardeId)}&role=${role}&pour=${encodeURIComponent(pour)}`

  // Le secrétariat n'assure pas de gardes : ce lien ne peut jamais être le sien.
  if (resultat.identite.genre !== 'veto') {
    return (
      <MauvaisCompteCard
        destinataire={null}
        connecteNom={resultat.identite.nomAffiche}
        suite={suite}
      />
    )
  }

  const moi = resultat.identite.veto

  if (moi.id !== pour) {
    // Le nom du destinataire, pour que le message soit utile plutôt que vague.
    // RLS borne la lecture au cabinet : un id d'un autre cabinet revient null,
    // et l'écran reste correct (message générique).
    const { data: cible } = await supabase
      .from('veterinaires')
      .select('prenom, nom')
      .eq('id', pour)
      .maybeSingle()

    const destinataire = cible
      ? `${(cible as { prenom: string }).prenom} ${(cible as { nom: string }).nom}`
      : null

    return (
      <MauvaisCompteCard
        destinataire={destinataire}
        connecteNom={`${moi.prenom} ${moi.nom}`}
        suite={suite}
      />
    )
  }

  // Le créneau concerné, pour l'afficher (date + type). RLS borne déjà la lecture
  // au cabinet du véto connecté : une garde d'un autre cabinet revient « null ».
  const { data: garde } = await supabase
    .from('gardes')
    .select('id, date, type')
    .eq('id', gardeId)
    .single()

  if (!garde) {
    return (
      <ErreurCard
        titre="Créneau introuvable"
        message="Cette garde n'existe plus ou n'est pas accessible depuis votre compte. Elle a peut-être déjà été réattribuée."
      />
    )
  }

  const dateLabel = formatDateFr(garde.date as string)
  const typeLabel = labelTypeDb(garde.type as string)
  const roleLabel = labelRole(role)

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <VolontaireConfirm
        absenceId={absenceId}
        gardeId={gardeId}
        role={role}
        pour={pour}
        dateLabel={dateLabel}
        typeLabel={typeLabel}
        roleLabel={roleLabel}
      />
    </div>
  )
}
