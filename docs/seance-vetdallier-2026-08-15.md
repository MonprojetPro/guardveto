# Fiche de séance — VetdAllier, 15 août 2026

> À garder sous les yeux pendant la démonstration.
> Préparée le 14 août 2026 à partir des retours écrits d'Anne-Catherine et d'Anne-Sophie du 10 juin 2026.
> Interlocutrices : **Anne-Sophie** (associée, c'est elle qui construit le planning) et **Anne-Catherine** (associée).

---

## 1. Où en est l'application ce matin

**Le compte est vierge, volontairement.** Il ne contient plus que ce que le cabinet a réellement dit : **7 vétérinaires**, **4 types de garde**, **18 règles — toutes actives, aucune en pause**, 2 liens de structure, et une seule période type neutre (« Configuration standard », 2 vétérinaires partout).

Tout le reste a été effacé : aucun planning, aucune garde, aucun congé, aucune absence, aucune notification, aucun e-mail au journal. Ce sont des données de test qui n'avaient rien à faire là. **La séance commencera donc par créer le premier planning** — ce qui est exactement ce qu'on veut montrer, et ce que vivra n'importe quel cabinet qui s'abonne.

Les 18 règles restantes, en clair : l'indisponibilité d'Anne-Sophie une semaine sur deux · Manon et Antoine jamais en duo · les jours de repos fixes d'Anne-Catherine, Anne-Sophie et Fanny · les repos liés au week-end de Jean, Antoine, Manon et Victor · le vendredi soir lié au week-end · l'inversion des rôles · les 6 dimensions d'équité.

Quatre réglages ont été corrigés ce matin pour coller à ce que les deux associées avaient écrit :

| Ce qui a changé | Pourquoi |
|---|---|
| « Vendredi soir lié au week-end » repasse en **interdiction ferme** | Les deux l'avaient validée comme règle dure. Elle avait glissé en « à éviter » sans que personne le demande. |
| « Inversion 1er/2nd entre vendredi et week-end » repasse en **interdiction ferme** | Idem. Anne-Catherine : « Ça marche capitaine ! » |
| Le repos de **Jean** (vendredi, ou mardi s'il est de garde le week-end) passe en **« Sauf urgence »** | Anne-Catherine : « Pour moi c'est une règle molle. » Il était en interdiction ferme. |
| L'équité sur les **jours fériés** descend à **priorité faible** | Anne-Sophie : « je mettrai le nombre de jours fériés en dernier. » Elle était au même niveau que tout le reste. |
| **Neuf règles ont été supprimées** — dont « au moins un senior le week-end » | **Aucune ne venait du cabinet** : c'étaient des essais de développement restés en base. Un « un seul week-end tous les six mois » par vétérinaire, une exigence portant sur une étiquette que personne ne porte, une autre sur une étiquette que tout le monde porte. Elles étaient déjà en pause ; les garder n'aurait servi qu'à ce que quelqu'un les rallume par curiosité. Si elles réclament une règle « au moins un senior », on l'installera proprement en étiquetant plusieurs vétérinaires — pas une seule personne. |
| Un lien **« le binôme du week-end tient aussi les soirs de semaine »** est **retiré** | Ce lien obligeait les deux vétérinaires de garde le week-end à assurer en plus toutes les gardes du lundi au jeudi. C'est l'inverse exact de ce que demande Anne-Sophie, et surtout : **cela rendait le planning impossible à construire au-delà de deux semaines** — le logiciel cherchait une minute puis renonçait. Aucun échange avec le cabinet ne le demande ; tout indique un essai resté allumé. Désactivé, pas supprimé. |

**Vérifié après ces changements** : un planning de 12 semaines se construit désormais en moins d'une seconde, sans aucune place vide et sans aucune règle enfreinte. Idem sur 6 semaines, à 6 comme à 7 vétérinaires, et sur l'été.

### 🌡️ La période type « Été » se crée EN DIRECT, avec elles

C'est la demande n°1 d'Anne-Catherine — elle écrivait en juin : « ça garde les deux vétos de garde […] **il faut qu'on puisse rentrer cette règle manuellement** ». Elle avait été préparée à l'avance, puis **volontairement retirée** : la créer devant elles répond mieux à sa demande que la lui montrer déjà faite. C'est le moment de la séance où on démontre que le logiciel a changé.

**Le geste, quand le sujet arrive :** Règles → onglet **Périodes types** → créer « Été » → mettre **Soir de semaine à 1 vétérinaire**, laisser les trois autres gardes à 2. Ne pas la cocher « par défaut ».

**Ce qu'il faut lui dire :** en juin, le logiciel décidait tout seul de la saison — et il se trompait. Maintenant c'est le cabinet qui décide : on nomme des périodes types, on choisit celle qu'on applique en créant le planning. Le logiciel ne devine plus rien.

**La seule période type existante** : « Configuration standard » — 2 vétérinaires partout, sans aucun affinage. Elle est là parce qu'il en faut au moins une pour générer, et elle est volontairement neutre. « Été » sera la première que le cabinet aura créée lui-même.

---

## 2. Les questions à poser, dans l'ordre

Les neuf questions ci-dessous sont classées de la plus structurante à la plus secondaire. Les trois premières conditionnent tout le reste : **à poser avant de générer quoi que ce soit.**

### Question 1 — Anne-Catherine fait-elle encore des gardes ?

> « Anne-Catherine, dans le logiciel tu es aujourd'hui en "dernier recours" : le planning ne te met de garde que s'il n'a vraiment personne d'autre. Anne-Sophie, de ton côté, tu m'as écrit en juin qu'Anne-Catherine était sortie de l'équation et que vous seriez six cet hiver. Qu'est-ce qu'on retient pour le planning qu'on va faire aujourd'hui : **six vétérinaires**, ou **sept dont Anne-Catherine en secours** ? »

*Pourquoi c'est la première question :* tout le reste en découle. À six, les règles de répartition ne sont pas les mêmes qu'à sept.

*Ce que disent leurs mails :* Anne-Catherine a validé « dernier recours » pour elle-même, en la classant comme règle souple. Anne-Sophie a écrit : « Anne-Catherine étant sortie de l'équation et étant donné que nous serons 6 vétos l'hiver prochain à faire des gardes… ». **Les deux ne disent pas la même chose.**

---

### Question 2 — Des périodes de combien de semaines ?

> « Le document de départ parlait de périodes de **12 semaines**, trois dans l'hiver. Anne-Sophie, tu m'as écrit en juin que vous pourriez partir sur des **rotations de 6 semaines**. On construit le planning d'aujourd'hui sur quelle durée ? »

*À savoir :* c'est libre. On saisit un nombre de semaines à la création du planning, la période commence toujours un lundi.

---

### Question 3 — L'été commence et finit exactement quand ?

> « L'été, vous n'êtes plus qu'un seul de garde la nuit en semaine. Je voudrais la date exacte. J'ai trois versions différentes dans mes notes : "du premier lundi de mai au dernier dimanche d'août", "de mi-mai à fin août ou début septembre", et un essai que tu avais fait, Anne-Catherine, du 4 avril au 23 mai. **Quelles dates pour l'été prochain ?** Et je confirme : ça commence un lundi et ça se termine un vendredi, c'est bien ça ? »

*À savoir :* le logiciel ne devine plus la saison tout seul. C'est le cabinet qui décide — on nomme une période type, et on choisit laquelle s'applique en créant le planning.

👉 **C'est le bon moment pour créer la période type « Été » avec elles** (voir en tête de fiche) : Règles → Périodes types → « Été » → Soir de semaine à **1 vétérinaire**. La réponse à cette question donne les dates, la période type donne l'effectif.

---

### Question 4 — Manon et Antoine ensemble : interdit, ou seulement à éviter ?

> « Vous n'êtes pas d'accord toutes les deux sur ce point, donc je préfère vous le demander en direct. Anne-Catherine, tu voulais que ce soit **totalement interdit**, y compris à Noël et au Nouvel An. Anne-Sophie, tu m'as écrit que tu le mettrais **en règle souple**, parce qu'il arrive qu'ils soient de garde ensemble quand il n'y a pas le choix. Qu'est-ce qu'on retient ? »

*Ce que ça change concrètement :*
- **Interdit** → le logiciel refusera de rendre un planning plutôt que de les mettre ensemble. Il vous demandera d'arbitrer.
- **À éviter sauf urgence** → il les évitera toujours, mais les mettra ensemble s'il n'y a vraiment aucune autre combinaison, plutôt que de vous rendre un planning incomplet.

*C'est aujourd'hui réglé sur « interdit ».* Je n'y ai pas touché exprès : c'est à vous de trancher.

---

### Question 5 — Une garde commence à 18h ou à 18h30 ?

> « Petit détail mais il se voit sur tous les plannings imprimés : dans le logiciel, les gardes de semaine sont saisies de **18h30 à 8h30**. Mes notes de départ disaient 18h à 8h. C'est laquelle, la bonne ? »

---

### Question 6 — Les soirs du 24 et du 31 décembre

> « Anne-Catherine, quand je t'avais listé une règle "éviter les gardes les soirs de réveillon", tu m'avais répondu "c'est-à-dire ?". Je reformule : voulez-vous que le logiciel **essaie d'épargner les soirs du 24 et du 31 décembre** à ceux qui sont déjà très chargés, ou est-ce que ces deux soirs se traitent comme n'importe quel autre ? »

*Statut actuel :* le logiciel les évite « autant que possible ». Personne ne l'a validé, c'est un réglage par défaut.

---

### Question 7 — Le rôle de 1er le week-end, et sa rémunération

> « Être **1er de garde le week-end** rapporte plus qu'être 2nd. Le logiciel essaie aujourd'hui de faire tourner ce rôle entre tout le monde, y compris les salariés, pour que l'avantage ne revienne pas toujours aux mêmes. **Est-ce que c'est ce que vous voulez** — ou est-ce que le rôle de 1er doit rester réservé aux associées et aux plus expérimentés ? »

*Important :* cette question vous avait été posée par écrit en juin, elle est restée sans réponse, et le réglage a été activé en attendant. C'est donc un choix qui a été fait à votre place — il faut le valider ou le corriger.

---

### Question 8 — Confirmation sur l'équité des jours fériés

> « Anne-Sophie, tu m'avais écrit "je mettrai le nombre de jours fériés en dernier". Je l'ai réglé comme ça ce matin : le logiciel équilibre d'abord les week-ends et les gardes de semaine, et ne s'occupe des jours fériés qu'après. **C'est bien ce que tu voulais ?** »

---

### Question 9 — Un jour férié, c'est une garde de journée ou une garde de nuit ?

> « Dernière question, et c'est du détail pratique. Prenons le 11 novembre, un mercredi. Aujourd'hui, le logiciel le traite comme un mardi ordinaire : il crée une garde **de 18h30 à 8h30 le lendemain matin**. Donc quelqu'un est de garde la nuit, mais personne n'est désigné pour la journée.
>
> Ma question : **le 11 novembre, qui couvre la journée ?** Est-ce qu'il y a quelqu'un de garde dès le matin, comme un samedi ? Ou est-ce que la clinique est ouverte normalement ce jour-là, et seule la nuit est une garde ? »

*Pourquoi je pose la question :* dans l'écran qui décrit vos types de garde, la fiche « Jour férié » affiche des horaires de **journée entière** (8h30 → 8h30). Ces horaires-là ne sont pas appliqués aujourd'hui — c'est la garde de soirée qui l'emporte. Avant de corriger quoi que ce soit, il faut savoir laquelle des deux correspond à votre réalité. Rien dans nos échanges de juin ne décrit la garde d'un jour férié : vous n'avez jamais eu à me le dire.

⚠️ **À ne pas confondre avec un trou.** Le **décompte** des jours fériés, lui, fonctionne parfaitement — vérifié sur un planning d'essai : les gardes qui tombent un jour férié sont bien reconnues comme telles et réparties entre plusieurs vétérinaires. L'équité sur les fériés qu'Anne-Sophie vient de demander (question 8) s'applique donc réellement. **Ce qui est en question ici, c'est l'HORAIRE de la garde d'un jour férié, pas son comptage.** Ne pas annoncer un problème de compteur — il n'y en a pas.

---

## 3. Ce que le logiciel ne sait pas faire aujourd'hui

**À annoncer plutôt que de les laisser le découvrir.** Formulation suggérée pour introduire le sujet :

> « Avant qu'on lance la génération, je préfère être clair sur six choses que l'outil ne sait pas encore faire. Deux d'entre elles vont se voir tout de suite sur le planning qu'on va produire. »

### 3.1 — À six, les vétérinaires du week-end n'ont aucune garde en début de semaine ❗

**Ce que vous demandez :** « Ils sont de garde vendredi, samedi et dimanche et c'est tout, pas d'autre garde sur le début de la semaine — ni lundi, ni mardi, ni mercredi, ni jeudi. » (Anne-Sophie)

**Ce que fait l'outil :** il ne sait pas relier « être de garde le week-end » à « ne rien avoir du lundi au jeudi de la même semaine ». Il sait interdire une garde **le lendemain** d'une autre, pas sur toute une semaine.

**Ce qu'on peut faire en attendant :** poser une limite « au plus 2 gardes par semaine » par vétérinaire, ce qui réduit fortement le problème sans l'éliminer. Puis corriger à la main les cas restants.

**C'est la règle la plus importante des six.** Elle décrit votre fonctionnement normal de l'hiver qui arrive : le planning généré aujourd'hui ne la respectera pas.

**L'ordre de grandeur, mesuré à l'avance sur un planning d'essai** — à annoncer, parce que ce n'est pas un cas isolé mais le motif dominant :

| Longueur du planning | Nombre de fois où un vétérinaire de garde le week-end a aussi une garde du lundi au jeudi |
|---|---|
| 12 semaines | **31 fois** |
| 6 semaines | **18 fois** |
| Été (8 semaines) | 10 fois |

Cela commence dès le premier week-end du planning. Formulation possible : « Sur douze semaines, ça arrive une trentaine de fois. Le logiciel ne sait pas encore l'éviter — il faudra soit corriger à la main, soit attendre que je l'ajoute. »

### 3.2 — Imposer un binôme précis sur une date (le 25 décembre) ❗

**Ce que vous demandez :** « Je veux que untel et untel soient de garde pour le 25 décembre… ce qui nous permettrait de garder la main sur cette rotation, qui est une rotation lente sur plusieurs années. » (Anne-Catherine, validé par Anne-Sophie)

**Ce que fait l'outil :** il n'a aucun moyen de fixer d'avance qui tient une date.

**Ce qu'on peut faire en attendant :** générer le planning, puis modifier la case du 25 décembre à la main. La limite à annoncer : **si on régénère la période, la modification est perdue.** Il faut donc le faire en dernier.

**C'est la deuxième plus attendue** : c'est le seul moyen que vous aviez identifié pour garder la main sur les fêtes.

### 3.3 — « Jamais deux week-ends de 1er de suite » en règle vraiment ferme

**Ce que vous demandez :** « On pourrait mettre en règle dure : jamais deux week-ends premiers de suite. On peut enchaîner un 1er et un 2nd par contre, en règle molle, sinon c'est très bloquant. » (Anne-Catherine, « OK » d'Anne-Sophie)

**Ce que fait l'outil :** il sait éviter deux week-ends de suite, mais (a) **sans faire la différence entre 1er et 2nd**, et (b) seulement en « sauf urgence », jamais en interdiction absolue.

**Ce qu'on peut faire en attendant :** le régler au maximum disponible — « Sauf urgence ». En pratique il ne l'enfreindra que s'il n'a aucune autre solution.

### 3.4 — Pâques et Pentecôte

**Ce que vous demandez :** le même binôme sur samedi, dimanche **et le lundi férié**, et deux autres vétérinaires le vendredi soir « sinon c'est long, 4 jours de garde de suite ».

**Ce que fait l'outil :** il traite le lundi de Pâques comme un soir de semaine ordinaire, sans le rattacher au week-end qui précède.

**Ce qu'on peut faire en attendant :** corriger ces deux week-ends à la main dans l'année. Ils sont connus à l'avance, ça se fait en cinq minutes.

### 3.5 — « Pas de garde la veille »

**Ce que vous demandez :** « Il ne devrait pas être de garde la veille [de ses vacances], en règle molle », et de la même façon pas de garde la veille de son jour de repos.

**Ce que fait l'outil :** il sait éviter de mettre quelqu'un de garde **le week-end** qui précède ses vacances. Il ne sait pas traiter « la veille » d'un jour posé, ni « la veille » d'un jour de repos.

**Ce qu'on peut faire en attendant :** activer ce qui existe (le week-end avant les vacances) et vérifier les veilles de départ à la main.

### 3.6 — Les jours de repos et le compteur de congés

**Ce que vous demandez :** que le logiciel **calcule** les jours de repos (« un jour de repos par semaine par vétérinaire présent ; pas de jour de repos si un jour férié tombe dedans pour Fanny, Anne-So et Jean ; pas de jour de repos si une journée est déjà posée indisponible dans la semaine »), et qu'il tienne le compte des congés en jours — 42 pour les salariés, 70 pour les associés, du 1er octobre au 30 septembre, avec un bilan trimestriel et un compteur en négatif quand un repos n'a pas pu être pris.

**Ce que fait l'outil :** les jours de repos sont **saisis** comme des contraintes (« Fanny ne travaille pas le mercredi ») et respectés par le planning. Mais ils ne sont **pas calculés**, et il n'y a **aucun décompte de congés en jours**.

**Ce qu'on peut faire en attendant :** rien d'automatique. C'est le plus gros chantier de la liste, et c'est le point n°2 de la liste « à peaufiner » d'Anne-Catherine — elle le mentionnera probablement.

### 3.7 — Deux choses qui se verront dans les compteurs, et qui sont NORMALES

Ce ne sont pas des trous, mais elles sautent aux yeux sur le tableau des compteurs. Mieux vaut les expliquer avant qu'elles ne soient lues à voix haute.

**Anne-Catherine apparaît à zéro garde.** C'est le fonctionnement correct du « dernier recours » : le logiciel ne la place que s'il n'a personne d'autre — et il trouve toujours quelqu'un d'autre. Mais une ligne à 0 à côté de lignes à 25, dans un tableau, se commente toute seule.

**Anne-Sophie sort mécaniquement sous-chargée** : environ **20 gardes contre 26** aux plus chargés sur douze semaines, soit un écart d'environ 23 %. Ce n'est pas un défaut de répartition — c'est la conséquence directe de ses indisponibilités une semaine sur deux : elle est absente de la moitié des créneaux, donc le logiciel ne peut pas lui en donner autant qu'aux autres. Formulation possible :

> « Anne-Sophie en a moins, et c'est mécanique : avec le vendredi, le samedi et le dimanche des semaines impaires bloqués, plus le lundi et le mardi qui suivent, il y a simplement moins de créneaux où elle est disponible. Si vous voulez rééquilibrer, ça se fera sur autre chose que le nombre de gardes. »

À l'inverse, une fois Anne-Catherine mise de côté, **les week-ends sont parfaitement égaux** entre les six autres, et l'écart de charge totale reste resserré. C'est le point fort à montrer.

---

## 4. Les deux pièges à ne pas déclencher en direct

> **Deux pièges ont disparu depuis la première version de cette fiche**, et c'est le vidage du compte qui les a réglés. Les neuf règles en pause — dont « au moins un senior », qui aurait bloqué toute génération dès qu'on aurait parlé du départ d'Anne-Catherine — **n'existent plus**. Il ne reste aucune règle en sommeil à rallumer par curiosité. **On peut donc laisser les vétérinaires manipuler l'écran Règles sans arrière-pensée.**
>
> Une réserve technique subsiste, sans danger aujourd'hui puisqu'il n'y a plus rien à réactiver : quand on **crée** une règle, le logiciel prévient si elle pose problème ; quand on **réactive** une règle existante ou qu'on change son niveau de fermeté, il ne prévient pas — la sanction arrive à l'étape « Générer », qui refuse de partir en expliquant pourquoi. Pour démontrer une modification de règle en direct, préférer une règle **nominative** (un repos fixe, une indisponibilité, un duo) : celles-là avertissent bien au moment du clic.

### Piège n°1 — Le champ « période type » démarre vide, et c'est exprès

Quand on crée un planning, il faut **choisir** la période type. Une seule existe aujourd'hui : « Configuration standard », **2 vétérinaires partout**. Le champ est vide au départ pour qu'on ne génère jamais par inadvertance avec le mauvais réglage.

**Le piège :** il n'existe **aucune période type d'été** tant qu'on ne l'a pas créée en séance. Si on veut montrer l'été sans l'avoir créée, le planning sortira avec **2 vétérinaires par nuit** au lieu d'un seul — et c'est précisément le défaut qu'Anne-Catherine avait signalé en juin. Donc : créer « Été » d'abord, la choisir ensuite, générer en dernier.

### Piège n°2 — Une règle modifiée ne change pas le planning déjà affiché

Si, pendant la séance, on change un réglage (par exemple passer le duo Manon + Antoine en souple), **le planning à l'écran ne bouge pas**. Les règles s'appliquent à la **prochaine génération**.

**Le piège :** montrer un changement de règle, regarder l'écran, et conclure devant elles que « ça n'a pas marché ». Il faut relancer la génération pour voir l'effet. Le dire à voix haute avant de toucher au moindre réglage.

## 5. Aide-mémoire — où se trouve quoi

| Ce qu'on veut faire | Où |
|---|---|
| Créer un planning, choisir la durée et la période type | **Générer** (première étape du parcours) |
| Changer le nombre de vétérinaires par garde, selon la saison | **Règles → Périodes types** |
| Changer les horaires ou les jours d'un type de garde | **Règles → Types de garde** |
| « Vendredi lié au week-end », « inversion des rôles » | **Règles → Enchaînements** |
| Priorités d'équité, réglages du moteur | **Règles → Moteur** |
| Contraintes propres à une personne (repos, indisponibilités, duos) | **Équipe → fiche du vétérinaire → Ses contraintes** |
| Congés et absences | **Absences** |
| Compteurs par type de garde (1er semaine, 2nd semaine, 1er week-end, 2nd week-end) | **Historique / Compteurs** |

Les quatre niveaux de fermeté d'une règle, tels qu'ils s'affichent :

- **Jamais** — le moteur ne le fera en aucun cas, quitte à ne pas trouver de planning et à demander d'arbitrer.
- **Sauf urgence** — il l'évite toujours, et ne s'y résout que si aucune autre combinaison ne marche.
- **À éviter** — il accepte de déséquilibrer un peu la répartition pour ne pas avoir à le faire, mais le fera plutôt que de bloquer.
- **Souhait** — il en tient compte en dernier, une fois l'équité assurée. Ne coûte jamais une garde à quelqu'un d'autre.

---

*Fiche préparée le 2026-08-14. Les citations entre guillemets sont les mots exacts d'Anne-Catherine et d'Anne-Sophie, tirés de leurs réponses écrites du 10 juin 2026 (`docs/retours-cabinet/`).*
