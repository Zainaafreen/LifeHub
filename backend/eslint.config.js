// eslint.config.js  (ESLint v9 flat-config format)
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // ── Possible errors ─────────────────────────────────────
      "no-console": "off",            // we use pino, but console.warn/error still useful at startup
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "error",

      // ── Best practices ───────────────────────────────────────
      "eqeqeq": ["error", "always"],
      "no-var": "error",
      "prefer-const": "warn",
      "curly": ["warn", "multi-line"],
      "no-throw-literal": "error",

      // ── Style (non-blocking — warn, not error) ───────────────
      "semi": ["warn", "always"],
      "quotes": ["warn", "single", { avoidEscape: true }],
      "indent": ["warn", 2, { SwitchCase: 1 }],
      "comma-dangle": ["warn", "always-multiline"],
    },
  },
  {
    // Test files — relax some rules
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      "no-unused-vars": "off",
    },
  },
];
