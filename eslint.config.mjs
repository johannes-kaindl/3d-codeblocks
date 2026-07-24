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
      // Die deklarative Settings-API (getSettingDefinitions) setzt Obsidian >=1.13.0
      // voraus; manifest minAppVersion ist 1.5.0 — display() ist hier der einzig
      // unterstuetzte Weg. Die Empfehlung ist ein Versionskonflikt-Fehlalarm.
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
      // "3D" ist ein Fachbegriff, kein Satzanfang — die Regel wuerde daraus "3d"
      // machen ("Maximum live 3d views"), was schlicht falsch geschrieben ist.
      "obsidianmd/ui/sentence-case": "off",
    },
  },
);
