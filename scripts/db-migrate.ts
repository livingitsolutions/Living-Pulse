import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const MIGRATIONS_DIRECTORY = resolve('deploy/growth/netlify/database/migrations')
export const LEDGER_SCHEMA = 'living_pulse_migrations'
export const LEDGER_TABLE = 'migration_history'
export const PRODUCTION_CONFIRMATION = 'APPLY_LIVING_PULSE_PRODUCTION_MIGRATIONS'
const ADVISORY_LOCK_NAMESPACE = 1280527443
const ADVISORY_LOCK_KEY = 1

export type Migration = {
  version: string
  name: string
  directoryName: string
  sql: string
  checksum: string
}

export type AppliedMigration = {
  sequenceNumber: number
  version: string
  name: string
  checksum: string
  appliedAt: Date | string
}

type QueryResult<Row> = { rows: Row[] }
export interface MigrationClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>
  executeScript?(sql: string): Promise<void>
}

export type MigrationStatus = {
  applied: AppliedMigration[]
  pending: Migration[]
}

export type MigrationApplyStatus = MigrationStatus & {
  appliedThisInvocation: number
}

export class MigrationInvariantError extends Error {}

const migrationPattern = /^(\d{14})_([a-z0-9][a-z0-9_]*)$/

export async function discoverMigrations(directory = MIGRATIONS_DIRECTORY): Promise<Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const directories = entries.filter((entry) => entry.isDirectory())
  const migrations: Migration[] = []

  for (const entry of directories) {
    const match = migrationPattern.exec(entry.name)
    if (!match) throw new MigrationInvariantError(`Invalid migration directory: ${entry.name}`)
    const bytes = await readFile(resolve(directory, entry.name, 'migration.sql'))
    migrations.push({
      version: match[1],
      name: match[2],
      directoryName: entry.name,
      sql: bytes.toString('utf8'),
      checksum: createHash('sha256').update(bytes).digest('hex'),
    })
  }

  migrations.sort((left, right) => left.directoryName.localeCompare(right.directoryName))
  const versions = new Set<string>()
  const names = new Set<string>()
  for (const migration of migrations) {
    if (versions.has(migration.version)) throw new MigrationInvariantError(`Duplicate migration version: ${migration.version}`)
    if (names.has(migration.name)) throw new MigrationInvariantError(`Duplicate migration name: ${migration.name}`)
    versions.add(migration.version)
    names.add(migration.name)
  }
  return migrations
}

export function validateLedger(migrations: Migration[], applied: AppliedMigration[]) {
  const versions = new Set<string>()
  const names = new Set<string>()
  for (let index = 0; index < applied.length; index++) {
    const record = applied[index]
    if (versions.has(record.version)) throw new MigrationInvariantError(`Duplicate applied migration version: ${record.version}`)
    if (names.has(record.name)) throw new MigrationInvariantError(`Duplicate applied migration name: ${record.name}`)
    versions.add(record.version)
    names.add(record.name)

    const expected = migrations[index]
    if (!expected) throw new MigrationInvariantError(`Applied migration is absent from disk: ${record.version}_${record.name}`)
    if (record.version !== expected.version || record.name !== expected.name) {
      const anywhere = migrations.find((migration) => migration.version === record.version || migration.name === record.name)
      throw new MigrationInvariantError(anywhere
        ? `Applied migration history is out of order or has a gap at sequence ${index + 1}`
        : `Unknown applied migration: ${record.version}_${record.name}`)
    }
    if (record.checksum !== expected.checksum) throw new MigrationInvariantError(`Checksum mismatch: ${expected.directoryName}`)
  }
}

async function ledgerExists(client: MigrationClient) {
  const result = await client.query<{ ledger: string | null }>('SELECT to_regclass($1) AS ledger', [`${LEDGER_SCHEMA}.${LEDGER_TABLE}`])
  return Boolean(result.rows[0]?.ledger)
}

async function readLedger(client: MigrationClient): Promise<AppliedMigration[]> {
  if (!await ledgerExists(client)) return []
  const result = await client.query<{
    sequence_number: string | number
    version: string
    migration_name: string
    checksum: string
    applied_at: Date | string
  }>(`SELECT sequence_number, version, migration_name, checksum, applied_at
      FROM ${LEDGER_SCHEMA}.${LEDGER_TABLE}
      ORDER BY sequence_number`)
  return result.rows.map((row) => ({
    sequenceNumber: Number(row.sequence_number),
    version: row.version,
    name: row.migration_name,
    checksum: row.checksum,
    appliedAt: row.applied_at,
  }))
}

