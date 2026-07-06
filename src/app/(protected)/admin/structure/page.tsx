// ============================================================
// GUARDVETO — Page /admin/structure
// ============================================================
// Écran admin de configuration de la structure des gardes d'un cabinet :
//   1. les PROFILS de planning (créer / dupliquer / régler) — P5 slice 4a ;
//   2. le catalogue des types de garde du profil défaut (lecture) — P5 slice 1 ;
//   3. les HORAIRES par type, réglés PAR PROFIL (creneau_modele) — P5 slice 4b.
//
// La RLS restrictive scope tout au cabinet courant. L'admin édite ; le véto
// consulte en lecture seule (comme /regles). Les horaires réglés ici sont ceux
// que la génération ET l'agenda utilisent réellement (via chargerStructureProfil).
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { CRENEAUX } from '@/engine/structure-creneaux'
import type { TypeGardeEngine } from '@/engine/types'
import type { CreneauModele } from '@/engine/creneau-modele'
import { chargerCreneauModele } from '@/data/chargerCreneauModele'
import {
  HorairesProfilEditor, type ProfilHorairesUI, type HoraireCreneauUI,
} from '@/components/admin/HorairesProfilEditor'
import {
  CatalogueCreneauxView, type CatalogueTypeUI,
} from '@/components/admin/CatalogueCreneauxView'
import {
  CatalogueCreneauxAdmin, type CatalogueTypeAdminUI,
} from '@/components/admin/CatalogueCreneauxAdmin'
import {
  ProfilsManager, type ProfilLigne,
} from '@/components/admin/ProfilsManager'
import { AssistantProfilIA } from '@/components/admin/AssistantProfilIA'

/** Types de garde connus, dans l'ordre d'affichage (les seuls horodatés par l'aval). */
const CODES_CONNUS: TypeGardeEngine[] = ['semaine_soir', 'vendredi_soir', 'weekend', 'ferie']

/** Jours en clair (0 = dimanche … 6 = samedi). */
const JOURS_COURTS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

/** Libellés « en clair » du jour de fin (miroir de StructureCreneauxClient). */
const OFFSET_CLAIR: Record<number, string> = {
  0: '', 1: ', le lendemain', 2: ', le surlendemain', 3: ', trois jours après',
}

/** Rôle en clair : premier → 1er, second → 2nd, troisieme → 3e… sinon le label brut. */
function roleClair(role: string): string {
  const map: Record<string, string> = {
    premier: '1er', second: '2nd', troisieme: '3e', quatrieme: '4e', cinquieme: '5e',
  }
  return map[role] ?? role
}

/** Décrit les jours couverts d'un type (jours de semaine + fériés). */
function joursClair(c: CreneauModele): string {
  const jours = [...c.joursSemaine].sort((a, b) => a - b).map((j) => JOURS_COURTS[j])
  const parts: string[] = []
  if (jours.length > 0) parts.push(jours.join(', '))
  if (c.surFeries) parts.push('jours fériés')
  return parts.length > 0 ? parts.join(' + ') : '—'
}

/** Décrit les places/rôles d'un type. */
function placesClair(c: CreneauModele): string {
  const n = c.nbPlaces
  const noms = c.roles.map(roleClair).join(', ')
  const motPlace = n > 1 ? 'places' : 'place'
  return noms ? `${n} ${motPlace} : ${noms}` : `${n} ${motPlace}`
}

/** Décrit les horaires d'un type. */
function horairesClair(c: CreneauModele): string {
  return `Garde de ${c.heureDebut} à ${c.heureFin}${OFFSET_CLAIR[c.offsetJoursFin] ?? ''}.`
}

/** Mappe le catalogue moteur → vue d'affichage (déjà mis en clair). */
function versCatalogueUI(catalogue: CreneauModele[]): CatalogueTypeAdminUI[] {
  return [...catalogue]
    .sort((a, b) => a.ordre - b.ordre)
    .map((c) => ({
      id: c.id,
      nom: c.nom,
      jours: joursClair(c),
      places: placesClair(c),
      horaires: horairesClair(c),
      actif: c.actif,
      estSeed: c.code !== null && CODES_CONNUS.includes(c.code as TypeGardeEngine),
    }))
}

/** Ligne brute d'horaires d'un créneau (par profil). */
interface CreneauHoraireRow {
  id: string
  code: string | null
  nom: string
  heure_debut: string // Postgres TIME → 'HH:MM:SS'
  heure_fin: string
  offset_jours_fin: number
  profil_id: string | null
  ordre: number
}

/** Postgres TIME 'HH:MM:SS' → 'HH:MM' pour l'input time. */
function hhmm(t: string): string {
  return t.slice(0, 5)
}

