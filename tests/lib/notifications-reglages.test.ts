// ============================================================
// Un interrupteur affiché commande-t-il réellement quelque chose ? (B-134)
// ============================================================
// LE DÉFAUT QUE CE TEST EMPÊCHE, et le projet l'a déjà payé plusieurs fois :
// un réglage visible à l'écran que personne ne consulte au moment d'agir. La
// personne décoche, lit « E-mail coupé », et les e-mails continuent de partir.
// Elle n'a alors AUCUNE raison de soupçonner l'écran — c'est la pire forme de
// panne, celle qui se présente comme un succès.
//
// C'est la même famille que « ne jamais afficher un paramètre que le moteur
// n'évalue pas » et que les 7 gardes de B-127, où une préférence affichée
// n'avait aucun gardien derrière.
//
// CE QUE CE TEST VÉRIFIE, PAR LECTURE DES SOURCES :
//   ① chaque réglage déclaré est réellement consulté par du code d'envoi ;
//   ② chaque type d'e-mail cité est accepté par la contrainte de `email_log` —
//      sinon l'envoi part et seule sa trace est refusée, donc invérifiable ;
//   ③ le catalogue est sain (pas de doublon, pas de réglage sans rôle) ;
//   ④ le secrétariat reçoit une liste VIDE, et non des cases sans effet.
//
// Aucune connexion réseau : on lit les fichiers.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  REGLAGES_EMAIL,
  reglagesPourRole,
  type CleReglage,
} from '@/lib/notifications-reglages'

const RACINE = join(__dirname, '..', '..')
const SRC = join(RACINE, 'src')
const MIGRATIONS = join(RACINE, 'supabase', 'migrations')

/** Toutes les sources TypeScript du produit, concaténées une fois. */
function toutesLesSources(): string {
  const morceaux: string[] = []
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, entree.name)
      if (entree.isDirectory()) parcourir(chemin)
      else if (/\.tsx?$/.test(entree.name)) morceaux.push(readFileSync(chemin, 'utf8'))
    }
  }
  parcourir(SRC)
  return morceaux.join('\n')
}

/**
 * La contrainte `email_log_type_check`, telle qu'elle est APRÈS la dernière
 * migration qui la réécrit. On prend la plus récente par ordre de nom de
 * fichier — c'est l'ordre d'application réel de Supabase.
 */
