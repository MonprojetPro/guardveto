# Filou actionneur + bascule maquette → produit

> Décisions MiKL du **2026-07-25**. Document de reprise : à lire en premier
> au démarrage de la prochaine session sur ce sujet.
> État : **décidé, non commencé — plus rien à arbitrer, prêt à démarrer**.

---

## 1. La décision

**Filou doit pouvoir faire tout ce qu'on peut faire manuellement dans l'application.**

Aujourd'hui il ne sait faire que de la *configuration*, et encore : 3 actions
sur ~45. Il sait créer une règle, proposer un profil de planning, proposer une
liaison de créneaux. Il ne touche à rien du planning vivant.

MiKL : *« je veux que Filou puisse faire tout ce qu'on peut faire manuellement
sur l'appli »*.

### Le principe non négociable

**Filou emprunte exactement le même chemin que le clic humain.** Chaque action
manuelle devient un outil qu'il peut appeler — mais il appelle la *même*
fonction que le bouton. Aucune porte dérobée, aucun accès direct à la base.

Conséquence : il hérite gratuitement de tous les contrôles existants (RLS,
règles métier, validations, journal). Il ne peut rien faire qu'un humain
n'aurait pas pu faire à sa place, avec ses propres droits.

### Les trois garde-fous

1. **Il annonce avant d'agir** — voir §2, c'est le cœur du dispositif.
2. **Tout est tracé** au journal comme « fait par Filou, pour le compte de X ».
3. **Tout est annulable.**

---

## 2. La confirmation déguisée (idée MiKL, centrale)

Filou ne demande **jamais** « êtes-vous sûr ? ». Ce serait renvoyer la
responsabilité à l'utilisateur sans l'avoir aidé.

Il **montre son travail**, et la confirmation devient la conséquence naturelle
de ce qu'il montre. Deux visages selon ce qu'il trouve :

**Cas simple — il a vérifié, rien ne bloque :**

> « Tu m'as demandé de passer la garde du 14 de Manon à Victor. Voilà ce que ça
> donne. J'ai vérifié : aucun conflit avec les règles, aucun avec les autres
> plannings. **C'est bon pour toi ?** »

**Cas conflit — il a trouvé quelque chose :**

> « Tu m'as demandé de passer la garde du 14 à Victor. Sauf que Victor est déjà
> de garde le 13 au soir — ça lui ferait deux nuits d'affilée, ce que la règle
> de repos interdit. **Je le fais quand même, ou je te propose autre chose ?** »

La différence avec une pop-up de confirmation : Filou a **déjà fait le travail
de vérification** et il en livre le résultat. L'utilisateur ne valide pas dans
le vide, il valide quelque chose qu'il voit.

### Où ça s'affiche

Dans le **panneau de droite de l'accueil** — là où vit aujourd'hui « Le coup
d'œil du matin » (`.stage` / `.glance` dans `maquette/m6-accueil-epicentre.html`).
La conversation reste à gauche sur la tablette ; le récap détaillé s'ouvre à
droite.

### Contenu de la fiche de récap

| Bloc | Contenu |
|------|---------|
| Ce que Filou a compris | la demande reformulée en clair |
| Avant / après | « le 14 : Manon → Victor » |
| Verdict de cohérence | vert « aucun conflit » **ou** rouge avec la **conséquence expliquée** |
| Actions | **C'est bon, fais-le** · **Propose-moi autre chose** |

⚠ Le verdict doit être **réel** : Filou interroge vraiment le moteur de règles.
Un panneau qui affiche un faux verdict est pire que pas de panneau — il donne
l'illusion d'une vérification.

---

## 3. Inventaire : ce que « tout » représente

~45 actions manuelles, 8 domaines. Sources : `src/**/actions.ts` et
`src/app/api/**/route.ts`.

| Domaine | Actions | Filou aujourd'hui |
|---|---|---|
| **Planning / gardes** | réattribuer (`api/gardes/[id]`), disponibilités, `api/generate`, `api/publish`, verrouillage (`cron/lock-gardes`) | ❌ rien |
| **Congés** | `createConge` `updateConge` `deleteConge` `validerConge` `refuserConge` | ❌ rien |
| **Absences** | `api/absences` + `appel-volontaires` `reparer` `volontaire` | ❌ rien |
| **Échanges** | `proposerEchange` `accepterEchange` `refuserEchange` `annulerEchange` `validerEchangeAdmin` `refuserEchangeAdmin` | ❌ rien |
| **Vétérinaires** | `createVeterinaire` `updateVeterinaire` `inviterVeterinaire` `toggleVeterinaireActif` + `createContrainte` `updateContrainte` `deleteContrainte` | ❌ rien |
| **Règles** | `setRegleActif` `deleteRegle` `setEquiteImportance` `setCohorteEquite` `deleteCohorteEquite` `setStructureRegle` `upsertCompositionRegle` `upsertRoleInterditRegle` `setRoleAvantageFinancier` `upsertRegle` `proposerRegleDepuisTexte` | 🟡 **création** seulement |
| **Structure / profils** | 16 actions (`creerProfil` `renommerProfil` `setProfilMeta` `setHorairesProfilCreneau` `supprimerProfil` `creerProfilComplet` `proposerProfilDepuisTexte` `creerCreneauSurMesure` `setCreneauActif` `creerRelationCreneau` `setRelationActive` `supprimerRelation` `proposerRelationDepuisTexte` `supprimerCreneauSurMesure` `configurerPartagesCabinet` `configurerAdresseCabinet`) | 🟡 **propose** profil + relation |
| **Périodes** | `creerPeriode` `setProfilPeriode` `setEffectifPeriode` `supprimerPeriode` | ❌ rien |
| Divers | `changerStatutCompensation` (dépannages), `api/export-pdf`, `api/calendar-sync`, `api/bilan` | ❌ rien |

