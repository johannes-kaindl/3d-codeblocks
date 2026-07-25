// Obsidian-Guideline-Gate (PROF-OBS-08): type-checked gegen ECHTE obsidian-Typen.
// KEIN Inline-`// eslint-disable` — genuin unvermeidbare Ausnahmen NUR als file-scoped
// Override unten, mit Begruendung (Review verbietet Inline-disables).
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
  { ignores: ["main.js", "node_modules/", "tests/"] },
  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // --- file-scoped Overrides (mit Begruendung) ------------------------------
  {
    files: ["src/main.ts"],
    rules: {
      // "3D Codeblocks" (Plugin-Eigenname) und "embedRegistry" (API-Name) sind keine
      // Satzwörter — sentence-case wäre hier eine Falschschreibung.
      "obsidianmd/ui/sentence-case": "off",
    },
  },
  {
    files: ["src/obsidian/settings.ts"],
    rules: {
      // Kein Override mehr fuer prefer-setting-definitions: die Regel war hier als
      // "Versionskonflikt-Fehlalarm" abgeschaltet, das war ein Denkfehler. minAppVersion
      // 1.5.0 und getSettingDefinitions() schliessen sich nicht aus — beide Renderpfade
      // koennen aus DERSELBEN Definition bedient werden (s. settings.ts). Der
      // Store-Scanner prueft dieselbe Regel und laesst sich nicht abschalten.
      //
      // "3D" ist ein Fachbegriff, kein Satzanfang — die Regel wuerde daraus "3d"
      // machen ("Maximum live 3d views"), was schlicht falsch geschrieben ist.
      "obsidianmd/ui/sentence-case": "off",
    },
  },
);
