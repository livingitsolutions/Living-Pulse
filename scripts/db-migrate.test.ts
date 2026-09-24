import { cp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LEDGER_SCHEMA,
  LEDGER_TABLE,
  MIGRATIONS_DIRECTORY,
  MigrationRunner,
  PRODUCTION_CONFIRMATION,
  discoverMigrations,
  migrationCommandEnvironment,
  validateLedger,
  withAdvisoryLock,
  type AppliedMigration,
  type Migration,
  type MigrationClient,
} from './db-migrate.js'

const temporaryDirectories: string[] = []
const noLock = async <T>(_client: MigrationClient, operation: () => Promise<T>) => operation()

async function temporaryHistory() {
  const directory = join(tmpdir(), `living-pulse-migrations-${crypto.randomUUID()}`)
  temporaryDirectories.push(directory)
  await cp(MIGRATIONS_DIRECTORY, directory, { recursive: true })
  return directory
}

const adapter = (database: PGlite): MigrationClient => ({
  query: async <Row extends Record<string, unknown>>(text: string, values?: unknown[]) => {
    const result = await database.query<Row>(text, values)
    return { rows: result.rows }
  },
  executeScript: async (sql) => { await database.exec(sql) },
})

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('migration discovery', () => {
  it('discovers the exact 11 migrations in complete-directory order with stable byte checksums', async () => {
    const migrations = await discoverMigrations()
    expect(migrations.map((migration) => migration.directoryName)).toEqual([
      '20260921075739_create_validation_prototype',
      '20260921101220_add_written_feedback',
      '20260921113905_create_acquisition_foundation',
      '20260921120900_create_operator_authentication',
      '20260921124959_create_product_idempotency',
      '20260921143000_add_prospect_discovery_evidence',
      '20260921172345_clean_the_fallen',
      '20260921172426_first_king_bedlam',
      '20260921172732_tired_tarantula',
      '20260921180000_reconcile_prospect_discovery_evidence',
      '20260921190000_reconcile_production_prospect_discovery_evidence',
    ])
    expect(migrations).toHaveLength(11)
    expect(migrations.map((migration) => migration.checksum)).toEqual([
      '95987830ca11fb301aa349430db852dc5a8aa723b7de744c6e683c4d026c006e',
      '3138ac588cdcd4e9956b4c14583879f2510e36c709231bb60160188dc01f3556',
      '20a065d957bf44d7823fbab0621b31396549f5ee05e0969e9d21eefcb9e4e19f',
      'b98cceb61574286c1439d57f3087444ad55799256fff512ef05b6947aa28f8cb',
      '8e974ac5347694316fd333a233ce7197e05259b562a26ca77c6388e9dcc429cd',
      'a5bf9842c171176e36fb0b354629f75ed0a91eba181a806687bf813cab238f64',
      'b74f51d31e0808a90603bcbbd686f23fcd4f1b3afdb120e7dc74002bf310ce9d',
      'b74f51d31e0808a90603bcbbd686f23fcd4f1b3afdb120e7dc74002bf310ce9d',
      '0a467e5f77b46533a560970fbcc3c58133adf49608f151b37a40763971c22bee',
      '89f4f0b5d9ddcacf98b79c98f1fefef1fa9a1dc40859227d17e0312fb995ca21',
      '4d947839a8e5b946b93ec5d0e2064be69707d29c6b443890c8a53fdec299dcb8',
    ])
  })

  it('requires valid directory identities and migration.sql while ignoring snapshot content', async () => {
    const directory = await temporaryHistory()
    await writeFile(join(directory, '20260921075739_create_validation_prototype', 'snapshot.json'), 'not executable SQL')
    expect(await discoverMigrations(directory)).toHaveLength(11)
    await mkdir(join(directory, 'invalid-directory'))
    await expect(discoverMigrations(directory)).rejects.toThrow(/Invalid migration directory/)
    await rm(join(directory, 'invalid-directory'), { recursive: true })
    await unlink(join(directory, '20260921101220_add_written_feedback', 'migration.sql'))
    await expect(discoverMigrations(directory)).rejects.toThrow()
  })
})

describe('ledger invariants', () => {
  const records = (migrations: Migration[]): AppliedMigration[] => migrations.map((migration, index) => ({
    sequenceNumber: index + 1,
    version: migration.version,
    name: migration.name,
    checksum: migration.checksum,
    appliedAt: new Date(),
  }))

  it('rejects checksum changes, missing history, unknown records, order changes, and gaps', async () => {
    const migrations = await discoverMigrations()
    const applied = records(migrations)
    expect(() => validateLedger(migrations, applied)).not.toThrow()
    expect(() => validateLedger(migrations, [{ ...applied[0], checksum: '0'.repeat(64) }])).toThrow(/Checksum mismatch/)
    expect(() => validateLedger(migrations.slice(1), [applied[0]])).toThrow(/Unknown applied migration/)
    expect(() => validateLedger(migrations, [{ ...applied[0], version: '19990101000000', name: 'unknown' }])).toThrow(/Unknown applied migration/)
    expect(() => validateLedger(migrations, [applied[1], applied[0]])).toThrow(/out of order or has a gap/)
    expect(() => validateLedger(migrations, [applied[0], applied[2]])).toThrow(/out of order or has a gap/)
    expect(() => validateLedger(migrations, [applied[0], applied[0]])).toThrow(/Duplicate applied migration version/)
    expect(() => validateLedger(migrations, [applied[0], { ...applied[1], name: applied[0].name }])).toThrow(/Duplicate applied migration name/)
    expect(() => validateLedger(migrations.slice(0, -1), applied)).toThrow(/absent from disk/)
  })
})

