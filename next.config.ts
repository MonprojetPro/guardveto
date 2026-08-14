import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // En dev, Next 16 (Turbopack) bloque par defaut le chargement des
  // ressources `/_next/*` (dont le runtime HMR/client) quand l'hote de la
  // requete differe de l'hote du serveur. Les tests E2E Playwright servent
  // l'app sur 127.0.0.1 (cf. playwright.config.ts) : sans cette allowlist,
  // le runtime client est bloque, la page `/login` ('use client') n'hydrate
  // pas, le handler onSubmit (preventDefault + Server Action) ne s'attache
  // jamais et le formulaire part en GET natif -> on reste sur /login.
  // Aucune incidence en production (build) : ce reglage est dev-only.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],

  experimental: {
    serverActions: {
      // Le plafond par defaut d'une action serveur est de 1 Mo. C'est
      // largement assez pour une phrase envoyee a Filou, et beaucoup trop peu
      // pour une PHOTO d'ancien planning prise au telephone (3 a 5 Mo, et un
      // tiers de plus une fois encodee en base64). Sans ce reglage, le depot
      // d'un document echoue avec une erreur de plateforme illisible.
      //
      // 16 Mo laisse passer les 12 Mo autorises cote lecture (cf.
      // TAILLE_MAX_OCTETS) avec la marge du base64. Au-dela, le refus est
      // rendu en francais par l'action elle-meme.
      bodySizeLimit: '16mb',
    },
  },
};

export default nextConfig;
