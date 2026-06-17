# Phase 3 — Guide de repointage de l'app sur la base MPP

> À dérouler quand tu es devant l'ordi. Objectif : faire pointer l'app (et les outils) sur la **base SaaS MonprojetPro** `mpvrokmtwqlmhvxaaxdn` au lieu de l'ancienne base client `iynaxwludhxvsvkupybw`.
> ⚠️ Aucune de ces étapes n'a été faite automatiquement (clés/secrets = ton domaine).

---

## Pré-requis (dette à solder AVANT de repointer)
- [ ] **Export PDF** : déjà corrigé dans le code (`src/app/api/export-pdf/route.ts`, `nom → libelle`) — ✅ fait, à committer/déployer.
- [ ] **Fériés 2027** : ajoutés au fichier `calendrier.sql` mais **pas encore appliqués en base** (ton « ok » requis). Commande prête : voir §4.

---

## 1. Variables d'environnement Vercel (projet GuardVeto)
**Seules les 3 variables Supabase changent.** Brevo, Google et les URLs restent identiques (même cabinet).

| Variable | Nouvelle valeur | Où la trouver |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://mpvrokmtwqlmhvxaaxdn.supabase.co` | (déductible du project_ref) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé **anon** du projet MPP | Dashboard Supabase → projet **guardveto (MonprojetPro)** → Settings → API → `anon public` |
| `SUPABASE_SERVICE_ROLE_KEY` | clé **service_role** du projet MPP | même page → `service_role` (⚠️ secret) |

Ne change PAS : `BREVO_*`, `GOOGLE_SERVICE_ACCOUNT_*`, `GOOGLE_CALENDAR_ID`, `NEXT_PUBLIC_APP_URL`/`SITE_URL`.
⚠️ Penser au `.trim()` / pas de retour-ligne en fin de variable (incident connu Vercel).
→ Après modif des variables : **redeploy** Vercel.

## 2. `.mcp.json` (pour Claude Code)
Changer `project_ref=iynaxwludhxvsvkupybw` → `project_ref=mpvrokmtwqlmhvxaaxdn`. Le token `GUARDVETO_SUPABASE_TOKEN` fonctionne déjà sur les deux orgs (pas de changement de token).

## 3. Google Agenda & Brevo
Mêmes identifiants (même cabinet pilote) → **rien à changer**. La synchro repartira sur la nouvelle base au prochain « Publier ».

## 4. Appliquer les fériés 2027 en base (en attente de ton « ok »)
Idempotent. Je le lance dès ton accord — ou tu colles dans le SQL Editor du projet MPP le contenu du bloc « 5b » de `supabase/migrations/20260616160000_calendrier.sql`.

---

## Phase 4 — Validation après repointage (E2E)
- [ ] **Connexion Anne-So** (`vetovaldallier@gmail.com`) → elle accède à l'app.
- [ ] **RLS stricte OK** : elle voit ses **7 vétos** et ses **10 règles**, et **uniquement** le cabinet pilote (aucune fuite d'un autre cabinet).
- [ ] Génération d'un planning de test → vérifier compteurs, calendrier (fériés + vacances **zone A**), export PDF (fériés présents).
- [ ] **Inviter les 6 autres vétos** depuis l'app (quand les vrais emails sont collectés) → auto-liés au cabinet pilote.

## Nettoyage (quand tu veux)
- [ ] Supprimer le compte auth résiduel `culus.osteo@gmail.com` (test « mika ») sur la base MPP.
- [ ] Garder l'ancienne base client `iynaxwludhxvsvkupybw` en **backup froid** quelques semaines, puis la retirer.
