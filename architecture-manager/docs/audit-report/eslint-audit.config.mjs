// Audit-only eslint config (lives in docs/audit-report/, does NOT modify repo eslint.config.mjs).
// Extends the repo base config (keeps ignores + no-undef) and additionally applies
// the correctness subset of eslint:recommended (inlined: @eslint/js is not installed
// in this dependency tree) plus no-unused-vars to surface issues the 1-rule baseline misses.
import base from '../../eslint.config.mjs';

const recommendedCorrectness = {
  'no-async-promise-executor': 'error',
  'no-caller': 'error',
  'no-class-assign': 'error',
  'no-compare-neg-zero': 'error',
  'no-cond-assign': 'error',
  'no-const-assign': 'error',
  'no-constant-binary-expression': 'error',
  'no-constant-condition': 'error',
  'no-control-regex': 'error',
  'no-debugger': 'error',
  'no-delete-var': 'error',
  'no-dupe-class-members': 'error',
  'no-dupe-else-if': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-empty': 'warn',
  'no-empty-character-class': 'error',
  'no-empty-pattern': 'error',
  'no-eval': 'warn',
  'no-ex-assign': 'error',
  'no-fallthrough': 'error',
  'no-func-assign': 'error',
  'no-global-assign': 'error',
  'no-import-assign': 'error',
  'no-invalid-regexp': 'error',
  'no-irregular-whitespace': 'error',
  'no-loss-of-precision': 'error',
  'no-misleading-character-class': 'error',
  'no-new-native-nonconstructor': 'error',
  'no-nonoctal-decimal-escape': 'error',
  'no-obj-calls': 'error',
  'no-prototype-builtins': 'warn',
  'no-redeclare': 'error',
  'no-regex-spaces': 'error',
  'no-self-assign': 'error',
  'no-setter-return': 'error',
  'no-shadow-restricted-names': 'error',
  'no-sparse-arrays': 'error',
  'no-template-curly-in-string': 'warn',
  'no-this-before-super': 'error',
  'no-undef-init': 'warn',
  'no-unreachable': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-unused-private-class-members': 'error',
  'no-unused-vars': 'warn',
  'no-use-before-define': ['warn', { functions: false }],
  'no-useless-backreference': 'error',
  'no-useless-catch': 'error',
  'no-useless-escape': 'warn',
  'require-yield': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error'
};

export default [
  ...base,
  {
    files: ['src/**/*.{mjs,cjs,jsx}', 'scripts/**/*.mjs'],
    rules: recommendedCorrectness
  }
];
