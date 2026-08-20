# Fiche de séance — VetdAllier, 21 août 2026

> À garder sous les yeux pendant la séance.
> Préparée le 20 août 2026, après le contrôle complet du premier planning généré par Anne-Sophie elle-même.
> Interlocutrice principale : **Anne-Sophie** (associée, c'est elle qui construit le planning).
> Fiche précédente : `seance-vetdallier-2026-08-15.md`.

---

## 1. Ce qui s'est passé depuis la dernière séance

**Anne-Sophie a généré son premier planning toute seule.** C'est le franchissement qu'on attendait : elle n'a eu besoin de personne.

Le planning s'appelle **« Hiver 1 »**, il couvre du **21 septembre au 29 novembre 2026** (10 semaines), il est en **brouillon** — donc rien n'est encore parti chez les vétérinaires. Il contient 50 gardes, toutes pourvues à 2 vétérinaires, sans un seul trou, et personne n'y a touché à la main.

**J'ai vérifié chacune des 18 règles du cabinet, une par une, directement dans les données.** Résultat : **aucune règle enfreinte**. En clair, sur les points qui comptent pour elle :

- L'indisponibilité d'Anne-Sophie une semaine sur deux : respectée sur les 10 semaines.
- Manon et Antoine jamais de garde ensemble : jamais arrivé, sur les 60 binômes.
- Le binôme du vendredi soir est bien celui du week-end, avec les rôles inversés : 10 fois sur 10.
- Les jours de repos fixes d'Anne-Catherine, d'Anne-Sophie et de Fanny : tous tenus.
- Les 4 congés validés (Jean, Manon, Anne-Catherine, Victor) : aucun n'a reçu de garde.
- Le 11 novembre est traité comme un jour férié à part entière ; le 1ᵉʳ novembre, qui tombe un dimanche, est couvert par le week-end.

**Et la répartition est juste** : entre les cinq vétérinaires pleinement disponibles, il n'y a que 2 gardes d'écart au total, et **une seule** d'écart sur les postes de premier. C'est très propre.

> **Le message à lui faire passer** : le logiciel n'a rien enfreint. Ce dont on va parler maintenant, ce ne sont pas des erreurs — ce sont des choses qu'on ne lui a jamais demandées.

---

## 2. ⚠️ LA question à lui poser en premier — ses semaines de disponibilité

**C'est le point le plus important de la séance. Il doit passer avant tout le reste.**

Le logiciel considère qu'Anne-Sophie est disponible **une semaine sur deux**, et il a construit tout le planning là-dessus. Mais la semaine où il la croit disponible n'a **jamais été confirmée par elle**. Si le calage est décalé d'une seule semaine, le planning est parfaitement conforme à la règle… et **totalement faux dans la vraie vie** : elle serait de garde exactement les semaines où elle ne peut pas.

**Le geste : lui montrer cette liste et lui demander si c'est bien la bonne.**

> Sur ce planning, tu es de garde les semaines du :
> **28 septembre · 12 octobre · 26 octobre · 9 novembre · 23 novembre**
>
> Et tu n'as rien les semaines du :
> **21 septembre · 5 octobre · 19 octobre · 2 novembre · 16 novembre**
>
> **C'est bien dans ce sens-là ?**

Si elle dit non → **c'est inversé, et il faut décaler le calage d'une semaine avant toute publication.** Ce n'est pas un bug, c'est un réglage qui n'a jamais été confirmé par quelqu'un qui sait.

**Pourquoi on se pose la question** : sur l'historique de juillet importé, le logiciel avait signalé qu'elle était de garde un jour où sa règle la dit indisponible. On avait supposé une exception d'été. Il faut trancher maintenant, avant qu'elle publie.

### Le point de vigilance qui va avec — les vacances scolaires

Le logiciel **recale son alternance à chaque début de vacances scolaires**. Sur cette période-ci, ça n'a rien changé (le recalage des vacances de la Toussaint est tombé juste) — mais sur une période suivante, ça peut faire basculer son rythme d'une semaine sans que personne le demande.

**À lui demander** : *« ton "une semaine sur deux", il repart de zéro aux vacances scolaires, ou il continue sans s'arrêter toute l'année ? »* Sa réponse conditionne le prochain planning.

---

## 3. Ce qu'on lui fait faire elle-même — la fréquence des week-ends

C'est **le vrai sujet du jour**, et le geste doit être fait **par elle**, dans l'écran Règles.

### Le problème, à lui montrer en ouvrant le planning

Prendre **Jean** comme exemple, c'est le plus parlant :

| Ses 3 week-ends | Quand |
|---|---|
| 1ᵉʳ | 26 septembre |
| 2ᵉ | **7 novembre** |
| 3ᵉ | **21 novembre** |

Il fait son week-end fin septembre, puis **plus rien pendant six semaines**, puis **deux week-ends en quinze jours**. Et ses deux week-ends de novembre sont avec **exactement le même binôme, dans les mêmes rôles** (Antoine premier, Jean second, les deux fois).

**L'explication à lui donner, en une phrase :** *« On a demandé au logiciel que tout le monde ait le même NOMBRE de week-ends. On ne lui a jamais demandé qu'ils soient bien répartis dans le temps. Il a fait exactement ce qu'on lui a demandé — trois week-ends pour chacun — mais il s'est permis de les grouper. »*

### Le geste, à lui faire faire

> **Règles → Ajouter une règle → « Fréquence des week-ends »**
> → Vétérinaire concerné : **« Tous les vétérinaires »** (première ligne de la liste)
> → *De garde au plus un week-end sur…* : **3**
> → laisser la fermeté sur **« Si possible »**
> → Enregistrer. **C'est tout — une seule règle pour tout le cabinet.**

**Pourquoi « si possible » et pas une interdiction ferme** : une règle trop rigide peut rendre le planning impossible à construire. En « si possible », le logiciel fait tout pour la tenir sans jamais se retrouver bloqué. On durcira plus tard si le résultat ne suffit pas.

**Pourquoi 3 et pas 2** : avec 6 vétérinaires disponibles et 10 week-ends, chacun en fait trois. Un espacement de trois semaines les étale sur toute la période sans jamais coincer.

### ✨ Nouveau depuis hier soir — « Tous les vétérinaires »

Jusqu'à hier, cette règle aurait dû être créée **six fois, une par vétérinaire**. C'était fastidieux, et surtout dangereux : un vétérinaire oublié — ou embauché plus tard — serait reparti sans la règle, sans que personne le voie.

**Une ligne « Tous les vétérinaires » a été ajoutée en tête de la liste des vétérinaires.** Une seule règle couvre désormais tout le cabinet, **y compris les vétérinaires qui arriveront plus tard** : la règle n'est pas figée sur une liste de noms, elle s'applique à l'effectif du moment.

C'est un bon moment de séance : *« vous nous aviez fait remarquer que c'était pénible de le faire un par un — c'est réglé. »* (À moduler : c'est MiKL qui l'a vu venir, mais le retour vaut pour elle aussi.)

L'option n'apparaît pas pour les règles qui désignent un binôme (« jamais en duo avec… ») : « tous » n'y aurait aucun sens.

---

## 4. Les 6 souhaits de congé en attente — à traiter AVANT de regénérer

L'écran affiche « 6 demandes de congé en attente chevauchent cette période ».

**Ce qu'il faut lui expliquer** : le logiciel ne tient compte que des congés **validés**. Un souhait qui n'a pas encore été traité est ignoré — et c'est normal, il ne peut pas deviner sa décision à sa place.

**Résultat concret : trois de ces souhaits tombent pile sur une garde qui a été attribuée.**

| Qui | Quand | Ce qui a été attribué |
|---|---|---|
| Jean | week-end du 26 septembre | il est **premier** |
| Anne-Sophie | week-end du 3 octobre | elle est **seconde** |
| Fanny | week-end du 17 octobre | elle est **seconde** |

**Le message** : *« ces six demandes, il faut les accepter ou les refuser avant de relancer. Sinon vous validerez un congé après coup et il faudra tout regénérer. »*

Les six : Victor (21/09), Jean (23/09), Jean (26/09), Anne-Sophie (03/10), Victor (09/10), Fanny (17/10).

---

## 5. Deux choses à lui signaler sans en faire un sujet

**Anne-Catherine n'a aucune garde sur toute la période.** C'est cohérent avec son statut de « dernier recours » : les six autres suffisent largement. **Mais c'est à confirmer avec elles deux** — est-ce bien l'intention, ou attendent-elles qu'elle en prenne quelques-unes ?

**Jean est de garde le mardi 3 novembre alors que c'est son jour de repos cette semaine-là** (sa règle dit : repos le vendredi, ou le mardi s'il est de garde le week-end — et il a le week-end du 7). Sa règle est réglée en **« Sauf urgence »**, donc le logiciel avait le droit de passer outre. **Décision prise : on laisse comme ça pour l'instant.** À mentionner seulement si elle le repère, et lui rappeler que c'est elle qui a choisi cette fermeté-là en juin (Anne-Catherine : *« pour moi c'est une règle molle »*).

---

## 6. 🚫 À NE PAS FAIRE pendant la séance

**Ne pas cliquer sur « Voir les demandes » dans le bandeau orange du planning.**
**Ne pas cliquer sur « Traiter dans Congés » sur l'écran d'accueil.**
**Ne pas cliquer sur la cloche des notifications.**

Ces trois boutons ouvrent d'anciens écrans qui n'ont pas encore été refaits — l'affichage change complètement (fond turquoise, autre menu) et on ne revient pas facilement en arrière. C'est identifié et rangé comme chantier à part ; ce n'est pas le sujet de demain.

**Pour traiter les congés devant elle, passer par le menu « Absences ».** C'est l'écran à jour, et il est même meilleur : il signale de lui-même quand un souhait tombe sur une garde déjà attribuée.

---

## 7. Le déroulé proposé

1. **Ouvrir le planning qu'elle a généré** et lui dire que tout est conforme — la commencer sur une réussite, c'est la sienne.
2. **Confirmer ses semaines de disponibilité** (§2). Bloquant : si c'est décalé, tout le reste attend.
3. **Traiter les 6 souhaits de congé** dans « Absences » (§4).
4. **Lui faire poser la règle « un week-end sur 3 »** sur chaque vétérinaire (§3).
5. **Regénérer devant elle** et regarder ensemble les week-ends de Jean.
6. Si le résultat lui convient → **elle publie**.

---

## 8. Ce qu'on lui doit après la séance

- [x] ~~Une ligne « Tous les vétérinaires » dans le choix du vétérinaire~~ — **livré le 20 août au soir.**
- [ ] Rebrancher les anciens écrans (congés, notifications, échanges) sur la nouvelle version.
- [ ] Trancher son rythme d'alternance face aux vacances scolaires, selon sa réponse au §2.

---

*Préparée le 20 août 2026. Contrôle du planning « Hiver 1 » fait sur les données réelles, règle par règle.*
