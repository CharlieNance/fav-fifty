<script setup lang="ts">
/**
 * The one button primitive. Everything clickable-and-styled goes through here so
 * shape, color, and focus behavior stay consistent (see docs/DESIGN.md).
 *
 * It renders the RIGHT element for the job — a real <button> by default, a
 * <RouterLink> when given `to`, or an <a> when given `href`. That keeps semantics
 * and accessibility correct (keyboard, focus ring) instead of styling a <div>,
 * which is what the raw mock did.
 */
import { computed } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

const props = withDefaults(
  defineProps<{
    /** Visual style. `primary` = filled accent pill; `secondary` = outlined. */
    variant?: 'primary' | 'secondary'
    /** Padding + text scale. `sm` for dense spots like the header. */
    size?: 'sm' | 'md'
    /** Internal route — renders a <RouterLink>. */
    to?: RouteLocationRaw
    /** External URL — renders an <a>. */
    href?: string
    /** Native button type (ignored for links). */
    type?: 'button' | 'submit'
    disabled?: boolean
  }>(),
  { variant: 'primary', size: 'md', type: 'button', disabled: false },
)

// Pick the element: link components when navigating, otherwise a real button.
const tag = computed(() => {
  if (props.to) return RouterLink
  if (props.href) return 'a'
  return 'button'
})

const variantClasses = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25',
  secondary: 'border border-border text-ink hover:border-muted/60 hover:bg-elevated',
} as const

const sizeClasses = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-6 py-3 text-base',
} as const

// Press/lift feedback (docs/DESIGN.md §Motion): buttons rise a hair on hover
// and squash on press, so clicking FEELS like clicking. Transform-based, so it
// sits behind `motion-safe:`; kept off disabled buttons (links can't be
// disabled, so gating on the prop is enough).
const motionClasses =
  'motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-95 active:shadow-none'
</script>

<template>
  <component
    :is="tag"
    :to="to"
    :href="href"
    :type="tag === 'button' ? type : undefined"
    :disabled="tag === 'button' ? disabled : undefined"
    class="inline-flex cursor-pointer items-center justify-center rounded-full text-center font-semibold transition-all duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
    :class="[variantClasses[variant], sizeClasses[size], !disabled && motionClasses]"
  >
    <slot />
  </component>
</template>
