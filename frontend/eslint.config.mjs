import next from "eslint-config-next";
import tseslint from "typescript-eslint";

// Next 16 removed `next lint`, so the config lives here and ESLint is invoked
// directly. Flat config, no .eslintrc.
export default tseslint.config(
  {ignores: ["out/**", ".next/**", "node_modules/**", "next-env.d.ts"]},
  ...next,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Unused arguments prefixed with an underscore are a deliberate signal
      // that a signature is fixed by a caller we do not own.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {argsIgnorePattern: "^_", varsIgnorePattern: "^_"},
      ],
    },
  },
);
