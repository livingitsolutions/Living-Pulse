import type { PulseOption } from './types'

export function hasEnoughOptions(options: PulseOption[]) {
  return options.filter((option) => option.label.trim()).length >= 2
}

export function percentage(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 100) : 0
}
