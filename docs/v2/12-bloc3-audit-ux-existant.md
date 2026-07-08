# Bloc 3 UX — Audit de l'existant (dans la peau d'Anne-Sophie, jour 1)

> Matière première de la réflexion Bloc 3. Audit en lecture seule du code UI
> (`src/app/(protected)/**`, `src/components/**`), état au 2026-07-08, par un agent d'audit.
> Persona : admin de cabinet non technique qui vient de s'abonner.

---

## 1. Carte des écrans et de la navigation

Navigation principale (`src/types/index.ts:177-189`, `Sidebar.tsx`, `MobileNav.tsx`) : **11 entrées pour l'admin, à plat, sans hiérarchie** :

| Ordre | Label | Route | Rôle | Accès |
|---|---|---|---|---|
| 1 | Planning | `/planning` | Calendrier mensuel + toute la barre génération/publication | admin + véto |
| 2 | Congés | `/conges` | Demandes, validation admin, conflits | admin + véto |
| 3 | Échanges | `/echanges` | Échanges de gardes + validation | admin + véto |
| 4 | Compteurs | `/compteurs` | Compteurs, bilan bonus/malus, historique fêtes | admin + véto |
| 5 | Règles | `/regles` | Règles par véto + équipe + réglages globaux + IA | admin + véto (lecture) |
| 6 | Demandes | `/admin/demandes` | Souhaits de congés (doublon partiel de /conges) | admin |
| 7 | Dépannages | `/admin/depannages` | Compensations de crise | admin |
| 8 | Périodes | `/admin/periodes` | Périodes de planification | admin |
| 9 | Structure | `/admin/structure` | Profils, catalogue créneaux, liaisons, horaires, paramètres | admin |
| 10 | Vétérinaires | `/admin/veterinaires` | Fiches, invitations, + « contraintes » LEGACY | admin |
| 11 | Journal e-mails | `/admin/journal-emails` | Log technique Brevo | admin |

Hors nav : `/notifications`, `/crise/volontaire`, `/login`, `/set-password`. La racine redirige vers `/planning` : **ni accueil, ni tableau de bord, ni premiers pas**. Mobile : 4 entrées en barre, les 7 autres derrière « Plus ». Aucun état « cabinet pas encore configuré » géré.

## 2. Le parcours « jour 1 » tel qu'il existe

