# Changements agenda Google (cliente) — comparaison 18/08 → 20/08/2026

---

# 🎤 À POSER EN RENDEZ-VOUS — dans cet ordre

> Les six questions ci-dessous, dans l'ordre. Les trois premières bloquent la
> génération du planning d'octobre-novembre : sans elles, on devine, et un
> planning deviné se paie en confiance dès la première garde qui tombe sur
> quelqu'un qui n'était pas là.

**1. « Vous notez des noms en semaine — "Victor 1" le lundi 14, "AC 2" le mardi 15. Ce sont des gardes ? »**
→ Notre outil ne connaît, pour l'été, **que des gardes de week-end** : 8 lignes, toutes des samedis. Tout ce que vous inscrivez en semaine n'existe nulle part chez nous. Soit ce sont de vraies gardes qu'il faut modéliser, soit c'est autre chose. **C'est la question la plus lourde de conséquences.**

**2. « Que veut dire "am" après un prénom ? Et "j" ? »**
→ « AS am » revient cinq fois (8 et 12/10, 5, 9 et 19/11). Matin, après-midi, journée ? Et surtout : **est-ce qu'elle est disponible, ou justement pas ?** On a une case pour ça, on ne sait pas laquelle cocher. Même question pour « Fan j », « AS j », « Man j ».

**3. « "J vacs svp" du 17 au 25 octobre — c'est Jean ? »**
→ Si oui, **c'est une semaine entière d'absence** en pleine période à générer. Si « J » veut dire « journée », ça ne veut plus rien dire. On n'a rien inscrit tant qu'on n'est pas sûr. Même chose pour « J libre si possible » les 7 et 8 novembre.

**4. « Manon disparaît de ses trois gardes du 14 au 18 septembre. Que s'est-il passé ? »**
→ « Man 1 » le 14, « Man2 » le 16, « Man j » le 18 : supprimés. Victor et Antoine ont pris le relais. Changement d'organisation, ou nettoyage de doublons ?

**5. « Victor et Manon ont échangé les 1er et 2 septembre — c'est bien un échange entre eux ? »**
→ Ce sont **les deux mêmes événements** qui ont été déplacés, chacun sur la date de l'autre (comparaison faite sur l'identifiant Google, pas sur le titre — donc ce n'est ni une ressaisie ni un doublon). L'échange est réel ; reste à savoir s'il est définitif.

**6. « Les "AS am" à répétition — c'est un rythme régulier ou des dates ponctuelles ? »**
→ S'il y a une régularité (tous les jeudis matin, par exemple), on peut la poser une fois pour toutes comme règle au lieu de la ressaisir chaque mois.

---

## ✅ Ce qui a été mis à jour dans GuardVeto (fait, sans interprétation)

| Ce qui a changé | Pourquoi c'était sûr |
|---|---|
| **Victor** — « pas de garde, embouteillage Lapalisse » déplacé du **9/10** au **10-11/10** | La cliente a elle-même déplacé l'événement le 20/08. Son agenda le plus récent fait foi ; on suit, on n'interprète pas. |
| **Manon** — souhait ajouté le **2/10** : « je reste sur Paris entre la CEC et mon DE » | Le texte dit explicitement qu'elle **n'est pas là**. Aucune interprétation nécessaire. Cohérent avec son examen DE déjà en base le 17/12. |

**Rien d'autre n'a été écrit**, et c'est délibéré : tout le reste dépend du sens de « am », « j » ou « J ». Une garde attribuée à quelqu'un d'absent parce qu'on aurait deviné coûte plus cher qu'une ligne manquante.

---

