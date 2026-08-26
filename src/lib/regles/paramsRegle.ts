// ============================================================
// GUARDVETO — Construction des params d'une règle du cabinet
// ============================================================
// CE FICHIER EST UNE EXTRACTION, PAS UNE RÉÉCRITURE.
//
// Tout ce qui suit vivait dans `app/(protected)/regles/actions.ts`. Il en a
// été sorti tel quel le 2026-08-02, pour une raison précise : le gardien de
// cohérence doit pouvoir construire la règle que l'utilisateur est en train de
// saisir — SANS l'écrire — afin de la soumettre au pré-vol du moteur. Or un
// fichier `'use server'` ne peut exporter que des fonctions async : ces
// constructeurs purs y étaient donc prisonniers.
//
// La règle candidate est bâtie ici, et la règle enregistrée aussi. C'est la
// MÊME fonction : un gardien qui vérifierait une autre forme que celle qui
// sera écrite ne garderait rien du tout.
//
// Rien n'est vérifié ici contre la BASE (existence d'un véto, catalogue de
// créneaux, doublons) : ces contrôles restent dans les actions, qui ont
// Supabase sous la main. Ce module ne connaît que la FORME.
// ============================================================

/** Les briques que le moteur sait réellement évaluer (mapReglesCabinet). */
export const BRIQUES_EVALUABLES = {
  interdire_creneau: 'jour_repos_fixe',
  repos_conditionnel: 'jour_repos_conditionnel',
  alternance_ancre: 'indisponibilite_cyclique',
  duo_interdit: 'duo_interdit',
  au_plus_n: 'au_plus_n',           // limite de charge réglable
  espacement_min: 'espacement_min', // écart minimal entre deux gardes
  espacement_weekend: 'espacement_weekend', // fréquence WE : au plus 1 WE sur N
  // Desiderata (n°7) — préférences positives, TOUJOURS souples (force
  // « jamais » refusée plus bas : aucun gardien dur n'existe pour elles).
  preferer_creneau: 'preferer_creneau',
  preferer_avec: 'preferer_avec',
  volume_gardes: 'volume_gardes',
  // Successions / séries / repos avancés (Vague 5 tranche B — #13).
  succession_interdite: 'succession_interdite',
  serie_max: 'serie_max',
  repos_apres_serie: 'repos_apres_serie',
  // Cadencement « 1 WE sur N ancré » (Vague 5 tranche C — #20).
  cadencement_weekend: 'cadencement_weekend',
  // Exclusion de dates / XOR « pas les deux » (Vague 6 tranche B — #15a).
  exclusion_dates: 'exclusion_dates',
  // Garde conditionnelle ORIENTÉE « seulement avec B » (Vague 6 tranche C — #15b).
  seulement_avec: 'seulement_avec',
} as const
export type BriqueEvaluable = keyof typeof BRIQUES_EVALUABLES

/** Briques desiderata : préférences pures — jamais d'interdiction ferme. */
export const BRIQUES_DESIDERATA = new Set<BriqueEvaluable>([
  'preferer_creneau', 'preferer_avec', 'volume_gardes',
])

// ── Règle « tous les vétérinaires » (2026-08-20) ──────────────
// Une règle de rythme (fréquence des week-ends, espacement, limite de charge)
// concerne en pratique TOUT le cabinet. La créer véto par véto est fastidieux
// et surtout DANGEREUX : un véto oublié — ou embauché après coup — repart sans
// la règle, en silence. On écrit donc UNE ligne `qui.type = 'tous'`, dépliée
// sur l'effectif RÉEL au moment du chargement (cf. mapperReglesCabinet).
//
// ⚠️ Le dépliage est fait par le mapper, PAS à l'écriture : figer les ids à la
//    création réintroduirait exactement le trou qu'on ferme (nouveau véto sans
//    la règle). C'est la raison d'être de ce mode — ne pas « optimiser » en
//    écrivant la liste des refs.

