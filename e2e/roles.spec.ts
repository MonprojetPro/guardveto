import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth-helpers'
import { loadEnvLocal } from './fixtures/load-env'
import { signInTenantClient } from './fixtures/tenant-client'
import { PERIODE_B_ID, TEST_EMAIL_DOMAIN, USERS } from './fixtures/test-data'

// ════════════════════════════════════════════════════════════════
// GUARDVETO — E2E Rôles (admin vs veto)
// ════════════════════════════════════════════════════════════════
// Un user rôle `veto` :
//   • est renvoyé sur son propre écran quand il tente une page admin ;
//   • ne voit pas les entrées de nav admin dans la sidebar ;
//   • peut accéder aux pages communes (planning, congés, compteurs).
// Un admin, lui, accède bien aux pages admin.
//
// ⚠️ Les deux écrans V1 `/admin/veterinaires` et `/admin/periodes` ont été
//    supprimés (doublons de `/equipe` et `/historique`, et le premier écrivait
//    dans la table morte `contraintes_veto`). Ce test vise donc désormais les
//    écrans V2 qui portent réellement ces sujets.
// ════════════════════════════════════════════════════════════════

loadEnvLocal()

// Pages réservées aux admins, avec la destination du renvoi. Elle n'est PAS la
// même partout : les écrans V2 renvoient sur `/accueil` (leur propre point
// d'entrée), les écrans V1 restants sur `/planning`. Un test qui n'attendrait
// qu'une seule cible passerait à côté de la moitié des cas.
const ADMIN_ONLY_ROUTES: { route: string; renvoiVers: RegExp }[] = [
  { route: '/equipe', renvoiVers: /\/accueil/ },
  { route: '/admin/demandes', renvoiVers: /\/planning/ },
]

