import { defineConfig } from 'drizzle-kit'
export default defineConfig({ dialect: 'postgresql', schema: './db/schema.ts', out: 'deploy/growth/netlify/database/migrations' })
