'use server'

import { createClient } from '@/lib/supabase/server'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Rafraîchit TOUS les écrans qui lisent la table `periodes`.
 *
 * Longtemps limité à `/historique`, le seul qui les listait. Depuis que la
 * création d'un planning se fait depuis « Générer » (2026-08-02), l'inventaire
 * des lecteurs a été refait :
 *
 *   • `/planning`  — la pilule de période ET l'assistant de génération.
 *                    Couvert aussi par `RealtimeRefresh` (il écoute `periodes`),
 *                    mais on ne s'en remet pas au seul Realtime : il ne tourne
 *                    que sur l'écran ouvert.
 *   • `/historique` — la liste des plannings et leurs réglages.
 *   • `/accueil`    — l'épicentre (`data/v2/accueilEpicentre.ts`) y lit la
 *                    période courante ; sans ça il restait figé sur l'ancienne.
 *   • `/regles`     — `data/optionsRegles.ts` propose les périodes quand on
 *                    limite une règle à l'une d'elles.
 *
 * Le dock de la barre V2 (`data/v2/dock.ts`) lit lui aussi les périodes, mais
 * il est rendu à l'intérieur de ces routes : les revalider le couvre.
 */
function revaliderPeriodes() {
  revalidatePath('/historique')
  revalidatePath('/planning')
  revalidatePath('/accueil')
  revalidatePath('/regles')
}

// ── Garde admin (même pattern que /regles et /admin/structure) ──
// La RLS periodes (write admin-only) protège déjà l'écriture ; cette garde
// ajoute un refus explicite en français au lieu d'une erreur Postgres brute.
async function assertAdmin(
  supabase: SupabaseClient<any, any, any>,
): Promise<{ error: string } | { veto: { id: string; role_app: string } }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }
  const { data: vet } = await supabase
    .from('veterinaires')
    .select('id, role_app')
    .eq('user_id', user.id)
    .single()
  if (!vet) return { error: 'Non authentifié.' }
  if (vet.role_app !== 'admin') {
    return { error: "Action réservée à l'administrateur du cabinet." }
  }
  return { veto: vet }
}

