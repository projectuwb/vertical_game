// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'dist-cli/**', 'android/**', 'node_modules/**', 'public/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Math.random is banned outside /render cosmetics. Use a seeded generator from /core/rng.ts.',
        },
      ],
    },
  },
  {
    // /audio joins /render's carve-out (Task 4.4): noise-buffer synthesis is exactly
    // the same "cosmetic, never gameplay-deterministic" category as /render's own use
    // of Math.random — TECH_SPEC.md §2's "/sim must not import /render, /ui, or
    // /audio" already puts audio in the same non-simulation bucket as render.
    files: ['src/render/**/*.ts', 'src/audio/**/*.ts'],
    rules: {
      'no-restricted-properties': 'off',
    },
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts', '*.config.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // TECH_SPEC.md §13: "No non-null assertions outside pool internals."
    files: ['src/core/pool.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
