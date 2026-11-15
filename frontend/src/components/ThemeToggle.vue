<script setup lang="ts">
/**
 * The header's light/dark switch (stores/theme.ts). The icon shows the theme
 * you'd switch TO (a sun in dark mode), and the accessible name says it in
 * words, so a screen reader hears the action ("Switch to light theme") rather
 * than a bare state it has to interpret.
 */
import { computed } from 'vue'
import { MoonIcon, SunIcon } from '@heroicons/vue/24/outline'

import IconButton from './IconButton.vue'
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()
const isDark = computed(() => theme.theme === 'dark')
const label = computed(() => (isDark.value ? 'Switch to light theme' : 'Switch to dark theme'))
</script>

<template>
  <IconButton :icon="isDark ? SunIcon : MoonIcon" :label="label" @click="theme.toggle()" />
</template>
