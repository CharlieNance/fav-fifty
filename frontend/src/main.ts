import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { router } from './router'
import { useClientConfigStore } from './stores/clientConfig'
import './assets/main.css'

const pinia = createPinia()
createApp(App).use(pinia).use(router).mount('#app')

// Fetch the server's limits in the background. Nothing waits on this: the store
// starts with bundled defaults, so the app works offline or with the API down.
void useClientConfigStore(pinia).load()
