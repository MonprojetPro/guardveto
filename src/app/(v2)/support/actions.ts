'use server'

// ============================================================
// GUARDVETO V2 — Déposer une demande de support (B-016)
// ============================================================
// Le fichier est déjà DANS le stockage quand cette action démarre : le
// navigateur l'y a poussé directement, sans passer par la plateforme. L'action
// ne reçoit donc que des chemins — quelques dizaines d'octets — et le plafond
// de 4,5 Mo de Vercel ne peut plus rien casser (leçon du 2026-08-18 : un
// contrôle derrière un plafond de plateforme ne s'exécute JAMAIS).
//
// ── L'ORDRE DES OPÉRATIONS N'EST PAS ARBITRAIRE ─────────────────────────────
//
// ① On enregistre la demande. ② Ensuite seulement on tente l'e-mail. ③ On
// revient écrire si l'envoi a réussi.
//
// L'inverse aurait été plus simple à écrire et faux : une demande perdue parce
// que le serveur d'envoi tousse, c'est exactement ce que ce chantier vient
// supprimer. Une demande enregistrée dont l'e-mail n'est pas parti reste une
// demande — l'écran le dit franchement, et elle est là au prochain passage.
//
// ── LE HUITIÈME CHEMIN D'ENVOI ──────────────────────────────────────────────
//
// Le 2026-08-21, six chemins d'e-mail sur sept étaient cassés et un seul
// fonctionnait : celui du bouton de test, le seul qu'on regardait. Cet envoi-ci
// passe donc par `sendBrevoEmail` comme les sept autres, sans variante. Un
// huitième chemin qui aurait sa propre tuyauterie serait un huitième endroit où
// la panne peut se cacher.
//
// Il ne se journalise PAS dans `email_log`, et c'est délibéré : ce journal est
// celui des e-mails du cabinet vers SON équipe (l'insert y est réservé à
// l'administrateur, la lecture aussi), alors qu'ici n'importe quel membre écrit
// vers l'éditeur. La trace vit dans `demandes_support.email_envoye` /
// `email_erreur`, et elle est affichée à l'écran — pas cachée dans un journal
// que l'auteur de la demande n'a pas le droit d'ouvrir.
//
// ── CE QUI N'EST JAMAIS CRU SUR PAROLE ──────────────────────────────────────
//
// Le cabinet et l'auteur viennent de la BASE, jamais du formulaire. Les chemins
// des pièces sont revérifiés préfixe par préfixe : un chemin fabriqué à la main
// qui commencerait par l'identifiant d'un autre cabinet est refusé ici, en plus
// de l'être par la policy du bucket.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { sendBrevoEmail } from '@/lib/brevo'
import { raisonEchec } from '@/lib/emails/echec'
import { corpsEmailSupport, sujetEmailSupport, type PieceJointeEmail } from '@/lib/emails/support'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { NB_PIECES_MAX, refusDemande, refusFichier } from '@/lib/support/contraintes'
import type { DepotDemande } from '@/lib/support/types'

/** L'adresse de l'éditeur. Surchargée par `SUPPORT_EMAIL` si un jour une boîte dédiée existe. */
const DESTINATAIRE_PAR_DEFAUT = 'contact@monprojet-pro.com'

/**
 * Combien de temps un lien de pièce jointe reste ouvrable : 60 jours.
 *
 * Assez long pour qu'une demande traitée trois semaines plus tard s'ouvre
 * encore ; assez court pour qu'un e-mail qui fuite ne donne pas un accès
 * perpétuel à une capture d'écran de planning.
 */
const DUREE_LIEN_SECONDES = 60 * 24 * 3600

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Enregistre une demande de support et la transmet à l'éditeur.
 *
 * Retourne toujours un message déjà écrit en français : l'écran l'affiche mot
 * pour mot, il ne reformule rien (règle du projet — une reformulation côté
 * composant finit toujours par diverger du refus réel).
 */
