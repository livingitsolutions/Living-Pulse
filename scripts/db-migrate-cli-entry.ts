import { runMigrationCli } from './db-migrate-cli.js'

process.exitCode = await runMigrationCli(process.argv.slice(2), process.env)