---

## 4. Ordre de chantier (du plus utile au plus rare)

1. **Le planning vivant** — réattribuer, absences, congés, échanges.
   C'est ~80 % du quotidien d'Anne-So. C'est aussi là que le récap de
   cohérence a le plus de valeur.
2. **Les règles** — finir ce qui est commencé : modifier, désactiver,
   supprimer, et pas seulement créer.
3. **L'équipe et les périodes** — plus rares, plus lourds de conséquences.
4. **Structure / profils** — le plus technique, à faire en dernier.

Le socle transverse (boîte à outils + fiche de récap + journal + annulation)
se construit avec le chantier 1 et sert à tous les suivants.

---

## 5. La bascule maquette → produit

**Décision MiKL : on bascule sur la version opérationnelle, au plus vite.**

### Pourquoi la maquette s'arrête ici

Elle a fait son travail : elle a répondu à *« à quoi ça ressemble »* après le
gel de la recette (l'UX était une usine à gaz). Direction trouvée : terrier,
Filou, simplification.

Elle ne peut pas répondre à *« qu'est-ce que ça fait »*. Un panneau maquetté
qui annonce « conflit avec Victor » est **une image** : le vrai sujet est que
Filou interroge réellement le moteur de règles. Une maquette qui simule de
l'intelligence ne prouve rien — et peut tromper, parce qu'elle a l'air de
marcher.

S'ajoute le coût : chaque pixel calé en maquette est du travail à refaire.

### Ce qu'il y a à porter dans le produit

| Élément | Où c'est | Note de portage |
|---|---|---|
| **Filou en couches** (respire, cligne, oreilles) | `filou/couches/*.webp` + CSS `.fx*` dans `maquette/m1-planning.html` | 4 fichiers = 53 Ko. Le CSS est autonome, à passer en composant. Calage : **arête visible à x≈192 natif** → `left: -160px` (cf. commentaire dans le CSS, piège documenté) |
| **Le socle « Faire appel à Filou »** | `.fe-socle` (même fichier) | Masque la coupe du métrage **et** porte l'action. Marges strictement égales (miroir) |
| **Coucou en vidéo** | `filou/filou-accroche-coucou.webm` (550 Ko) | Déclenché ~30-45 s + au survol. Bascule en 2 temps (pose neutre 220 ms puis échange 80 ms) |
| **Bandeau de consigne** | `.grid-hint` | « Clique sur une case pour agir dessus » |
| **Mémoire de l'origine** | `#filou=planning` lu dans `m6-accueil-epicentre.html` | Filou ouvre par une accroche liée à l'écran d'où on l'appelle. Accroches déjà écrites pour `planning`, `regles`, `absences` |
| **Le panneau de récap** | ❌ n'existe pas | À construire **directement dans le produit** — c'est une fonctionnalité, pas un visuel |

⚠ **Ne jamais réintroduire de fondu** dans les assets Filou : c'est ce qui avait
détruit le métrage (cf. `docs/patch-log.md` et la mémoire projet).

### TRANCHÉ — on bascule directement sur la nouvelle version, design ET fonctionnel

**Décision MiKL du 2026-07-25** : *« on bascule directement sur la nouvelle
version design et fonctionnelle »*.

Le design et les capacités avancent **ensemble**, dans le produit. On ne
développe pas les fonctions dans l'ancienne interface pour refaire le look
après.

⚠ **Cette décision LÈVE la règle antérieure** *« la refonte UI/design = phase
finale, après que tout le dev soit fini »* (2026-06-25). Elle ne s'applique
plus à ce chantier.

Ce que ça implique concrètement :

- Chaque écran refait arrive **en nouveau look + nouvelles capacités** d'un
  seul tenant. Pas d'écran à moitié refait.
- Le portage des assets Filou n'est pas un « en plus » : c'est la **première
  brique**, puisque le nouveau look en dépend.
- L'app reste utilisable pendant la bascule — le cabinet pilote s'en sert.
  Donc on avance **écran par écran**, chacun livré fini, jamais un grand
  chantier ouvert des semaines.
- Ordre de bascule des écrans : celui du chantier fonctionnel (§4), le
  planning vivant d'abord. Le design suit la même file.

### Premiers pas concrets

1. Créer le composant `FilouEdge` (couches + socle + coucou) et le poser sur
   une page réelle — c'est le test de portage, et la première brique du
   nouveau look.
2. Poser la **boîte à outils** : un registre qui expose chaque action manuelle
   sous forme d'outil appelable, en réutilisant les `actions.ts` existants.
3. Construire la **fiche de récap** branchée sur le validateur de règles réel
   (celui-ci existe déjà et est indépendant du moteur — c'est lui qui doit
   fournir le verdict).
4. Chantier 1 (planning vivant), action par action, testable sur Vercel.

---

*Rédigé le 2026-07-25 à la clôture de la session « Filou ».*
