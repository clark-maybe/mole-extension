import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

export default [
  {
    ignores: ['dist/**', 'build_version/**', 'node_modules/**', 'codex-main/**', 'docs/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: globals.browser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // any 类型使用给出警告，推动逐步收紧类型安全
      '@typescript-eslint/no-explicit-any': 'warn',
      // 未使用变量给出警告，下划线开头的参数/变量可豁免
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // TypeScript 自身负责未定义变量检查，此规则关闭避免误报
      'no-undef': 'off',
      // 常量条件（如 while(true)）给出警告
      'no-constant-condition': 'warn',
      // 无用转义字符给出警告
      'no-useless-escape': 'warn',
    },
  },
]
