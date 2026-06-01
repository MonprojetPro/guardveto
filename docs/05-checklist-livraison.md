# ✅ Checklist de livraison — GuardVeto

> Document de référence pour livrer GuardVeto au cabinet vétérinaire.
> Sert à la fois de **check interne** (avant de livrer) et de **support de validation avec le client**.
> Réutilisable pour tes prochains produits.
>
> Légende statut : ✅ fait · ⚠️ à vérifier/faire · ❓ à confirmer avec le client · ➖ non applicable

---

## 🎓 Le principe d'une livraison propre

Une livraison ne se résume pas à « le code marche ». Elle se découpe en **5 temps** :

1. **Go-Live Readiness** — ce que TU vérifies en interne avant de montrer quoi que ce soit
2. **Recette (UAT)** — le client teste et valide que ça répond à son besoin
3. **Handover** — tu transmets les accès, la doc, la formation
4. **Juridique & RGPD** — le cadre légal (surtout avec des données de santé)
5. **Post-livraison** — support, garantie, maintenance

> Règle d'or : **rien ne se livre sans recette validée par le client.** Le client doit cliquer lui-même et dire « oui, c'est bon ».

---

## A. 🔧 Go-Live Readiness (vérif interne — avant de livrer)

### Code & build
- [x] ✅ Build de production passe sans erreur
- [x] ✅ Lint propre (0 erreur, 0 warning)
- [x] ✅ Aucun code de debug résiduel (script de live-reload `localhost:8400` retiré)
- [ ] ⚠️ Branche `feat/ruflo-v4-migration` mergée sur `master` (version officielle)
- [ ] ⚠️ Tag de version posé (ex. `v1.0.0`) pour pouvoir revenir en arrière si besoin

### Sécurité
- [x] ✅ RLS activée sur toutes les tables (cloisonnement des données par rôle)
- [x] ✅ Audit sécurité Supabase : 0 erreur (vues corrigées en `security_invoker`)
- [x] ✅ Aucun secret/clé API dans le code (tout en variables d'environnement)
- [ ] ⚠️ Protection « mot de passe piraté » activée (Supabase → Auth → Settings)
- [ ] ❓ Politique de mots de passe (longueur minimale) définie

### Configuration de production
- [ ] ⚠️ Toutes les variables d'env configurées sur Vercel (prod) : Supabase, `CRON_SECRET`, Google, Resend, `NEXT_PUBLIC_APP_URL`
- [ ] ⚠️ `NEXT_PUBLIC_APP_URL` pointe vers le **vrai domaine** (pas `*.vercel.app` si domaine custom)
- [ ] ❓ Nom de domaine définitif choisi + SSL/HTTPS actif
- [x] ✅ Crons Vercel configurés (`lock-gardes` 00h01, `rappels` 07h00)
- [ ] ⚠️ **Emails** : domaine vérifié sur Resend (SPF/DKIM) — sinon les emails tombent en spam ou ne partent pas
- [ ] ⚠️ **Google Agenda** : compte de service configuré + calendrier partagé en prod

### Données
- [ ] ⚠️ Données de test/seed supprimées (ne pas livrer avec de faux vétos ou gardes bidon)
- [ ] ⚠️ Vraies données initiales saisies (7 vétos réels, contraintes, jours fériés, périodes)
- [ ] ⚠️ Sauvegardes automatiques de la base activées (Supabase backups / PITR)

### Fiabilité
- [ ] ❓ Pages d'erreur propres (404 / 500) testées
- [ ] ❓ Comportement testé sur mobile ET ordinateur (le client utilisera les deux)
- [ ] ➖ Outil de suivi des erreurs en prod (ex. Sentry) — optionnel pour un petit cabinet

---

## B. 🧪 Recette / UAT (validation AVEC le client)

> Le client (Anne-So + un véto + une secrétaire) teste les vrais parcours. Tu observes, tu notes.

> Modèle de rôles : **2 rôles seulement** — `admin` (les administrateurs) et `veto` (les autres). Pas de secrétaire.

### Scénarios métier à faire valider
- [ ] ❓ **Admin** : créer une période, générer un planning, le publier
- [ ] ❓ **Admin** : saisir/valider/refuser un congé (avec motif de refus)
- [ ] ❓ **Véto** : se connecter, voir le planning publié, déposer un souhait de congé
- [ ] ❓ **Véto** : recevoir l'email de notification (planning publié, congé refusé)
- [ ] ❓ Export PDF du planning imprimable
- [ ] ❓ Synchro Google Agenda (un véto voit ses gardes dans son agenda)
- [ ] ❓ Cloisonnement : un véto ne voit QUE ce qu'il doit voir (pas les brouillons, pas les données des autres)

### Formalisation
- [ ] ❓ **PV de recette** signé par le client (liste des scénarios + « validé / réserves »)
- [ ] ❓ Bugs/réserves listés et corrigés avant le Go-Live définitif

---

## C. 📦 Handover (transmission au client)

- [ ] ❓ Comptes créés pour tous les utilisateurs (administrateurs + vétos)
- [ ] ❓ Identifiants transmis de façon **sécurisée** (pas par email en clair — invitation Supabase)
- [ ] ❓ **Guide d'utilisation** rédigé (1 page par rôle suffit) — peut être généré par DOC
- [ ] ❓ Séance de **formation / démo** planifiée avec le cabinet (1h suffit en général)
- [ ] ❓ Coordonnées de support communiquées (qui contacter, comment, délai)
- [ ] ❓ « Que faire si j'ai oublié mon mot de passe » expliqué au client

---

## D. ⚖️ Juridique & RGPD

> ⚠️ **Important pour GuardVeto** : l'appli stocke des données personnelles de soignants, dont des **congés de type « santé »** = données de santé = catégorie sensible au sens du RGPD.

- [x] ✅ Données hébergées dans l'UE (Supabase `eu-west-1` / Irlande)
- [ ] ❓ Politique de confidentialité accessible dans l'appli (quelles données, pourquoi, combien de temps)
- [ ] ❓ Mentions légales (éditeur, hébergeur)
- [ ] ❓ Information des vétos sur le traitement de leurs données (base légale)
- [ ] ❓ Contrat de prestation / CGU signé avec le cabinet
- [ ] ❓ Propriété du code et conditions de réutilisation clarifiées
- [ ] ❓ Modalités de facturation / paiement actées

---

## E. 🛟 Post-livraison

- [ ] ❓ Période de garantie définie (ex. 30 jours de corrections incluses)
- [ ] ❓ Canal de signalement des bugs convenu (email, formulaire, téléphone)
- [ ] ❓ Modalités de maintenance (mises à jour de sécurité, sauvegardes, surveillance)
- [ ] ❓ Processus pour les évolutions futures (nouvelle demande = devis)
- [ ] ❓ Point de suivi planifié quelques semaines après la mise en service

---

## 🚦 Synthèse — où en est GuardVeto aujourd'hui (2026-06-01)

| Domaine | État |
|---|---|
| Code & build | 🟢 Solide (build OK, lint OK, debug nettoyé) |
| Sécurité technique | 🟢 Très bon (0 erreur d'audit, RLS partout) |
| Config de production | 🟠 À finaliser (env Vercel, domaine, emails Resend, Google) |
| Recette client | 🔴 À faire (le client n'a pas encore validé formellement) |
| Doc & formation | 🔴 À préparer |
| Juridique / RGPD | 🔴 À cadrer (données de santé = vigilance) |

**Le produit est techniquement prêt. Ce qui reste est surtout du processus de livraison (recette, doc, juridique) — c'est normal, et c'est là que se joue une livraison réussie.**
