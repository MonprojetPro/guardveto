// ============================================================
// Le secrétariat reste-t-il dans son périmètre ?
// ============================================================
// CE QUI S'EST PASSÉ LE 2026-08-25, ET QUI JUSTIFIE CE FICHIER.
//
// La première migration du secrétariat accordait quatre lectures — gardes,
// périodes diffusées, annuaire, congés validés — et s'arrêtait là, sur un
// raisonnement vérifié : toutes les policies du projet testent une ÉGALITÉ
// STRICTE (`= 'admin'`, `= 'veto'`), donc une troisième valeur de rôle
// n'ouvre rien.
//
// Le raisonnement était juste. La conclusion était fausse. En se plaçant dans
// la peau du compte et en comptant table par table, on a trouvé :
//
//     regles_cabinet=22   snapshots_regles=15   briques_regles=26
//     profils_planning=2  periode_type_creneau=4  creneaux_catalogue=4
//     relation_creneau=3
//
// Ces tables ne portent pas de policy par rôle : elles portent un
// `read_auth USING (true)`, ouvert à tout compte authentifié. Une secrétaire
// EST un compte authentifié. On avait vérifié ce qu'on ouvrait, pas ce qui
// l'était déjà — exactement l'angle mort de la faille `security_invoker` du
// 22/08.
//
// Ce test garde les deux moitiés du correctif, et surtout il garde le CHEMIN
// D'IDENTITÉ : le jour où quelqu'un ajoute un écran V2 en recopiant l'ancien
// motif (`.from('veterinaires')` + `signOut()`), il déconnectera le
// secrétariat sans le savoir et sans le moindre message à l'écran.
//
// Aucune connexion réseau : on lit des fichiers.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(__dirname, '..', '..')
const MIGRATIONS = join(RACINE, 'supabase', 'migrations')

const socle = readFileSync(join(MIGRATIONS, '20260825160000_secretariat_socle.sql'), 'utf8')
const resserrage = readFileSync(
  join(MIGRATIONS, '20260825170000_secretariat_perimetre_mesure.sql'),
  'utf8',
)

describe('Le secrétariat ne touche à rien', () => {
  it('n’a aucune policy d’écriture, sur aucune table', () => {
    // « Elle ne touche à rien » (MiKL, 25/08) est appliqué par l'ABSENCE de
    // droit, pas par un écran qui masque les boutons. Un écran se contourne.
    // `[\s\S]` plutôt que le drapeau `s` : la cible de compilation du projet
    // est antérieure à es2018, qui l'a introduit.
    const ecritures = /CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)[^;]*secretaire[^;]*;/gi
    for (const sql of [socle, resserrage]) {
      const trouve = sql.match(ecritures) ?? []
      // Seule exception admise : `secretaires_admin_all`, qui vise l'ADMIN et
      // porte le mot « secretaires » uniquement dans le nom de la table.
      const fautives = trouve.filter((p) => !/secretaires_admin_all/i.test(p))
      expect(fautives, `policy d'écriture accordée au secrétariat :\n${fautives.join('\n')}`).toHaveLength(0)
    }
  })

  it('ne voit que les plannings réellement diffusés', () => {
    // Elle répond au TÉLÉPHONE : annoncer une garde issue d'un brouillon
    // reviendrait à diffuser hors du logiciel une version que l'équipe n'a
    // jamais validée — l'incident de l'agenda Google du 20/08, transposé.
    // La borne est en RLS, donc elle tient aussi par appel direct à l'API.
    const policy = resserrage.slice(resserrage.indexOf('gardes_secretaire_read'))
    expect(policy).toContain('publie_at IS NOT NULL')
  })

  it('n’accède ni aux règles, ni à leur historique, ni à la structure', () => {
    for (const table of [
      'regles_cabinet',
      'snapshots_regles',
      'briques_regles',
      'profils_planning',
      'periode_type_creneau',
      'creneaux_catalogue',
      'relation_creneau',
    ]) {
      expect(resserrage, `${table} n'est pas fermée au secrétariat`).toContain(`'${table}'`)
    }
    // La forme compte autant que la liste : une RESTRICTIVE ne peut rien
    // ouvrir, et vaut `true` pour les autres rôles — donc elle ne change rien
    // pour les vétérinaires. Une permissive réécrite l'aurait risqué.
    expect(resserrage).toContain('AS RESTRICTIVE FOR SELECT')
    expect(resserrage).toContain("IS DISTINCT FROM ''secretaire''")
  })

  it('garde les libellés dont le planning a besoin', () => {
    // `creneau_modele` porte le NOM des créneaux (« Nuit semaine »). Le fermer
    // afficherait des codes bruts à l'écran : on retirerait la légende de ce
    // qu'elle a le droit de lire.
    const fermees = resserrage.slice(resserrage.indexOf('FOREACH'))
    expect(fermees).not.toContain("'creneau_modele'")
    expect(fermees).not.toContain("'jours_feries'")
    expect(fermees).not.toContain("'vacances_scolaires'")
  })
})

