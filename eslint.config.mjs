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
    // Server code and shared libraries never reach into the UI: rules a
    // screen shares with a service or a route live in src/lib.
    files: ["src/services/**", "src/lib/**", "src/app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/components/*", "@/hooks/*"],
              message: "Server code can't depend on UI modules. Move the shared code into src/lib.",
            },
          ],
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
