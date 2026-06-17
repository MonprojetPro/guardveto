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
};

export default nextConfig;
