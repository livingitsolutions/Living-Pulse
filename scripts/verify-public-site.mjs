import { access, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'

const base = 'deploy/public-site'
const copies = {
  'index.html': 'index.html',
  'public/living-pulse-icon.svg': 'public/living-pulse-icon.svg',
  'src/App.tsx': 'src/App.tsx',
  'src/acquisition.ts': 'src/acquisition.ts',
  'src/api.ts': 'src/api.ts',
  'src/creatorAccess.ts': 'src/creatorAccess.ts',
  'src/lifecycle.ts': 'src/lifecycle.ts',
  'src/main.tsx': 'src/main.tsx',
  'src/publicPulse.ts': 'src/publicPulse.ts',
  'src/types.ts': 'src/types.ts',
  'src/validation.ts': 'src/validation.ts',
  'server/productServiceClient.ts': 'server/productServiceClient.ts',
  'netlify/functions/api.mts': 'netlify/functions/api.mts',
}

function deploymentContent(source, content) {
  if (source === 'src/index.css') {
    return content.replace(/\n\/\* Private Growth Console \*\/[\s\S]*?(?=\n\/\* Creator publish and private-results access \*\/)/, '\n')
  }
  return content
}

copies['src/index.css'] = 'src/index.css'

const failures = []
if (process.argv.includes('--write')) {
  await Promise.all(Object.entries(copies).map(async ([source, destination]) => {
    const content = deploymentContent(source, await readFile(source, 'utf8'))
    await writeFile(join(base, destination), content)
  }))
  console.log('Synchronized Public deployment source.')
}
for (const [source, destination] of Object.entries(copies)) {
  const [expected, actual] = await Promise.all([
    readFile(source, 'utf8').then((content) => Buffer.from(deploymentContent(source, content))),
    readFile(join(base, destination)).catch(() => null),
  ])
  if (!actual || !expected.equals(actual)) failures.push(`${destination} is not synchronized with ${source}`)
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      failures.push(`${relative(base, path)} is a symlink`)
      return []
    }
    return entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist'
      ? files(path)
      : entry.isFile() ? [path] : []
  }))).flat()
}

const manifest = JSON.parse(await readFile(join(base, 'package.json'), 'utf8'))
const lock = JSON.parse(await readFile(join(base, 'package-lock.json'), 'utf8'))
const dependencyNames = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
if (dependencyNames.includes('@netlify/database')) failures.push('Public manifest contains @netlify/database')
if (Object.keys(lock.packages ?? {}).some((path) => path === 'node_modules/@netlify/database')) failures.push('Public lockfile contains @netlify/database')
await access(join(base, 'netlify', 'database', 'migrations')).then(
  () => failures.push('Public base contains Netlify Database migrations'),
  () => undefined,
)

const publicFiles = await files(base)
if (publicFiles.some((path) => path.includes('/growth-functions/'))) failures.push('Public base contains Growth functions')
for (const path of publicFiles.filter((path) => /\.(?:[cm]?[jt]sx?|toml|json)$/.test(path))) {
  const content = await readFile(path, 'utf8')
  if (/@netlify\/database|drizzle-orm\/netlify-db/.test(content)) failures.push(`${relative(base, path)} references a database adapter`)
  if (/RESEND_API_KEY|LIVING_PULSE_OPERATOR_SECRET|ACQUISITION_SENDING_ENABLED/.test(content)) failures.push(`${relative(base, path)} references a Growth-only secret`)
  if (['.ts', '.tsx', '.mts', '.cts'].includes(extname(path))) {
    for (const match of content.matchAll(/(?:from\s+|import\s*\()['"](\.\.?\/[^'"]+)/g)) {
      if (!resolve(dirname(path), match[1]).startsWith(`${resolve(base)}/`)) failures.push(`${relative(base, path)} imports outside the Public base`)
    }
  }
}

const serverFiles = publicFiles.filter((path) => path.startsWith(`${base}/server/`) || path.startsWith(`${base}/netlify/`))
const allowedServerFiles = new Set([`${base}/server/productServiceClient.ts`, `${base}/netlify/functions/api.mts`])
for (const path of serverFiles) if (!allowedServerFiles.has(path)) failures.push(`${relative(base, path)} is not an allowed Public server file`)

const css = await readFile(join(base, 'src/index.css'), 'utf8')
if (/Private Growth Console|\.growth-(?:shell|login|topbar|main)/.test(css)) failures.push('Public stylesheet contains Growth Console presentation')

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log('Public deployment source is synchronized and database-free.')
}
