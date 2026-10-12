import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // A leading underscore marks a value as deliberately unused, e.g. a
      // field pulled out of an object so the rest can be passed on.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Tests import services lazily behind a database check and inspect
    // untyped JSON payloads, so `any` stays allowed there.
    files: ["src/__tests__/**", "e2e/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // These screens predate the React Compiler rules in eslint-plugin-react-hooks 7
    // and are due to be rewritten by the UI redesign. Keep the findings visible as
    // warnings until then, and delete this block once the new screens land.
    files: [
      "src/app/page.tsx",
      "src/app/chat/page.tsx",
      "src/app/flashcards/page.tsx",
      "src/app/guides/page.tsx",
      "src/app/learn/page.tsx",
      "src/app/plan/page.tsx",
      "src/app/s/*/screens/runner.tsx",
    ],
    rules: {
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  globalIgnores([
    // Defaults of eslint-config-next, restated because globalIgnores replaces them
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated code and tool output
    "generated/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
