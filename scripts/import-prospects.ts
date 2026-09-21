import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createProspect, validateCreate } from '../db/acquisitionApplication.ts'
import { importProspects } from '../src/prospectImport.ts'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const dryRun = args.includes('--dry-run')
const file = args.find((arg) => !arg.startsWith('--'))

if (!file || apply === dryRun) {
  console.error('Usage: npm run prospects:import -- <file.json> (--dry-run | --apply)')
  process.exitCode = 1
} else {
  try {
    const values: unknown = JSON.parse(await readFile(resolve(file), 'utf8'))
    const reports = await importProspects(values, { createProspect, validateCreate }, dryRun)
    for (const report of reports) console.log(JSON.stringify(report))
    const accepted = reports.filter((report) => report.status === 'accepted').length
    console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'apply', accepted, rejected: reports.length - accepted }))
    if (reports.some((report) => report.status === 'rejected')) process.exitCode = 2
  } catch (error) {
    console.error(error instanceof SyntaxError ? 'Input is not valid JSON.' : 'Import could not be completed.')
    process.exitCode = 1
  }
}