/** Valeur sentinelle du champ « propriétaire » côté formulaire = tout l'effectif. */
export const OWNER_TOUS = '__tous__'

/** Libellé unique — l'écran Règles, la fiche Équipe et Filou disent la MÊME chose. */
export const LIBELLE_OWNER_TOUS = 'Tous les vétérinaires'

/**
 * Briques qui désignent un PARTENAIRE nommé (`avec_veterinaire_id`) : « tous »
 * n'y a aucun sens (« personne ne peut être avec personne ») et produirait une
 * règle qui se contredit elle-même dès qu'elle se déplie sur son partenaire.
 * Le formulaire n'offre pas l'option pour elles, et le serveur la refuse.
 */
export const BRIQUES_SANS_TOUS = new Set<BriqueEvaluable>([
  'duo_interdit', 'preferer_avec', 'seulement_avec',
])

/** Forces sélectionnables par l'admin (les niveaux système sont exclus). */
export const FORCES_VALIDES = ['jamais', 'sauf_crise', 'evitee', 'si_possible'] as const
export type ForceFormulaire = (typeof FORCES_VALIDES)[number]

const JOURS_VALIDES = new Set(['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'])
// Préférences de jours (preferer_creneau) : les 7 jours (un créneau weekend
// est daté du samedi ; le vendredi soir du vendredi).
const JOURS_VALIDES_TOUS = new Set([
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
])
const SEMAINES_VALIDES = new Set(['paires', 'impaires', 'toutes'])
// Parite d'un REPOS FIXE (B-038). Au SINGULIER, contrairement a `SEMAINES_VALIDES`
// ci-dessus : c'est le mot que lisent `violeReposFixe` et `validerPlanning` dans
// la forme « tableau de regles ». Les confondre ne leve aucune erreur — la regle
// s'enregistre et n'est simplement jamais appliquee.
const PARITES_VALIDES = new Set(['toutes', 'paire', 'impaire'])
const PERIODES_VALIDES = new Set(['soir_semaine', 'weekend']) // seules évaluées par R2
// Fenêtres de comptage acceptées par checkAuPlusN (hard-constraints.ts) :
// « semaine_civile » (lundi→dimanche) ou « glissante_K_jours » (regex moteur).
const FENETRES_VALIDES = new Set([
  'semaine_civile', 'glissante_7_jours', 'glissante_14_jours', 'glissante_30_jours',
])
const N_MAX_GARDES = 14    // borne haute raisonnable (au plus N gardes / fenêtre)
const ECART_MAX_JOURS = 30 // borne haute raisonnable (espacement minimal)
// Fréquence WE : « 1 week-end sur N ». N=1 = aucune contrainte (inerte) → min 2.
const N_SEM_WE_MIN = 2
const N_SEM_WE_MAX = 26    // une période fait 12-17 semaines : 26 couvre large
// Séries / repos avancés (#13) : bornes hautes raisonnables (jours).
const SERIE_MAX_JOURS = 31 // « pas plus de N jours d'affilée » — 31 couvre large
const REPOS_APRES_MAX = 30 // jours de repos imposés après une série
// Cadencement WE « 1 sur N ancré » (#20) : N=1 = tous les WE (inerte) → min 2.
// Max 12 : au-delà, un cycle plus long qu'une période hiver n'a guère de sens.
const N_SEM_CADENCE_MIN = 2
const N_SEM_CADENCE_MAX = 12
const SENS_CADENCE_VALIDES = new Set(['interdit', 'impose'])
// Exclusion « pas les deux » (#15a) : codes fête reconnus (référentiel historique).
const CODES_FETE_VALIDES = new Set(['noel', 'nouvel_an'])