test.describe('Contrôle des rôles', () => {
  test('un véto est renvoyé de chaque page admin', async ({ page }) => {
    await login(page, USERS.vetoB.email, USERS.vetoB.password)

    for (const { route, renvoiVers } of ADMIN_ONLY_ROUTES) {
      await page.goto(route)
      await expect(page, `route ${route} doit rediriger un véto`).toHaveURL(renvoiVers)
    }
  })

  test('un véto ne voit pas les entrées de navigation admin', async ({ page }) => {
    await login(page, USERS.vetoB.email, USERS.vetoB.password)
    await page.goto('/planning')

    // Entrées communes visibles dans la sidebar.
    const nav = page.locator('aside nav')
    await expect(nav.getByRole('link', { name: 'Planning' })).toBeVisible()

    // Entrées admin absentes pour un véto.
    await expect(nav.getByRole('link', { name: 'Vétérinaires' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Périodes' })).toHaveCount(0)
  })

  test('un véto accède bien aux pages communes', async ({ page }) => {
    await login(page, USERS.vetoB.email, USERS.vetoB.password)

    await page.goto('/conges')
    await expect(page).toHaveURL(/\/conges/)

    await page.goto('/compteurs')
    await expect(page).toHaveURL(/\/compteurs/)
  })

  test('un véto CONSULTE l’Organisation, sans aucune commande', async ({ page }) => {
    // Régression tenue par ce test : la bascule V2 avait remplacé le « lecture
    // seule » des deux pages V1 par un `redirect`, privant les vétérinaires de
    // l'accès aux horaires et aux règles qui produisent leur propre planning.
    await login(page, USERS.vetoB.email, USERS.vetoB.password)
    await page.goto('/regles')

    await expect(page).toHaveURL(/\/regles/)
    await expect(page.getByRole('heading', { name: /Organisation des gardes/ })).toBeVisible()

    // La vitrine se DIT…
    await expect(page.getByText(/Seul un administrateur peut la modifier/)).toBeVisible()

    // …et ne porte AUCUN bouton d'action. Le sélecteur de période type reste
    // hors du fieldset (changer de vue n'écrit rien) : on vise donc les
    // commandes à l'intérieur de la scène.
    await expect(page.locator('.ro-shell button')).toHaveCount(0)
  })

  test('un admin accède bien à l’écran Équipe', async ({ page }) => {
    await login(page, USERS.adminB.email, USERS.adminB.password)
    await page.goto('/equipe')

    await expect(page).toHaveURL(/\/equipe/)
    await expect(
      page.getByRole('heading', { name: /^Équipe$/, level: 1 })
    ).toBeVisible()
  })

  test('un véto ne peut pas muter les données via la RLS (insert refusé)', async () => {
    // Le rôle `veto` n'a pas de policy d'écriture admin sur veterinaires :
    // une tentative d'insert d'un nouveau véto doit être refusée par la RLS.
    //
    // ⚠️ Ce test GATE le correctif RLS :
    //    supabase/migrations/20260617153000_fix_rls_isolation_restrictive.sql
    //    Tant que ce correctif n'est PAS appliqué, l'insert est ACCEPTÉ
    //    (escalade de privilèges : la policy d'isolation permissive FOR ALL
    //    accorde l'écriture à tout authentifié du cabinet). Le test échoue
    //    donc volontairement jusqu'à l'application de la migration.
    const clientVeto = await signInTenantClient(USERS.vetoB.email, USERS.vetoB.password)

    const { error } = await clientVeto.from('veterinaires').insert({
      cabinet_id: USERS.vetoB.cabinetId,
      nom: 'Intrus',
      prenom: 'Mallory',
      email: `intrus@${TEST_EMAIL_DOMAIN}`,
      statut: 'salarie',
      role_app: 'veto',
      actif: true,
      couleur: '#000000',
    })

    expect(error, 'un véto ne doit pas pouvoir créer un vétérinaire').not.toBeNull()

    await clientVeto.auth.signOut()
  })

  test('un véto ne peut pas écrire le planning (attributions) — escalade V2 refusée', async () => {
    // ⚠️ Ce test GATE le correctif RLS V2 :
    //    supabase/migrations/20260618120000_f5_003_rls_v2_strict.sql
    //    Avant ce correctif, la policy d'isolation PERMISSIVE FOR ALL sur
    //    `attributions` accorde l'écriture à TOUT authentifié du cabinet :
    //    un simple véto peut réécrire le planning. Le test échoue
    //    volontairement tant que la migration n'est pas appliquée.
    const clientVeto = await signInTenantClient(USERS.vetoB.email, USERS.vetoB.password)

    // Données VALIDES (cabinet/période/véto réels) : seul l'absence de
    // policy d'écriture pour le rôle `veto` doit provoquer le refus.
    const { error } = await clientVeto.from('attributions').insert({
      cabinet_id: USERS.vetoB.cabinetId,
      planning_id: PERIODE_B_ID,
      veterinaire_id: USERS.vetoB.veterinaireId,
      role: 'premier',
      type_presence: 'sur_place',
      date_debut_reel: '2026-01-05T18:30:00+01:00',
      date_fin_reel: '2026-01-06T08:30:00+01:00',
    })

    expect(error, 'un véto ne doit pas pouvoir écrire une attribution').not.toBeNull()

    await clientVeto.auth.signOut()
  })

  test('un admin peut écrire le planning (attributions) de son cabinet', async () => {
    const clientAdmin = await signInTenantClient(USERS.adminB.email, USERS.adminB.password)

    const { data, error } = await clientAdmin
      .from('attributions')
      .insert({
        cabinet_id: USERS.adminB.cabinetId,
        planning_id: PERIODE_B_ID,
        veterinaire_id: USERS.adminB.veterinaireId,
        role: 'premier',
        type_presence: 'sur_place',
        date_debut_reel: '2026-01-12T18:30:00+01:00',
        date_fin_reel: '2026-01-13T08:30:00+01:00',
      })
      .select('id')
      .single()

    expect(error, 'un admin doit pouvoir écrire une attribution de son cabinet').toBeNull()
    expect(data?.id).toBeTruthy()

    // Cleanup explicite (la ligne n'est pas couverte par le seed).
    if (data?.id) {
      await clientAdmin.from('attributions').delete().eq('id', data.id)
    }

    await clientAdmin.auth.signOut()
  })
})

// ════════════════════════════════════════════════════════════════
// P1A-001 — briques_regles : catalogue partagé, écriture verrouillée (C3)
// ════════════════════════════════════════════════════════════════
// La table de référence `briques_regles` est lisible par tout authentifié
// (l'interface + l'IA en ont besoin) mais N'EST JAMAIS écrite côté app :
// aucune policy INSERT/UPDATE/DELETE. L'écriture passe par migrations /
// service_role (une nouvelle brique = une PR Git).
// ⚠️ Ces tests GATENT la migration 20260619120000_p1a_briques_regles.sql.
// ════════════════════════════════════════════════════════════════
test.describe('Catalogue briques_regles (P1A-001)', () => {
  test('un authentifié peut lire le catalogue de briques', async () => {
    const clientVeto = await signInTenantClient(USERS.vetoB.email, USERS.vetoB.password)

    const { data, error } = await clientVeto
      .from('briques_regles')
      .select('id')

    expect(error, 'la lecture du catalogue doit être ouverte à tout authentifié').toBeNull()
    // Le seed pose les 10 briques du golden test pilote.
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(10)

    await clientVeto.auth.signOut()
  })

  test('un authentifié ne peut PAS écrire dans le catalogue de briques (C3)', async () => {
    const clientVeto = await signInTenantClient(USERS.vetoB.email, USERS.vetoB.password)

    const { error } = await clientVeto.from('briques_regles').insert({
      id: 'brique_intrus',
      famille: 'interdire',
      operateur: 'JAMAIS',
      schema_json: {},
    })

    expect(
      error,
      'aucun authentifié ne doit pouvoir écrire dans briques_regles (écriture = migrations/service_role)'
    ).not.toBeNull()

    await clientVeto.auth.signOut()
  })
})

// ════════════════════════════════════════════════════════════════
// P1A-002 — regles_cabinet : écriture admin-only, isolation stricte
// ════════════════════════════════════════════════════════════════
// La table `regles_cabinet` porte les règles configurées par cabinet.
// Gouvernance PRD §5 : le véto PROPOSE, l'admin ANCRE → seul l'admin écrit.
// Isolation RESTRICTIVE par cabinet (modèle F5-003).
// ⚠️ Ces tests GATENT la migration 20260619130000_p1a_regles_cabinet.sql.
// ════════════════════════════════════════════════════════════════
test.describe('Règles configurables regles_cabinet (P1A-002)', () => {
  test('un véto ne peut PAS écrire une règle (write admin-only)', async () => {
    const clientVeto = await signInTenantClient(USERS.vetoB.email, USERS.vetoB.password)

    const { error } = await clientVeto.from('regles_cabinet').insert({
      cabinet_id: USERS.vetoB.cabinetId,
      brique_id: 'interdire_creneau',
      params_json: { qui: { type: 'individu', refs: [USERS.vetoB.veterinaireId] } },
      force: 'jamais',
    })

    expect(
      error,
      'un véto ne doit pas pouvoir créer une règle (il propose, l’admin ancre)'
    ).not.toBeNull()

    await clientVeto.auth.signOut()
  })

  test('un admin peut écrire une règle de son cabinet', async () => {
    const clientAdmin = await signInTenantClient(USERS.adminB.email, USERS.adminB.password)

    const { data, error } = await clientAdmin
      .from('regles_cabinet')
      .insert({
        cabinet_id: USERS.adminB.cabinetId,
        brique_id: 'interdire_creneau',
        params_json: { qui: { type: 'individu', refs: [USERS.adminB.veterinaireId] } },
        force: 'jamais',
      })
      .select('id')
      .single()

    expect(error, 'un admin doit pouvoir créer une règle de son cabinet').toBeNull()
    expect(data?.id).toBeTruthy()

    // Cleanup explicite (ligne hors seed).
    if (data?.id) {
      await clientAdmin.from('regles_cabinet').delete().eq('id', data.id)
    }

    await clientAdmin.auth.signOut()
  })
})
