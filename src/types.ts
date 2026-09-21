export type PulseOption = { id: string; label: string }
export type FollowUp = { question: string; options: PulseOption[] }
export type Pulse = { id: string; creatorKey?: string; businessName: string; idea: string; question: string; options: PulseOption[]; followUp: FollowUp | null; allowUpdates: boolean; status: string; createdAt?: string }
export type PublicPulse = Omit<Pulse, 'creatorKey' | 'status'>
export type Results = { pulse: Pulse; total: number; options: Array<PulseOption & { count: number; percentage: number }>; followUp: Array<PulseOption & { count: number; percentage: number }>; updateOptIns: number }
export type EventName = 'landing_viewed' | 'create_started' | 'pulse_created' | 'pulse_published' | 'pulse_link_copied' | 'qr_downloaded' | 'public_pulse_viewed' | 'response_started' | 'response_completed' | 'update_opt_in' | 'results_viewed' | 'second_pulse_created' | 'powered_by_clicked'
