import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Permite `_`-prefijados sin usar (params de firma, catch ignorados).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      // El proyecto normaliza JSON externo de forma dinámica; `unknown` +
      // narrowing es el patrón, pero algunos parsers usan any acotado.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Los tests usan mocks y aserciones que no requieren tanta rigidez.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Scripts sueltos de Node (no pasan por tsc, que es de donde el resto del
    // proyecto saca estos globals).
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
      },
    },
  }
);