export async function deposerDemandeSupport(
  depot: DepotDemande,
): Promise<{ success: true; emailEnvoye: boolean; avertissement: string | null } | { error: string }> {
  const supabase = await createClient()

  // ── Qui écrit ? La base répond, pas le formulaire ──────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { data: moi, error: erreurMoi } = await supabase
    .from('veterinaires')
    .select('id, prenom, nom, email, role_app, actif')
    .eq('user_id', user.id)
    .eq('actif', true)
    .single()

  // L'erreur est LUE, jamais avalée : sans ça, une base qui ne répond pas
  // devient « ta fiche n'existe pas », et on cherche un problème de compte là
  // où il y a une panne réseau (leçon B-011, 2026-08-24).
  if (erreurMoi) {
    console.error('[Support] Lecture de la fiche impossible :', erreurMoi.message)
    return { error: "Je n'arrive pas à lire ta fiche pour le moment. Réessaie dans un instant." }
  }
  const vet = moi as { id: string; prenom: string; nom: string; email: string | null } | null
  if (!vet) return { error: 'Non authentifié.' }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch {
    return { error: "Ton compte n'est rattaché à aucun cabinet — je ne peux pas rattacher ta demande." }
  }

  // ── Ce que la demande a le droit d'être ────────────────────────────────
  if (!UUID.test(depot.demandeId)) {
    return { error: 'Cette demande est mal formée. Recharge la page et recommence.' }
  }
  if (depot.type !== 'bug' && depot.type !== 'amelioration') {
    return { error: 'Précise s’il s’agit d’un problème ou d’une idée.' }
  }

  const refus = refusDemande(depot)
  if (refus) return { error: refus }

  const pieces = depot.pieces ?? []
  if (pieces.length > NB_PIECES_MAX) {
    return { error: `Trois pièces jointes au maximum — il y en a ${pieces.length}.` }
  }

  // Le préfixe du chemin EST la frontière entre cabinets. On le revérifie ici
  // même si la policy du bucket le vérifie aussi : deux gardiens, parce que
  // celui-ci dit pourquoi en français et que l'autre dit non.
  const prefixe = `${cabinetId}/${depot.demandeId}/`
  for (const p of pieces) {
    if (!p.chemin.startsWith(prefixe)) {
      console.warn('[Support] Chemin de pièce jointe hors périmètre, refusé :', p.chemin)
      return { error: 'Une pièce jointe ne correspond pas à cette demande. Recharge la page et recommence.' }
    }
    const refusPiece = refusFichier({ name: p.nomOrigine, size: p.taille, type: p.typeMime })
    if (refusPiece) return { error: refusPiece }
  }

  // ── ① La demande existe, quoi qu'il arrive ensuite ─────────────────────
  const contexte = {
    ecran: depot.ecran,
    navigateur: depot.navigateur,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.trim()?.slice(0, 7) ?? null,
  }

  const { error: erreurInsert } = await supabase.from('demandes_support').insert({
    id: depot.demandeId,
    cabinet_id: cabinetId,
    auteur_id: vet.id,
    type: depot.type,
    titre: depot.titre.trim(),
    description: depot.description.trim(),
    pieces_jointes: pieces.map((p) => p.chemin),
    contexte,
  })

  if (erreurInsert) {
    console.error('[Support] Enregistrement refusé :', erreurInsert.message)
    return {
      error:
        "Je n'ai pas réussi à enregistrer ta demande. Rien n'a été envoyé — réessaie, et préviens-moi si ça recommence.",
    }
  }

  // ── ② Les liens signés, puis l'e-mail ──────────────────────────────────
  const piecesEmail: PieceJointeEmail[] = []
  let piecesManquees = 0

  for (const p of pieces) {
    const { data, error } = await supabase.storage
      .from('support')
      .createSignedUrl(p.chemin, DUREE_LIEN_SECONDES)

    if (error || !data?.signedUrl) {
      // On compte et on continue : une pièce non signée ne doit pas retenir le
      // signalement lui-même. Le fichier est en place, il reste récupérable.
      piecesManquees += 1
      console.error('[Support] Lien signé impossible pour', p.chemin, error?.message)
      continue
    }
    piecesEmail.push({ nom: p.nomOrigine, lien: data.signedUrl, taille: p.taille })
  }

  const { data: cabinetDb } = await supabase
    .from('cabinets')
    .select('nom')
    .eq('id', cabinetId)
    .maybeSingle()
  const nomCabinet = ((cabinetDb as { nom?: string | null } | null)?.nom ?? '').trim() || 'Cabinet'

  const quand = new Date().toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const echeance = new Date(Date.now() + DUREE_LIEN_SECONDES * 1000).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const destinataire = process.env.SUPPORT_EMAIL?.trim() || DESTINATAIRE_PAR_DEFAUT

  const resultat = await sendBrevoEmail({
    to: destinataire,
    toName: 'Support GuardVeto',
    subject: sujetEmailSupport(depot.type, nomCabinet, depot.titre.trim()),
    htmlContent: corpsEmailSupport({
      type: depot.type,
      titre: depot.titre.trim(),
      description: depot.description.trim(),
      auteur: `${vet.prenom} ${vet.nom}`,
      auteurEmail: vet.email,
      cabinet: nomCabinet,
      demandeId: depot.demandeId,
      pieces: piecesEmail,
      echeance,
      contexte,
      quand,
    }),
    // Expéditeur GÉNÉRIQUE, pas celui du cabinet : ce message va vers
    // l'éditeur, pas vers l'équipe. L'adresse du cabinet sert à ce que les
    // vétérinaires reconnaissent leur propre cabinet — elle n'a rien à faire
    // ici, et une adresse cabinet mal réglée ferait tomber le support avec le
    // reste (incident du 2026-08-21).
    fromEmail: null,
    fromName: 'GuardVeto',
  })

  const envoye = 'success' in resultat
  const erreurBrute = 'error' in resultat ? (resultat.error ?? null) : null

  // ── ③ Le verdict de l'envoi, écrit sur la demande ──────────────────────
  // `error` est LU. Une trace ratée ne doit pas faire croire à un envoi raté —
  // ni l'inverse.
  const { error: erreurMaj } = await supabase
    .from('demandes_support')
    .update({ email_envoye: envoye, email_erreur: erreurBrute })
    .eq('id', depot.demandeId)

  if (erreurMaj) {
    console.error('[Support] Verdict d’envoi non enregistré :', erreurMaj.message)
  }

  revalidatePath('/support')

  const avertissements: string[] = []
  if (!envoye) {
    avertissements.push(
      `Ta demande est enregistrée, mais l’e-mail vers l’éditeur n’est pas parti. ${raisonEchec(erreurBrute ?? '')} Ta demande ne se perd pas pour autant : elle reste dans la liste ci-dessous.`,
    )
  }
  if (piecesManquees > 0) {
    avertissements.push(
      piecesManquees === 1
        ? 'Une pièce jointe n’a pas pu être rattachée à l’e-mail. Le fichier est bien déposé.'
        : `${piecesManquees} pièces jointes n’ont pas pu être rattachées à l’e-mail. Les fichiers sont bien déposés.`,
    )
  }

  return {
    success: true,
    emailEnvoye: envoye,
    avertissement: avertissements.length > 0 ? avertissements.join(' ') : null,
  }
}
