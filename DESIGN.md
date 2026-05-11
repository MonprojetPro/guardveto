---
name: GuardVeto
description: Planning des gardes vétérinaires — chaud, fiable, universel.
colors:
  primary: "#0891B2"
  primary-light: "#22D3EE"
  background: "#ECFEFF"
  surface: "#FFFFFF"
  foreground: "#164E63"
  muted-text: "#475569"
  accent-cta: "#059669"
  danger: "#DC2626"
  warning: "#D97706"
  border: "#CCE8EF"
typography:
  display:
    fontFamily: "Figtree, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.3
  headline:
    fontFamily: "Figtree, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Noto Sans, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Noto Sans, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
  badge:
    fontFamily: "Noto Sans, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1
rounded:
  sm: "4px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "#0772a1"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-cta:
    backgroundColor: "{colors.accent-cta}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-text}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  garde-badge-premier:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  garde-badge-second:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
---

# Design System: GuardVeto

## 1. Overview

**Creative North Star: "L'Agenda Vivant"**

GuardVeto ressemble à l'agenda papier accroché derrière la porte de la salle de repos — celui que tout le monde connaît, que personne n'a besoin d'apprendre, et auquel on fait confiance sans se poser de questions. Il respire. Il est toujours à jour. Il reconnaît les gens par leur prénom et leur couleur, pas par un matricule. Il ne stresse pas ses utilisateurs, il les informe.

Le système de design est **Restrained** (tinted neutrals + un accent primaire cyan qui ne dépasse jamais 15% de la surface) avec une exception délibérée : le calendrier, qui est **Full palette** par nécessité fonctionnelle. Chaque vétérinaire a une couleur attribuée. Ces couleurs ne sont pas décoratives — elles sont le langage visuel de l'équipe. Elles fonctionnent ensemble parce qu'elles sont bien contrastées sur fond blanc et suffisamment distinctes pour être identifiées d'un coup d'oeil.

Le thème est **clair uniquement**. Scène physique : Anne-So ouvre son téléphone entre deux consultations, en cabinet éclairé, pour vérifier qui est de garde ce week-end. Ou Victor glance son planning du mois depuis la salle de réveil. La lumière est ambiante et claire. Le mode sombre n'a pas sa place ici.

Ce système rejette explicitement deux esthétiques : le blanc aseptisé des logiciels médicaux (croix rouge, iconographie hospitalière, froideur clinique) et le gris poussiéreux des vieux ERP (Arial sur fond beige, menus imbriqués, tableaux sans respiration). GuardVeto est contemporain sans être tendance, professionnel sans être austère.

**Key Characteristics:**
- Cyan comme couleur principale : chaleureux mais professionnel, associé à la clarté et à la confiance
- Typographie mixte : Figtree (ronde, amicale) pour les titres, Noto Sans (neutre, lisible) pour les données
- Espacement généreux : l'app est consultée sur mobile entre deux urgences, chaque élément a besoin d'espace tactile
- Couleurs personnelles : chaque vétérinaire est reconnu par sa couleur dans toute l'interface
- Feedback immédiat : chaque action produit un retour visible (toast, état de bouton, indicateur de chargement)

## 2. Colors: La Palette de Confiance

Le cyan teinté domine les fonds et les surfaces. Le cyan saturé concentre l'attention sur les actions. Le vert confirme. Le rouge alerte.

