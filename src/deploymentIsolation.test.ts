import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import publicApi from '../netlify/functions/api.mjs'
import growthApi from '../netlify/growth-functions/api.mjs'

const read = (path: string) => readFile(path, 'utf8')
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
    const [config, api] = await Promise.all([read('netlify.public.toml'), read('netlify/functions/api.mts')])
    expect(config).toContain('directory = "netlify/functions"')
    expect(config).toContain('command = "npm run build:public"')
    expect(config).not.toMatch(/migrat|database/i)
    expect(api).not.toMatch(/operator|acquisitionConsole|LIVING_PULSE_OPERATOR_SECRET|ACQUISITION_SENDING_ENABLED|RESEND_API_KEY/i)
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
  it('uses a dedicated frontend entry and private functions directory', async () => {
    const [entry, config, netlifyConfig] = await Promise.all([read('growth/main.tsx'), read('vite.growth.config.ts'), read('netlify.toml')])
    expect(entry).toMatch(/GrowthConsole/)
    expect(config).toContain("outDir: '../dist-growth'")
    expect(netlifyConfig).toContain('directory = "netlify/growth-functions"')
    expect(netlifyConfig).toContain('command = "npm run build:growth"')
    expect(netlifyConfig).not.toMatch(/from = "\/api\/(?:operator|product-service)\/\*"[\s\S]*?status = 404/)
    expect(await read('netlify/growth-functions/api.mts')).toContain("path: ['/api/operator/*', '/api/product-service/*']")
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
})
