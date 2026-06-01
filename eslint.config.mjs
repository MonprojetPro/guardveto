import next from "eslint-config-next";

const eslintConfig = [
  ...next,
  {
    // Projet 100 % francophone : les apostrophes dans le JSX (l'utilisateur,
    // d'un...) sont volontaires. Les échapper en &apos; nuirait à la lisibilité.
    rules: {
      "react/no-unescaped-entities": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      ".claude/**", // outillage ruflo, hors périmètre applicatif
    ],
  },
];

export default eslintConfig;
