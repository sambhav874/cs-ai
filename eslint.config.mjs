// Flat ESLint config for the TypeScript workspaces (apps/web, apps/api).
//
// A lean, high-signal set: real bugs (duplicate keys, unreachable code, bad
// typeof, assignment in a condition) plus unused code. Unused variables live
// here rather than in tsc's noUnusedLocals so that code ported from
// ContractSense (apps/web/src/features/intelligence) can carry its dead code
// as warnings while it is cleaned up, without loosening the rule for
// everything else.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

const UNUSED = ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }]

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.venv/**', '**/build/**', '**/coverage/**', 'vendor/**'] },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks },
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': UNUSED,
      'no-undef': 'off',
      'no-redeclare': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-useless-escape': 'warn',
      'no-control-regex': 'off',
      'preserve-caught-error': 'off',
    },
  },
  // apps/api never ran lint (upstream shipped no config at this level), so
  // its existing unused code warns until it is cleaned up; new code is held
  // to the rule in review.
  {
    files: ['apps/api/**'],
    // The plugin is registered again here: an override that only sets rules
    // fails to resolve them when this block matches a file the base block's
    // glob did not (scripts/, for instance).
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { '@typescript-eslint/no-unused-vars': ['warn', UNUSED[1]] },
  },
  {
    files: ['apps/web/src/features/intelligence/**'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { '@typescript-eslint/no-unused-vars': ['warn', UNUSED[1]], 'no-useless-assignment': 'warn' },
  },
)
