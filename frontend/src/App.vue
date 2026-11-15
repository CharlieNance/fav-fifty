<script setup lang="ts">
// Root shell: the global layout that wraps every page. The session is resolved
// once by the router's beforeEach guard, so the header renders the correct
// logged-in / logged-out state on first paint.
import { nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'

import AppFooter from '@/components/AppFooter.vue'
import AppHeader from '@/components/AppHeader.vue'
import ToastHost from '@/components/ToastHost.vue'
import ClaimListsDialog from '@/features/lists/ClaimListsDialog.vue'
import CreateListModal from '@/features/lists/CreateListModal.vue'
import { useThemeStore } from '@/stores/theme'

// Instantiated here so the theme follows the system (or the saved choice) from
// the first render, not only once the header's toggle is used.
useThemeStore()

// An SPA navigation doesn't reload the page, so keyboard and screen-reader users
// would otherwise be left on the link they clicked, in a page that has changed
// under them. Move focus to the new page's heading (announcing it), or to <main>
// while the page is still loading. Not on the first load: the browser already
// starts at the top there, and the skip link should stay the first Tab stop.
const route = useRoute()
watch(
  () => route.path,
  async (_path, previous) => {
    if (previous === undefined) return
    await nextTick()
    const main = document.getElementById('main-content')
    const heading = main?.querySelector<HTMLElement>('h1')
    if (heading) {
      heading.setAttribute('tabindex', '-1')
      heading.focus({ preventScroll: true })
    } else {
      main?.focus({ preventScroll: true })
    }
  },
)
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <!-- First Tab stop on every page (WCAG 2.4.1): jump past the header. -->
    <a
      href="#main-content"
      class="sr-only rounded-full bg-accent px-4 py-2 font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60]"
    >
      Skip to main content
    </a>
    <AppHeader />
    <main id="main-content" tabindex="-1" class="flex-1 outline-none">
      <RouterView />
    </main>
    <AppFooter />
    <CreateListModal />
    <!-- Offers this device's lists to the account after sign-in. -->
    <ClaimListsDialog />
    <ToastHost />
  </div>
</template>
