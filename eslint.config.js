import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "library", "work"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    // The classic hook rules only: the React Compiler rules in the plugin's
    // recommended set assume a compiler build this app does not use.
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Best-effort cleanup (storage, audio teardown) swallows errors on purpose.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Paginated GitHub reads loop with do { … } while (true).
      "no-constant-condition": ["error", { checkLoops: "none" }],
      // A closure that runs later may read a `let` assigned once below it.
      "prefer-const": ["error", { ignoreReadBeforeAssign: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
);