### Primary
- **Cyan Profond** (#0891B2 / oklch(0.565 0.155 212.6)): couleur d'action principale. Boutons primaires, éléments actifs dans la navigation, focus rings, indicateurs de période. Utilisé avec intention sur maximum 15% de la surface de chaque écran.
- **Cyan Vif** (#22D3EE / oklch(0.804 0.144 210.4)): accent secondaire pour les survols, états secondaires, highlights légers. Jamais utilisé seul comme couleur d'action principale.

### Secondary
- **Vert Émeraude** (#059669 / oklch(0.558 0.169 162.5)): couleur de confirmation et de validation. Réservée au bouton "Publier", aux statuts "Publié", aux confirmations de succès. Son apparition est un signal fort : quelque chose vient d'être validé.

### Tertiary
- **Ambre Chaud** (#D97706 / oklch(0.705 0.190 75.2)): avertissements et rappels. Violations de règles souples, badge de souhaits en attente dans la sidebar, bandeaux de rappel. Signal d'attention sans urgence.
- **Rouge Vif** (#DC2626 / oklch(0.577 0.245 27.325)): danger et erreurs uniquement. Violations de règles dures, messages d'erreur, boutons destructifs. Son utilisation est strictement réservée aux situations nécessitant une action corrective.

### Neutral
- **Fond Cyan Pâle** (#ECFEFF / oklch(0.975 0.019 207.1)): fond principal de toute l'application. Teinté vers le cyan (chroma 0.019) pour éviter le blanc clinique et garder la chaleur de la marque.
- **Blanc Surface** (#FFFFFF / oklch(1 0 0)): fond des cartes, modales, sidebar. Légèrement plus élevé que le fond principal pour créer la hiérarchie de couches.
- **Cyan Très Foncé** (#164E63 / oklch(0.333 0.094 212.8)): texte principal. Cohérent avec le hue cyan — pas un noir pur, un bleu-vert profond.
- **Gris Ardoise** (#475569 / oklch(0.452 0.028 261.1)): texte secondaire, labels, métadonnées. Légèrement désaturé pour reculer sans disparaître.
- **Bordure Cyan Pâle** (#CCE8EF / oklch(0.900 0.030 207.1)): séparateurs, contours de cartes et d'inputs. Toujours teintée vers le cyan, jamais gris neutre.

### Couleurs des vétérinaires
Sept couleurs distinctes, une par personne. Ces couleurs vivent dans les badges de calendrier, les avatars, et les légendes. Elles ne sont pas des tokens du système — elles sont stockées en base de données et chargées dynamiquement.

| Vétérinaire | Couleur | Hex |
|-------------|---------|-----|
| Anne-So | Bleu | #3B82F6 |
| Fanny | Violet | #8B5CF6 |
| Jean | Vert | #10B981 |
| Anne-Cat | Gris | #6B7280 |
| Manon | Rose | #EC4899 |
| Antoine | Orange | #F59E0B |
| Victor | Indigo | #6366F1 |

**La Règle du Fond Teinté.** Jamais de blanc pur (#FFFFFF) comme fond d'écran principal. Le fond d'app doit toujours être le Fond Cyan Pâle. Le blanc surface est réservé aux éléments qui s'élèvent au-dessus du fond (cartes, sidebar, modales).

**La Règle du Cyan Concentré.** Le Cyan Profond n'apparaît que là où il y a une décision à prendre ou une information critique. Pas de titres colorés, pas de bordures décoratives. Sa rareté est son signal.

## 3. Typography: Figtree + Noto Sans

**Display Font:** Figtree (sans-serif arrondie, Google Fonts)
**Body Font:** Noto Sans (sans-serif neutre, couverture universelle, Google Fonts)

**Character:** Figtree apporte la chaleur — ses formes arrondies évoquent un outil conçu pour des humains, pas pour des machines. Noto Sans apporte la lisibilité universelle — conçu pour toutes les langues, parfaitement lisible sur mobile à toutes les tailles. Le duo est chaud sans être informel, professionnel sans être froid.

### Hierarchy
- **Display** (Figtree 700, 1.5rem/24px, lh 1.3): titres de pages. Apparaît une seule fois par écran, en haut de la zone de contenu principale. Ex: "Planning", "Congés", "Compteurs".
- **Headline** (Figtree 600, 1.25rem/20px, lh 1.4): titres de sections et de cartes. Ex: "Gardes week-end", "Souhaits en attente".
- **Body** (Noto Sans 400, 1rem/16px, lh 1.6): tout le texte courant. Descriptions, contenus de cartes, données de formulaires. Longueur max 65ch.
- **Label** (Noto Sans 500, 0.875rem/14px, lh 1.4): labels de champs, textes de navigation, textes de boutons. Semi-bold pour se distinguer sans être un titre.
- **Badge** (Noto Sans 600, 0.6875rem/11px, lh 1): noms dans les badges de calendrier, compteurs. Semi-bold pour rester lisible à très petite taille.
- **Petit texte** (Noto Sans 400, 0.75rem/12px, lh 1.5): métadonnées, dates secondaires, texte d'aide.

**La Règle du Contraste de Hiérarchie.** Chaque niveau de titre doit être au moins 1.25× plus grand que le niveau suivant. Un titre Display à 24px implique un Headline à maximum 19px. Pas d'échelle plate où tous les titres ont la même taille.

## 4. Elevation

Ce système est **plat par défaut, tonal par couche**. Il n'y a pas de système d'ombres dramatiques. La profondeur est exprimée par la couleur de fond : Fond Cyan Pâle (fond d'app) → Blanc Surface (cartes, sidebar) → fond blanc avec bordure (modales, popups).

Une ombre unique existe : `shadow-sm` (0 1px 2px rgba(0,0,0,0.05)) sur les cartes principales (ActionBar, cartes vétérinaires). Son rôle est de séparer subtilement la carte du fond d'app, pas de créer une impression de flottement.

### Shadow Vocabulary
- **Ambient Subtle** (`box-shadow: 0 1px 2px oklch(0 0 0 / 0.05)`): cartes à responsabilité d'action (ActionBar, cartes admin). Uniquement en état de repos.

**La Règle du Plat par Défaut.** Pas d'ombres sur les éléments de navigation, les badges, les inputs, les cellules de calendrier. La hiérarchie vient de la couleur de fond, pas de l'élévation. Si tu ressens le besoin d'ajouter une ombre, remplace-la par un changement de fond.

## 5. Components

### Buttons
Les boutons sont **gently rounded (8px radius)** — ni carrés (trop corporate), ni très arrondis (trop consumer app). Le texte est en label (Noto Sans 500, 14px).

- **Primary (Cyan):** fond Cyan Profond (#0891B2), texte blanc, padding 10px 16px, radius 8px. Usage : action principale de chaque écran (Générer le planning). Un seul bouton primary par zone.
- **CTA (Vert):** fond Vert Émeraude (#059669), texte blanc, padding 10px 16px, radius 8px. Usage : confirmation et publication uniquement (Publier). Désactivé (opacity 50%) jusqu'à ce que la condition soit remplie.
- **Outline:** fond transparent, bordure Cyan Pâle, texte Cyan Très Foncé. Usage : actions secondaires (Exporter PDF, Annuler).
- **Ghost:** fond transparent, pas de bordure, texte Gris Ardoise. Usage : actions tertiaires (liens dans la barre d'actions, icônes de navigation).
- **Destructive:** fond Rouge Vif (#DC2626), texte blanc. Usage : actions irréversibles uniquement (supprimer, forcer une violation).
- **Hover/Focus:** opacity à 90% sur les fonds colorés. Focus ring : outline 2px Cyan Profond avec offset 2px.

### Cards / Containers
- **Corner Style:** gently rounded (radius 10-14px selon la taille)
- **Background:** Blanc Surface (#FFFFFF)
- **Shadow:** Ambient Subtle uniquement sur les cartes d'action (ActionBar)
- **Border:** bordure Cyan Pâle (#CCE8EF, 1px solid)
- **Internal Padding:** 16px standard, 12px pour les cartes compactes

**Règle : pas de cartes imbriquées.** Une carte contient du contenu, pas d'autres cartes. Si le contenu d'une carte a besoin de subdivision, utiliser des séparateurs horizontaux ou des fonds teintés (bg-primary/6).

### Inputs / Fields
- **Style:** fond Blanc Surface, bordure Cyan Pâle, radius 8px, padding 8px 12px
- **Focus:** border-color passe à Cyan Profond, focus ring 2px Cyan Profond / offset 0
- **Disabled:** opacity 50%, curseur not-allowed
- **Error:** border-color passe à Rouge Vif, message d'erreur en texte Rouge Vif sous le champ

### Navigation
- **Desktop Sidebar (240px):** fond Blanc Surface, logo Figtree 700 en Cyan Profond en haut. Items de nav : Noto Sans 500, 14px. État actif : fond Cyan Profond, texte blanc, radius 8px. État hover : fond Fond Cyan Pâle, texte Cyan Très Foncé.
- **Mobile Bottom Nav:** fixée en bas, fond Blanc Surface, bordure top Cyan Pâle, items avec icône Lucide 20px + label 10px. État actif : couleur Cyan Profond. Hauteur 64px, safe-area respectée.
- **Transitions:** 150ms ease-out sur les changements d'état de navigation.

### Garde Badge (composant signature)
Le badge vétérinaire est le composant le plus distinctif de l'interface. C'est une pilule colorée affichant le prénom et le rang (1 ou 2) du vétérinaire de garde.

- **Structure:** fond = couleur personnelle du vétérinaire, texte blanc, radius 4px, padding 2px 6px
- **Rang:** numéro "1" ou "2" affiché après le prénom en text-white/70, font-normal — visible mais non dominant
- **Second de garde:** opacity 82% pour distinguer visuellement 1er et 2nd sans changer la couleur
- **Compact (mobile):** font-size 10px; non-compact (desktop) : 11px
- **Cellule week-end:** fond bg-primary/10 avec bordure border-primary/20 — vendredi, samedi et dimanche (le vendredi soir fait partie du bloc de garde week-end)

### Alerte / Bandeau
- **Warning (orange):** fond bg-warning/10, bordure border-warning/30, texte warning. Usage : rappels et délais imminents.
- **Danger (rouge):** fond bg-destructive/5, bordure border-destructive/30, texte destructive. Usage : erreurs et impasses de génération.
- **Pas de side-stripe.** Jamais de border-left colorée sur ces éléments. Fond teinté + bordure complète uniquement.

## 6. Do's and Don'ts

### Do:
- **Do** utiliser le Fond Cyan Pâle (#ECFEFF) comme fond d'app, jamais le blanc pur.
- **Do** réserver le Cyan Profond aux éléments interactifs (boutons, nav active, focus rings). Pas de titres ou décorations en cyan.
- **Do** afficher chaque vétérinaire avec sa couleur personnelle partout où il apparaît (badge, avatar, légende).
- **Do** indiquer le rang (1 ou 2) dans chaque badge de garde — c'est une information métier critique, pas un détail visuel.
- **Do** utiliser Figtree pour tous les titres et Noto Sans pour tous les textes courants. Ne jamais inverser.
- **Do** respecter les cibles tactiles minimum 44×44px sur mobile pour tous les éléments interactifs.
- **Do** donner un feedback immédiat (toast, spinner, état de bouton) pour chaque action utilisateur.
- **Do** colorer les cellules vendredi + samedi + dimanche avec le fond weekend (bg-primary/10) — le vendredi soir est un jour de garde comme le samedi.

### Don't:
- **Don't** utiliser un fond blanc pur (#FFFFFF) comme fond principal d'écran. C'est le look médical/clinique que ce projet rejette explicitement.
- **Don't** créer un look logiciel d'entreprise vieillissant : pas de tableaux gris imbriqués, pas de typographie Arial/System, pas de menus à 4 niveaux, pas de padding uniforme partout qui donne l'impression d'un intranet des années 2010.
- **Don't** utiliser des gradient texts (background-clip: text). Couleur pleine uniquement.
- **Don't** utiliser des border-left ou border-right colorées (>1px) comme accent décoratif sur les cartes ou alertes. Fond teinté + bordure complète à la place.
- **Don't** imbriquer des cartes. Une Card contient du contenu, pas d'autres Cards.
- **Don't** afficher les vétérinaires sans leur couleur personnelle. Un badge sans couleur est un badge mort.
- **Don't** utiliser le Vert Émeraude (#059669) pour autre chose que "Publié" / "Confirmé" / "Succès". Sa rareté est sa valeur.
- **Don't** utiliser le Rouge Vif (#DC2626) pour des informations non critiques. Si ce n'est pas une erreur ou une violation dure, ce n'est pas rouge.
- **Don't** ajouter des ombres dramatiques. L'élévation se lit par la couche de fond, pas par des box-shadows prononcées.
- **Don't** réduire la taille des cibles tactiles sur mobile sous prétexte de densité. 44×44px minimum, sans exception.
