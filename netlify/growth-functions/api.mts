import type { Config, Context } from '@netlify/functions'
import { acquisitionConsoleRepository } from '../../db/acquisitionConsole.js'
import { qualifyProspect, queueProspect, rejectProspect, suppressProspect } from '../../db/acquisitionApplication.js'
import { createOperatorAuthHandler, hasOperatorSession } from '../../db/operatorAuth.js'
import { createOperatorConsoleHandler } from '../../db/operatorConsole.js'
import { operatorStore } from '../../db/operatorStore.js'
import { productOperationRepository } from '../../db/productOperationRepository.js'
import { createProductOperations } from '../../server/productOperations.js'
import { createProductServiceHandler } from '../../server/productServiceHandler.js'

const operatorAuth = createOperatorAuthHandler({ store: operatorStore, secret: () => Netlify.env.get('LIVING_PULSE_OPERATOR_SECRET') })
const operatorConsole = createOperatorConsoleHandler({
  authenticated: (request) => hasOperatorSession(request, operatorStore),
  repository: acquisitionConsoleRepository,
  services: { qualifyProspect, rejectProspect, suppressProspect, queueProspect },
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
