export function publicPulsePath(id: string) {
  return `/p/${id}`
}

export function publicPulseUrl(origin: string, id: string) {
  return `${origin}${publicPulsePath(id)}`
}
