import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'tests/**', 'supabase/**'] },
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } },
    rules: { 'no-undef': 'error', 'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-const-assign': 'error' },
  },
  { files: ['src/sw.js'], languageOptions: { globals: { ...globals.serviceworker } } },
];
