<script setup lang="ts">
// Placeholder landing page. Its only job right now is to prove the stack
// renders: routing resolves it, and the Tailwind design tokens (bg-canvas,
// text-accent, text-ink, text-muted) apply. Real design — layout, palette,
// type, motion — comes later; decisions get captured in docs/DESIGN.md.
</script>

<template>
  <main class="grid min-h-screen place-items-center px-6">
    <div class="max-w-xl text-center">
      <p class="text-sm font-medium tracking-[0.2em] text-accent uppercase">Fav Fifty</p>
      <h1 class="mt-4 text-4xl font-semibold text-ink sm:text-5xl">
        Rank your fifty favorite things.
      </h1>
      <p class="mt-4 text-muted">
        Bands, desserts, video games — anything. Build a ranked list of 50, and share it.
      </p>
      <p class="mt-10 text-xs text-muted">🚧 Frontend scaffold — design &amp; features next.</p>
    </div>
  </main>
</template>
