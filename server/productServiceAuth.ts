import { createHash, timingSafeEqual } from 'node:crypto'

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest()

export function hasProductServiceCredential(request: Request, configuredSecret: string | undefined) {
  const supplied = request.headers.get('authorization')
  if (!configuredSecret || !supplied?.startsWith('Bearer ')) return false
  const credential = supplied.slice(7)
  if (!credential) return false
  return timingSafeEqual(digest(configuredSecret), digest(credential))
}
