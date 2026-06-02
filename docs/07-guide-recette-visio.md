# 🎥 Guide de recette en visioconférence — GuardVeto

> **Pour qui ?** Pour toi (MiKL), afin de mener la recette de GuardVeto en visio avec le cabinet, en pilotant le partage d'écran.
> **Objectif :** faire valider chaque fonctionnalité par le client, en direct, puis recueillir sa validation écrite.
> **Durée :** 45 min à 1 h.

---

## 1. ⚙️ Préparation (la veille / 30 min avant)

- [ ] **Outil visio prêt** : lien Zoom / Google Meet / Teams envoyé au client.
- [ ] **Partage d'écran testé** (et le son).
- [ ] **2 comptes prêts pour la démo** : un compte **Administrateur** et un compte **Vétérinaire** (pour montrer les 2 points de vue). Idéalement un 2ᵉ navigateur ou une fenêtre privée pour jongler entre les deux.
- [ ] ⚠️ **Données de démo** : prépare si possible une **période "bac à sable"** (brouillon) pour montrer la génération/publication **sans modifier le vrai planning du cabinet**. Ne régénère jamais un planning déjà publié en réel pendant la démo.
- [ ] **Connexion testée** sur https://guardveto.vercel.app (vérifie que le déploiement du jour est bien en ligne).
- [ ] **Imprime ou ouvre** ce guide + le PV de recette (`06-fiche-recette-client.md`) pour cocher en direct.

> 💡 Conseil d'or pour un client non-technique : **parle bénéfices, pas technique.** Dis « voici comment vous validez un congé en un clic », pas « voici la mutation RLS ». Laisse-le poser des questions. S'il bloque sur un point, note-le calmement comme « réserve » — ce n'est pas un échec, c'est le but de la recette.

---

## 2. 🎬 Déroulé de la démo (à suivre dans l'ordre)

> Pour chaque étape : **🖱️ ce que tu montres** · **🗣️ ce que tu dis** · coche quand le client valide.

### Introduction (2 min)
🗣️ « GuardVeto gère le planning des gardes de vos 7 vétérinaires : génération automatique équitable, gestion des congés, notifications, export imprimable. Je vous montre tout, vous m'arrêtez quand vous voulez. »

### A — Connexion
- [ ] 🖱️ Page de connexion → se connecter en **Administrateur**. 🗣️ « Chacun a son compte personnel et sécurisé. »
- [ ] 🖱️ Montre le « Mot de passe oublié ». 🗣️ « Si quelqu'un oublie son mot de passe, il le réinitialise seul par email. »

### B — Côté Administrateur (le cœur de l'outil)
- [ ] 🖱️ **Vétérinaires** : la liste des 7 + leurs contraintes. 🗣️ « On déclare ici les contraintes de chacun. »
- [ ] 🖱️ **Périodes** : montre une période (hiver 12 sem / été 17 sem).
- [ ] 🖱️ **Congés — saisie** : ajoute un congé pour un véto.
- [ ] 🖱️ **Congés — validation/refus** : valide une demande, puis refuse-en une **avec un motif**. 🗣️ « Le véto reçoit la réponse et le motif par email. »
- [ ] 🖱️ **Génération du planning** (sur la période bac à sable) : lance la génération. 🗣️ « L'outil répartit les gardes automatiquement, en respectant les règles et l'équité. » ⭐ *moment fort de la démo*
- [ ] 🖱️ **Alertes / violations** : montre comment les conflits sont signalés.
- [ ] 🖱️ **Modifier une garde** : ouvre une garde, montre la modification manuelle.
- [ ] 🖱️ **Publier** : publie le planning. 🗣️ « Tant que ce n'est pas publié, les vétos ne voient rien. »
- [ ] 🖱️ **Export PDF** (barre d'actions) : télécharge le PDF imprimable.
- [ ] 🖱️ **Compteurs / équité** : montre le bilan par véto.

### C — Côté Vétérinaire
- [ ] 🖱️ Connecte-toi avec le **compte véto** (2ᵉ fenêtre). 🗣️ « Voilà ce que voit un vétérinaire. »
- [ ] 🖱️ **Consulter le planning** publié, naviguer entre les mois.
- [ ] 🖱️ **Déposer un souhait de congé**.
- [ ] 🖱️ **Exporter le planning en PDF** (le bouton « Exporter PDF »). 🗣️ « Chaque véto peut imprimer son planning. »
- [ ] 🖱️ 🗣️ « Le véto ne voit ni les brouillons ni les données d'administration — chacun voit ce qui le concerne. »

### D — Notifications & intégrations
- [ ] 🖱️ Montre un **email** reçu (publication / refus de congé).
- [ ] 🖱️ Montre la **synchro Google Agenda** (les gardes dans l'agenda partagé).
- [ ] 🗣️ « Des rappels automatiques sont aussi envoyés avant chaque échéance de publication. »

### E — Sur mobile
- [ ] 🖱️ Ouvre l'appli sur **téléphone** (partage ou montre). 🗣️ « C'est utilisable depuis un mobile. »

### Questions
- [ ] Laisse le client poser ses questions. Note tout dans les **réserves**.

---

## 3. 📋 Réserves relevées pendant la visio

| N° | Fonctionnalité | Remarque du client | Gravité (bloquant / mineur) |
|----|----------------|---------------------|------------------------------|
| 1 | | | |
| 2 | | | |
| 3 | | | |

---

## 4. ✅ Clôture & validation à distance

À la fin de la visio, annonce clairement le résultat et **demande la validation écrite** :

🗣️ « Si tout vous convient, je vous envoie un court email de validation : il vous suffira d'y répondre "Je valide" pour officialiser la mise en service. »

### Modèle d'email de validation (à envoyer juste après la visio)

```
Objet : Validation de la recette — GuardVeto

Bonjour [Nom],

Merci pour votre temps lors de la démonstration de GuardVeto ce jour.

Nous avons passé en revue ensemble les fonctionnalités suivantes :
connexion, gestion des vétérinaires et des congés, génération et
publication du planning, export PDF, notifications et synchronisation
Google Agenda.

[Si réserves :] Les points suivants seront corrigés avant le [date] :
- …

Pour officialiser la recette et la mise en service, merci de répondre
à cet email par « Je valide la recette de GuardVeto ».

Bien cordialement,
MiKL — MonProjetPro
```

> ⚖️ **Valeur juridique** : la réponse « Je valide » du client par email constitue une preuve de recette. Conserve cet échange. Si le client préfère, tu peux aussi lui envoyer le PV (`06-fiche-recette-client.md`) en PDF à signer et te le renvoyer scanné.

---

*Guide généré le 2026-06-01 — à utiliser avec le PV de recette (06-fiche-recette-client.md).*
