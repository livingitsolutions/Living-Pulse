import { prospectStore } from './prospectStore.js'
import { createProspectServices } from '../src/prospectServices.js'

export const { createProspect, qualifyProspect, rejectProspect, suppressProspect, queueProspect, validateCreate } = createProspectServices(prospectStore)
