import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

// Flat config (ESLint 9). Order matters: Vue + TS rules first, then
// skipFormatting last so Prettier owns all formatting (no rule fights).
export default defineConfigWithVueTs(
  {
    name: 'app/files',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },
  {
    name: 'app/ignores',
    ignores: ['dist/**', 'coverage/**'],
  },
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  {
    // User content is untrusted: Vue's escaping is our XSS defence, and v-html
    // bypasses it (docs/ABUSE_PROTECTION_PLAN.md §Layer 3).
    name: 'app/security',
    rules: { 'vue/no-v-html': 'error' },
  },
  skipFormatting,
)
