# UX Specs — GuardVeto

**Auteur :** PIXEL — MonProjetPro
**Date :** 23 avril 2026
**Statut :** En attente de validation MiKL
**Documents source :** docs/01-prd.md, docs/02-architecture.md

---

## 1. Design System

### Philosophie

GuardVeto est un outil **métier pour des non-techniciens**. Anne-So (l'admin) est vétérinaire, pas informaticienne. Les autres utilisateurs (vétos, secrétaires) veulent voir leurs gardes en un coup d'oeil, rien de plus.

**Principes directeurs :**
- **Clarté absolue** : on comprend le planning en 2 secondes
- **Zéro apprentissage** : si ça ressemble à Google Agenda, tout le monde sait l'utiliser
- **Mobile d'abord** : 80% de la consultation se fera sur téléphone
- **Accessibilité** : gros textes, contrastes forts, cibles tactiles larges (44x44px min)

### Palette de couleurs

| Usage | Couleur | Hex | Quand l'utiliser |
|-------|---------|-----|------------------|
| **Primaire** | Cyan foncé | `#0891B2` | Boutons principaux, liens, éléments actifs |
| **Secondaire** | Cyan clair | `#22D3EE` | Accents, survol, états secondaires |
| **Action/CTA** | Vert émeraude | `#059669` | Bouton "Publier", "Valider", confirmations |
| **Fond principal** | Cyan très pâle | `#ECFEFF` | Arrière-plan de l'app |
| **Fond carte** | Blanc | `#FFFFFF` | Cartes, modals, calendrier |
| **Texte principal** | Cyan très foncé | `#164E63` | Titres, corps de texte |
| **Texte secondaire** | Gris ardoise | `#475569` | Labels, texte d'aide |
| **Alerte** | Rouge | `#DC2626` | Violations de règle, alertes, erreurs |
| **Avertissement** | Ambre | `#D97706` | Contraintes souples violées, rappels |
| **Succès** | Vert | `#059669` | Confirmation, gardes valides |

### Couleurs des vétérinaires

Chaque véto a une couleur attribuée pour identification immédiate dans le calendrier :

| Véto | Couleur | Hex | Tailwind |
|------|---------|-----|----------|
| Anne-So | Bleu | `#3B82F6` | `blue-500` |
| Fanny | Violet | `#8B5CF6` | `violet-500` |
| Jean | Vert | `#10B981` | `emerald-500` |
| Anne-Cat | Gris | `#6B7280` | `gray-500` |
| Manon | Rose | `#EC4899` | `pink-500` |
| Antoine | Orange | `#F59E0B` | `amber-500` |
| Victor | Indigo | `#6366F1` | `indigo-500` |

### Typographie

| Usage | Police | Poids | Taille |
|-------|--------|-------|--------|
| Titre page | Figtree | 700 (Bold) | 24px / 1.5rem |
| Titre section | Figtree | 600 (Semi-bold) | 20px / 1.25rem |
| Corps de texte | Noto Sans | 400 (Regular) | 16px / 1rem |
| Label | Noto Sans | 500 (Medium) | 14px / 0.875rem |
| Badge (calendrier) | Noto Sans | 600 (Semi-bold) | 13px / 0.8125rem |
| Petit texte | Noto Sans | 400 (Regular) | 12px / 0.75rem |

Import Google Fonts :
```
Figtree:wght@300;400;500;600;700
Noto Sans:wght@300;400;500;700
```

### Composants (shadcn/ui)

| Composant | Usage | Composant shadcn |
|-----------|-------|-----------------|
| Bouton principal | Générer, Publier, Valider | `Button` variant="default" |
| Bouton secondaire | Annuler, Exporter PDF | `Button` variant="outline" |
| Bouton danger | Supprimer, Déverrouiller | `Button` variant="destructive" |
| Carte | Conteneur de section | `Card` |
| Modal | Détail d'une garde, confirmation | `Dialog` |
| Formulaire | Congés, contraintes | `Form` + react-hook-form |
| Select | Choix de véto, de période | `Select` |
| Badge | Nom véto dans le calendrier | `Badge` avec couleur véto |
| Tooltip | Info-bulle sur une règle | `Tooltip` |
| Toast | Notification de succès/erreur | `Sonner` |
| Sidebar | Navigation latérale | `Sidebar` (collapsible sur mobile) |
| Calendar | Sélecteur de date | `Calendar` |

---

## 2. Layout global

### Desktop (> 1024px)

```
┌─────────────────────────────────────────────────────────┐
│  Header : Logo GuardVeto    [Période actuelle]  [User ▾]│
├────────┬────────────────────────────────────────────────┤
│        │                                                │
│  Side  │           Zone de contenu principale           │
│  bar   │                                                │
│        │                                                │
│  ----  │                                                │
│  Plan. │                                                │
│  Congés│                                                │
│  Compt.│                                                │
│  Admin │                                                │
│        │                                                │
└────────┴────────────────────────────────────────────────┘
```

- **Sidebar** : 240px fixe, collapsible en icônes (60px)
- **Zone de contenu** : flex-1, max-width 1200px, padding 24px
- **Header** : 64px de haut, fixe en haut

### Tablette (768px — 1024px)

- Sidebar collapsée par défaut (icônes uniquement)
- Ouverture en overlay au tap sur le hamburger
- Calendrier mensuel en pleine largeur

### Mobile (< 768px)

```
┌──────────────────────┐
│  ☰  GuardVeto  [User]│
├──────────────────────┤
│                      │
│   Zone de contenu    │
│   (pleine largeur)   │
│                      │
├──────────────────────┤
│  Plan.  Congés  +    │
│  (bottom nav bar)    │
└──────────────────────┘
```

- **Sidebar** remplacée par une **barre de navigation en bas** (bottom nav)
- 3-4 onglets max : Planning, Congés, Compteurs, (Admin si admin)
- Header simplifié : hamburger + logo + avatar
- Calendrier : grille compacte avec badges empilés

---

## 3. Écrans par rôle

### 3.1 — Écran principal : Planning (tous les rôles)

C'est l'écran que tout le monde voit en premier.

**Vue mensuelle :**

```
┌──────────────────────────────────────────────────┐
│  ◄  Février 2027  ►     [Période 2 Hiver]        │
│                          [Publié ✓]               │
├──────┬──────┬──────┬──────┬──────┬──────┬──────┤
│  Lun │  Mar │  Mer │  Jeu │  Ven │  Sam │  Dim │
├──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│      │      │      │      │  3   │  4 ●●│  5   │
│      │      │      │      │ AS 1 │ Jean1│      │
│      │      │      │      │Jean 2│ AS  2│      │
├──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│  6   │  7   │  8   │  9   │  10  │ 11 ●●│  12  │
│Fanny1│Manon1│      │Vict.1│ AS 1 │Fanny1│      │
│Vict.2│Ant. 2│      │Jean 2│Fanny2│ AS  2│      │
├──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│ ...  │      │      │      │      │      │      │
└──────┴──────┴──────┴──────┴──────┴──────┴──────┘
```

**Détails de chaque case :**
- Numéro du jour en haut à gauche
- **Badge 1er de garde** : couleur du véto + prénom + "1" (en gras)
- **Badge 2nd de garde** : couleur du véto + prénom + "2" (plus léger)
- Si jour férié : fond légèrement teinté + nom du férié en petit
- Si jour verrouillé (passé) : fond grisé léger, non cliquable (sauf admin correction)
- Si congé sur ce jour : icône "vacances" discrète à côté du nom
- WE : colonnes samedi/dimanche avec un fond légèrement différent
- Indicateur ●● sur le samedi pour signaler le WE de garde

**Interaction au clic sur une case (admin) :**
- Ouvre une modale avec le détail de la garde
- Permet de modifier le 1er et/ou le 2nd
- Affiche les vétos disponibles ce jour-là (ceux qui ne sont pas en congé/repos)
- Alerte en rouge si la modification viole une règle dure
- Alerte en orange si la modification viole une règle souple

**Interaction au clic sur une case (véto/secrétaire) :**
- Ouvre une modale en lecture seule avec le détail

**Mobile — vue compacte :**
- Cases plus petites, badges réduits à l'initiale + couleur (ex: "AS" bleu, "J" vert)
- Scroll horizontal si nécessaire (calendrier 7 colonnes)
- Alternative : vue liste pour mobile (jour par jour, scroll vertical)

### 3.2 — Barre d'actions admin (au-dessus du calendrier)

Visible uniquement pour Anne-So :

```
┌──────────────────────────────────────────────────────────┐
│  [Générer le planning]   [Publier]   [Exporter PDF]      │
│                                                          │
│  Période : Hiver P2 (1 déc — 23 fév)    Statut: Brouillon│
└──────────────────────────────────────────────────────────┘
```

- **Générer** (bouton primaire cyan) : lance le moteur, résultat affiché directement dans le calendrier
- **Publier** (bouton vert, désactivé tant que pas généré) : confirme et pousse vers Google Agenda + notifications
- **Exporter PDF** (bouton outline) : télécharge le PDF du mois affiché
- Statut visible : Brouillon / Publié / Verrouillé

### 3.3 — Écran Congés

**Vue admin (Anne-So) :**

```
┌──────────────────────────────────────────────────────────┐
│  Congés & Indisponibilités          [+ Ajouter un congé] │
├──────────────────────────────────────────────────────────┤
│  ┌─ Filtres ──────────────────────────────────────────┐  │
│  │  Véto: [Tous ▾]   Statut: [Tous ▾]   Type: [Tous] │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌── Souhaits en attente (2) ─────────────────────────┐  │
│  │  ● Fanny — 10-16 mars — Vacances — "si possible"  │  │
│  │    [Valider ✓]  [Refuser ✗]  [Modifier]            │  │
│  │                                                     │  │
│  │  ● Victor — 24-30 mars — Formation canine          │  │
│  │    [Valider ✓]  [Refuser ✗]  [Modifier]            │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌── Congés validés ──────────────────────────────────┐  │
│  │  ✓ Anne-So — 1-15 juil — Vacances                 │  │
│  │  ✓ Jean — 17-30 juil — Vacances                    │  │
│  │  ✓ Manon — 3-9 fév — Vacances (CP)                │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

- Les souhaits en attente sont mis en avant (fond légèrement coloré)
- Chaque congé affiche : véto (couleur), dates, type, commentaire éventuel
- Actions admin : valider, refuser, modifier les dates

**Vue véto :**
- Voit uniquement ses propres congés
- Peut ajouter un souhait (formulaire simple : dates + type + commentaire)
- Voit le statut de ses demandes (en attente / validé / refusé)

**Formulaire d'ajout :**

```
┌── Nouveau congé ──────────────────────┐
│                                       │
│  Vétérinaire : [Fanny ▾]  (admin)    │
│               (pré-rempli si véto)    │
│                                       │
│  Semaine(s) :  [10 mars] → [16 mars] │
│                                       │
│  Type : ○ Vacances                    │
│         ○ Formation                   │
│         ○ Santé                       │
│         ○ Autre                       │
│                                       │
│  Commentaire : [si possible         ] │
│                                       │
│  [Annuler]              [Enregistrer] │
└───────────────────────────────────────┘
```

### 3.4 — Écran Compteurs

```
┌──────────────────────────────────────────────────────────┐
│  Compteurs — Période 2 Hiver (1 déc — 23 fév)           │
│                                                 [Bilan ▾]│
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌── Gardes week-end ─────────────────────────────────┐  │
│  │  Véto      │ 1er │ 2nd │ Total │ Écart │ B/M      │  │
│  │────────────┼─────┼─────┼───────┼───────┼──────────│  │
│  │ ● Anne-So  │  2  │  2  │   4   │   0   │  —       │  │
│  │ ● Fanny    │  2  │  1  │   3   │  -1   │ +1 (P1)  │  │
│  │ ● Jean     │  2  │  2  │   4   │   0   │  —       │  │
│  │ ● Manon    │  1  │  2  │   3   │  -1   │  —       │  │
│  │ ● Antoine  │  2  │  1  │   3   │  -1   │  —       │  │
│  │ ● Victor   │  2  │  2  │   4   │   0   │  —       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌── Gardes semaine (nuits) ──────────────────────────┐  │
│  │  [tableau similaire]                                │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌── Jours fériés ────────────────────────────────────┐  │
│  │  [tableau similaire]                                │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌── Grands week-ends (salariés) ─────────────────────┐  │
│  │  Manon: 4  │  Antoine: 3  │  Victor: 4             │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

- **Colonne Écart** : vert si 0, orange si ±1, rouge si ≥ ±2
- **Colonne B/M** : bonus/malus hérité de la période précédente
- Sélecteur de période en haut pour naviguer entre les périodes
- Vue véto : voit uniquement sa propre ligne (mise en avant)

### 3.5 — Écran Admin > Vétérinaires

Réservé à Anne-So. Gestion de l'équipe et des contraintes.

```
┌──────────────────────────────────────────────────────────┐
│  Gestion de l'équipe               [+ Ajouter un véto]  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌── Anne-So (Associée) ─── Admin ────────────────────┐  │
│  │  Repos : Jeu AP (sem. impaires) + Lun AP (paires)  │  │
│  │          + Mer (sem. paires)                        │  │
│  │  Spécial : Indisponible soirs+WE sem. impaires      │  │
│  │  Vacances été : 1-15 juil + 1-15 août               │  │
│  │                                    [Modifier]       │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌── Fanny (Associée) ────────────────────────────────┐  │
│  │  Repos : Mercredi (flexible vac. scolaires)         │  │
│  │                                    [Modifier]       │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌── Manon (Salariée) ────────────────────────────────┐  │
│  │  Repos : Jeu si garde WE / Ven sinon                │  │
│  │  Duo interdit : Antoine                             │  │
│  │                                    [Modifier]       │  │
│  └─────────────────────────────────────────────────────┘  │
│  ...                                                     │
└──────────────────────────────────────────────────────────┘
```

- Chaque véto est une carte avec ses contraintes résumées en langage clair
- Bouton "Modifier" ouvre un formulaire structuré (pas de JSON à saisir)
- Possibilité de désactiver un véto (départ) sans le supprimer

### 3.6 — Écran Admin > Périodes

```
┌──────────────────────────────────────────────────────────┐
│  Périodes de planification                               │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌── Été 2027 ────────────────────────────────────────┐  │
│  │  5 mai — 31 août (17 sem.)     Statut: À générer   │  │
│  │  [Générer]                                          │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌── Hiver P3 2026-27 ───────────────────────────────┐   │
│  │  3 mars — 27 avril (12 sem.)   Statut: Publié ✓    │  │
│  │  Publié le 12 fév 2027                              │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌── Hiver P2 2026-27 ───────────────────────────────┐   │
│  │  1 déc — 23 fév (12 sem.)      Statut: Verrouillé  │  │
│  │  Bilan : [Voir les compteurs]                       │  │
│  └─────────────────────────────────────────────────────┘  │
│  ...                                                     │
└──────────────────────────────────────────────────────────┘
```

### 3.7 — Écran Connexion

```
┌──────────────────────────────────────┐
│                                      │
│          🐾 GuardVeto                │
│     Planning de gardes               │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  Email                        │  │
│  │  [________________________]   │  │
│  │                                │  │
│  │  Mot de passe                  │  │
│  │  [________________________]   │  │
│  │                                │  │
│  │  [    Se connecter          ]  │  │
│  │                                │  │
│  │  Mot de passe oublié ?         │  │
│  └────────────────────────────────┘  │
│                                      │
└──────────────────────────────────────┘
```

- Page simple, centrée
- Logo / nom de l'app en haut
- Pas de création de compte (les comptes sont créés par l'admin)

---

## 4. Modale de détail / modification d'une garde

Quand on clique sur une case du calendrier :

```
┌── Garde du Samedi 11 Février ────────────────────┐
│                                                   │
│  Type : Week-end                                  │
│  Statut : Publié                                  │
│                                                   │
│  1er de garde :  ● Jean        [Modifier ▾]       │
│  2nd de garde :  ● Anne-So     [Modifier ▾]       │
│                                                   │
│  ┌── Vétérinaires disponibles ────────────────┐   │
│  │  ✓ Jean        (0 WE ce mois)              │   │
│  │  ✓ Anne-So     (1 WE ce mois) — sem. paire │   │
│  │  ✓ Fanny       (1 WE ce mois)              │   │
│  │  ✗ Manon       — en congé                  │   │
│  │  ✗ Antoine     — déjà WE précédent         │   │
│  │  ✗ Victor      — en formation              │   │
│  │  ⚠ Anne-Cat    — dernier recours           │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  ┌── Règles vérifiées ────────────────────────┐   │
│  │  ✓ Duo autorisé                            │   │
│  │  ✓ Inversion 1er/2nd OK (vs vendredi soir) │   │
│  │  ✓ Pas 2 WE de suite                       │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  [Annuler]                        [Enregistrer]   │
└───────────────────────────────────────────────────┘
```

- **Admin** : les sélecteurs sont modifiables
- **Véto / Secrétaire** : tout est en lecture seule, pas de bouton "Modifier"
- Les raisons d'indisponibilité sont affichées (congé, WE précédent, formation...)
- Les règles sont vérifiées en temps réel quand on change un véto

---

## 5. Alertes et notifications dans l'interface

### Alerte de génération impossible

```
┌── Alerte ─────────────────────────────────────────┐
│  ⚠ Impossible de couvrir la garde du 15 mars      │
│                                                    │
│  Raison : Tous les vétérinaires sont soit en       │
│  congé, soit déjà de garde le WE précédent.        │
│                                                    │
│  Suggestions :                                     │
│  • Permettre à Antoine de faire 2 WE de suite      │
│  • Décaler les congés de Fanny d'une semaine       │
│                                                    │
│  [Modifier les congés]  [Forcer manuellement]      │
└────────────────────────────────────────────────────┘
```

### Alerte de violation de règle (modification manuelle)

```
┌── Attention ──────────────────────────────────────┐
│  ⚠ Cette modification viole une règle :            │
│                                                    │
│  Règle R6 : Manon et Antoine ne peuvent pas        │
│  être seuls en duo.                                │
│                                                    │
│  [Annuler]                    [Forcer quand même]  │
└────────────────────────────────────────────────────┘
```

- Violations de règle **dure** : fond rouge, bouton "Forcer" en rouge
- Violations de règle **souple** : fond orange, bouton "Accepter" en orange

### Rappel de publication

Bandeau en haut du planning (admin uniquement) :

```
┌──────────────────────────────────────────────────────────┐
│  ⏰ La Période 3 commence dans 12 jours. Le planning     │
│     n'est pas encore publié.              [Générer →]    │
└──────────────────────────────────────────────────────────┘
```

---

## 6. Export PDF — Format d'impression

Le PDF reprend la vue mensuelle dans un format optimisé pour l'impression A4 paysage.

```
┌─────────────────────────────────────────────────────────────┐
│  GuardVeto — Planning des gardes — Février 2027             │
│  Période 2 Hiver | Publié le 12/01/2027                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [Grille calendrier mensuelle identique à l'écran]          │
│  Chaque case : date + prénom 1er + prénom 2nd               │
│  Week-ends en grisé clair                                   │
│  Jours fériés surlignés                                     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Légende :                                                  │
│  ● AS  ● Fanny  ● Jean  ● Manon  ● Antoine  ● Victor      │
│  1 = 1er de garde | 2 = 2nd de garde                        │
│  ■ = Jour férié                                             │
└─────────────────────────────────────────────────────────────┘
```

- Format A4 paysage
- Noir et blanc compatible (les couleurs des vétos ont aussi des motifs distincts en N&B)
- Police lisible en petit (Noto Sans 10pt)

---

## 7. Responsive — Points de rupture

| Breakpoint | Largeur | Layout | Navigation |
|------------|---------|--------|------------|
| **Mobile** | < 768px | 1 colonne, bottom nav | Barre bas (3-4 onglets) |
| **Tablette** | 768px — 1024px | 1 colonne, sidebar icônes | Sidebar collapsée |
| **Desktop** | > 1024px | Sidebar + contenu | Sidebar étendue |

### Adaptations mobile du calendrier

- **Option A (défaut)** : grille 7 colonnes compactes, initiales des vétos (AS, F, J, M, A, V)
- **Option B (accessible via toggle)** : vue liste jour par jour, scroll vertical

```
┌── Vue liste mobile ──────────────┐
│  Lun 6 fév                       │
│  Nuit : Fanny (1er) + Victor (2nd)│
│                                   │
│  Mar 7 fév                        │
│  Nuit : Manon (1er) + Antoine (2nd)│
│                                   │
│  ...                              │
│                                   │
│  Sam 11 fév — Dim 12 fév         │
│  WE : Jean (1er) + Anne-So (2nd) │
│  Ven soir : Anne-So (1er) + Jean │
└───────────────────────────────────┘
```

---

## 8. États et feedback

| Action | Feedback |
|--------|----------|
| Clic "Générer" | Spinner 1-2s → calendrier rempli + toast "Planning généré" |
| Clic "Publier" | Confirmation modale → spinner → toast "Planning publié, notifications envoyées" |
| Modification d'une garde | Vérification temps réel des règles dans la modale |
| Souhait de congé envoyé | Toast "Souhait envoyé à Anne-So" |
| Congé validé/refusé | Toast + mise à jour du statut en temps réel |
| Erreur serveur | Toast rouge "Une erreur est survenue, réessayez" |
| Export PDF | Téléchargement direct du fichier |

---

## 9. Icônes

Utiliser **Lucide React** (compatible shadcn/ui). Pas d'emojis dans l'interface.

| Usage | Icône Lucide |
|-------|-------------|
| Planning | `Calendar` |
| Congés | `Palmtree` |
| Compteurs | `BarChart3` |
| Admin / Réglages | `Settings` |
| Vétérinaires | `Users` |
| Périodes | `Clock` |
| Générer | `Wand2` |
| Publier | `Send` |
| PDF | `FileDown` |
| Alerte | `AlertTriangle` |
| Succès | `CheckCircle` |
| Verrouillé | `Lock` |
| Modifier | `Pencil` |
| Supprimer | `Trash2` |

---

## 10. Checklist pré-livraison

- [ ] Pas d'emojis comme icônes (SVG Lucide uniquement)
- [ ] Toutes les cibles tactiles ≥ 44x44px
- [ ] `cursor-pointer` sur tous les éléments cliquables
- [ ] Contrastes texte/fond ≥ 4.5:1 (WCAG AA)
- [ ] Focus visible sur tous les éléments interactifs
- [ ] `prefers-reduced-motion` respecté
- [ ] Responsive testé : 375px, 768px, 1024px, 1440px
- [ ] Pas de scroll horizontal non voulu sur mobile
- [ ] Formulaires avec labels associés (accessibilité)
- [ ] Transitions hover douces (150-300ms)
- [ ] Mode clair uniquement (pas de dark mode en V1)

---

**Validation : MiKL**
*Ce document guide SPARK pour l'implémentation de l'interface.*
