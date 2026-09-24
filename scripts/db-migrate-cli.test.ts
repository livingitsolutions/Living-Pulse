import { spawnSync } from 'node:child_process'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { PRODUCTION_CONFIRMATION, type MigrationClient } from './db-migrate.js'
import { runMigrationCli, type MigrationCliDependencies } from './db-migrate-cli.js'

const testUrl = 'postgresql://migration_user:super-secret-password@private.example.test:5432/living_pulse_test'

function pgliteDependencies(database: PGlite, stdout: string[], stderr: string[]): MigrationCliDependencies {
  const client: MigrationClient = {
    query: async <Row extends Record<string, unknown>>(text: string, values?: unknown[]) => {
      const result = await database.query<Row>(text, values)
      return { rows: result.rows }
    },
    executeScript: async (sql) => { await database.exec(sql) },
  }
  return {
    createClient: () => Object.assign(client, {
      connect: async () => undefined,
      end: async () => undefined,
    }),
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  }
}

function sanitizedEnvironment() {
  const environment = { ...process.env }
  delete environment.DATABASE_URL
  delete environment.DB_MIGRATION_TARGET
  delete environment.DB_MIGRATION_CONFIRM
  return environment
}

describe('migration CLI contract', () => {
  it('executes status and prints deterministic safe status fields', async () => {
    const database = new PGlite()
    const stdout: string[] = []
    const stderr: string[] = []
    const exitCode = await runMigrationCli(
      ['status'],
      { DATABASE_URL: testUrl, DB_MIGRATION_TARGET: 'local-verification' },
      pgliteDependencies(database, stdout, stderr),
    )
    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(JSON.parse(stdout[0])).toEqual({ command: 'status', target: 'local-verification', applied: 0, pending: 11 })
    expect(stdout.join('\n')).not.toContain('super-secret-password')
    expect(stdout.join('\n')).not.toContain('private.example.test')
    await database.close()
  })

  it('prints apply invocation and total counts without changing runner semantics', async () => {
    const database = new PGlite()
    const stdout: string[] = []
    const stderr: string[] = []
    const exitCode = await runMigrationCli(
      ['apply'],
      { DATABASE_URL: testUrl, DB_MIGRATION_TARGET: 'local-verification' },
      pgliteDependencies(database, stdout, stderr),
    )
    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(JSON.parse(stdout[0])).toEqual({
      command: 'apply', target: 'local-verification', appliedThisInvocation: 11, totalApplied: 11, pending: 0,
    })
    await database.close()
  })

  it('rejects production apply before creating a client unless deliberately confirmed', async () => {
    let clientsCreated = 0
    const dependencies: MigrationCliDependencies = {
      createClient: () => { clientsCreated += 1; throw new Error('must not connect') },
      stdout: () => undefined,
      stderr: () => undefined,
    }
    expect(await runMigrationCli(['apply'], { DATABASE_URL: testUrl, DB_MIGRATION_TARGET: 'production' }, dependencies)).toBe(1)
    expect(clientsCreated).toBe(0)
    expect(PRODUCTION_CONFIRMATION).toBe('APPLY_LIVING_PULSE_PRODUCTION_MIGRATIONS')
  })

  it('returns non-zero with safe errors for invalid commands and runner failures', async () => {
    const stderr: string[] = []
    const dependencies: MigrationCliDependencies = {
      createClient: () => ({
        connect: async () => undefined,
        end: async () => undefined,
        query: async () => { throw new Error(`connection failed for ${testUrl}`) },
      }),
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    }
    expect(await runMigrationCli(['invalid'], {}, dependencies)).toBe(1)
    expect(await runMigrationCli(['status'], { DATABASE_URL: testUrl, DB_MIGRATION_TARGET: 'safe-target' }, dependencies)).toBe(1)
    expect(stderr.join('\n')).not.toContain(testUrl)
    expect(stderr.join('\n')).not.toContain('super-secret-password')
    expect(stderr).toContain('Database migration command failed. Expected command: status or apply.')
    expect(stderr).toContain('Database migration command failed.')
  })
})

describe('actual executable boundary', () => {
  it('npm status with missing configuration exits non-zero instead of silently succeeding', () => {
    const result = spawnSync('npm', ['run', 'db:migrate:status'], {
      cwd: process.cwd(), env: sanitizedEnvironment(), encoding: 'utf8',
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('DATABASE_URL is required')
  })

  it('the explicit entrypoint rejects an invalid command', () => {
    const result = spawnSync('npx', ['vite-node', 'scripts/db-migrate-cli-entry.ts', 'invalid'], {
      cwd: process.cwd(), env: sanitizedEnvironment(), encoding: 'utf8',
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Expected command: status or apply')
  })

  it('importing the CLI module alone has no CLI side effects', () => {
    const result = spawnSync('npx', ['vite-node', 'scripts/fixtures/import-db-migrate-cli.ts'], {
      cwd: process.cwd(), env: sanitizedEnvironment(), encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('imported')
    expect(result.stderr).toBe('')
  })
})