describe('Filou n’est pas ouvert au secrétariat', () => {
  const actions = readFileSync(
    join(RACINE, 'src', 'app', '(protected)', 'filou', 'actions.ts'),
    'utf8',
  )

  it('le refuse EXPLICITEMENT, pas par effet de bord', () => {
    // Avant le 25/08, une secrétaire était déjà refusée — mais par accident :
    // pas de fiche vétérinaire, donc lecture vide, donc refus. Un refus obtenu
    // par effet de bord disparaît au premier remaniement, et personne ne s'en
    // aperçoit : Filou se met simplement à répondre à qui n'y a pas droit.
    expect(actions).toContain("from('secretaires')")
    expect(actions).toMatch(/Filou n’est pas ouvert au secrétariat/)
  })

  it('ne fait pas passer une panne de base pour un profil inexistant', () => {
    // Leçon B-011 : « cette personne n'existe pas » a été affirmé pendant des
    // semaines sur des lectures qui avaient simplement échoué.
    expect(actions).toContain('erreurVet')
  })

  it('disparaît de l’écran du secrétariat', () => {
    const planning = readFileSync(
      join(RACINE, 'src', 'components', 'v2', 'PlanningV2.tsx'),
      'utf8',
    )
    expect(planning).toContain('{!lectureSeule && <FilouEdge')
  })
})

