import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { loadCloudflareBeacon } from './analytics/cloudflare'
import { analytics } from './analytics/events'
import { router } from './router'
import { useClientConfigStore } from './stores/clientConfig'
import './assets/main.css'

const pinia = createPinia()
createApp(App).use(pinia).use(router).mount('#app')

// Product events queue from the start, and go out only once the server's config
// says they're on (src/analytics/events.ts).
analytics.startSession()
analytics.flushWhenHidden()

// Fetch the server's limits in the background. Nothing waits on this: the store
// starts with bundled defaults, so the app works offline or with the API down.
const config = useClientConfigStore(pinia)
void config.load().then(() => analytics.setEnabled(config.features.events_enabled))

// Traffic analytics, production only (and only once its token is configured).
if (import.meta.env.PROD) {
  loadCloudflareBeacon(import.meta.env.VITE_CF_BEACON_TOKEN as string | undefined)
}
