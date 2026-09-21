import { SOURCE_TYPES, normalizeEmail, type ProspectInput, type SourceType } from './acquisitionFoundation'
import type { StoredProspect } from './prospectServices'

type Services = {
  validateCreate(input: ProspectInput): Promise<ProspectInput>
  createProspect(input: ProspectInput): Promise<StoredProspect>
}
export type ImportReport = { businessName: string; sourceType: string; status: 'accepted' | 'rejected'; prospectId?: string; reason?: string }

function textField(row: Record<string, unknown>, name: string, required: true): string
function textField(row: Record<string, unknown>, name: string, required?: false): string | null
function textField(row: Record<string, unknown>, name: string, required = false): string | null {
  const value = row[name]
  if (value == null && !required) return null
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required and must be text.`)
  return value
}

function parseRow(value: unknown): ProspectInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each prospect must be a JSON object.')
  const row = value as Record<string, unknown>
  const sourceType = textField(row, 'sourceType', true)
  if (!SOURCE_TYPES.includes(sourceType as SourceType)) throw new Error('sourceType is not supported.')
  const observed = textField(row, 'sourceObservedAt', true)
  const sourceObservedAt = new Date(observed)
  if (Number.isNaN(sourceObservedAt.getTime())) throw new Error('sourceObservedAt must be a valid date and time.')
  return {
    businessName: textField(row, 'businessName', true),
    publicContactEmail: textField(row, 'publicContactEmail', true),
    sourceUrl: textField(row, 'sourceUrl', true),
    sourceType: sourceType as SourceType,
    sourceObservedAt,
    evidenceNote: textField(row, 'evidenceNote', true),
    potentialUseCase: textField(row, 'potentialUseCase'),
    emailSourceUrl: textField(row, 'emailSourceUrl', true),
    websiteUrl: textField(row, 'websiteUrl'),
    industry: textField(row, 'industry'),
    locationText: textField(row, 'locationText'),
    personalizationContext: textField(row, 'personalizationContext'),
    personalizationEvidence: textField(row, 'personalizationEvidence'),
  }
}

function label(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { businessName: 'Unknown business', sourceType: 'unknown' }
  const row = value as Record<string, unknown>
  return { businessName: typeof row.businessName === 'string' ? row.businessName.trim() || 'Unknown business' : 'Unknown business', sourceType: typeof row.sourceType === 'string' ? row.sourceType : 'unknown' }
}

export async function importProspects(values: unknown, services: Services, dryRun: boolean): Promise<ImportReport[]> {
  if (!Array.isArray(values)) throw new Error('Import input must be a JSON array.')
  const reports: ImportReport[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const identity = label(value)
    try {
      const input = parseRow(value)
      const normalizedEmail = normalizeEmail(input.publicContactEmail)
      if (seen.has(normalizedEmail)) throw new Error('A duplicate public email appears in this import.')
      if (dryRun) await services.validateCreate(input)
      const saved = dryRun ? null : await services.createProspect(input)
      seen.add(normalizedEmail)
      reports.push({ ...identity, status: 'accepted', ...(saved ? { prospectId: saved.id } : {}) })
    } catch (error) {
      reports.push({ ...identity, status: 'rejected', reason: error instanceof Error ? error.message : 'Validation failed.' })
    }
  }
  return reports
}