describe('transactional migration application', () => {
  it('reports fresh status, applies all migrations, and makes the second apply a no-op', async () => {
    const directory = await temporaryHistory()
    await writeFile(join(directory, '20260921075739_create_validation_prototype', 'snapshot.json'), 'not executable SQL')
    const database = new PGlite()
    const client = adapter(database)
    const runner = new MigrationRunner(client, directory, noLock)
    expect(await runner.status()).toMatchObject({ applied: [], pending: { length: 11 } })
    expect((await database.query(`SELECT to_regnamespace('${LEDGER_SCHEMA}') AS value`)).rows[0]).toEqual({ value: null })
    expect(await runner.apply()).toMatchObject({ applied: { length: 11 }, pending: [] })
    expect(await runner.status()).toMatchObject({ applied: { length: 11 }, pending: [] })
    const ledgerBefore = await database.query(`SELECT version, migration_name, checksum FROM ${LEDGER_SCHEMA}.${LEDGER_TABLE} ORDER BY sequence_number`)
    expect(await runner.apply()).toMatchObject({ applied: { length: 11 }, pending: [] })
    const ledgerAfter = await database.query(`SELECT version, migration_name, checksum FROM ${LEDGER_SCHEMA}.${LEDGER_TABLE} ORDER BY sequence_number`)
    expect(ledgerAfter.rows).toEqual(ledgerBefore.rows)
    await database.close()
  })

  it('rolls back failed SQL and does not record the failed migration', async () => {
    const directory = await temporaryHistory()
    const failedDirectory = join(directory, '20260921120900_create_operator_authentication')
    const original = await readFile(join(failedDirectory, 'migration.sql'), 'utf8')
    await writeFile(join(failedDirectory, 'migration.sql'), `${original}\nCREATE TABLE broken syntax;\n`)
    const database = new PGlite()
    const runner = new MigrationRunner(adapter(database), directory, noLock)
    await expect(runner.apply()).rejects.toThrow(/rolled back.*create_operator_authentication/)
    const ledger = await database.query<{ migration_name: string }>(`SELECT migration_name FROM ${LEDGER_SCHEMA}.${LEDGER_TABLE} ORDER BY sequence_number`)
    expect(ledger.rows.map((row) => row.migration_name)).toEqual([
      'create_validation_prototype', 'add_written_feedback', 'create_acquisition_foundation',
    ])
    expect((await database.query("SELECT to_regclass('public.operator_sessions') AS value")).rows[0]).toEqual({ value: null })
    await database.close()
  })

  it('rejects unknown and out-of-order physical ledger records without repair', async () => {
    const database = new PGlite()
    const runner = new MigrationRunner(adapter(database), MIGRATIONS_DIRECTORY, noLock)
    await runner.apply()
    await database.query(`UPDATE ${LEDGER_SCHEMA}.${LEDGER_TABLE} SET version = '19990101000000', migration_name = 'unknown' WHERE sequence_number = 1`)
    await expect(runner.status()).rejects.toThrow(/Unknown applied migration/)
    await database.close()
  })
})

describe('advisory locking', () => {
  it('serializes concurrent operations and always unlocks after errors', async () => {
    const events: string[] = []
    const unlockers: Array<() => void> = []
    let queue: Promise<void> = Promise.resolve()
    const client: MigrationClient = {
      async query(text) {
        if (text.includes('pg_advisory_lock')) {
          const previous = queue
          queue = new Promise<void>((resolve) => { unlockers.push(resolve) })
          await previous
          events.push('lock')
        } else if (text.includes('pg_advisory_unlock')) {
          events.push('unlock')
          unlockers.shift()?.()
        }
        return { rows: [] }
      },
    }
    const first = withAdvisoryLock(client, async () => { events.push('first'); await Promise.resolve(); throw new Error('expected') })
    const second = withAdvisoryLock(client, async () => { events.push('second') })
    await expect(first).rejects.toThrow('expected')
    await second
    expect(events).toEqual(['lock', 'first', 'unlock', 'lock', 'second', 'unlock'])
  })
})

describe('administrative command safety', () => {
  const url = 'postgresql://runner:redacted@localhost:5432/living_pulse_test'

  it('requires an explicit URL and target and validates production confirmation', () => {
    expect(() => migrationCommandEnvironment('status', {})).toThrow(/DATABASE_URL/)
    expect(() => migrationCommandEnvironment('status', { DATABASE_URL: url })).toThrow(/DB_MIGRATION_TARGET/)
    expect(() => migrationCommandEnvironment('apply', { DATABASE_URL: url, DB_MIGRATION_TARGET: 'production' })).toThrow(/Production apply requires/)
    expect(migrationCommandEnvironment('apply', { DATABASE_URL: url, DB_MIGRATION_TARGET: 'production', DB_MIGRATION_CONFIRM: PRODUCTION_CONFIRMATION })).toMatchObject({ target: 'production' })
  })
})
