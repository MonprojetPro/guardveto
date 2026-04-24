# [STORY-001] Authentification (login / logout / rôles)

## Epic
E1 — Foundation

## Story
En tant que vétérinaire ou secrétaire, je veux me connecter avec mon email et mot de passe afin d'accéder au planning selon mon rôle.

## Critères d'acceptation
- [ ] Page de connexion fonctionnelle (email + mot de passe)
- [ ] Redirection vers /planning après connexion réussie
- [ ] Message d'erreur clair si identifiants incorrects
- [ ] Bouton déconnexion dans le header
- [ ] Middleware : pages protégées inaccessibles sans auth
- [ ] Le rôle (admin/veto/secretaire) est lu depuis la table veterinaires.role_app
- [ ] Admin voit le menu complet (Planning, Congés, Compteurs, Admin)
- [ ] Véto voit : Planning, Congés (les siens), Compteurs (les siens)
- [ ] Secrétaire voit : Planning, Export PDF

## Tâches techniques
- [ ] Créer `src/app/login/page.tsx` — formulaire de connexion
- [ ] Configurer Supabase Auth (email/password)
- [ ] Créer `src/lib/supabase/middleware.ts` — protection des routes
- [ ] Créer `src/hooks/useAuth.ts` — hook qui expose user + rôle
- [ ] Créer `src/components/layout/Header.tsx` avec avatar + déconnexion
- [ ] Créer `src/components/layout/Sidebar.tsx` avec navigation conditionnelle selon le rôle
- [ ] Créer `src/components/layout/RoleGate.tsx` — composant qui masque selon le rôle
- [ ] Créer `src/app/layout.tsx` — layout racine avec sidebar + header
- [ ] Sur mobile : bottom nav bar à la place de la sidebar

## Estimation
- Taille : M
- Points : 3
- Durée estimée : 3-4h

## Dépendances
- Requiert : TECH-001, TECH-002
- Débloque : STORY-002, toutes les stories UI

## Agent exécutant
- Dev : SPARK
- Test : TESS (login, rôles, protection routes)
