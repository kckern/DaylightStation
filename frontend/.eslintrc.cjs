module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: [
    'dist',
    '.eslintrc.cjs',
    // Vendored/third-party or generated code — not ours to lint.
    'public/**/vendor/**',
    'public/webaudiofont/**', // generated WebAudioFont instrument sample data
    'src/lib/audio/speex_aec.js', // emscripten-generated WASM glue (see build-speex-aec.sh)
  ],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.2' } },
  plugins: ['react-refresh'],
  globals: {
    // Injected by Vite at build time; not a Node env in the running app.
    process: 'readonly',
  },
  rules: {
    'react/jsx-no-target-blank': 'off',
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    'react/prop-types': 'off',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^(React|_)' }],
    // Empty `catch {}` is a deliberate swallow-and-continue pattern used
    // throughout (cleanup/teardown paths where failure is a non-issue).
    'no-empty': ['error', { allowEmptyCatch: true }],
    // Template literals intentionally embed typographic whitespace (e.g. an
    // en space as a label separator) — same reasoning the rule already
    // applies to plain string literals via its skipStrings default.
    'no-irregular-whitespace': ['error', { skipTemplates: true }],
  },
  overrides: [
    {
      // Vitest runs with `globals: true` (vite.config.js), so these are real
      // runtime globals in test files, not undeclared identifiers.
      files: ['**/*.test.js', '**/*.test.jsx', '**/*.test.mjs', 'src/test-setup.js'],
      env: { node: true, jest: true },
      globals: { vi: 'readonly' },
    },
    {
      // Node-executed build/tooling config, not app code.
      files: ['*.config.js', '*.config.cjs'],
      env: { node: true },
    },
    {
      // The Vite entry point (index.html's <script src="/src/main.jsx">).
      // Nothing ever imports it, so Fast Refresh can never apply to it no
      // matter how its exports are shaped — the rule's premise doesn't hold.
      files: ['src/main.jsx'],
      rules: { 'react-refresh/only-export-components': 'off' },
    },
  ],
}
