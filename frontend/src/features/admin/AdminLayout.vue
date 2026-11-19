<script setup lang="ts">
/**
 * Shell for the owner-only admin area (docs/ADMIN_AND_ANALYTICS_PLAN.md): a
 * section nav over the current admin page. Lazy-loaded, so none of the admin code
 * is in the public bundle. The router guard keeps non-admins out, but that's UX
 * only: every admin API route checks for itself.
 */
const sections = [
  { to: { name: 'admin-dashboard' }, label: 'Dashboard' },
  { to: { name: 'admin-users' }, label: 'Users' },
  { to: { name: 'admin-abuse' }, label: 'Abuse' },
  { to: { name: 'admin-settings' }, label: 'Settings' },
  { to: { name: 'admin-audit' }, label: 'Audit log' },
] as const
</script>

<template>
  <section class="mx-auto max-w-5xl px-6 py-12 sm:my-10 sm:px-10 sm:py-10 sm:page-panel">
    <nav aria-label="Admin" class="mb-6 flex items-center gap-4 text-sm">
      <span class="font-semibold tracking-wide text-muted uppercase">Admin</span>
      <RouterLink
        v-for="section in sections"
        :key="section.label"
        :to="section.to"
        class="rounded font-medium text-muted transition-colors hover:text-ink aria-[current=page]:text-ink aria-[current=page]:underline aria-[current=page]:decoration-accent aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-8 [&.router-link-active]:text-ink"
      >
        {{ section.label }}
      </RouterLink>
    </nav>
    <RouterView />
  </section>
</template>
