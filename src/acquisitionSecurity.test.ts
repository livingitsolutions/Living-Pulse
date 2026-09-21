import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('acquisition security boundary', () => {
  it('does not expose acquisition through the public API', async () => {
    const api = await readFile('netlify/functions/api.mts', 'utf8')
    expect(api).not.toMatch(/acquisitionProspects|prospects:import|queueProspect|createProspectServices/)
  })
  it('does not access Resend or its API key', async () => {
    const files = ['src/prospectServices.ts', 'src/prospectImport.ts', 'db/prospectStore.ts', 'db/acquisitionApplication.ts', 'scripts/import-prospects.ts']
    const content = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n')
    expect(content).not.toMatch(/RESEND_API_KEY|\bresend\b|fetch\s*\(/i)
  })
  it('adds no scheduled or deploy delivery handler', async () => {
    const functions = await readdir('netlify/functions')
    expect(functions).toEqual(['api.mts'])
    const api = await readFile('netlify/functions/api.mts', 'utf8')
    expect(api).not.toMatch(/schedule|deploy|outreach_attempt|sendEmail/i)
  })
})
