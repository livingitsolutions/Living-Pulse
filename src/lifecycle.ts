export const statusOptions = ['Draft', 'Testing', 'Planned', 'Coming Soon', 'Launched', 'Archived'] as const

export const statusDescriptions: Record<string, string> = {
  Draft: "You're preparing this idea and haven't started testing it yet.",
  Testing: "You're currently measuring customer interest in this idea.",
  Planned: "You've decided to move forward with this idea.",
  'Coming Soon': "You've committed to the idea and are preparing to launch it.",
  Launched: 'This idea is now available to your customers.',
  Archived: 'This idea is no longer actively being tracked.',
}
