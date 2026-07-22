import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

/** `const { omitted: _x, ...rest }` is the idiomatic way to drop a key. */
const UNUSED_VARS = [
  "error",
  { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/test-results/**",
      // shadcn components are vendored; upstream owns their style.
      "apps/web/src/components/ui/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, __BUILD_ID__: "readonly" },
    },
    plugins: {
      "react-hooks": reactHooks,
      // Several accessibility defects in the hardening spec — a click handler
      // on a non-interactive element, duplicate accessible names — are ones
      // this plugin catches before review does.
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "@typescript-eslint/no-unused-vars": UNUSED_VARS,
    },
  },
  { files: ["**/*.{ts,tsx}"], rules: { "@typescript-eslint/no-unused-vars": UNUSED_VARS } },
  {
    files: ["apps/web/src/sw.ts"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ["scripts/**/*.mjs", "*.config.{ts,js}", "supabase/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["tests/**/*.ts", "e2e/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
);