- **Étape 0 — Arrivée sur `/planning` : mur de silence.** Calendrier vide ; `ActionBar.tsx:234` : `if (periodes.length === 0) return null` — la barre Générer/Publier N'EXISTE PAS tant qu'aucune période n'existe, sans message. Grep confirmé : **aucun onboarding, wizard, checklist ou état vide guidé dans tout `src/`**.
- **Étape 1 — Créer les 7 vétos** (`VeterinaireForm.tsx`) : statut salarié/associé (impact moteur non expliqué), « dernier recours » (concept moteur nu), tags (utilité découverte ailleurs), invitations une par une. **Piège majeur : chaque fiche porte une section « Contraintes » (`ContrainteForm.tsx`, table `contraintes_veto`, 4 types) — un SECOND système de règles parallèle à `/regles`**, mêmes concepts sous d'autres libellés, rien n'indique lequel fait foi.
- **Étape 2 — `/admin/structure`** (362 lignes, 6 sections empilées) : profils EN PREMIER (concept avancé), types de garde, créneaux liés, horaires par profil, paramètres cabinet — où on demande un **Google Calendar ID** et l'**expéditeur Brevo** (tuyauterie pure). Aucun ordre suggéré.
- **Étape 3 — `/admin/periodes`** : titre à convention implicite, **date de début = lundi obligatoire** (découvert par l'erreur, `periodes/actions.ts:48-52`), **saison déduite automatiquement** (mai→août = été) sans le dire alors qu'elle pilote l'effectif par défaut (hiver=2/été=1) et le profil proposé, effectif résolu en cascade période > profil > saison.
- **Étape 4 — `/regles`** : cf. §3.
- **Étape 5 — Générer** : retour sur `/planning` (la génération ne vit pas sur Périodes), pré-vol, toast jargon (« 47 gardes générées en 312ms »), ou diagnostic d'impasse renvoyant assouplir via `/regles?focus=`.
- **Étape 6 — Corriger** : `GardeDetailModal.tsx` (626 l.), garde par garde, mois par mois, pas de vue période.
- **Étape 7 — Publier** : modale de conséquences + gate de réserves ; synchro agenda automatique SI le Calendar ID a été collé — sinon échec silencieux de son point de vue.

**Bilan : 7 étapes sur 5 écrans, dans un ordre que rien ne suggère, avec ≥ 6 points de blocage silencieux.**

## 3. Charge cognitive par écran

### `/regles` — le plus chargé (3 composants, ~1 300 lignes d'UI)

| Concept exposé | Vrai choix métier ? |
|---|---|
| Force 4 crans + émojis 🔴🟠🟡 (jamais/sauf_crise/evitee/si_possible) | Métier mais sur-granulaire ; « sauf crise » suppose le concept de crise |
| **16 types de briques dans un Select** (« Cadencement week-end calé sur un cycle fixe »…) | Mécanique interne : elle pense en phrases, pas en taxonomie |
| Fenêtres de comptage (« 30 jours glissants ») | Vocabulaire d'algorithmicien |
| Semaines paires/impaires, « ancre », « cycle calendaire strict » | Fuite du moteur |
| 6 dimensions d'équité × 5 crans d'IMPORTANCE — échelle DIFFÉRENTE de la force, lignes visuellement identiques | La mécanique du score lexicographique fuit |
| « Cohortes d'équité » (dimension × tag × importance) | Terme d'ingénieur pour « équilibrer entre les juniors » |
| 4 pénalités souples réglables | 3ᵉ modèle de réglage |
| Structure du week-end + rôle à avantage financier | Métier réel mais DOUBLONNE « Créneaux liés » de /admin/structure |
| Validité par période | Métier |
| Section « Réglementaires — bientôt » | Placeholder = bruit |

**Verdict : 3 modèles mentaux différents (règle-phrase / règle-équipe-tag / réglage-curseur) et 2 échelles de pondération pour un seul métier : « dire mes règles ».**

### `/admin/structure`
Profil de planning, profil défaut intangible, saison suggérée, effectif par profil, catalogue, seed vs sur-mesure, « code machine », places/rôles, offset de fin, liaisons par profil, horaires par profil, Google Calendar ID, Brevo, zone scolaire. 6 sections, 2 assistants IA, 30+ contrôles. **Mélange 3 populations : vital jour 1 (types de garde), expert (profils/liaisons/horaires), technique pur (Brevo/Calendar) — sans hiérarchie, profils en tête.**

### `/admin/periodes`
Tableau 9 colonnes, 4 cartes de stats, effectif résolu éditable avec provenance, cycle brouillon/publié/verrouillé. **La résolution d'effectif (mécanique du loader) est affichée telle quelle ; lundi obligatoire et saison auto invisibles avant l'erreur.**

### `/planning` (admin)
ActionBar + 5 systèmes d'alerte selon l'état (PreVolAlert, CreneauxIgnoresAlert, DiagnosticImpasse, RevalidationRealtime, bandeau rappel). **Les alertes sont bien écrites, mais l'écran cumule 5 systèmes et la génération cohabite avec la consultation.**

### `/compteurs`
« BM hérité », « bilan bonus/malus » : mécanisme interne d'équité inter-périodes sans pédagogie.

### `/admin/veterinaires`
« Dernier recours », tags dont l'usage est ailleurs, et la section Contraintes legacy qui duplique `/regles`.

## 4. L'assistant IA aujourd'hui

**Trois assistants distincts, sans identité, enfouis :**

| Composant | Où | Sait faire |
|---|---|---|
| `AssistantIA.tsx` (355 l.) | Encadré au milieu de `/regles` | 19 types de règles, force pré-remplie, aperçu, création |
| `AssistantRelationIA.tsx` (249 l.) | Section « Créneaux liés » de `/admin/structure` | Liaisons même équipe / inversion |
| `AssistantProfilIA.tsx` (250 l.) | Section « Profils » | Profil par duplication, saison, effectif, horaires |

Qualités réelles : boucle propose→valide→crée, aperçu français identique au rendu liste (`rendreRegle`), garde-fous, aide en langage clair, erreurs inline.

**Ne couvre PAS** : création de vétos, congés, périodes, types de garde, génération, **diagnostic/sortie d'impasse**, correction du planning, questions (« qu'est-ce qui est configuré pour Manon ? »). Il ne sait que CRÉER — jamais lire, expliquer ni corriger.