> Extraction faite en lecture seule à partir des deux exports iCal fournis par la cliente (cabinet vétérinaire du Val d'Allier) :
> - Ancien (18/08) : `vetvalallier@gmail.com.ical/PLANNING DES VETOS_....ics`
> - Nouveau (20/08) : `vetvalallier@gmail.com.ical-2/PLANNING DES VETOS_....ics`
>
> Comparaison faite par `UID` iCalendar (identifiant stable d'un événement Google même quand la date change). Confrontation avec la base Supabase (`gardes`, `conges`, `veterinaires`) — période été (`e26cec19-…`, 27/07→20/09) et hiver (`c35eb29d-…`, 21/09→29/11, brouillon).

---

## ⚠️ Constat préalable, avant les tableaux

**La base GuardVeto ne connaît que 8 gardes sur toute la période été (27/07→20/09), une par week-end** (samedi+dimanche, `type = 'weekend'`). Toutes les entrées de l'agenda Google du 01/09, 02/09, 14/09, 15/09, 16/09 et 18/09 (les changements listés ci-dessous) tombent sur des **jours de semaine** — elles n'ont donc **aucune ligne correspondante dans la table `gardes`**. Il n'y a rien à mettre à jour côté `gardes` pour ces dates : soit ces jours de semaine ne sont pas modélisés dans GuardVeto (probable, période été = week-ends uniquement), soit ils devraient être des `conges`/indisponibilités. Voir section "à éclaircir".

---

## Tableau 1 — Gardes de septembre (agenda cliente vs base)

| Date agenda | Ce que dit l'agenda de la cliente (nouveau export) | Ce que dit notre base | Action proposée |
|---|---|---|---|
| 01/09 | `Victor 1` (UID `7u66jcu0…`) — **déplacé** depuis le 02/09 (ancien export) | Aucune garde en base ce jour (mardi, hors période gardée par `gardes`) | Rien en base. Si un jour de semaine doit être suivi, le créer comme `conges`/dispo — cf. question ouverte. |
| 02/09 | `Man1` (UID `3g2f9rkgm8…`) — **déplacé** depuis le 01/09 (échange Victor↔Manon) | Idem, aucune ligne `gardes` (mercredi) | Rien en base pour `gardes`. |
| 14/09 | `Victor 1` (UID `2u78pjv80…`) — **renommé**, était `Victor journée` dans l'ancien export | Aucune ligne `gardes` (lundi) | Rien en base. |
| 14/09 | `Man 1` (UID `6i67g8ki90…`) — **supprimé** de l'agenda cliente (présent dans l'ancien export, absent du nouveau) | Aucune ligne `gardes` | Rien en base — l'entrée n'existait déjà pas côté BDD. |
| 15/09 | `AC 2` (UID `4r0gk231co…`) — **renommé**, était `Victor 2` dans l'ancien export | Aucune ligne `gardes` (mardi) | Rien en base. |
| 16/09 | `Antoine 2` (UID `471n6amphr…`) — **ajouté** (créé 19/08, absent de l'ancien export) | Aucune ligne `gardes` (mercredi) | Rien en base. |
| 16/09 | `Man2` (UID `7nfj2n3unp…`) — **supprimé** de l'agenda cliente | Aucune ligne `gardes` | Rien en base — n'existait déjà pas côté BDD. |
| 18/09 | `Victor journée` (UID `46klv3hdjv…`) — **ajouté** (créé 19/08, absent de l'ancien export) | Aucune ligne `gardes` (vendredi) | Rien en base. |
| 18/09 | `Man j` (UID `2kpf6aade2…`) — **supprimé** de l'agenda cliente | Aucune ligne `gardes` | Rien en base — n'existait déjà pas côté BDD. |
| 05/09 (rappel, inchangé) | Pas d'entrée nominative dans l'agenda ce week-end-là | `gardes` : 1er = Victor, 2nd = Jean | RAS, cohérent avec le principe garde week-end. |
| 12/09 (rappel, inchangé) | Pas d'entrée nominative dans l'agenda ce week-end-là | `gardes` : 1er = Fanny, 2nd = Antoine | RAS, cohérent. |

**SQL proposé : AUCUN.** Aucune des 9 lignes ci-dessus n'a de correspondance dans `gardes` (toutes tombent en semaine, hors du modèle "1 garde par week-end" de la période été). Rien à écrire tant que la question "à éclaircir #1" n'est pas tranchée avec la cliente.

---

## Tableau 2 — Congés / souhaits octobre-novembre

| Date | Personne | Texte exact de la cliente | Classement | Ce qu'on peut en faire |
|---|---|---|---|---|
| 02/10 | Manon (indice : préfixe "Manon") | « Manon j stp (je reste sur Paris entre la CEC et mon DE) » | SOUHAIT (« stp ») — vocabulaire "j" non élucidé | Pas de ligne `conges` correspondante en base pour Manon à cette date. À créer une fois "j" élucidé (voir ci-dessous). |
| 08/10 | AS (indice : préfixe "AS" = Anne-Sophie, sigle habituel du cabinet) | « AS am » | INDÉTERMINÉ — "am" non élucidé (matin ? absence ?) | Pas de ligne `conges` correspondante. En base ce jour : Anne-Catherine a un `conges` validé "Forum ergone - absente" (08/10). Les deux entrées peuvent coexister (personnes différentes) si confirmées. |
| 12/10 | AS | « AS am » | INDÉTERMINÉ — "am" | Aucune ligne `conges` en base à cette date. |
| 05/11 | AS | « AS am » | INDÉTERMINÉ — "am" | Aucune ligne `conges` en base à cette date (hors plage actuellement peuplée). |
| 09/11 | AS | « AS am » | INDÉTERMINÉ — "am" | Idem, aucune ligne en base. |
| 19/11 | AS | « AS am » | INDÉTERMINÉ — "am" | Idem, aucune ligne en base. |
| 10/10–11/10 | Victor (nommé explicitement) | « Embouteillage lapalisse, Victor pas de garde svp » (événement 2 jours, 10 et 11/10) | SOUHAIT (« svp ») — GARDE à éviter | ⚠️ La base a **déjà** une entrée : `conges` Victor, 09/10, type `autre`, statut `souhait`, commentaire "Pas de garde svp - embouteillage Lapalisse". **Date différente** (09/10 en base vs 10-11/10 dans l'agenda le plus récent) — à réconcilier avec la cliente, pas à corriger seul. |
| 14/10 | AS et Fan (les deux, indice : "AS et Fan j" vu à une autre date dans le calendrier + ici séparé en deux entrées "Fan j" et "AS j") | « Fan j » et « AS j » (deux entrées distinctes le même jour) | INDÉTERMINÉ — "j" | Aucune ligne `conges` en base au 14/10 pour Fanny ou Anne-Sophie. En base à proximité : Anne-Catherine a une formation validée le 13/10. |
| 17/10 | J (ambigu : Jean OU abréviation "journée" — voir ambiguïtés) | « J vacs svp » (événement du 17 au 25/10, DTSTART 20261017 / DTEND 20261026 exclusif) | SOUHAIT si "J" = Jean (vacances) | Aucune ligne `conges` Jean en base sur cette période. Fanny a par ailleurs un souhait "pas de garde si possible" le 17/10, déjà en base (validé). |
| 21/09 (rappel, déjà repéré) | Victor | « Victor repos si possible » | SOUHAIT | ✅ **Déjà en base** : `conges` Victor, 21/09, statut `souhait`, commentaire "Repos si possible". Cohérent, rien à faire. |
| 07/11–08/11 | J (ambigu : Jean OU "journée" — mais ici suivi de "libre", plus probablement un prénom) | « J libre si possible » (événement 2 jours, DTSTART 20261107 / DTEND 20261109 exclusif → couvre 07 et 08/11) | SOUHAIT si "J" = Jean | Aucune ligne `conges` Jean en base sur cette période. |

**SQL proposé : AUCUN à ce stade.** Toutes les entrées ci-dessus supposent de trancher le sens de "am"/"j" et l'identité de "J" avant d'écrire quoi que ce soit — voir section suivante. Seule l'entrée Victor du 21/09 est déjà correctement en base, et l'entrée Victor "Embouteillage" nécessite une **correction de date à valider par la cliente**, pas une création :

```sql
-- NE PAS EXÉCUTER SANS VALIDATION EXPLICITE DE LA CLIENTE.
-- Proposition SI la cliente confirme que la date à retenir est 10-11/10 (agenda le plus récent)
-- et non le 09/10 actuellement en base :
UPDATE conges
SET date_debut = '2026-10-10',
    date_fin   = '2026-10-11',
    commentaire = 'Pas de garde svp - embouteillage Lapalisse'
WHERE veterinaire_id = '00000000-0000-0000-0000-000000000007'  -- Victor Coelho
  AND date_debut = '2026-10-09';
```

---

## ⚠️ À ÉCLAIRCIR AVEC LA CLIENTE

1. **Les jours de semaine dans votre agenda (ex. "Victor 1" le lundi 14/09) — est-ce que ce sont des vraies gardes, ou autre chose ?** Notre outil ne suit pour l'instant qu'une garde par week-end. Si vous assignez aussi des gardes en semaine, il faut qu'on sache lesquelles et comment les nommer.
2. **Que veut dire "am" après un prénom (ex. "AS am") ?** Absence le matin ? Après-midi ? Toute la journée ? On a une colonne dédiée pour ça (matin / après-midi / journée / soirée) mais on ne sait pas laquelle cocher.
3. **Que veut dire "j" après un prénom (ex. "Fan j", "Manon j stp") ?** Journée entière d'absence, ou "journée de garde" ? C'est l'opposé de "am" ou pas ?
4. **"J" tout seul, ça veut dire Jean ou "journée" ?** On a trois entrées avec juste "J" ("J vacs svp" le 17/10, "J libre si possible" le 07/11, "J pas de garde svp" le 01/09) — on part du principe que c'est Jean vu que "vacs" et "libre" collent à une personne, mais on préfère confirmer.
5. **Victor "embouteillage Lapalisse" : c'est le 9/10, le 10/10, ou le 10-11/10 ?** Notre base a le 9/10, votre agenda le plus récent dit 10-11/10 (modifié le 20/08 même). Laquelle est la bonne ?
6. **Le 01/09-02/09, Victor et Manon ont-ils vraiment échangé leurs jours, ou est-ce une simple correction de faute de frappe ?** (Victor passe du 01 au 02/09, Manon du 02 au 01/09 — les deux dates s'inversent exactement.)
7. **Les suppressions du 14/09 ("Man 1"), du 16/09 ("Man2") et du 18/09 ("Man j") — Manon a-t-elle eu un changement d'organisation sur cette semaine, ou fallait-il juste enlever ces trois doublons ?**
8. **Les entrées "AS am" à répétition (08/10, 12/10, 05/11, 09/11, 19/11) — c'est une disponibilité récurrente d'Anne-Sophie (ex. tous les jeudis matin) ou des dates ponctuelles ?**

---

## Annexe — vétérinaires et sigles

| Sigle agenda | Vétérinaire | Base |
|---|---|---|
| AS | Anne-Sophie Blanchard | `00000000-0000-0000-0000-000000000001` |
| AC | Anne-Catherine Bernard | `00000000-0000-0000-0000-000000000004` |
| Fan / Fanny | Fanny Altieri | `00000000-0000-0000-0000-000000000002` |
| J / Jean *(ambigu, cf. question 4)* | Jean De Thoisy | `00000000-0000-0000-0000-000000000003` |
| Man / Manon | Manon Renaud | `00000000-0000-0000-0000-000000000005` |
| Antoine / Ant | Antoine Lafarge | `00000000-0000-0000-0000-000000000006` |
| Victor | Victor Coelho | `00000000-0000-0000-0000-000000000007` |

Le chiffre après le prénom (« Victor 1 », « AC 2 ») indique le rôle 1er/2nd de garde dans l'agenda cliente — mais rappel : aucune de ces entrées de septembre ne correspond à une ligne `gardes` en base (voir constat préalable).
