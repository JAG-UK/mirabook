import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'scripts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022 },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Omitting a key by destructuring it into an unused name is deliberate,
      // and the clearest way to drop one entry from an object.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // These two are the React-Compiler-era rules from eslint-plugin-react-hooks
      // v7. They fire on the load-on-mount and page-turn effects in Library and
      // Reader — working code, but code the compiler cannot optimise. Silencing
      // them would throw away real signal, and fixing them means restructuring
      // data loading in Reader.tsx, which has no test coverage yet. So: warn,
      // with CI pinning the count (--max-warnings) so the debt cannot grow.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
)
