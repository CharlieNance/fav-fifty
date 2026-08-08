import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Playwright's `webServer` config starts the frontend and backend dev servers,
// but neither of those starts Postgres — do that first so the backend has a
// database to connect to. Reuses tools/db_up.sh so there's one source of
// truth for "how to start the DB" instead of duplicating docker-compose logic.
export default function globalSetup(): void {
  execFileSync('bash', [path.resolve(dirname, '../../tools/db_up.sh')], {
    stdio: 'inherit',
  })
}
