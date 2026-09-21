import { access, readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import publicApi from '../netlify/functions/api.mjs'
import growthApi from '../netlify/growth-functions/api.mjs'

const read = (path: string) => readFile(path, 'utf8')
const exists = (path: string) => access(path).then(() => true, () => false)
const publicPackageDirectory = 'deploy/public'
const growthPackageDirectory = 'deploy/growth'
const isolatedPublicBase = 'deploy/public-site'
const operatorPaths = [
  'login',
  'session',
  'logout',
  'protected-check',
  'acquisition/overview',
  'prospects',
  'prospects/prospect-id/qualify',
  'prospects/prospect-id/reject',
  'prospects/prospect-id/suppress',
  'prospects/prospect-id/queue',
  'outreach',
  'suppressions',
]

describe('public deployment composition', () => {
  it('has a self-contained dependency boundary with no database package', async () => {
    const [manifestText, lockText] = await Promise.all([
      read(`${isolatedPublicBase}/package.json`),
      read(`${isolatedPublicBase}/package-lock.json`),
    ])
    const manifest = JSON.parse(manifestText) as { dependencies?: Record<string, string>, devDependencies?: Record<string, string> }
    const lock = JSON.parse(lockText) as { packages: Record<string, unknown> }
    expect({ ...manifest.dependencies, ...manifest.devDependencies }).not.toHaveProperty('@netlify/database')
    expect(Object.keys(lock.packages)).not.toContain('node_modules/@netlify/database')
    expect(await exists(`${isolatedPublicBase}/netlify/database/migrations`)).toBe(false)
  })

  it('contains only the Public function and HTTP Product Service client', async () => {
    const [functionEntries, api, client, config] = await Promise.all([
      readdir(`${isolatedPublicBase}/netlify/functions`),
      read(`${isolatedPublicBase}/netlify/functions/api.mts`),
      read(`${isolatedPublicBase}/server/productServiceClient.ts`),
      read(`${isolatedPublicBase}/netlify.toml`),
    ])
    expect(functionEntries).toEqual(['api.mts'])
    expect(await exists(`${isolatedPublicBase}/netlify/growth-functions`)).toBe(false)
    expect(api).not.toMatch(/@netlify\/database|drizzle-orm\/netlify-db|operator|acquisitionConsole|RESEND/i)
    expect(client).toMatch(/fetcher|fetch/)
    expect(client).not.toMatch(/@netlify\/database|drizzle|postgres|sql`/i)
    expect(config).toContain('directory = "netlify/functions"')
    expect(config).toContain('command = "npm run build"')
    expect(config).toContain('publish = "dist"')
    expect(config).not.toMatch(/database|migrat/i)
  })

  it('does not compose the Growth UI into the public React entry', async () => {
    const [app, main, publicConfig] = await Promise.all([read('src/App.tsx'), read('src/main.tsx'), read('vite.public.config.ts')])
    expect(app).not.toMatch(/GrowthConsole|path="\/growth"/)
    expect(main).not.toMatch(/GrowthConsole|growth\/main/)
    expect(publicConfig).toContain("outDir: 'dist-public'")
  })

  it.each(operatorPaths)('returns 404 rather than registering /api/operator/%s', async (path) => {
    const response = await publicApi(new Request(`https://pulse.livingitsolutions.com/api/operator/${path}`))
    expect(response.status).toBe(404)
  })

  it('packages only the public function directory and requires no operator environment', async () => {
    const [config, api] = await Promise.all([read(`${publicPackageDirectory}/netlify.toml`), read('netlify/functions/api.mts')])
    expect(config).toContain('directory = "netlify/functions"')
    expect(config).toContain('command = "npm run build:public"')
    expect(config).toContain('publish = "dist-public"')
    expect(config).not.toMatch(/migrat|database/i)
    expect(api).not.toMatch(/operator|acquisitionConsole|LIVING_PULSE_OPERATOR_SECRET|ACQUISITION_SENDING_ENABLED|RESEND_API_KEY/i)
  })

  it('cannot discover Netlify Database migrations in its package directory', async () => {
    expect(await exists(`${publicPackageDirectory}/netlify/database/migrations`)).toBe(false)
    expect(await exists('netlify/database/migrations')).toBe(true)
  })

  it('retains public Pulse, Results, response, feedback, lifecycle, and telemetry routes', async () => {
    const [app, api] = await Promise.all([read('src/App.tsx'), read('netlify/functions/api.mts')])
    expect(app).toMatch(/path="\/p\/:id"/)
    expect(app).toMatch(/path="\/results\/:id"/)
    expect(app).toMatch(/path="\/create"/)
    expect(api).toMatch(/parts\[0\] === 'events'/)
    expect(api).toMatch(/parts\[2\] === 'responses'/)
    expect(api).toMatch(/parts\[2\] === 'results'/)
    expect(api).toMatch(/x-creator-key/)
  })
})

describe('Growth deployment composition', () => {
  it('retains every applied migration at its original path and content', async () => {
    const checksums: Record<string, string> = {
      '20260921075739_create_validation_prototype/migration.sql': '95987830ca11fb301aa349430db852dc5a8aa723b7de744c6e683c4d026c006e',
      '20260921075739_create_validation_prototype/snapshot.json': 'd6f17b5b1422aac2643e2d1140603aeb731f00622931ac15cc1bf3aa66255eb4',
      '20260921101220_add_written_feedback/migration.sql': '3138ac588cdcd4e9956b4c14583879f2510e36c709231bb60160188dc01f3556',
      '20260921101220_add_written_feedback/snapshot.json': '8a9a774935a2980be2be782953fbbb7d404e9e43934c8b12dbe8f40dee5e649b',
      '20260921113905_create_acquisition_foundation/migration.sql': '20a065d957bf44d7823fbab0621b31396549f5ee05e0969e9d21eefcb9e4e19f',
      '20260921113905_create_acquisition_foundation/snapshot.json': '0ccbeed465866a96959bc51b5f977e775665b2a47860ac8d78cd05923b045788',
      '20260921120900_create_operator_authentication/migration.sql': 'b98cceb61574286c1439d57f3087444ad55799256fff512ef05b6947aa28f8cb',
      '20260921120900_create_operator_authentication/snapshot.json': '13c70f1295bfe26142077b43ab11b74fbfff1f1e3bdba4d3c6ef4d3953ee4040',
      '20260921124959_create_product_idempotency/migration.sql': '8e974ac5347694316fd333a233ce7197e05259b562a26ca77c6388e9dcc429cd',
      '20260921124959_create_product_idempotency/snapshot.json': '876bf74e0a5485408dc0c543c88cf02d5fa09b6cfa7a5f8504ab4c3af6f6507b',
    }
    for (const [path, checksum] of Object.entries(checksums)) {
      const content = await readFile(join('netlify/database/migrations', path))
      expect(createHash('sha256').update(content).digest('hex')).toBe(checksum)
    }
  })

  it('uses a dedicated frontend entry and private functions directory', async () => {
    const [entry, config, netlifyConfig] = await Promise.all([read('growth/main.tsx'), read('vite.growth.config.ts'), read(`${growthPackageDirectory}/netlify.toml`)])
    expect(entry).toMatch(/GrowthConsole/)
    expect(config).toContain("outDir: '../dist-growth'")
    expect(netlifyConfig).toContain('directory = "netlify/growth-functions"')
    expect(netlifyConfig).toContain('command = "npm run build:growth"')
    expect(netlifyConfig).toContain('publish = "dist-growth"')
    expect(netlifyConfig).toContain('path = "netlify/database/migrations"')
    expect(netlifyConfig).not.toMatch(/from = "\/api\/(?:operator|product-service)\/\*"[\s\S]*?status = 404/)
    expect(await read('netlify/growth-functions/api.mts')).toContain("path: ['/api/operator/*', '/api/product-service/*']")
  })

  it('has no root configuration that can override either package configuration', async () => {
    expect(await exists('netlify.toml')).toBe(false)
    expect(await exists('netlify.public.toml')).toBe(false)
  })

  it('retains login and session routes without exposing acquisition unauthenticated', async () => {
    const context = { ip: '192.0.2.10' } as Parameters<typeof growthApi>[1]
    const login = await growthApi(new Request('https://growth.livingitsolutions.com/api/operator/login', { method: 'POST', headers: { Origin: 'https://growth.livingitsolutions.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: '' }) }), context)
    const session = await growthApi(new Request('https://growth.livingitsolutions.com/api/operator/session'), context)
    const overview = await growthApi(new Request('https://growth.livingitsolutions.com/api/operator/acquisition/overview', { headers: { 'x-creator-key': 'creator-capability' } }), context)
    expect(login.status).toBe(401)
    expect(session.status).toBe(200)
    expect(await session.json()).toEqual({ authenticated: false })
    expect(overview.status).toBe(401)
  })

  it('keeps cookie and mutation origin isolation strict', async () => {
    const [auth, consoleHandler] = await Promise.all([read('db/operatorAuth.ts'), read('db/operatorConsole.ts')])
    expect(auth).not.toMatch(/Domain=/)
    expect(auth).toMatch(/HttpOnly/)
    expect(auth).toMatch(/SameSite=Strict/)
    expect(auth).toMatch(/origin === new URL\(request\.url\)\.origin/)
    expect(consoleHandler).toMatch(/validMutationOrigin/)
    expect(consoleHandler).not.toMatch(/Access-Control-Allow-Origin|['"]\*['"]/)
  })

  it('keeps concurrent duplicate imports safe at the database boundary', async () => {
    const [schema, store] = await Promise.all([read('db/schema.ts'), read('db/prospectStore.ts')])
    expect(schema).toMatch(/uniqueIndex\('acquisition_prospects_normalized_email_unique'\)\.on\(table\.normalizedEmail\)/)
    expect(store).toMatch(/db\.transaction/)
    expect(store).toMatch(/findProspectByEmail/)
  })
})