**Présentation** : pas de nom, pas d'avatar, badge « bêta », icône Sparkles générique. **Les avatars fox-1.png à fox-5.png existent à la racine du repo (même pas dans /public) et ne sont référencés nulle part** (grep confirmé).

## 5. La « visibilité de ce qui est défini »

**Acquis solides (à préserver)** :
- **`rendreRegle`** : rendu français de toute règle (26 briques), la même phrase sert liste, aperçus, diagnostic, pré-vol. **Le meilleur actif UX du produit.**
- Liste des règles groupée par force, désactivées réactivables.
- Effectif résolu affiché avec provenance.
- Pré-vol, créneaux ignorés, diagnostic d'impasse avec suggestions **vérifiées par replay** et lien profond `/regles?focus=`.
- Re-validation Realtime du planning publié + gate de publication avec réserves.
- Compteurs, bilan, historique des fêtes, catalogue de créneaux en clair, journal e-mails.

**Ce qui manque** :
- **Aucune vue unifiée « voici tout ce que le moteur va appliquer »** — config éclatée sur /regles (3 sections), /admin/structure (5 sections), /admin/periodes, fiches vétos.
- Aucune vue PAR VÉTÉRINAIRE (« toutes les règles qui concernent Manon »).
- Aucun récapitulatif avant génération (le pré-vol ne montre que les anomalies).
- Les deux systèmes de règles jamais présentés ensemble.
- Pas d'historique/diff (« qu'est-ce qui a changé depuis la dernière génération ? ») malgré le snapshot moteur.

## 6. Top 10 des frictions (gravité décroissante)

1. **Aucun chemin de démarrage** — /planning vide, ActionBar absente si 0 période, aucun wizard/checklist ; deviner l'ordre vétos→structure→période→règles→génération sur 5 écrans d'une nav de 11 entrées. Elle a payé et l'app ne lui dit pas quoi faire.
2. **Deux systèmes de règles concurrents** — contraintes_veto (fiches) vs regles_cabinet (/regles) : mêmes notions, libellés différents, saisie double ou au mauvais endroit possible.
3. **`/regles` superpose 3 modèles mentaux et 2 échelles de pondération** — comprendre force vs importance exige de connaître le score lexicographique.
4. **Le formulaire manuel expose la taxonomie interne : 16 briques dans un Select** — elle pense « Manon ne travaille pas le mercredi », on lui demande de classifier dans la nomenclature du solveur. (L'IA contourne — mais présentée comme boîte « bêta » secondaire.)
5. **Même réglage pilotable depuis 2 écrans** — liaison WE/inversion dans « Créneaux liés » (structure) ET « Structure du week-end » (/regles) ; ni lien ni précédence expliqués.
6. **« Profil de planning » s'impose avant d'être utile** — première section, contamine 3 écrans, n'apporte rien au jour 1 mono-organisation.
7. **Créer une période = pièges silencieux** — lundi obligatoire, saison déduite en silence (pilote effectif + profil), convention de titre, 9 colonnes.
8. **Flux génération/correction/publication éclaté, vocabulaire qui fuit** — toasts de perf, « régénérer » repasse en brouillon et renvoie des e-mails.
9. **L'assistant IA fragmenté, anonyme, unidirectionnel** — 3 boîtes sur 2 écrans, sans nom ni visage, ne sait que créer ; la sortie d'impasse (là où elle sera le plus démunie) reste manuelle.
10. **Jargon résiduel + technique mêlé au métier** — « cohortes », « BM hérité », « dernier recours », « code machine », Calendar ID/Brevo au même niveau que les types de garde. L'accumulation crée le sentiment « usine à gaz ».

**Synthèse** : la mécanique profonde (rendu français, pré-vol, diagnostic vérifié, gates honnêtes) est d'une qualité rare et constitue exactement la « visibilité » à garder. La complexité perçue vient de trois sources : **absence totale de séquencement du jour 1**, **éclatement/doublons d'un même métier sur plusieurs écrans et modèles**, et **fuite de la taxonomie du moteur** (briques, forces, importances, profils, cohortes) dans des interfaces que seule une IA — aujourd'hui reléguée en encadré « bêta » — sait traduire.