export default async function StructurePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentVeto } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()
  if (!currentVeto) redirect('/login')

  const isAdmin = currentVeto.role_app === 'admin'

  // cabinet_id (best-effort) pour filtrer les surcharges du cabinet.
  let cabinetId: string | null = null
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch {
    cabinetId = null
  }

  // Le VRAI catalogue du cabinet (creneau_modele) — la source que le moteur
  // consomme (jours / places / rôles). Vide si pas de cabinetId (best-effort).
  const catalogue = cabinetId ? await chargerCreneauModele(supabase, cabinetId) : []
  const catalogueUI = versCatalogueUI(catalogue)

  // Profils de planning du cabinet (P5 slice 4a) + horaires par profil (slice 4b).
  const { data: profilsDb } = cabinetId
    ? await supabase
        .from('profils_planning')
        .select('id, nom, est_defaut, saison_suggeree, nb_vetos_semaine_soir')
        .eq('actif', true)
        .order('ordre')
    : { data: null }
  const { data: cmRows } = cabinetId
    ? await supabase
        .from('creneau_modele')
        .select('id, code, nom, heure_debut, heure_fin, offset_jours_fin, profil_id, ordre')
        .eq('cabinet_id', cabinetId)
        .order('ordre')
    : { data: null }
  const horairesRows = (cmRows as CreneauHoraireRow[] | null) ?? []

  // Nombre de types par profil (badge du gestionnaire).
  const comptes = new Map<string, number>()
  for (const r of horairesRows) {
    if (r.profil_id) comptes.set(r.profil_id, (comptes.get(r.profil_id) ?? 0) + 1)
  }
  const profilsBase = (profilsDb as Omit<ProfilLigne, 'nb_types'>[] | null) ?? []
  const profils: ProfilLigne[] = profilsBase.map((p) => ({ ...p, nb_types: comptes.get(p.id) ?? 0 }))

  // Horaires éditables par profil (slice 4b, généralisé P3b) : un bloc de
  // cartes par profil, pour TOUS les créneaux codifiés — les 4 types connus
  // (libellé du référentiel) comme les sur-mesure (libellé = nom du catalogue).
  const profilsHoraires: ProfilHorairesUI[] = profilsBase.map((p) => ({
    id: p.id,
    nom: p.nom,
    est_defaut: p.est_defaut,
    creneaux: horairesRows
      .filter((r) => r.profil_id === p.id && r.code)
      .sort((a, b) => a.ordre - b.ordre)
      .map((r): HoraireCreneauUI => ({
        id: r.id,
        code: r.code as string,
        libelle: CODES_CONNUS.includes(r.code as TypeGardeEngine)
          ? CRENEAUX[r.code as TypeGardeEngine].libelle
          : r.nom,
        heureDebut: hhmm(r.heure_debut),
        heureFin: hhmm(r.heure_fin),
        offsetJoursFin: r.offset_jours_fin,
      })),
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Structure des gardes</h1>
        <p className="text-muted-foreground text-sm mt-1 leading-5 max-w-2xl">
          Voici comment votre cabinet organise ses gardes : les types de garde, les jours
          couverts, le nombre de vétérinaires par garde et leurs rôles. C&apos;est cette
          structure que le moteur utilise pour générer vos plannings.
          {!isAdmin && ' (Lecture seule — seul l’administrateur peut modifier.)'}
        </p>
      </div>

      {/* P5 slice 4a — gestionnaire de profils de planning. */}
      <section className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Profils de planning
          </h2>
          <p className="text-muted-foreground text-sm mt-1 leading-5 max-w-2xl">
            Un profil est une organisation de gardes réutilisable (ex. « Hiver », « Été »).
            À la création d&apos;une période, vous choisissez le profil à appliquer ; il peut
            être proposé automatiquement selon la saison. Créez un profil en le dupliquant,
            puis réglez sa saison suggérée et son effectif.
            {!isAdmin && ' (Lecture seule — seul l’administrateur peut modifier.)'}
          </p>
        </div>
        {/* P5 slice 5 — créer un profil en langage naturel (admin seul). */}
        {isAdmin && <AssistantProfilIA />}
        <ProfilsManager profils={profils} isAdmin={isAdmin} />
      </section>

      {/* P5 slice 1 + P3b — le vrai catalogue (jours / places / rôles).
          Admin : création sur-mesure, activation, suppression. Véto : lecture. */}
      <section className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Vos types de garde
          </h2>
          {isAdmin && (
            <p className="text-muted-foreground text-sm mt-1 leading-5 max-w-2xl">
              Ajoutez vos propres types de garde (garde de jour, samedi seul…) : le moteur
              les planifie comme les autres. Désactivez un type pour qu&apos;il ne soit plus
              planifié — par exemple le week-end complet, si vous le remplacez par un samedi
              et un dimanche séparés.
            </p>
          )}
        </div>
        {isAdmin ? (
          <CatalogueCreneauxAdmin
            types={catalogueUI}
            profils={profils.map((p) => ({ id: p.id, nom: p.nom, est_defaut: p.est_defaut }))}
          />
        ) : (
          <CatalogueCreneauxView types={catalogueUI} />
        )}
      </section>

      {/* P5 slice 4b — éditeur d'horaires PAR PROFIL. */}
      <section className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-foreground">Horaires par profil</h2>
          <p className="text-muted-foreground text-sm mt-1 leading-5 max-w-2xl">
            Réglez les horaires de chaque type de garde, <span className="font-medium">pour le profil
            choisi</span>. Un profil « Été » peut ainsi démarrer les gardes plus tard qu&apos;« Hiver ».
            Vos réglages s&apos;appliquent à la prochaine génération de planning et à la
            synchronisation de l&apos;agenda.
          </p>
        </div>
        <HorairesProfilEditor profils={profilsHoraires} isAdmin={isAdmin} />
      </section>

      <a href="/planning" className="inline-block text-sm text-muted-foreground hover:text-foreground transition-colors">
        ← Retour au planning
      </a>
    </div>
  )
}
