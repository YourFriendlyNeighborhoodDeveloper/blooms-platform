import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dist-server', 'node_modules', 'playwright-report', 'test-results', 'server/db/types.gen.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, jsxA11y.flatConfigs.recommended],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // The admin kit's Input, Select and Textarea render native controls.
      'jsx-a11y/label-has-associated-control': ['error', { controlComponents: ['Input', 'Select', 'Textarea', 'StyledInput'], assert: 'either', depth: 3 }],
    },
  },
  {
    // Context providers and shared drawing helpers intentionally co-export hooks/constants.
    files: ['src/components/layout/*.tsx', 'src/components/atelier/flora.tsx', 'src/lib/*.tsx', 'src/shop/*.tsx', 'src/admin/*.tsx', 'src/pages/shop/Track.tsx', 'src/pages/Policy.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['server/**/*.ts', 'shared/**/*.ts', 'e2e/**/*.ts', 'scripts/**/*.ts', 'playwright.config.ts', 'vitest.config.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.node, ...globals.browser } },
    rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
  {
    // Node scripts; Playwright's page.evaluate callbacks run in the browser.
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
);