function typesJournalisables(): Set<string> {
  const fichiers = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  let derniere: string | null = null
  for (const f of fichiers) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
    // On ne retient que les migrations qui AJOUTENT la contrainte (les blocs
    // ROLLBACK en commentaire la citent aussi, d'où l'ancrage sur `add`).
    if (/add\s+constraint\s+email_log_type_check/i.test(sql)) derniere = sql
  }
  if (!derniere) throw new Error('Aucune migration ne définit email_log_type_check')

  // Le corps du CHECK le plus bas dans le fichier retenu.
  const blocs = [...derniere.matchAll(/add\s+constraint\s+email_log_type_check[\s\S]*?\)\s*\)\s*;/gi)]
  const bloc = blocs[blocs.length - 1]?.[0] ?? ''
  return new Set([...bloc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
}

describe('B-134 — les réglages d’e-mail ne sont pas décoratifs', () => {
  const sources = toutesLesSources()

  it('chaque réglage déclaré est réellement consulté par un envoi', () => {
    // La forme exacte qu'un envoi utilise pour poser la question :
    // `recoitVeto(<qui>, 'cle')` ou `recoit(<qui>, 'cle')`. On cherche la clé
    // citée comme littéral dans un de ces deux appels.
    const jamaisConsultes = REGLAGES_EMAIL.filter((r) => {
      const appel = new RegExp(`recoit(?:Veto)?\\([^)]*['"]${r.cle}['"]`)
      return !appel.test(sources)
    }).map((r) => r.cle)

    expect(
      jamaisConsultes,
      `Ces réglages sont affichés mais AUCUN envoi ne les lit — décocher ne couperait rien : ${jamaisConsultes.join(', ')}`,
    ).toEqual([])
  })

  it('chaque type d’e-mail gouverné est journalisable', () => {
    const acceptes = typesJournalisables()
    const orphelins = REGLAGES_EMAIL.flatMap((r) =>
      r.typesEmail.filter((t) => !acceptes.has(t)).map((t) => `${r.cle} → ${t}`),
    )

    expect(
      orphelins,
      `Types cités par un réglage mais refusés par email_log_type_check (l’e-mail partirait sans laisser de trace vérifiable) : ${orphelins.join(', ')}`,
    ).toEqual([])
  })

  it('le catalogue est sain : pas de doublon, jamais de réglage sans rôle', () => {
    const cles = REGLAGES_EMAIL.map((r) => r.cle)
    expect(new Set(cles).size, 'Deux réglages partagent la même clé').toBe(cles.length)

    const sansRole = REGLAGES_EMAIL.filter((r) => r.roles.length === 0).map((r) => r.cle)
    expect(
      sansRole,
      `Réglages que personne ne peut voir — donc impossibles à couper : ${sansRole.join(', ')}`,
    ).toEqual([])

    // Un libellé et une explication vides donneraient une case muette.
    for (const r of REGLAGES_EMAIL) {
      expect(r.libelle.trim().length, `Réglage ${r.cle} sans libellé`).toBeGreaterThan(0)
      expect(r.explication.trim().length, `Réglage ${r.cle} sans explication`).toBeGreaterThan(0)
      expect(r.typesEmail.length, `Réglage ${r.cle} ne gouverne aucun e-mail`).toBeGreaterThan(0)
    }
  })

  it('chaque rôle voit exactement ce qui le concerne', () => {
    const admin = reglagesPourRole('admin').map((r) => r.cle)
    const veto = reglagesPourRole('veto').map((r) => r.cle)

    // Les deux e-mails de congé demandés par MiKL, chacun du bon côté.
    expect(admin).toContain('conge_demande')
    expect(veto).toContain('conge_decision')

    // Un véto n'a pas à couper les rappels de publication de l'administratrice :
    // il ne les reçoit pas. Une case sans effet apprend à ne plus lire l'écran.
    expect(veto).not.toContain('rappel_publication')
    expect(veto).not.toContain('conge_demande')

    // ⚠️ LE SECRÉTARIAT : liste VIDE, et c'est une décision, pas un oubli.
    // Aucun envoi du produit ne le cible (tous lisent la table `veterinaires`,
    // où il ne figure pas — B-017). L'écran le dit en clair plutôt que de lui
    // proposer des interrupteurs qui ne commandent rien. Le jour où un e-mail
    // le concernera, ajouter son rôle au catalogue fera tomber ce test — c'est
    // voulu : il faudra alors décider ce qu'il voit.
    expect(reglagesPourRole('secretaire')).toEqual([])
    expect(reglagesPourRole('inconnu')).toEqual([])
  })

  it('l’envoi d’une demande de congé passe par le chemin qui lit l’expéditeur du cabinet', () => {
    // La leçon du 21/08 : deux chemins d'envoi, un seul lisant
    // `cabinets.brevo_from_*`. Régler l'expéditeur ne changeait que l'e-mail
    // d'essai et les réponses aux congés ; les autres partaient sous une
    // identité générique et se faisaient rejeter. Un nouvel e-mail doit donc
    // naître dans `notifications.ts`, jamais dans un troisième chemin.
    const notifications = readFileSync(join(SRC, 'lib', 'notifications.ts'), 'utf8')
    expect(notifications).toContain('export async function sendCongeDemande')
    expect(notifications).toMatch(/sendCongeDemande[\s\S]*?lecteurExpediteur\(supabase\)/)

    // Et il doit être appelé par la pose d'une demande, sinon il ne part jamais.
    const actionsConges = readFileSync(
      join(SRC, 'app', '(protected)', 'conges', 'actions.ts'),
      'utf8',
    )
    expect(actionsConges).toContain('sendCongeDemande')
  })

  it('la cloche n’est JAMAIS conditionnée par un réglage d’e-mail', () => {
    // Couper l'e-mail réduit le bruit d'une boîte mail ; couper la cloche
    // supprimerait l'information. Si la notif in-app passait un jour derrière
    // le même filtre, une demande de congé pourrait n'atteindre personne — le
    // silence exact que ce chantier supprime.
    const notifications = readFileSync(join(SRC, 'lib', 'notifications.ts'), 'utf8')
    const bloc = notifications.slice(notifications.indexOf('export async function sendCongeDemande'))
    const creation = bloc.indexOf('creerNotification')
    const filtre = bloc.indexOf("recoitVeto(admin.id, 'conge_demande')")

    expect(creation, 'sendCongeDemande ne crée aucune notif in-app').toBeGreaterThan(-1)
    expect(filtre, 'sendCongeDemande ne consulte pas le réglage').toBeGreaterThan(-1)
    expect(
      creation,
      'La cloche est créée APRÈS le filtre d’e-mail : un admin qui coupe l’e-mail perdrait aussi la notif in-app',
    ).toBeLessThan(filtre)
  })
})

describe('B-134 — la préférence du DESTINATAIRE doit être lisible', () => {
  // ⚠️ CE TEST EXISTE PARCE QUE LE DÉFAUT A ÉTÉ LIVRÉ, PUIS TROUVÉ EN RELISANT.
  //
  // La table est née avec deux policies : isolation cabinet (restrictive) et
  // `self` (chacun ne voit que sa ligne). C'était propre, et ça rendait TOUS
  // les interrupteurs décoratifs — prouvé en base : un véto ne voyait qu'1
  // ligne sur 2 dans son propre cabinet.
  //
  // La raison est structurelle et se réapprendra mal : UN ENVOI TOURNE SOUS
  // L'IDENTITÉ DE CELUI QUI DÉCLENCHE, JAMAIS DE SON DESTINATAIRE. Un véto qui
  // pose un congé fait lire la préférence de l'admin ; l'admin qui publie fait
  // lire celle des sept vétérinaires. `self` masquait exactement la ligne dont
  // le code avait besoin, et le filtre concluait « rien de coupé ».
  //
  // ⚠️ CE QUE CE TEST NE PEUT PAS FAIRE : interroger la base. Il lit le SQL.
  //    Il attrape donc quelqu'un qui RESSERRE la policy en la croyant trop
  //    large — le scénario le plus probable, puisque `using (true)` a l'air
  //    d'un oubli quand on ne connaît pas la raison. Il n'attrape pas une
  //    policy modifiée directement en base sans migration.
  const migrations = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()

  it('une policy de LECTURE au niveau du cabinet existe, et l’écriture reste personnelle', () => {
    const concernees = migrations
      .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
      .filter((sql) => sql.includes('preferences_notifications'))

    expect(concernees.length, 'Aucune migration ne définit preferences_notifications').toBeGreaterThan(0)
    const sql = concernees.join('\n')

    // ① La lecture doit être ouverte au cabinet, sinon tout redevient décoratif.
    expect(
      /create policy prefs_notifs_read_cabinet[\s\S]*?for select[\s\S]*?using \(true\)/i.test(sql),
      'La policy de LECTURE au niveau du cabinet a disparu : les envois ne peuvent plus lire la préférence de leurs destinataires, donc plus aucun interrupteur ne coupe quoi que ce soit.',
    ).toBe(true)

    // ② Elle ne vaut QUE pour le SELECT. Si elle s'élargissait à `for all`,
    //    n'importe qui pourrait couper les e-mails d'un collègue.
    expect(
      /create policy prefs_notifs_read_cabinet[\s\S]*?for all/i.test(sql),
      'La policy de lecture s’est élargie à l’écriture : quelqu’un pourrait couper les e-mails d’un collègue.',
    ).toBe(false)

    // ③ L'isolation entre cabinets reste RESTRICTIVE. C'est elle, et elle seule,
    //    qui empêche `using (true)` d'être réellement ouvert à tous.
    expect(
      /create policy prefs_notifs_cabinet_isolation[\s\S]*?as restrictive/i.test(sql),
      'L’isolation cabinet n’est plus RESTRICTIVE : avec une lecture en `using (true)`, les préférences de TOUS les cabinets deviendraient visibles.',
    ).toBe(true)

    // ④ L'écriture personnelle est toujours là.
    expect(
      /create policy prefs_notifs_self[\s\S]*?user_id = auth\.uid\(\)/i.test(sql),
      'La policy d’écriture personnelle a disparu.',
    ).toBe(true)
  })
})

describe('B-134 — un véto doit pouvoir prévenir l’admin', () => {
  // ⚠️ DEUXIÈME DÉFAUT DU MÊME CHANTIER, PROUVÉ EN BASE ET NON PAR UN TEST.
  //
  // Le code appelait bien `creerNotification` et `logEmail`. Les deux étaient
  // REFUSÉS : leurs policies d'INSERT exigeaient le rôle admin, alors que
  // l'envoi tourne sous l'identité du vétérinaire qui pose sa demande. Et les
  // deux refus étaient silencieux. On aurait livré une notification qui ne
  // prévient personne, en croyant l'avoir livrée.
  //
  // Ce test verrouille les deux portes ouvertes en réparation, et surtout leur
  // ÉTROITESSE : le jour où quelqu'un les élargira « pour simplifier », il
  // ouvrira à un vétérinaire le droit d'écrire n'importe quelle notification à
  // n'importe qui.
  const sqlDesMigrations = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n')

  for (const { table, policy } of [
    { table: 'notifications', policy: 'notifications_insert_demande_conge' },
    { table: 'email_log', policy: 'email_log_insert_demande_conge' },
  ]) {
    it(`${table} : la porte existe, et reste bornée au type et aux admins`, () => {
      const bloc = sqlDesMigrations.match(
        new RegExp(`create policy ${policy}[\\s\\S]*?;`, 'i'),
      )?.[0]

      expect(
        bloc,
        `La policy ${policy} a disparu : poser une demande de congé redeviendrait muet (${table} refuse l'écriture à un vétérinaire), et l'échec serait silencieux.`,
      ).toBeTruthy()

      // Bornée au SEUL type de ce chantier.
      expect(
        bloc,
        `${policy} n'est plus bornée au type conge_demande : un vétérinaire pourrait écrire n'importe quelle ligne.`,
      ).toMatch(/type = 'conge_demande'/)

      // Et au SEUL destinataire qualifié.
      expect(
        bloc,
        `${policy} n'exige plus que la cible soit un admin actif du cabinet.`,
      ).toMatch(/role_app = 'admin'[\s\S]*?actif = true|actif = true[\s\S]*?role_app = 'admin'/)
      expect(bloc).toMatch(/auth_cabinet_actif\(\)/)

      // Uniquement l'insertion : jamais un `for all`, qui donnerait aussi la
      // lecture et la modification des notifications d'autrui.
      expect(
        /for all/i.test(bloc ?? ''),
        `${policy} s'est élargie au-delà de l'insertion.`,
      ).toBe(false)
    })
  }

  it('l’échec du journal ne peut plus être silencieux', () => {
    // `insert` ne lève pas : il rend `{ error }`. Personne ne le lisait, donc
    // une ligne refusée disparaissait sans un mot — et c'est ce qui a permis au
    // défaut ci-dessus de passer inaperçu.
    const notifications = readFileSync(join(SRC, 'lib', 'notifications.ts'), 'utf8')
    const logEmail = notifications.slice(
      notifications.indexOf('async function logEmail'),
      notifications.indexOf('// ── Export : Nouveau planning publié'),
    )
    expect(logEmail).toMatch(/const \{ error \} = await supabase\.from\('email_log'\)/)
    expect(
      /if \(error\)[\s\S]*?console\.error/.test(logEmail),
      'logEmail ignore à nouveau son erreur : un journal incomplet redeviendrait invisible.',
    ).toBe(true)
  })
})

describe('B-134 — les clés stockées survivent au retrait d’un réglage', () => {
  it('les clés du catalogue sont des identifiants stables, pas des libellés', () => {
    // Les clés partent en base dans `desactivees`. Les renommer ferait
    // silencieusement réapparaître des e-mails que quelqu'un avait coupés — un
    // réglage qui se remet tout seul est indétectable côté utilisateur.
    for (const r of REGLAGES_EMAIL) {
      expect(r.cle, `Clé non conforme : ${r.cle}`).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('le type CleReglage et le catalogue ne peuvent pas diverger', () => {
    // Garde-fou de compilation, vérifié aussi à l'exécution : si une clé du
    // type n'est pas dans le catalogue, l'écran ne pourrait jamais la proposer.
    const cles = new Set<string>(REGLAGES_EMAIL.map((r) => r.cle))
    const attendues: CleReglage[] = [
      'conge_demande',
      'conge_decision',
      'planning_publie',
      'garde_modifiee',
      'appel_volontaires',
      'depannage_confirme',
      'rappel_publication',
    ]
    for (const c of attendues) {
      expect(cles.has(c), `La clé ${c} existe dans le type mais pas dans le catalogue`).toBe(true)
    }
    expect(cles.size).toBe(attendues.length)
  })
})
