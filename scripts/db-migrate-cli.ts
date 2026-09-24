import { createRequire } from 'node:module'
import {
  MigrationInvariantError,
  MigrationRunner,
  migrationCommandEnvironment,
  type MigrationClient,
} from './db-migrate.js'

type AdministrativeClient = MigrationClient & { connect(): Promise<void>; end(): Promise<void> }
type Command = 'status' | 'apply'

export type MigrationCliDependencies = {
  createClient(options: Record<string, unknown>): AdministrativeClient
  stdout(message: string): void
  stderr(message: string): void
}

const defaultDependencies = (): MigrationCliDependencies => {
  const { Client } = createRequire(import.meta.url)('pg') as {
    Client: new (options: Record<string, unknown>) => AdministrativeClient
  }
  return {
    createClient: (options) => new Client(options),
    stdout: console.log,
    stderr: console.error,
  }
}

export async function runMigrationCli(
  args: string[],
  environment: NodeJS.ProcessEnv,
  dependencies = defaultDependencies(),
): Promise<number> {
  const requestedCommand = args[0]
  if (requestedCommand !== 'status' && requestedCommand !== 'apply') {
    dependencies.stderr('Database migration command failed. Expected command: status or apply.')
    return 1
  }

  const command: Command = requestedCommand
  let client: AdministrativeClient | undefined
  try {
    const configuration = migrationCommandEnvironment(command, environment)
    client = dependencies.createClient({
      connectionString: configuration.connectionString,
      connectionTimeoutMillis: 10_000,
      application_name: 'living-pulse-migrations',
    })
    await client.connect()
    const runner = new MigrationRunner(client)
    const result = command === 'status' ? await runner.status() : await runner.apply()
    const output = command === 'status'
      ? { command, target: configuration.target, applied: result.applied.length, pending: result.pending.length }
      : {
          command,
          target: configuration.target,
          appliedThisInvocation: 'appliedThisInvocation' in result ? result.appliedThisInvocation : 0,
          totalApplied: result.applied.length,
          pending: result.pending.length,
        }
    dependencies.stdout(JSON.stringify(output))
    return 0
  } catch (error: unknown) {
    const detail = error instanceof MigrationInvariantError ? ` ${error.message}` : ''
    dependencies.stderr(`Database migration command failed.${detail}`)
    return 1
  } finally {
    if (client) {
      try { await client.end() } catch { /* preserve the command result without exposing connection details */ }
    }
  }
}