/** Payload envoyé par le formulaire (champs simples — le JSON est bâti ici). */
export interface UpsertReglePayload {
  id?: string // présent = édition
  /**
   * L'admin a vu les conséquences et veut écrire quand même.
   *
   * Sans ce drapeau, le serveur REFUSE une règle qui rend la génération
   * impossible (contrôle d'impact, audit du 2026-08-03). Il n'est jamais posé
   * par Filou : un assistant ne passe pas outre un blocage à la place de
   * l'humain, il rapporte le refus et laisse trancher.
   */
  confirmeImpact?: boolean
  brique_id: BriqueEvaluable
  owner_id: string
  force: ForceFormulaire
  /** null/absent = règle permanente ; un id = règle limitée à cette période. */
  periode_id?: string | null
  // interdire_creneau
  jour?: string
  exception_vacances_scolaires?: boolean
  /** Parite des semaines visees (B-038). Absent ou 'toutes' = toutes les semaines. */
  semaine?: string
  // repos_conditionnel
  si_garde_we?: string
  sinon?: string
  // alternance_ancre
  semaines?: string
  periodes?: string[]
  // duo_interdit
  avec_veterinaire_id?: string
  // au_plus_n
  n?: number
  fenetre?: string
  /** Filtre optionnel par types de créneaux du cabinet (axe `quoi`, n°19).
   *  Vide/absent = toutes les gardes comptent (comportement historique). */
  creneaux?: string[]
  // espacement_min
  ecart_min_jours?: number
  // espacement_weekend
  n_semaines?: number
  // preferer_creneau (n°7) : jours et/ou créneaux préférés (creneaux réutilisé)
  jours?: string[]
  // volume_gardes (n°7)
  sens?: string
  // succession_interdite (#13) : « pas de B le lendemain de A »
  type_avant?: string
  type_apres?: string
  // serie_max (#13) : « jamais plus de N jours d'affilée » (creneaux réutilisé)
  n_jours?: number
  // repos_apres_serie (#13) : « après N jours, M jours de repos »
  repos_jours?: number
  // cadencement_weekend (#20) : « 1 WE sur N ancré » — n_semaines réutilisé.
  // `sens` est partagé avec volume_gardes (plus/moins) mais porte ici interdit/impose.
  ancre?: string // date ISO yyyy-MM-dd (un samedi de référence)
  // exclusion_dates (#15a) : XOR « pas les deux ». UNE seule forme :
  //   fetes = paire de codes fête (noel/nouvel_an) ; dates = paire de dates ISO.
  fetes?: string[]
  dates?: string[]
}

/** Parse un entier dans [1, max]. Retourne null si invalide (frontière de confiance). */
export function entierBorne(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN
  if (!Number.isInteger(n) || n < 1 || n > max) return null
  return n
}

/** Vrai si la règle vise TOUT l'effectif (et non un véto nommé). */
export function estRegleTous(pj: unknown): boolean {
  return (pj as { qui?: { type?: unknown } })?.qui?.type === 'tous'
}

export function lireOwner(pj: unknown): string | null {
  // Une règle « tous » n'a pas de propriétaire nommé : on rend la sentinelle
  // pour que le formulaire rouvre sur « Tous les vétérinaires » en édition
  // (sinon il retomberait sur le 1er véto de la liste et transformerait
  // silencieusement une règle collective en règle individuelle).
  if (estRegleTous(pj)) return OWNER_TOUS
  const refs = (pj as { qui?: { refs?: unknown } })?.qui?.refs
  return Array.isArray(refs) && typeof refs[0] === 'string' ? refs[0] : null
}
export function lirePartenaire(pj: unknown): string | null {
  const a = (pj as { params?: { avec_veterinaire_id?: unknown } })?.params?.avec_veterinaire_id
  return typeof a === 'string' ? a : null
}

/** Types de créneaux historiques — repli quand le cabinet n'a pas de catalogue. */
export const CODES_CRENEAUX_HISTORIQUES = ['semaine_soir', 'vendredi_soir', 'weekend'] as const

// NOTE — `chargerCodesCreneauxValides` est restée dans les actions : elle lit
// le catalogue du cabinet en base, ce module ne connaît que la forme. Elle lui
// passe son résultat en paramètre (`codesCreneaux`).

