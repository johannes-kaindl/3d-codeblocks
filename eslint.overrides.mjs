// Repo-eigene ESLint-Abweichungen — der EINZIGE Ort dafuer. Der Kern
// (eslint.config.mjs) ist template-verwaltet, Inline-disables blockt das Lint-Gate.
// Jeder Override braucht eine Begruendung im Kommentar.
//
// Zwei Klassen, zwei Preise (Details: _docs/docs/obsidian-plugin-publishing.md):
// - Kosmetik-/Benennungsregeln (z. B. ui/sentence-case bei Eigennamen/API-Namen):
//   Override ist die richtige Antwort und kostet nichts — der Scanner hat keinen
//   Mangel gefunden, sondern eine Konvention falsch angelegt.
// - Faehigkeitsregeln (z. B. settings-tab/prefer-setting-definitions): der Scanner
//   bewertet den Mangel, nicht die Begruendung — ein Override hier ist gestundete
//   Schuld und kostet die Store-Wertung ("Satisfactory" statt "Passed").
//   Marker fuer solche Faelle: `// STORE-SCHULD:` + wo die Abloesung geplant ist.
export default [
  {
    // Type-aware Linting braucht das Build-tsconfig des Repos. Achtung Falle
    // (json_viewer 1.9.0): ein obsidian→Mock-paths-Alias im referenzierten tsconfig
    // laesst die type-aware Regeln auf einen losen Mock aufloesen → no-unsafe-*-Kaskade.
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
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
];
