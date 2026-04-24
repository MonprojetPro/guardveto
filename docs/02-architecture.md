# Architecture — GuardVeto

**Auteur :** ARCH — MonProjetPro
**Date :** 23 avril 2026
**Statut :** En attente de validation MiKL
**Documents source :** docs/01-prd.md, docs/regles-metier-gardes.md

---

## 1. Contexte et contraintes

### Le problème technique

Générer automatiquement un planning de gardes pour 7 vétérinaires sur des périodes de 12 semaines (hiver) ou 17 semaines (été), en respectant ~20 règles métier (contraintes dures + optimisation d'équité), avec possibilité de modification manuelle et synchronisation vers Google Agenda.

### Contraintes dimensionnelles

- **7 vétérinaires** (dont 1 quasi-inactive : Anne-Cat)
- **84 jours** par période hiver (12 semaines) — **~119 jours** pour l'été
- **~10 utilisateurs max** simultanés (7 vétos + secrétaires)
- **Pas de montée en charge** prévue (mono-cabinet)

→ Le problème est **petit** en termes de calcul. Pas besoin de solver industriel. Un algorithme de backtracking avec heuristiques suffit largement.

### Contraintes techniques

- Hébergement **gratuit ou quasi-gratuit** (Vercel free tier + Supabase free tier)
- **Accès mobile indispensable** : site responsive, pas d'app native
- **Synchronisation Google Agenda** : les vétos utilisent leur téléphone pour consulter
- **Pas de temps réel** nécessaire : le planning change quelques fois par mois

---

## 2. Stack technique

| Brique | Choix | Raison |
|--------|-------|--------|
| **Framework** | Next.js 15 (App Router) | SSR/SSG, API Routes intégrées, React Server Components, écosystème riche |
| **Langage** | TypeScript strict | Sécurité de typage indispensable pour le moteur de contraintes |
| **Base de données** | Supabase (PostgreSQL) | Auth intégrée, RLS pour les rôles, API REST auto, free tier suffisant |
| **Auth** | Supabase Auth (email/password) | 3 rôles (admin, veto, secretaire), simple et suffisant |
| **Moteur de planning** | TypeScript (API Route Next.js) | Calcul côté serveur dans une API Route — pas de dépendance externe |
| **Google Calendar** | Google Calendar API v3 | Créer/modifier/supprimer des événements sur un agenda partagé |
| **Notifications** | Resend (emails transactionnels) | Free tier = 100 emails/jour, largement suffisant pour ce volume |
| **PDF** | @react-pdf/renderer | Génération côté serveur, composants React → PDF propre |
| **Styles** | Tailwind CSS + shadcn/ui | Composants UI prêts à l'emploi, responsive natif |
| **Hébergement** | Vercel | Deploy auto sur push, free tier suffisant |
| **Date/Time** | date-fns | Manipulation de dates légère, sans les 80kb de moment.js |

### Pourquoi PAS de solver externe (OR-Tools, etc.) ?

Avec 7 vétos sur 12 semaines, le nombre de combinaisons est gérable par un algorithme custom :
- Semaine par semaine, on attribue les gardes
- Backtracking si une impasse est atteinte
- Heuristiques de tri : commencer par les vétos les plus contraints (Anne-So, salariés)
- Score d'optimisation pour l'équité

Un solver externe ajouterait une dépendance lourde (binaire natif, WASM) pour un gain nul à cette échelle.

---

## 3. Modèle de données (Supabase / PostgreSQL)

### Tables

```sql
-- Vétérinaires
CREATE TABLE veterinaires (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  statut TEXT NOT NULL CHECK (statut IN ('associe', 'salarie')),
  role_app TEXT NOT NULL DEFAULT 'veto' CHECK (role_app IN ('admin', 'veto', 'secretaire')),
  actif BOOLEAN NOT NULL DEFAULT true,
  dernier_recours BOOLEAN NOT NULL DEFAULT false, -- Anne-Cat
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Contraintes individuelles par vétérinaire
CREATE TABLE contraintes_veto (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  veterinaire_id UUID REFERENCES veterinaires(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'jour_repos_fixe',        -- ex: mercredi
    'jour_repos_conditionnel', -- ex: jeudi si garde WE, vendredi sinon
    'indisponibilite_cyclique', -- ex: Anne-So semaines impaires
    'duo_interdit'             -- ex: Manon + Antoine
  )),
  config JSONB NOT NULL,
  -- config exemples :
  -- jour_repos_fixe: { "jour": "mercredi", "exception_vacances_scolaires": true }
  -- jour_repos_conditionnel: { "si_garde_we": "jeudi", "sinon": "vendredi" }
  -- indisponibilite_cyclique: { "semaines": "impaires", "periodes": ["soir", "weekend"] }
  -- duo_interdit: { "avec_veterinaire_id": "uuid-antoine" }
  actif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Périodes de planification
CREATE TABLE periodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saison TEXT NOT NULL CHECK (saison IN ('ete', 'hiver')),
  numero INTEGER, -- 1, 2, 3 pour hiver ; NULL pour été
  date_debut DATE NOT NULL, -- toujours un lundi
  date_fin DATE NOT NULL,   -- toujours un dimanche
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'publie', 'verrouille')),
  created_at TIMESTAMPTZ DEFAULT now(),
  publie_at TIMESTAMPTZ,
  CONSTRAINT dates_coherentes CHECK (date_fin > date_debut),
  CONSTRAINT debut_lundi CHECK (EXTRACT(DOW FROM date_debut) = 1)
);

-- Gardes (1 ligne par jour de garde)
CREATE TABLE gardes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periode_id UUID REFERENCES periodes(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('semaine', 'weekend', 'ferie')),
  premier_id UUID REFERENCES veterinaires(id),
  second_id UUID REFERENCES veterinaires(id), -- NULL en été pour les gardes de semaine
  verrouille BOOLEAN NOT NULL DEFAULT false,
  modifie_manuellement BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, type) -- 1 seule garde par jour et par type
);

-- Congés et indisponibilités
CREATE TABLE conges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  veterinaire_id UUID REFERENCES veterinaires(id) ON DELETE CASCADE,
  date_debut DATE NOT NULL, -- lundi de la semaine
  date_fin DATE NOT NULL,   -- dimanche de la semaine
  type TEXT NOT NULL CHECK (type IN ('vacances', 'formation', 'sante', 'autre')),
  statut TEXT NOT NULL DEFAULT 'souhait' CHECK (statut IN ('souhait', 'valide', 'refuse')),
  commentaire TEXT,
  saisi_par UUID REFERENCES veterinaires(id),
  valide_par UUID REFERENCES veterinaires(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Bonus/Malus inter-périodes
CREATE TABLE bonus_malus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  veterinaire_id UUID REFERENCES veterinaires(id) ON DELETE CASCADE,
  periode_id UUID REFERENCES periodes(id) ON DELETE CASCADE,
  -- Écarts constatés en fin de période (positif = a fait plus que sa part)
  ecart_we INTEGER NOT NULL DEFAULT 0,
  ecart_semaine INTEGER NOT NULL DEFAULT 0,
  ecart_feries INTEGER NOT NULL DEFAULT 0,
  ecart_grands_we INTEGER NOT NULL DEFAULT 0, -- salariés uniquement
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(veterinaire_id, periode_id)
);

-- Jours fériés (table de référence)
CREATE TABLE jours_feries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  nom TEXT NOT NULL -- "Noël", "1er mai", etc.
);

-- Vacances scolaires (table de référence, pour la règle Fanny)
CREATE TABLE vacances_scolaires (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date_debut DATE NOT NULL,
  date_fin DATE NOT NULL,
  nom TEXT NOT NULL -- "Vacances d'hiver 2026", etc.
);

-- Journal des modifications (audit)
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  old_data JSONB,
  new_data JSONB,
  user_id UUID REFERENCES veterinaires(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Vues calculées

```sql
-- Compteurs par vétérinaire et par période
CREATE VIEW compteurs_gardes AS
SELECT
  g.periode_id,
  v.id AS veterinaire_id,
  v.prenom,
  v.statut,
  COUNT(*) FILTER (WHERE g.type = 'weekend' AND g.premier_id = v.id) AS we_premier,
  COUNT(*) FILTER (WHERE g.type = 'weekend' AND g.second_id = v.id) AS we_second,
  COUNT(*) FILTER (WHERE g.type = 'semaine' AND g.premier_id = v.id) AS sem_premier,
  COUNT(*) FILTER (WHERE g.type = 'semaine' AND g.second_id = v.id) AS sem_second,
  COUNT(*) FILTER (WHERE g.type = 'ferie' AND (g.premier_id = v.id OR g.second_id = v.id)) AS feries
FROM veterinaires v
CROSS JOIN gardes g
WHERE v.id IN (g.premier_id, g.second_id)
  AND g.verrouille = true
GROUP BY g.periode_id, v.id, v.prenom, v.statut;
```

### Row Level Security (RLS)

```
-- Admin (Anne-So) : accès total
-- Véto : lecture sur gardes, conges (les siens), compteurs (les siens). Écriture sur conges (les siens, statut 'souhait')
-- Secrétaire : lecture sur gardes uniquement
```

---

## 4. Structure du projet

```
guardveto/
├── .env.local              # Clés API (Supabase, Google, Resend)
├── .env.example            # Template sans valeurs
├── .gitignore
├── CLAUDE.md               # Contexte projet
├── next.config.ts
├── package.json
├── tailwind.config.ts
├── tsconfig.json
│
├── docs/                   # Documentation projet
│   ├── 01-prd.md
│   ├── 02-architecture.md
│   ├── 03-ux-specs.md
│   └── regles-metier-gardes.md
│
├── supabase/
│   ├── migrations/         # Fichiers SQL versionnés
│   │   ├── 001_tables.sql
│   │   ├── 002_rls.sql
│   │   └── 003_seed.sql    # Données initiales (vétos, contraintes, jours fériés)
│   └── config.toml
│
├── src/
│   ├── app/                        # App Router Next.js
│   │   ├── layout.tsx              # Layout racine (auth check, sidebar)
│   │   ├── page.tsx                # Redirect vers /planning
│   │   ├── login/
│   │   │   └── page.tsx            # Page de connexion
│   │   ├── planning/
│   │   │   ├── page.tsx            # Vue mensuelle du planning
│   │   │   └── [periodeId]/
│   │   │       └── page.tsx        # Planning d'une période spécifique
│   │   ├── conges/
│   │   │   └── page.tsx            # Gestion des congés
│   │   ├── compteurs/
│   │   │   └── page.tsx            # Compteurs et bonus/malus
│   │   ├── admin/
│   │   │   ├── veterinaires/
│   │   │   │   └── page.tsx        # Gestion des vétos et contraintes
│   │   │   └── periodes/
│   │   │       └── page.tsx        # Gestion des périodes
│   │   └── api/
│   │       ├── generate/
│   │       │   └── route.ts        # POST — lancer la génération
│   │       ├── publish/
│   │       │   └── route.ts        # POST — publier un planning
│   │       ├── calendar-sync/
│   │       │   └── route.ts        # POST — synchro Google Agenda
│   │       ├── notify/
│   │       │   └── route.ts        # POST — envoi de notifications
│   │       └── export-pdf/
│   │           └── route.ts        # GET — génération PDF
│   │
│   ├── engine/                     # Moteur de génération (coeur métier)
│   │   ├── types.ts                # Types : Veterinaire, Garde, Contrainte, etc.
│   │   ├── rules/
│   │   │   ├── index.ts            # Agrégateur de toutes les règles
│   │   │   ├── hard-constraints.ts # R1-R9, R16-R19 : contraintes bloquantes
│   │   │   ├── soft-constraints.ts # R10 : pas 2 WE de suite, etc.
│   │   │   └── optimization.ts     # R11-R15, R20 : équité, bonus/malus
│   │   ├── solver.ts               # Algorithme de backtracking + scoring
│   │   ├── scorer.ts               # Calcul du score d'équité d'un planning
│   │   └── utils.ts                # Helpers dates, semaines paires/impaires
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts           # Client navigateur
│   │   │   ├── server.ts           # Client serveur (API Routes)
│   │   │   └── middleware.ts       # Auth middleware
│   │   ├── google-calendar.ts      # Wrapper Google Calendar API
│   │   ├── notifications.ts        # Envoi d'emails via Resend
│   │   └── pdf.ts                  # Génération PDF
│   │
│   ├── components/
│   │   ├── ui/                     # shadcn/ui (boutons, modals, etc.)
│   │   ├── calendar/
│   │   │   ├── MonthView.tsx       # Grille mensuelle
│   │   │   ├── DayCell.tsx         # Case d'un jour (avec gardes)
│   │   │   └── GardeBadge.tsx      # Badge véto (couleur + nom + 1er/2nd)
│   │   ├── compteurs/
│   │   │   ├── CompteursTable.tsx  # Tableau récap par véto
│   │   │   └── BonusMalusCard.tsx  # Carte bonus/malus
│   │   ├── conges/
│   │   │   ├── CongesForm.tsx      # Formulaire de saisie
│   │   │   └── CongesList.tsx      # Liste avec statut
│   │   └── layout/
│   │       ├── Sidebar.tsx         # Navigation latérale
│   │       ├── Header.tsx          # En-tête avec user info
│   │       └── RoleGate.tsx        # Composant qui masque selon le rôle
│   │
│   └── hooks/
│       ├── useAuth.ts              # Hook d'authentification
│       ├── usePeriode.ts           # Hook période courante
│       └── useCompteurs.ts         # Hook compteurs en temps réel
│
└── tests/                          # Tests (TESS)
    ├── engine/
    │   ├── hard-constraints.test.ts
    │   ├── soft-constraints.test.ts
    │   ├── solver.test.ts
    │   └── scenarios/              # Jeux de données réels
    │       ├── hiver-standard.json
    │       ├── ete-congés-lourds.json
    │       └── impasse.json
    └── e2e/                        # Playwright
        ├── login.spec.ts
        ├── planning.spec.ts
        └── conges.spec.ts
```

---

## 5. Moteur de génération — Architecture détaillée

### Flux de génération

```
1. Anne-So clique "Générer"
     │
2. API Route /api/generate reçoit { periodeId }
     │
3. Chargement des données
     ├── Vétérinaires actifs + contraintes
     ├── Congés validés sur la période
     ├── Jours fériés de la période
     ├── Vacances scolaires (pour Fanny)
     ├── Bonus/malus de la période précédente
     └── Gardes déjà verrouillées (si re-génération partielle)
     │
4. Construction du problème
     ├── Pour chaque jour de la période :
     │   ├── Type : semaine / weekend / férié
     │   ├── Saison : été (1 seul) / hiver (1er + 2nd)
     │   └── Liste des vétos disponibles ce jour-là
     │
5. Résolution (solver.ts)
     ├── Tri des jours par difficulté (WE d'abord, puis fériés, puis semaine)
     ├── Pour chaque jour, tri des vétos candidats par score d'équité
     ├── Attribution + vérification des contraintes dures
     ├── Si violation → backtrack et essayer le candidat suivant
     ├── Si solution complète → calculer le score d'optimisation
     ├── Garder la meilleure solution trouvée (ou la première valide)
     │
6. Résultat
     ├── Succès → planning complet retourné en JSON
     └── Échec → liste des jours en impasse + contrainte bloquante
```

### Stratégie du solver

**Ordre d'attribution :**
1. **Week-ends** d'abord (les plus contraints : duo obligatoire, vendredi lié)
2. **Jours fériés** ensuite
3. **Nuits de semaine** en dernier (les plus flexibles)

**Heuristiques de choix :**
- Véto avec le moins de gardes sur la période → prioritaire (équité)
- Ajuster par les bonus/malus de la période précédente
- Exclure immédiatement les vétos en congé, en repos fixe, ou déjà de garde le WE précédent (R10)

**Performance estimée :**
- 7 vétos × 84 jours × ~3 candidats par jour = ~1 800 opérations dans le cas simple
- Avec backtracking : au pire ~10 000 itérations (< 1 seconde)

### Séparation des responsabilités

| Fichier | Rôle | Entrée | Sortie |
|---------|------|--------|--------|
| `hard-constraints.ts` | Valide si une attribution est légale | (jour, véto, planning partiel) | oui/non + raison si non |
| `soft-constraints.ts` | Pénalise une attribution non-idéale | (jour, véto, planning partiel) | score de pénalité (0 = parfait) |
| `optimization.ts` | Calcule l'équité globale d'un planning | planning complet | score d'optimisation |
| `solver.ts` | Orchestre la recherche | données complètes | planning ou erreur |
| `scorer.ts` | Calcule le bilan d'une période | planning verrouillé | compteurs + bonus/malus |

---

## 6. Synchronisation Google Agenda

### Flux

```
1. Anne-So clique "Publier"
     │
2. API Route /api/publish
     ├── Marque la période comme "publie"
     ├── Appelle /api/calendar-sync
     └── Appelle /api/notify
     │
3. /api/calendar-sync
     ├── Auth OAuth2 via service account Google
     ├── Pour chaque garde de la période :
     │   ├── Si l'événement existe déjà (par ID stocké en base) → update
     │   └── Sinon → create
     ├── Chaque événement contient :
     │   ├── Titre : "Garde — [Prénom] (1er) + [Prénom] (2nd)"
     │   ├── Date/heure début et fin
     │   └── Description : type de garde + rôle
     └── Stocke l'event_id Google dans la table gardes
```

### Authentification Google

- **Service Account** Google Cloud (pas OAuth interactif)
- Le service account a accès en écriture au Google Agenda du cabinet
- Les vétos ajoutent ce calendrier en **lecture** sur leur téléphone
- Pas de gestion de tokens utilisateur

---

## 7. Notifications (Resend)

| Événement | Destinataires | Contenu |
|-----------|---------------|---------|
| Planning publié | Tous les vétos | "Le planning [période] est disponible. Consultez vos gardes." |
| Garde modifiée | Vétos concernés (ancien + nouveau) | "Votre garde du [date] a été modifiée." |
| Rappel publication | Anne-So (admin) | "La période [X] commence dans [Y] jours. Le planning n'est pas encore publié." |
| Souhait de congé | Anne-So (admin) | "[Prénom] a posé un souhait de congé du [date] au [date]." |

---

## 8. Export PDF

- Génération côté serveur via `@react-pdf/renderer`
- Format : **calendrier mensuel** avec une grille 7 colonnes (lun-dim)
- Chaque case contient : nom du 1er + nom du 2nd (si applicable), code couleur
- En-tête : mois, année, période, saison
- Pied de page : légende des couleurs par véto
- Téléchargement direct (pas d'envoi automatique)

---

## 9. Verrouillage automatique

### Mécanisme

- **Cron Supabase** (pg_cron) ou **Vercel Cron** : chaque nuit à 00h01 :
  - Toutes les gardes dont la `date < aujourd'hui` et `verrouille = false` → `verrouille = true`
  - Si une période entière est passée → statut de la période passe à `verrouille`
  - À ce moment : calcul automatique des bonus/malus et insertion dans `bonus_malus`

### Correction admin

- Anne-So peut déverrouiller une garde passée (correction d'erreur) via un bouton "Corriger"
- L'action est loguée dans `audit_log`
- Les compteurs sont recalculés automatiquement

---

## 10. Sécurité

### Authentification
- Email + mot de passe via Supabase Auth
- Pas de magic link ni SSO (trop complexe pour le besoin)
- Session persistante (cookie httpOnly)

### Autorisation (RLS)
- 3 rôles : `admin`, `veto`, `secretaire`
- Le rôle est stocké dans `veterinaires.role_app` et synchronisé avec les metadata Supabase Auth
- Toutes les tables protégées par RLS — aucun accès sans authentification

### Données sensibles
- Pas de données médicales ni de données patients
- Les seules données personnelles : nom, prénom, email des vétos
- Conformité RGPD minimale : droit d'accès et de suppression (soft delete)

---

## 11. Environnements

| Environnement | Usage | Base de données | URL |
|---------------|-------|-----------------|-----|
| **Local** | Développement | Supabase local (docker) ou projet dev | localhost:3000 |
| **Preview** | Revue avant prod | Projet Supabase "staging" | guardveto-preview.vercel.app |
| **Production** | Usage réel | Projet Supabase "prod" | guardveto.vercel.app (ou domaine custom) |

---

## 12. Trade-offs et décisions

| Décision | Ce qu'on gagne | Ce qu'on perd |
|----------|---------------|---------------|
| Solver custom vs OR-Tools | Pas de dépendance binaire, contrôle total, simple à débugger | Moins robuste si le problème grossit (mais il ne grossira pas) |
| Resend vs Gmail API pour les emails | Intégration simple, pas d'OAuth, free tier | Emails envoyés depuis noreply@resend.dev (pas depuis le Gmail du cabinet) |
| Service Account Google vs OAuth utilisateur | Pas de flux interactif, 1 seul calendrier à gérer | Les vétos ne peuvent pas écrire sur le calendrier (lecture seule = ce qu'on veut) |
| shadcn/ui vs Material UI vs Ant Design | Léger, personnalisable, Tailwind natif | Moins de composants "prêts à l'emploi" que MUI (mais suffisant ici) |
| Vercel Cron vs pg_cron pour le verrouillage | Pas de configuration Supabase supplémentaire | Dépendance au free tier Vercel (1 cron/jour suffit) |
| @react-pdf vs html-pdf vs Puppeteer | Composants React, pas de headless browser | Rendu moins fidèle que Puppeteer (mais suffisant pour un tableau) |

---

**Validation : MiKL**
*Ce document est la référence technique pour la Phase 3 (UX Design par PIXEL) et le développement (SPARK).*
