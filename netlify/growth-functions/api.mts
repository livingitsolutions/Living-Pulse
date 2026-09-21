import type { Config, Context } from '@netlify/functions'
import { acquisitionConsoleRepository } from '../../db/acquisitionConsole.js'
import { createProspect, qualifyProspect, queueProspect, rejectProspect, suppressProspect } from '../../db/acquisitionApplication.js'
import { createOperatorAuthHandler, hasOperatorSession } from '../../db/operatorAuth.js'
import { createOperatorConsoleHandler } from '../../db/operatorConsole.js'
import { operatorStore } from '../../db/operatorStore.js'
import { productOperationRepository } from '../../db/productOperationRepository.js'
import { createProductOperations } from '../../server/productOperations.js'
import { createProductServiceHandler } from '../../server/productServiceHandler.js'
import { UnconfiguredPublicWebDiscoveryProvider } from '../../server/prospectDiscoveryProvider.js'
import { TavilyProspectDiscoveryProvider } from '../../server/tavilyProspectDiscoveryProvider.js'
import { prospectStore } from '../../db/prospectStore.js'
import type { ProspectDiscoveryProvider } from '../../src/prospectDiscovery.js'

const tavilyDiscoveryProvider = new TavilyProspectDiscoveryProvider({ apiKey: () => Netlify.env.get('TAVILY_API_KEY') })
const unconfiguredDiscoveryProvider = new UnconfiguredPublicWebDiscoveryProvider()
const discoveryProvider: ProspectDiscoveryProvider = {
  get id() { return Netlify.env.has('TAVILY_API_KEY') ? tavilyDiscoveryProvider.id : unconfiguredDiscoveryProvider.id },
  discover(criteria, signal) {
    const selected = Netlify.env.has('TAVILY_API_KEY') ? tavilyDiscoveryProvider : unconfiguredDiscoveryProvider
    return selected.discover(criteria, signal)
  },
}

const operatorAuth = createOperatorAuthHandler({ store: operatorStore, secret: () => Netlify.env.get('LIVING_PULSE_OPERATOR_SECRET') })
const operatorConsole = createOperatorConsoleHandler({
  authenticated: (request) => hasOperatorSession(request, operatorStore),
  repository: acquisitionConsoleRepository,
  services: { createProspect, qualifyProspect, rejectProspect, suppressProspect, queueProspect },
  discoveryProvider,
  prospectExistsByEmail: async (email) => Boolean(await prospectStore.findProspectByEmail(email)),
})

export default async (request: Request, context: Context) => {
  if (new URL(request.url).pathname.startsWith('/api/product-service/')) {
    return createProductServiceHandler({
      operations: createProductOperations(productOperationRepository),
      secret: () => Netlify.env.get('LIVING_PULSE_PRODUCT_SERVICE_SECRET'),
    })(request)
  }
  const parts = new URL(request.url).pathname.replace(/^\/api\/operator\/?/, '').split('/').filter(Boolean)
  if (['acquisition', 'prospects', 'outreach', 'suppressions'].includes(parts[0])) return operatorConsole(request)
  return operatorAuth(request, context.ip)
}

export const config: Config = { path: ['/api/operator/*', '/api/product-service/*'] }