describe('L’écran du secrétariat ne promet rien d’impossible', () => {
  const planning = readFileSync(join(RACINE, 'src', 'components', 'v2', 'PlanningV2.tsx'), 'utf8')

  it('ne lui montre pas les compteurs d’équité', () => {
    // Week-ends, nuits et surtout ÉCART à la juste part : c'est la vie interne
    // de l'équipe. Le panneau ET son bouton disparaissent — laisser le bouton
    // aurait ouvert un panneau vide.
    // Regex plutôt qu'une chaîne littérale : les fins de ligne et
    // l'indentation ne doivent pas faire tomber un test de sécurité.
    expect(planning).toMatch(
      /lectureSeule \? \(\s*<AbsencesAVenirPanel[\s\S]{0,200}\) : \(\s*<aside className="counters-panel"/,
    )
    expect(planning).toMatch(/\{!lectureSeule && \(\s*<button[\s\S]{0,200}Compteurs/)
  })

  it('lui donne les absences à venir à la place, au même endroit', () => {
    // Demande MiKL du 25/08 : la colonne de droite existait, et elle était
    // occupée par la seule information qu'on venait de lui retirer. Elle porte
    // désormais la réponse à « il revient quand ? ».
    expect(planning).toContain('<AbsencesAVenirPanel absences={absencesAVenir} />')
  })

  it('garde la colonne de droite ouverte pour lui', () => {
    // Ce panneau n'a pas de bouton pour le replier : c'est la raison d'être de
    // l'écran pour le secrétariat, pas un détail qu'on range.
    expect(planning).toContain('compteursOuverts || lectureSeule')
  })

  it('remplace la consigne d’échange, qu’elle ne peut pas suivre', () => {
    // « Clique sur une de TES gardes » : elle n'en a aucune. Lui servir cette
    // consigne, c'est la faire chercher un bouton qui n'existe pas — le défaut
    // relevé par MiKL le 20/08, sur les vétérinaires cette fois.
    expect(planning).toContain('lectureSeule ? (')
    expect(planning).toContain('Consultation seule')
  })
})

describe('La gestion des fiches est réservée à l’administratrice', () => {
  const actions = readFileSync(
    join(RACINE, 'src', 'app', '(v2)', 'equipe', 'secretariat-actions.ts'),
    'utf8',
  )

  it('chaque action pose sa garde admin, pas seulement l’écran', () => {
    // Un écran qui masque un bouton n'empêche personne d'appeler l'action
    // directement. Les quatre doivent donc vérifier elles-mêmes.
    const nombreActions = (actions.match(/export async function/g) ?? []).length
    const nombreGardes = (actions.match(/await assertAdmin\(supabase\)/g) ?? []).length

    // On garde l'INVARIANT (autant de gardes que d'actions), pas un décompte
    // figé : le 25/08, ce test a refusé l'ajout de `supprimerSecretaire` en
    // exigeant exactement quatre actions. Il avait raison de se déclencher —
    // une action de plus est bien un moment où l'on doit revérifier la garde —
    // mais interdire d'en ajouter une n'est pas ce qu'on lui demande.
    expect(nombreActions).toBeGreaterThanOrEqual(4)
    expect(
      nombreGardes,
      `${nombreActions} actions exportées mais ${nombreGardes} gardes admin : l'une d'elles est ouverte à tout le monde.`,
    ).toBe(nombreActions)
  })

  it('invite par l’API officielle, jamais par un INSERT en base', () => {
    // ⚠️ Leçon du 25/08 : un compte auth créé en SQL ne peut PAS se connecter
    // (Supabase Auth exige des chaînes vides là où l'intuition met NULL), et
    // le refus est générique — l'écran le traduit en « mot de passe
    // incorrect », que personne ne peut relier à la vraie cause.
    expect(actions).toContain('inviteUserByEmail')
    expect(actions).not.toMatch(/from\('auth\.users'\)|insert into auth/i)
  })

  it('pose le cabinet dans le JETON après l’invitation', () => {
    // `inviteUserByEmail` n'alimente que `user_metadata`. Sans cette seconde
    // passe, le compte se crée, le mot de passe se définit, et la connexion
    // échoue sur « compte pas activé » — incident du 2026-08-15.
    expect(actions).toContain('app_metadata: { cabinet_id: sec.cabinet_id }')
  })

  it('n’annonce pas une invitation qui ne pourrait pas aboutir', () => {
    // Si le rattachement au cabinet échoue, le compte est effacé : mieux vaut
    // une invitation à refaire qu'un compte qui ne se connectera jamais sans
    // que personne sache pourquoi.
    const bloc = actions.slice(actions.indexOf('erreurMeta'))
    expect(bloc).toContain('deleteUser(compteId)')
  })

  it('ne prétend pas savoir si la personne s’est connectée', () => {
    // Le drapeau `invite_pending` des vétérinaires a menti deux mois sur la
    // fiche de Fanny. Ici l'écran déduit son état de ce qu'il lit vraiment :
    // il existe un compte, ou il n'en existe pas.
    const section = readFileSync(
      join(RACINE, 'src', 'components', 'v2', 'SecretariatSection.tsx'),
      'utf8',
    )
    expect(section).not.toContain('invite_pending')
    expect(section).toContain('aUnCompte')

    // La nuance qui compte : « Invitation envoyée » en TOAST est un fait
    // constaté à l'instant où l'action vient de réussir — c'est légitime. Ce
    // qui est interdit, c'est d'en faire un ÉTAT affiché en permanence dans la
    // liste, car plus rien ne le fait retomber le jour où la personne se
    // connecte. On inspecte donc le dictionnaire des états, pas le fichier.
    const dictionnaire = section.slice(
      section.indexOf('const LIBELLE'),
      section.indexOf('export function SecretariatSection'),
    )
    expect(dictionnaire).not.toMatch(/Invitation envoyée/)
  })
})

describe('Aucun écran ne déconnecte le secrétariat par mégarde', () => {
  // L'ancien motif, recopié dans dix pages :
  //     const { data: moi } = await supabase.from('veterinaires')…single()
  //     if (!moi) { await supabase.auth.signOut(); redirect('/login') }
  // « Je ne te trouve pas dans les vétérinaires » y voulait dire « tu n'existes
  // pas ». Depuis le 25/08 c'est faux, et la sanction — la déconnexion — est
  // muette : on retape son mot de passe, et on retombe sur la connexion.
  const dossierV2 = join(RACINE, 'src', 'app', '(v2)')

  const pages = readdirSync(dossierV2, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ nom: e.name, chemin: join(dossierV2, e.name, 'page.tsx') }))
    .filter((p) => {
      try {
        readFileSync(p.chemin)
        return true
      } catch {
        return false
      }
    })

  it('trouve bien les écrans V2 (le test ne passe pas à vide)', () => {
    expect(pages.length).toBeGreaterThanOrEqual(6)
  })

  for (const page of pages) {
    it(`/${page.nom} passe par la source unique d’identité`, () => {
      const src = readFileSync(page.chemin, 'utf8')
      // Les trois portes légitimes : `exigerVeterinaire` (l'écran est réservé
      // aux vétérinaires), `exigerIdentite` (il accepte les deux),
      // `resoudreIdentite` (il gère lui-même les cas limites).
      expect(src).toMatch(/exigerVeterinaire|exigerIdentite|resoudreIdentite/)
    })

    it(`/${page.nom} ne déconnecte pas un compte qu’il ne reconnaît pas`, () => {
      const src = readFileSync(page.chemin, 'utf8')
      // Un `signOut()` dans un écran ne peut plus signifier « inconnu » : c'est
      // à `lib/identite` de faire la différence entre un compte sans
      // rattachement, une secrétaire, et une base qui ne répond pas.
      expect(src, `${page.nom} contient encore un signOut() direct`).not.toContain('auth.signOut()')
    })
  }
})
