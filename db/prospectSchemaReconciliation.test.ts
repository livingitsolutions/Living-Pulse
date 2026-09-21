import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('prospect discovery schema reconciliation', () => {
  it('keeps repository discovery fields aligned with the acquisition schema', async () => {
    const [schema, repository] = await Promise.all([
      readFile('db/schema.ts', 'utf8'),
      readFile('db/prospectStore.ts', 'utf8'),
    ])
    for (const field of ['evidenceNote', 'potentialUseCase', 'emailSourceUrl']) {
      expect(schema).toContain(`${field}:`)
      expect(repository).toContain(`${field}: row.${field}`)
    }
  })

  it('repairs only missing discovery evidence columns and preserves existing rows', async () => {
    const migration = await readFile('netlify/database/migrations/20260921180000_reconcile_prospect_discovery_evidence/migration.sql', 'utf8')
    expect(migration).toMatch(/to_regclass\('public\.acquisition_prospects'\)/)
    expect(migration.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(3)
    expect(migration).toMatch(/COALESCE\("evidence_note"/)
    expect(migration).toMatch(/COALESCE\("email_source_url", "source_url"\)/)
    expect(migration).not.toMatch(/DROP|TRUNCATE|DELETE|CREATE TABLE/i)
  })
})