/** Une date ISO telle qu'on la lit à voix haute : « lundi 21 septembre 2026 ». */
function dateFr(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** Le lendemain — le premier jour redevenu libre après un planning. */
function jourSuivant(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// Détection automatique de la saison depuis la date de début
// Mai (5) → Août (8) = été, le reste = hiver
function detecterSaison(dateDebut: string): 'ete' | 'hiver' {
  const mois = new Date(dateDebut + 'T12:00:00Z').getUTCMonth() + 1
  return mois >= 5 && mois <= 8 ? 'ete' : 'hiver'
}

export async function creerPeriode(formData: FormData) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  const libelle   = (formData.get('libelle') as string | null)?.trim() || null
  const dateDebut = formData.get('date_debut') as string
  const dateFin   = formData.get('date_fin') as string

  if (!libelle) return { error: 'Le titre est obligatoire.' }
  if (!dateDebut || !dateFin) return { error: 'Les dates de début et de fin sont requises.' }

  // Vérification : date_debut doit être un lundi
  const jour = new Date(dateDebut + 'T12:00:00Z').getUTCDay()
  if (jour !== 1) {
    return { error: 'La date de début doit être un lundi.' }
  }

  // Un planning qui finit avant de commencer passait jusqu'ici sans un mot :
  // le test de chevauchement ci-dessous (date_debut <= dateFin ET date_fin >=
  // dateDebut) ne peut PAS l'attraper, la fenêtre étant vide. On repartait donc
  // avec une période inerte que le moteur remplissait de zéro garde.
  if (dateFin < dateDebut) {
    return { error: 'La date de fin doit venir après la date de début.' }
  }

  // Vérification : chevauchement avec une période existante
  const { data: chevauchements } = await supabase
    .from('periodes')
    .select('id, libelle, saison, numero, date_debut, date_fin')
    .lte('date_debut', dateFin)
    .gte('date_fin', dateDebut)

  if (chevauchements && chevauchements.length > 0) {
    const c = chevauchements[0]
    const label = c.libelle ?? (c.saison === 'ete' ? 'Été' : `Hiver P${c.numero ?? ''}`)
    // Message lisible par le cabinet : des dates en français, pas des ISO, et
    // la sortie indiquée. Un refus qui montre le mur sans montrer la porte
    // oblige l'admin à aller chercher lui-même les dates du planning fautif.
    return {
      error:
        `Ces dates se chevauchent avec le planning « ${label} », `
        + `qui va du ${dateFr(c.date_debut)} au ${dateFr(c.date_fin)}. `
        + `Choisis un départ après le ${dateFr(jourSuivant(c.date_fin))}, `
        + `ou raccourcis la durée.`,
    }
  }

  const saison = detecterSaison(dateDebut)

  // cabinet_id dérivé côté serveur (jamais du client) — sinon la période
  // est insérée avec cabinet_id NULL et reste invisible sous RLS stricte.
  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  // Profil de planning choisi (P5 slice 3c). Si l'admin en choisit un, on VÉRIFIE
  // qu'il appartient à son cabinet (garde tenant : la RLS restrictive borne déjà
  // la lecture, ce check rejette proprement un id étranger/inexistant). Sinon on
  // PROPOSE le profil dont saison_suggeree = saison détectée ; à défaut NULL
  // (= profil défaut du cabinet → byte-identique avec l'existant).
  const profilChoisi = (formData.get('profil_id') as string | null)?.trim() || null
  let profilId: string | null = null
  if (profilChoisi) {
    const { data: owned } = await supabase
      .from('profils_planning')
      .select('id')
      .eq('id', profilChoisi)
      .eq('cabinet_id', cabinetId)
      .maybeSingle()
    if (!owned) return { error: 'Profil invalide pour ce cabinet.' }
    profilId = profilChoisi
  } else {
    const { data: parSaison } = await supabase
      .from('profils_planning')
      .select('id')
      .eq('cabinet_id', cabinetId)
      .eq('saison_suggeree', saison)
      .eq('actif', true)
      .order('ordre')
      .limit(1)
      .maybeSingle()
    profilId = (parSaison as { id: string } | null)?.id ?? null
  }

  // `select('id')` : l'assistant de l'écran Planning enchaîne la génération sur
  // le planning qu'il vient de créer — sans cet id il devrait le retrouver à
  // tâtons par ses dates, et générerait le mauvais en cas d'homonyme.
  const { data: creee, error } = await supabase
    .from('periodes')
    .insert({
      cabinet_id: cabinetId,
      saison,
      numero:     null,
      libelle,
      date_debut: dateDebut,
      date_fin:   dateFin,
      statut:     'brouillon',
      profil_id:  profilId,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revaliderPeriodes()
  return { success: true, id: (creee as { id: string }).id }
}

/**
 * Rattache une période à un profil de planning (ou NULL = profil défaut du
 * cabinet). S'applique à la PROCHAINE génération. RLS periodes (write admin-only,
 * cabinet-borné) sécurise l'écriture ; on vérifie en plus que le profil est bien
 * visible pour ce cabinet (garde tenant, cohérente avec creerPeriode).
 */
export async function setProfilPeriode(periodeId: string, profilId: string | null) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  if (profilId) {
    const { data: owned } = await supabase
      .from('profils_planning')
      .select('id')
      .eq('id', profilId)
      .maybeSingle()
    if (!owned) return { error: 'Profil introuvable.' }
  }

  const { error } = await supabase
    .from('periodes')
    .update({ profil_id: profilId })
    .eq('id', periodeId)

  if (error) return { error: error.message }
  revaliderPeriodes()
  return { success: true }
}

/**
 * Règle l'effectif de garde la nuit en semaine (1 ou 2 vétos) pour une période.
 * RLS periodes (write admin-only) sécurise l'écriture. S'applique à la PROCHAINE
 * génération du planning de la période.
 */
export async function setEffectifPeriode(periodeId: string, nb: number) {
  if (!Number.isInteger(nb) || nb < 1 || nb > 4) {
    return { error: 'Effectif invalide (entre 1 et 4 vétérinaires).' }
  }
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  const { error } = await supabase
    .from('periodes')
    .update({ nb_vetos_semaine_soir: nb })
    .eq('id', periodeId)

  if (error) return { error: error.message }
  revaliderPeriodes()
  return { success: true }
}

/**
 * Supprime un planning. **Uniquement un BROUILLON** — c'est la seule ligne
 * rouge, et elle est double : le `.eq('statut', 'brouillon')` du delete la
 * tient même si l'appelant se trompe.
 *
 * CE QUI A CHANGÉ LE 2026-08-03 (demande explicite de MiKL : « je veux pouvoir
 * supprimer un brouillon déjà généré mais non publié »). L'action refusait tout
 * planning ayant des gardes. C'était trop prudent : un brouillon généré n'a
 * JAMAIS été vu par l'équipe, aucun e-mail n'est parti, aucun événement
 * d'agenda n'existe — tout cela se déclenche à la publication. Le seul travail
 * perdu est un calcul de quelques secondes, refaisable d'un clic. En échange,
 * les essais s'accumulaient sans aucun moyen de faire le ménage.
 *
 * CE QUE LA SUPPRESSION EMPORTE — inventaire refait à la source (contraintes
 * FK réelles, pas de mémoire) :
 *   • `gardes`, `attributions`, `bonus_malus` → ON DELETE CASCADE, la base s'en
 *     charge ;
 *   • `email_log`, `historique_fete` → ON DELETE SET NULL, les traces restent ;
 *   • `compteurs_gardes`, `planning_semaine` → ce sont des VUES, elles suivent ;
 *   • `regles_cabinet.periode_id` → NO ACTION : une règle limitée à ce planning
 *     BLOQUERAIT le delete. On le détecte AVANT pour l'expliquer, au lieu de
 *     laisser remonter une erreur de contrainte Postgres.
 *
 * Renvoie le nombre de gardes effacées, pour que l'écran puisse le dire.
 */
export async function supprimerPeriode(periodeId: string) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  const { data: per } = await supabase
    .from('periodes')
    .select('statut, libelle')
    .eq('id', periodeId)
    .maybeSingle()
  if (!per) return { error: 'Planning introuvable.' }

  const statut = (per as { statut?: string }).statut
  if (statut !== 'brouillon') {
    return {
      error: statut === 'publie'
        ? 'Ce planning est publié : l’équipe l’a déjà vu. Il faut le dépublier avant de pouvoir le supprimer.'
        : 'Ce planning est verrouillé : il fait partie de l’historique du cabinet.',
    }
  }

  // Règles limitées à CE planning : la FK est en NO ACTION, le delete
  // échouerait avec une erreur Postgres illisible. On l'annonce en français.
  const { count: nbRegles } = await supabase
    .from('regles_cabinet')
    .select('id', { count: 'exact', head: true })
    .eq('periode_id', periodeId)
  if (nbRegles && nbRegles > 0) {
    return {
      error: `${nbRegles} règle${nbRegles > 1 ? 's sont limitées' : ' est limitée'} à ce planning. `
        + `Supprime-la${nbRegles > 1 ? 's' : ''} ou rends-la${nbRegles > 1 ? 's' : ''} permanente${nbRegles > 1 ? 's' : ''} avant d’effacer le planning.`,
    }
  }

  const { count: nbGardes } = await supabase
    .from('gardes')
    .select('id', { count: 'exact', head: true })
    .eq('periode_id', periodeId)

  // `attributions.planning_id` cascade désormais, mais on garde ce nettoyage
  // explicite : une génération dont l'écriture V1 a échoué à mi-course peut
  // avoir laissé des lignes V2 rattachées à un planning qui, lui, n'existe
  // plus vraiment. Le faire AVANT coûte une requête et ne peut pas nuire.
  const { error: attribErr } = await supabase
    .from('attributions')
    .delete()
    .eq('planning_id', periodeId)
  if (attribErr) return { error: attribErr.message }

  const { error } = await supabase
    .from('periodes')
    .delete()
    .eq('id', periodeId)
    .eq('statut', 'brouillon')

  if (error) return { error: error.message }

  revaliderPeriodes()
  return { success: true, nbGardes: nbGardes ?? 0 }
}