async function createLedger(client: MigrationClient) {
  await client.query('BEGIN')
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${LEDGER_SCHEMA}`)
    await client.query(`CREATE TABLE IF NOT EXISTS ${LEDGER_SCHEMA}.${LEDGER_TABLE} (
      sequence_number bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      version text NOT NULL UNIQUE,
      migration_name text NOT NULL UNIQUE,
      checksum char(64) NOT NULL,
      applied_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT migration_history_identity_unique UNIQUE (version, migration_name),
      CONSTRAINT migration_history_checksum_format CHECK (checksum ~ '^[0-9a-f]{64}$')
    )`)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

export async function withAdvisoryLock<T>(client: MigrationClient, operation: () => Promise<T>): Promise<T> {
  await client.query('SELECT pg_advisory_lock($1, $2)', [ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_KEY])
  try {
    return await operation()
  } finally {
    await client.query('SELECT pg_advisory_unlock($1, $2)', [ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_KEY])
  }
}

type LockRunner = <T>(client: MigrationClient, operation: () => Promise<T>) => Promise<T>

export class MigrationRunner {
  constructor(
    private readonly client: MigrationClient,
    private readonly migrationDirectory = MIGRATIONS_DIRECTORY,
    private readonly lockRunner: LockRunner = withAdvisoryLock,
  ) {}

  async status(): Promise<MigrationStatus> {
    return this.lockRunner(this.client, async () => {
      const migrations = await discoverMigrations(this.migrationDirectory)
      const applied = await readLedger(this.client)
      validateLedger(migrations, applied)
      return { applied, pending: migrations.slice(applied.length) }
    })
  }

  async apply(): Promise<MigrationApplyStatus> {
    return this.lockRunner(this.client, async () => {
      const migrations = await discoverMigrations(this.migrationDirectory)
      await createLedger(this.client)
      const applied = await readLedger(this.client)
      validateLedger(migrations, applied)

      for (const migration of migrations.slice(applied.length)) {
        await this.client.query('BEGIN')
        try {
          if (this.client.executeScript) await this.client.executeScript(migration.sql)
          else await this.client.query(migration.sql)
          await this.client.query(
            `INSERT INTO ${LEDGER_SCHEMA}.${LEDGER_TABLE} (version, migration_name, checksum) VALUES ($1, $2, $3)`,
            [migration.version, migration.name, migration.checksum],
          )
          await this.client.query('COMMIT')
        } catch (error) {
          await this.client.query('ROLLBACK')
          throw new MigrationInvariantError(`Migration failed and was rolled back: ${migration.directoryName}`, { cause: error })
        }
      }

      const finalApplied = await readLedger(this.client)
      validateLedger(migrations, finalApplied)
      return {
        applied: finalApplied,
        pending: migrations.slice(finalApplied.length),
        appliedThisInvocation: finalApplied.length - applied.length,
      }
    })
  }
}

type Command = 'status' | 'apply'

export function migrationCommandEnvironment(command: Command, environment: NodeJS.ProcessEnv) {
  const connectionString = environment.DATABASE_URL?.trim()
  const target = environment.DB_MIGRATION_TARGET?.trim()
  if (!connectionString) throw new MigrationInvariantError('DATABASE_URL is required.')
  if (!target || !/^[a-z0-9][a-z0-9_-]*$/.test(target)) throw new MigrationInvariantError('DB_MIGRATION_TARGET is required and must be a safe target label.')
  let url: URL
  try { url = new URL(connectionString) } catch { throw new MigrationInvariantError('DATABASE_URL must be a valid PostgreSQL URL.') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname === '/') {
    throw new MigrationInvariantError('DATABASE_URL must identify an explicit PostgreSQL database.')
  }
  if (command === 'apply' && target === 'production' && environment.DB_MIGRATION_CONFIRM !== PRODUCTION_CONFIRMATION) {
    throw new MigrationInvariantError(`Production apply requires DB_MIGRATION_CONFIRM=${PRODUCTION_CONFIRMATION}.`)
  }
  return { connectionString, target }
}
