# 📝 Procès-verbal de recette — GuardVeto

> **À quoi sert ce document ?**
> La *recette* est l'étape où le client teste lui-même le produit et confirme, par écrit, qu'il correspond à ses besoins. Une fois ce document signé, la livraison est officiellement validée. C'est ta protection (et celle du client) : ce qui est marqué « Conforme » est accepté, ce qui est marqué « Réserve » sera corrigé avant la mise en service définitive.
>
> **Comment l'utiliser ?** Déroule chaque scénario avec le client devant l'écran. Pour chacun : il réalise l'action, on observe le résultat, et on coche. Compte ~45 min à 1 h.

---

## 1. Informations générales

| | |
|---|---|
| **Produit** | GuardVeto — planning des gardes vétérinaires |
| **Version testée** | _(ex. v1.0 — commit b9462d9)_ |
| **URL testée** | https://guardveto.vercel.app |
| **Date de la recette** | ____ / ____ / 2026 |
| **Testeur côté client** | _______________________ (rôle : ☐ Administrateur ☐ Vétérinaire) |
| **Accompagnant (MonProjetPro)** | MiKL |
| **Navigateur / appareil** | _______________________ |

**Modèle de rôles** : 2 rôles — **Administrateur** (gère tout) et **Vétérinaire** (consulte, dépose ses souhaits de congés).

**Légende** : ✅ Conforme · ⚠️ Réserve (à corriger) · ⏳ Non testé

---

## 2. Connexion & comptes (tous les utilisateurs)

| N° | Action à réaliser | Résultat attendu | Statut | Commentaire |
|----|-------------------|------------------|:------:|-------------|
| A1 | Se connecter avec email + mot de passe | Accès au planning, nom + rôle affichés en haut à droite | ☐ | |
| A2 | Cliquer sur « Mot de passe oublié » | Réception d'un email de réinitialisation, le lien permet de changer le mot de passe | ☐ | |
| A3 | Première connexion via email d'invitation | Possibilité de définir son mot de passe puis d'accéder à l'appli | ☐ | |
| A4 | Se déconnecter | Retour à la page de connexion, accès protégé impossible sans se reconnecter | ☐ | |

---

## 3. Parcours Administrateur

| N° | Action à réaliser | Résultat attendu | Statut | Commentaire |
|----|-------------------|------------------|:------:|-------------|
| B1 | Ouvrir la gestion des vétérinaires | Liste des 7 vétos, possibilité de consulter/modifier leurs contraintes | ☐ | |
| B2 | Créer ou consulter une période (12 ou 17 semaines) | La période apparaît avec ses dates et son statut (brouillon) | ☐ | |
| B3 | Saisir un congé pour un vétérinaire | Le congé est enregistré et visible | ☐ | |
| B4 | Générer un planning pour la période | Un planning complet est produit ; les gardes se répartissent entre les vétos | ☐ | |
| B5 | Vérifier les alertes / violations de règles | Les éventuels conflits de règles sont signalés clairement | ☐ | |
| B6 | Ouvrir le détail d'une garde et la modifier manuellement | La modification est prise en compte ; les disponibilités s'affichent | ☐ | |
| B7 | Valider une demande de congé déposée par un véto | La demande passe en « validé » ; le véto est notifié | ☐ | |
| B8 | Refuser une demande de congé **avec un motif** | La demande passe en « refusé » avec le motif ; le véto reçoit le motif | ☐ | |
| B9 | Publier le planning | Le statut passe en « Publié » ; les vétos peuvent désormais le voir | ☐ | |
| B10 | Exporter le planning en PDF (barre d'actions) | Un PDF propre et imprimable est téléchargé | ☐ | |
| B11 | Consulter les compteurs / l'équité | Les compteurs par véto et le bilan bonus/malus s'affichent | ☐ | |

---

## 4. Parcours Vétérinaire

| N° | Action à réaliser | Résultat attendu | Statut | Commentaire |
|----|-------------------|------------------|:------:|-------------|
| C1 | Consulter le planning publié | Vue mensuelle des gardes, navigation entre les mois | ☐ | |
| C2 | Déposer un souhait de congé | Le souhait est enregistré et visible par l'admin | ☐ | |
| C3 | Modifier ou supprimer un souhait non encore validé | La modification/suppression fonctionne | ☐ | |
| C4 | Exporter le planning publié en PDF (bouton « Exporter PDF ») | Un PDF propre et imprimable est téléchargé | ☐ | |
| C5 | Recevoir l'email de notification (planning publié / congé traité) | L'email arrive dans la boîte (vérifier aussi les spams) | ☐ | |
| C6 | Cloisonnement : vérifier qu'un véto ne voit **pas** un planning en brouillon ni les données d'administration | Seuls les plannings publiés et ses propres données sont visibles | ☐ | |

---

## 5. Intégrations & notifications

| N° | Action à réaliser | Résultat attendu | Statut | Commentaire |
|----|-------------------|------------------|:------:|-------------|
| D1 | Vérifier la réception des emails (publication, refus de congé) | Emails reçus, lisibles, non classés en spam | ☐ | |
| D2 | Vérifier la synchronisation Google Agenda | Les gardes apparaissent dans l'agenda Google partagé | ☐ | |
| D3 | Rappels automatiques de publication | À constater sur la durée (envoi automatique avant échéance) | ☐ | |

---

## 6. Affichage multi-supports

| N° | Action à réaliser | Résultat attendu | Statut | Commentaire |
|----|-------------------|------------------|:------:|-------------|
| E1 | Ouvrir l'application sur **ordinateur** | Affichage correct et lisible | ☐ | |
| E2 | Ouvrir l'application sur **mobile / tablette** | Affichage adapté, navigation possible | ☐ | |

---

## 7. Anomalies relevées pendant la recette

| N° | Scénario concerné | Description de l'anomalie | Gravité (bloquant / mineur) |
|----|-------------------|---------------------------|------------------------------|
| 1 | | | |
| 2 | | | |
| 3 | | | |

---

## 8. Prononcé de la recette

> Cocher la mention retenue à l'issue des tests.

- ☐ **Recette acceptée sans réserve** — le produit est conforme, la mise en service peut être prononcée.
- ☐ **Recette acceptée avec réserves** — le produit est conforme dans l'ensemble ; les anomalies mineures listées au §7 seront corrigées avant le ____ / ____ / 2026.
- ☐ **Recette refusée** — des anomalies bloquantes (§7) empêchent la mise en service ; une nouvelle recette sera planifiée.

---

## 9. Signatures

| Pour le cabinet (client) | Pour MonProjetPro |
|--------------------------|-------------------|
| Nom : ____________________ | Nom : MiKL |
| Date : ____ / ____ / 2026 | Date : ____ / ____ / 2026 |
| Signature : | Signature : |
| | |
| | |

---

*Document généré le 2026-06-01 — à conserver signé par les deux parties.*
