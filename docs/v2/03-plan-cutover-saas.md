# Plan de cutover — Rapatriement GuardVeto V2 sur le Supabase MonprojetPro

> **Statut : PROPOSITION — en attente de validation MiKL.** Aucune base n'est touchée tant que ce plan n'est pas validé.
> Date : 2026-06-16 · Branche : `feat/ruflo-v4-migration`

---

## 1. Le problème qu'on corrige

GuardVeto devient un **SaaS multi-cabinet**. Or aujourd'hui la base prod tourne dans le compte Supabase **du client** (`vetovaldallie's Org`), et on s'apprêtait à y poser la structure multi-tenant de la V2. C'est le mauvais endroit : un SaaS ne s'héberge pas chez un de ses clients.

**Cible :** la base centrale du SaaS vit dans l'org **MonprojetPro**, et vetovaldallie y devient le **cabinet pilote n°1** (un locataire parmi N), livré **clé en main en V2**, avec **toutes ses règles conservées**.

### Les deux bases en présence

| Base (`project_ref`) | Org | Rôle | Contenu |
|---|---|---|---|
| `mpvrokmtwqlmhvxaaxdn` | **MonprojetPro** | **→ futur foyer du SaaS** | schéma V1, **données de test** (8 vétos dont « mika kaka », 145 gardes test, 5 périodes) + les 10 vraies règles |
| `iynaxwludhxvsvkupybw` | vetovaldallie's Org | prod actuelle client | schéma V1, 7 vrais vétos, 91 gardes, **données réelles** |

### Ce qui est précieux (vérifié) vs jetable

- ✅ **Précieux** : les **10 règles** (`contraintes_veto`) — **identiques octet pour octet dans les deux bases** ; les **7 vrais vétos** et leurs caractéristiques (statut, dernier_recours, couleur). Source autoritaire = le seed `supabase/migration-complete-client.sql` (lignes 691-711), qui correspond à la base client.
- 🗑️ **Jetable** : toutes les **gardes** (test), le compte **« mika kaka »** (culus.osteo@gmail.com), les périodes/congés de test.

---

## 2. La découverte qui dédramatise la migration Auth

`migration-complete-client.sql` montre la méthode déjà utilisée : **schéma + seed de données statiques** (vétos avec `user_id = NULL`, règles, fériés, vacances) — **sans aucun compte Auth ni planning**. Les comptes sont créés **par invitation** (dashboard pour le 1er admin, app pour les suivants → `user_id` relié automatiquement).

**Conséquence : on ne migre pas `auth.users`. On ré-invite.** Le « point dur » disparaît : il devient une simple ré-invitation, déjà rodée (cf. mémoire « Bootstrap 1er admin »).

---

## 3. Séquence de cutover proposée

### PHASE 0 — Filets de sécurité (avant de toucher quoi que ce soit)
1. **Backup logique** de la base MPP (`pg_dump` ou export SQL des 12 tables) → fichier horodaté.
2. La base **client reste intacte** pendant tout le chantier = backup naturel et rollback ultime.
3. Geler les écritures côté vetovaldallie le temps du cutover (fenêtre à convenir — cf. décision D3).

### PHASE 1 — Remettre la base MPP à neuf (données autoritaires)
> Objectif : repartir d'une base MPP **propre et déterministe**, sans cruft de dev.
1. `TRUNCATE` des tables métier MPP (`gardes`, `conges`, `bonus_malus`, `contraintes_veto`, `periodes`, `veterinaires` en cascade) → supprime mika + gardes de test.
2. Ré-appliquer le **seed autoritaire** (7 vétos UUID déterministes `…0001`→`…0007`, 10 règles, fériés, vacances) depuis `migration-complete-client.sql`.
   - ⚠️ Dans ce seed, **Anne-Catherine ET Anne-Sophie sont `admin`** → c'est la version corrigée (la base MPP actuelle a Anne-Cat en `veto`, c'est l'ancienne ; on aligne sur le seed).
3. Appliquer le **fix F7-001** : ajouter `"ancre": "2026-09-01"` au `config` de la contrainte `indisponibilite_cyclique` d'Anne-Sophie (corrige le bug « parité ISO » repéré en prod).

### PHASE 2A — Migrations V2 : structure tolérante
Appliquer dans l'ordre, une à une, vérification entre chaque :
1. `…140000_add_cabinets.sql` (crée la table `cabinets`)
2. `…140001_add_cabinet_id.sql` (colonne `cabinet_id` partout + RLS **tolérante** `OR cabinet_id IS NULL`)

### PHASE 2B — ⏸️ Auth du 1er admin (manuel, MiKL)
> La RLS stricte (2C) verrouille tout ce qui n'a pas le bon `cabinet_id` dans le JWT. Il faut donc qu'Anne-So existe et soit taguée **avant**.
1. **Inviter Anne-So** (`vetovaldallier@gmail.com`, son email est réel) sur le projet **MPP** via le dashboard Supabase.
2. Relier `veterinaires.user_id` d'Anne-So à son `auth.users.id`.
3. Régler son **`app_metadata`** : `{ "cabinet_id": "00000000-0000-0000-0000-000000000001" }`.

### PHASE 2C — Migrations V2 : structure stricte + données
Après l'auth admin, appliquer dans l'ordre :
3. `…150000_bootstrap_cabinet_pilote.sql` (crée le cabinet pilote, tag toutes les lignes, **RLS STRICTE**)
4. `…160000_calendrier.sql`
5. `…160001_brique_type.sql`
6. `…160002_attributions_v2.sql`
7. `…170000_snapshots.sql`
8. `…170001_migrate_contraintes.sql` (convertit les 10 règles au format brique V2 — **ne touche pas le sens métier**)
9. `…170002_migrate_gardes.sql` (convertit gardes→attributions — **inoffensif ici car gardes purgées en Phase 1**)
10. `…180000_f8_002_snapshots_link.sql`

### PHASE 3 — Repointer l'application sur la base MPP
- **Vercel** : `SUPABASE_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` → valeurs du projet MPP `mpvrok…` (penser au `.trim()`, cf. incident newline).
- **MCP** : `.mcp.json` `project_ref` → `mpvrokmtwqlmhvxaaxdn`.
- **Google Agenda** (calendarId / compte de service) et **Brevo** → reconfigurer sur le nouveau projet.

### PHASE 4 — Validation puis retrait de l'ancienne base
1. Test E2E : Anne-So se connecte, voit **uniquement** son cabinet (RLS stricte OK), voit ses 7 vétos et ses 10 règles.
2. Collecter les **vrais emails** des 6 autres vétos → les inviter depuis l'app (auto-liés au cabinet pilote).
3. Tests de non-régression (planning, congés, compteurs).
4. Ancienne base client `iynax…` → **backup froid**, conservée X semaines, puis retrait.

---

## 4. Points de vérification / risques relevés
- **Zone scolaire** : le bootstrap configure le cabinet pilote en `zone_scolaire = 'C'`, mais le seed des vacances est en **zone B**. Impact sur la règle de Fanny (« mercredi sauf vacances »). → à confirmer avec le cabinet.
- **Emails placeholders** : seuls l'email d'Anne-So est réel. Les 6 autres sont des placeholders → invitations impossibles tant qu'on n'a pas les vrais (cf. décision D2).
- **UUID partagé** : le cabinet pilote et la véto Anne-Sophie portent tous deux `…0001`, mais dans des tables différentes (`cabinets` vs `veterinaires`) → aucun conflit (confirmé par le commentaire de la migration).
- **vetovaldallie est en prod** : coordonner la fenêtre de cutover pour ne pas casser leur service en cours.

---

## 5. Décisions de MiKL (2026-06-16) — TRANCHÉES

- **D1 — Remise à neuf base MPP : ✅ REPARTIR DE ZÉRO** (truncate + re-seed autoritaire).
- **D2 — Invitations : ✅ ANNE-SO UNIQUEMENT pour l'instant.** Les 6 autres vétos invités plus tard (vrais emails à collecter).
- **D3 — Fenêtre de cutover : ✅ GEL IMMÉDIAT possible** — vetovaldallie ne s'en sert pas actuellement. On peut enchaîner sans attendre.
- **D4 — Zone scolaire : à confirmer, très probablement ZONE A** (Val d'Allier → Allier → académie Clermont-Ferrand = zone A ; la config actuelle C et le seed B sont tous deux erronés). Les `vacances_scolaires` seront re-seedées pour la bonne zone.

## 6. Feature V2 backlog (issue de cette session)
- **Détection automatique de la zone scolaire + région fériés par adresse** : à l'onboarding d'un cabinet, géocoder l'adresse (coordonnées GPS) → en déduire zone scolaire (A/B/C) et région des jours fériés. Évite la saisie manuelle et les erreurs de zone. Lié à la stratégie multi-cabinet.
```
