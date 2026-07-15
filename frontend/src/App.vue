<script setup lang="ts">
// Root shell: the global layout that wraps every page. The session is resolved
// once by the router's beforeEach guard, so the header renders the correct
// logged-in / logged-out state on first paint.
import AppFooter from '@/components/AppFooter.vue'
import AppHeader from '@/components/AppHeader.vue'
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <AppHeader />
    <main class="flex-1">
      <RouterView />
    </main>
    <AppFooter />
  </div>
</template>
