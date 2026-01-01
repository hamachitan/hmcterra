import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { files: ["**/*.{js,mjs,cjs,ts,mts,cts}"], plugins: { js }, extends: ["js/recommended"], languageOptions: { globals: globals.node, parserOptions: { ecmaVersion: 2020 } } },
  tseslint.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'caughtErrorsIgnorePattern': '^_' }],
      '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'caughtErrorsIgnorePattern': '^_' }],
      'arrow-body-style': ['warn', 'as-needed'],
      'arrow-parens': ['warn', 'as-needed'],
    },
  },
  { files: ["**/*.d.ts"], rules: { 'no-unused-vars': 'off', '@typescript-eslint/no-unused-vars': 'off' } },
  { files: ["test/**/*"], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
]);
