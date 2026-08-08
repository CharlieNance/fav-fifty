import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dirname, '../..')

// Playwright's `webServer` config starts the frontend and backend dev servers,
// but neither of those starts Postgres or applies migrations — do both first so
// the backend has a schema to connect to. On a fresh checkout / empty Docker
// volume the tests would otherwise fail confusingly at the dev-login step
// (missing tables) despite `npm run test:e2e` claiming to be self-contained.
// `alembic upgrade head` is a no-op if the DB is already current.
export default function globalSetup(): void {
  execFileSync('bash', [path.resolve(repoRoot, 'tools/db_up.sh')], {
    stdio: 'inherit',
  })
  execFileSync('uv', ['run', 'alembic', 'upgrade', 'head'], {
    cwd: path.resolve(repoRoot, 'backend'),
    stdio: 'inherit',
  })
}
