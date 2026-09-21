import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const migrationPath = 'netlify/database/migrations/20260921190000_reconcile_production_prospect_discovery_evidence/migration.sql'

async function discoveryColumns(db: PGlite) {
  const result = await db.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'acquisition_prospects'
      AND column_name IN ('evidence_note', 'potential_use_case', 'email_source_url')
    ORDER BY column_name
  `)
  return result.rows
}

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

  it('repairs a foundation-only schema and safely backfills required values', async () => {
    const migration = await readFile(migrationPath, 'utf8')
    const db = new PGlite()

    await db.exec(`
      CREATE TABLE acquisition_prospects (
        id text PRIMARY KEY,
        source_url text NOT NULL
      );
      INSERT INTO acquisition_prospects (id, source_url)
      VALUES ('legacy', 'https://example.com/public-contact');
    `)
    await db.exec(migration)

    expect(await discoveryColumns(db)).toEqual([
      { column_name: 'email_source_url', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'evidence_note', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'potential_use_case', data_type: 'text', is_nullable: 'YES', column_default: null },
    ])
    const result = await db.query<{ evidence_note: string; potential_use_case: string | null; email_source_url: string }>(`
      SELECT evidence_note, potential_use_case, email_source_url
      FROM acquisition_prospects
      WHERE id = 'legacy'
    `)
    expect(result.rows).toEqual([{
      evidence_note: 'Imported before structured discovery evidence was introduced.',
      potential_use_case: null,
      email_source_url: 'https://example.com/public-contact',
    }])
    await db.close()

    expect(migration).toMatch(/to_regclass\('public\.acquisition_prospects'\)/)
    expect(migration.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(3)
    expect(migration).toMatch(/COALESCE\(evidence_note/)
    expect(migration).toMatch(/COALESCE\(email_source_url, source_url\)/)
    expect(migration).not.toMatch(/DROP|TRUNCATE|DELETE|CREATE TABLE/i)
  })

  it('is a repeat-safe no-op for an already-repaired schema and preserves values', async () => {
    const migration = await readFile(migrationPath, 'utf8')
    const db = new PGlite()

    await db.exec(`
      CREATE TABLE acquisition_prospects (
        id text PRIMARY KEY,
        source_url text NOT NULL,
        evidence_note text NOT NULL,
        potential_use_case text,
        email_source_url text NOT NULL
      );
      INSERT INTO acquisition_prospects (
        id, source_url, evidence_note, potential_use_case, email_source_url
      ) VALUES (
        'repaired',
        'https://example.com/general-source',
        'Original evidence excerpt',
        'Original potential use',
        'https://example.com/exact-email-source'
      );
    `)
    await db.exec(migration)
    await db.exec(migration)

    expect(await discoveryColumns(db)).toEqual([
      { column_name: 'email_source_url', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'evidence_note', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'potential_use_case', data_type: 'text', is_nullable: 'YES', column_default: null },
    ])
    const result = await db.query<{ evidence_note: string; potential_use_case: string; email_source_url: string }>(`
      SELECT evidence_note, potential_use_case, email_source_url
      FROM acquisition_prospects
      WHERE id = 'repaired'
    `)
    expect(result.rows).toEqual([{
      evidence_note: 'Original evidence excerpt',
      potential_use_case: 'Original potential use',
      email_source_url: 'https://example.com/exact-email-source',
    }])
    await db.close()
  })
})