/** Construit { quand, params } pour les briques NON-duo. Null = erreur (raison).
 *  `codesCreneaux` : référentiel du cabinet, requis SEULEMENT si un filtre de
 *  créneaux est demandé (au_plus_n, n°19). */
export function construireParams(
  p: UpsertReglePayload,
  codesCreneaux?: Set<string>,
): { quand: unknown; params: Record<string, unknown> } | { error: string } {
  switch (p.brique_id) {
    case 'interdire_creneau': {
      // ── PLUSIEURS jours (B-041, 2026-08-26) ───────────────────────────
      //
      // « lundi ET mardi, semaines paires » : Filou n'en avait retenu qu'un, et
      // sans le dire. La limite venait de moi (« un seul jour par regle »,
      // B-038) — pas des gardiens, qui bouclent sur `regles` depuis l'origine.
      //
      // `jours` (liste) prime sur `jour` (singulier), conserve pour les regles
      // deja en base et pour la forme simple.
      const joursDemandes = [
        ...new Set(
          (p.jours ?? []).filter((x): x is string => typeof x === 'string' && x.trim() !== ''),
        ),
      ]
      const listeJours = joursDemandes.length > 0 ? joursDemandes : p.jour ? [p.jour] : []

      if (listeJours.length === 0) return { error: 'Choisis au moins un jour de repos.' }
      const invalides = listeJours.filter((j) => !JOURS_VALIDES.has(j))
      if (invalides.length > 0) {
        return { error: `Jour de repos invalide : ${invalides.join(', ')}.` }
      }
      // Ciblage par type de garde (2026-08-02). Vide = toute la journée, ce qui
      // est le comportement historique ET celui de toutes les règles déjà en
      // base : la clé n'est même pas écrite dans ce cas, pour que l'empreinte
      // d'une règle non ciblée reste identique à ce qu'elle était.
      const creneaux = [
        ...new Set((p.creneaux ?? []).filter((x) => typeof x === 'string' && x.trim() !== '')),
      ]
      if (creneaux.length > 0) {
        if (!codesCreneaux) return { error: 'Types de créneaux du cabinet indisponibles.' }
        const inconnus = creneaux.filter((c) => !codesCreneaux.has(c))
        if (inconnus.length > 0) {
          return { error: `Type(s) de créneau inconnu(s) pour ce cabinet : ${inconnus.join(', ')}.` }
        }
      }
      // ── Une semaine sur deux (B-038, 2026-08-26) ──────────────────────
      //
      // Demande de MiKL : « repos le jeudi, mais une semaine sur deux ». Les
      // DEUX gardiens savaient déjà l'évaluer — `violeReposFixe` côté moteur et
      // `validerPlanning` côté validateur — mais uniquement sous la forme
      // « tableau de règles », celle de la donnée héritée du cabinet pilote.
      // Seule la SAISIE manquait. On écrit donc cette forme-là, plutôt que
      // d'inventer un troisième format qu'il aurait fallu apprendre aux deux.
      //
      // ⚠️ Deux orthographes cohabitent, et les confondre casse tout en
      //    silence : `alternance_ancre` dit `semaines: 'impaires'` (pluriel),
      //    le repos fixe dit `semaine: 'impaire'` (singulier). C'est ce second
      //    mot que lisent les gardiens ici.
      //
      // ⚠️ Aucune `ancre` n'est posée — c'est délibéré. Sans ancre, la parité
      //    est celle du NUMÉRO DE SEMAINE ISO, exactement comme la règle déjà
      //    en place chez le cabinet pilote. Poser une ancre ici donnerait deux
      //    sens différents à « semaines impaires » selon la règle qu'on lit :
      //    l'admin verrait la même phrase produire deux plannings distincts,
      //    sans rien pour l'expliquer. Contrepartie assumée : au passage d'une
      //    année à 53 semaines, deux semaines impaires se suivent une fois.
      const semaine = p.semaine
      if (semaine !== undefined && !PARITES_VALIDES.has(semaine)) {
        return { error: 'Cadence des semaines invalide (toutes, paires ou impaires).' }
      }
      // Forme TABLEAU des qu'il y a une parite OU plusieurs jours. C'est la
      // seule que les gardiens savent lire autrement que « ce jour, toutes les
      // semaines » — et ils l'evaluent entree par entree, donc plusieurs jours
      // ne leur demandent aucun code neuf.
      const enTableau = semaine === 'paire' || semaine === 'impaire' || listeJours.length > 1

      if (enTableau) {
        // L'exception « sauf vacances scolaires » n'est lue par les gardiens que
        // sur la forme SIMPLE. L'accepter ici afficherait un assouplissement que
        // le planning n'applique jamais — le défaut « un paramètre montré que le
        // moteur n'évalue pas », déjà payé sur `periode: 'apres_midi'`. On REFUSE
        // donc la combinaison, au lieu de l'ignorer en silence : un refus se lit,
        // une case sans effet ne se voit pas.
        if (p.exception_vacances_scolaires) {
          return {
            error:
              'L’exception « sauf vacances scolaires » n’est disponible que sur un repos d’un seul jour, toutes les semaines. Choisissez l’un ou l’autre.',
          }
        }
        return {
          quand: listeJours[0],
          params: {
            regles: listeJours.map((jour) => ({
              jour,
              // `semaine` n'est ecrit que s'il vaut vraiment quelque chose : une
              // cle `semaine: 'toutes'` serait lue comme « ni paire ni impaire »
              // par les gardiens, donc ignoree — mais elle laisserait croire, en
              // relisant la base, que la parite a ete choisie.
              ...(semaine === 'paire' || semaine === 'impaire' ? { semaine } : {}),
              ...(creneaux.length > 0 ? { creneaux } : {}),
            })),
          },
        }
      }

      return {
        quand: listeJours[0],
        params: {
          jour: listeJours[0],
          exception_vacances_scolaires: Boolean(p.exception_vacances_scolaires),
          ...(creneaux.length > 0 ? { creneaux } : {}),
        },
      }
    }
    case 'repos_conditionnel': {
      // ── Les deux volets sont INDEPENDANTS (B-045, 2026-08-26) ──────────
      //
      // Exigence de MiKL : « il faut pouvoir ne pas mettre de sinon ». Cas reel
      // et frequent — « quand il est de garde le week-end, il se repose le
      // jeudi ; les autres semaines, rien de particulier ».
      //
      // Les DEUX gardiens le geraient deja : `violeReposConditionnel` (moteur)
      // et `validerPlanning` comparent `sinon === jour`, ce qui est simplement
      // faux quand `sinon` est absent. Seule la saisie l'exigeait. C'est la
      // QUATRIEME fois aujourd'hui qu'une limite vient du formulaire et non du
      // moteur — cf. B-038, B-041, B-043.
      const siWe = p.si_garde_we
      const sinon = p.sinon
      if (siWe && !JOURS_VALIDES.has(siWe)) return { error: 'Jour « si garde le week-end » invalide.' }
      if (sinon && !JOURS_VALIDES.has(sinon)) return { error: 'Jour « sinon » invalide.' }
      // Les deux vides = une regle qui ne fait rien. On la refuse plutot que de
      // laisser l'admin croire qu'elle a pose quelque chose (coquille vide).
      if (!siWe && !sinon) {
        return { error: 'Renseigne au moins un des deux cas : avec garde de week-end, ou sans.' }
      }
      return {
        quand: null,
        params: {
          ...(siWe ? { si_garde_we: siWe } : {}),
          ...(sinon ? { sinon } : {}),
        },
      }
    }
    case 'alternance_ancre': {
      if (!p.semaines || !SEMAINES_VALIDES.has(p.semaines)) return { error: 'Cadence (semaines) invalide.' }
      const periodes = (p.periodes ?? []).filter((x) => PERIODES_VALIDES.has(x))
      if (periodes.length === 0) return { error: 'Sélectionnez au moins une période (soirs / week-ends).' }
      return { quand: periodes[0], params: { semaines: p.semaines, periodes } }
    }
    case 'au_plus_n': {
      const n = entierBorne(p.n, N_MAX_GARDES)
      if (n === null) return { error: `Nombre de gardes invalide (1 à ${N_MAX_GARDES}).` }
      if (!p.fenetre || !FENETRES_VALIDES.has(p.fenetre)) return { error: 'Fenêtre de comptage invalide.' }
      // Axe `quoi` (n°19) : filtre optionnel par types de créneaux du cabinet.
      // Frontière de confiance : chaque code DOIT exister dans le référentiel
      // du cabinet (un code fantôme rendrait la règle silencieusement inerte).
      const creneaux = [
        ...new Set((p.creneaux ?? []).filter((x) => typeof x === 'string' && x.trim() !== '')),
      ]
      if (creneaux.length > 0) {
        if (!codesCreneaux) return { error: 'Types de créneaux du cabinet indisponibles.' }
        const inconnus = creneaux.filter((c) => !codesCreneaux.has(c))
        if (inconnus.length > 0) {
          return { error: `Type(s) de créneau inconnu(s) pour ce cabinet : ${inconnus.join(', ')}.` }
        }
        return { quand: null, params: { n, fenetre: p.fenetre, creneaux } }
      }
      return { quand: null, params: { n, fenetre: p.fenetre } }
    }
    case 'espacement_min': {
      const ecart = entierBorne(p.ecart_min_jours, ECART_MAX_JOURS)
      if (ecart === null) return { error: `Écart minimal invalide (1 à ${ECART_MAX_JOURS} jours).` }
      return { quand: null, params: { ecart_min_jours: ecart } }
    }
    case 'espacement_weekend': {
      const n = entierBorne(p.n_semaines, N_SEM_WE_MAX)
      if (n === null || n < N_SEM_WE_MIN) {
        return { error: `Fréquence de week-end invalide (un week-end sur ${N_SEM_WE_MIN} à ${N_SEM_WE_MAX}).` }
      }
      return { quand: null, params: { n_semaines: n } }
    }
    // ── Desiderata (n°7) — préférences positives, toujours souples ──
    case 'preferer_creneau': {
      const jours = [...new Set((p.jours ?? []).filter((x) => JOURS_VALIDES_TOUS.has(x)))]
      const creneaux = [
        ...new Set((p.creneaux ?? []).filter((x) => typeof x === 'string' && x.trim() !== '')),
      ]
      if (jours.length === 0 && creneaux.length === 0) {
        return { error: 'Sélectionnez au moins un jour ou un type de créneau préféré.' }
      }
      if (creneaux.length > 0) {
        if (!codesCreneaux) return { error: 'Types de créneaux du cabinet indisponibles.' }
        const inconnus = creneaux.filter((c) => !codesCreneaux.has(c))
        if (inconnus.length > 0) {
          return { error: `Type(s) de créneau inconnu(s) pour ce cabinet : ${inconnus.join(', ')}.` }
        }
      }
      return {
        quand: null,
        params: {
          ...(jours.length > 0 ? { jours } : {}),
          ...(creneaux.length > 0 ? { creneaux } : {}),
        },
      }
    }
    case 'preferer_avec': {
      if (!p.avec_veterinaire_id) return { error: 'Sélectionnez le co-équipier préféré.' }
      if (p.avec_veterinaire_id === p.owner_id) {
        return { error: 'Le co-équipier préféré doit être un autre vétérinaire.' }
      }
      return { quand: null, params: { avec_veterinaire_id: p.avec_veterinaire_id } }
    }
    case 'volume_gardes': {
      if (p.sens !== 'plus' && p.sens !== 'moins') {
        return { error: 'Précisez le souhait : plus ou moins de gardes.' }
      }
      return { quand: null, params: { sens: p.sens } }
    }
    // ── Successions / séries / repos avancés (#13) ──
    case 'succession_interdite': {
      const avant = typeof p.type_avant === 'string' ? p.type_avant.trim() : ''
      const apres = typeof p.type_apres === 'string' ? p.type_apres.trim() : ''
      if (avant === '' || apres === '') {
        return { error: 'Choisissez le créneau « veille » et le créneau interdit le lendemain.' }
      }
      // Frontière de confiance : les deux codes DOIVENT exister dans le
      // référentiel du cabinet (un code fantôme rendrait la règle inerte).
      if (!codesCreneaux) return { error: 'Types de créneaux du cabinet indisponibles.' }
      const inconnus = [avant, apres].filter((c) => !codesCreneaux.has(c))
      if (inconnus.length > 0) {
        return { error: `Type(s) de créneau inconnu(s) pour ce cabinet : ${inconnus.join(', ')}.` }
      }
      return { quand: null, params: { type_avant: avant, type_apres: apres } }
    }
    case 'serie_max': {
      const n = entierBorne(p.n_jours, SERIE_MAX_JOURS)
      if (n === null) return { error: `Nombre de jours invalide (1 à ${SERIE_MAX_JOURS}).` }
      // Filtre optionnel de créneaux (mêmes règles que au_plus_n).
      const creneaux = [
        ...new Set((p.creneaux ?? []).filter((x) => typeof x === 'string' && x.trim() !== '')),
      ]
      if (creneaux.length > 0) {
        if (!codesCreneaux) return { error: 'Types de créneaux du cabinet indisponibles.' }
        const inconnus = creneaux.filter((c) => !codesCreneaux.has(c))
        if (inconnus.length > 0) {
          return { error: `Type(s) de créneau inconnu(s) pour ce cabinet : ${inconnus.join(', ')}.` }
        }
        return { quand: null, params: { n_jours: n, creneaux } }
      }
      return { quand: null, params: { n_jours: n } }
    }
    case 'repos_apres_serie': {
      const n = entierBorne(p.n_jours, SERIE_MAX_JOURS)
      if (n === null) return { error: `Longueur de série invalide (1 à ${SERIE_MAX_JOURS}).` }
      const repos = entierBorne(p.repos_jours, REPOS_APRES_MAX)
      if (repos === null) return { error: `Jours de repos invalides (1 à ${REPOS_APRES_MAX}).` }
      return { quand: null, params: { n_jours: n, repos_jours: repos } }
    }
    // ── Cadencement « 1 WE sur N ancré » (#20) ──
    case 'cadencement_weekend': {
      const n = entierBorne(p.n_semaines, N_SEM_CADENCE_MAX)
      if (n === null || n < N_SEM_CADENCE_MIN) {
        return { error: `Cycle invalide (un week-end sur ${N_SEM_CADENCE_MIN} à ${N_SEM_CADENCE_MAX}).` }
      }
      const ancre = typeof p.ancre === 'string' ? p.ancre.trim() : ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ancre) || Number.isNaN(new Date(ancre + 'T12:00:00Z').getTime())) {
        return { error: 'Date d’ancrage invalide (format attendu : une date de week-end).' }
      }
      const sens = typeof p.sens === 'string' ? p.sens : ''
      if (!SENS_CADENCE_VALIDES.has(sens)) {
        return { error: 'Précisez le sens : week-ends interdits ou gardes forcées sur le cycle.' }
      }
      // On stocke l'ancre TELLE QUE saisie : le moteur la ramène au samedi de sa
      // semaine (aucune dépendance à ce que l'admin ait pile choisi un samedi).
      return { quand: null, params: { n_semaines: n, ancre, sens } }
    }
    // ── Exclusion « pas les deux » (#15a) ──
    // Une SEULE forme par règle : `fetes` (paire de codes fête) prioritaire si
    // fournie, sinon `dates` (paire de dates ISO distinctes). Frontière de
    // confiance : validation stricte ici (le moteur est inerte si mal formé,
    // mais on refuse à l'écriture pour ne pas créer de coquille vide).
    case 'exclusion_dates': {
      const fetes = Array.isArray(p.fetes)
        ? [...new Set((p.fetes as unknown[]).filter((x): x is string => typeof x === 'string'))]
        : []
      if (fetes.length > 0) {
        if (fetes.length !== 2) return { error: 'Sélectionnez exactement deux fêtes.' }
        if (fetes.some((f) => !CODES_FETE_VALIDES.has(f))) {
          return { error: 'Fête inconnue (Noël ou Nouvel An).' }
        }
        // fetes.length===2 après dédoublonnage ⇒ déjà distinctes.
        return { quand: null, params: { fetes } }
      }
      const dates = Array.isArray(p.dates)
        ? (p.dates as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      if (dates.length !== 2) {
        return { error: 'Indiquez deux dates (ou choisissez la forme « fêtes »).' }
      }
      const isISO = (x: string) =>
        /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(new Date(x + 'T12:00:00Z').getTime())
      if (!isISO(dates[0]) || !isISO(dates[1])) return { error: 'Date invalide.' }
      if (dates[0] === dates[1]) return { error: 'Les deux dates doivent être différentes.' }
      return { quand: null, params: { dates: [dates[0], dates[1]] } }
    }
    // ── Garde conditionnelle ORIENTÉE « seulement avec B » (#15b) ──
    // A ne peut être de garde QUE si B l'est sur le même créneau. B ≠ A. Ciblage
    // `creneaux` optionnel (mêmes règles de validation que au_plus_n). L'existence
    // et l'activité de B + la garde anti-impasse sont vérifiées dans upsertRegle
    // (elles nécessitent la base : effectif actif + catalogue nbPlaces).
    case 'seulement_avec': {
      if (!p.avec_veterinaire_id) return { error: 'Sélectionnez le binôme requis.' }
      if (p.avec_veterinaire_id === p.owner_id) {
        return { error: 'Le binôme requis doit être un autre vétérinaire.' }
      }
      const creneaux = [
        ...new Set((p.creneaux ?? []).filter((x) => typeof x === 'string' && x.trim() !== '')),
      ]
      if (creneaux.length > 0) {
        if (!codesCreneaux) return { error: 'Types de créneaux du cabinet indisponibles.' }
        const inconnus = creneaux.filter((c) => !codesCreneaux.has(c))
        if (inconnus.length > 0) {
          return { error: `Type(s) de créneau inconnu(s) pour ce cabinet : ${inconnus.join(', ')}.` }
        }
        return { quand: null, params: { avec_veterinaire_id: p.avec_veterinaire_id, creneaux } }
      }
      return { quand: null, params: { avec_veterinaire_id: p.avec_veterinaire_id } }
    }
    default:
      return { error: 'Brique non gérée par ce constructeur.' }
  }
}

/** Enveloppe params_json complète attendue par le mapper + le rendu. */
export function envelopper(
  ownerId: string,
  briqueId: BriqueEvaluable,
  quand: unknown,
  params: Record<string, unknown>,
): Record<string, unknown> {
  // « Tous » : aucune ref figée — le mapper déplie sur l'effectif du moment.
  if (ownerId === OWNER_TOUS) {
    return {
      qui: { type: 'tous', refs: [] },
      quand: quand ?? null,
      params,
      _source: { type_v1: BRIQUES_EVALUABLES[briqueId] },
    }
  }
  return {
    qui: { type: 'veterinaire', refs: [ownerId] },
    quand: quand ?? null,
    params,
    _source: { type_v1: BRIQUES_EVALUABLES[briqueId] },
  }
}
