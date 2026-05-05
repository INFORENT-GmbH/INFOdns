import { FastifyInstance } from 'fastify'
import { billingSettingsRoutes } from './settings.js'
import { billingItemsRoutes } from './items.js'
import { billingInvoicesRoutes } from './invoices.js'
import { billingPaymentsRoutes } from './payments.js'
import { billingDunningRoutes } from './dunning.js'
import { billingUsageRoutes } from './usage.js'
import { billingDashboardRoutes } from './dashboard.js'
import { billingViesRoutes } from './vies.js'

// Aggregator for all /billing/* routes. Phase-by-phase modules register here.
export async function billingRoutes(app: FastifyInstance) {
  await app.register(billingSettingsRoutes)
  await app.register(billingItemsRoutes)
  await app.register(billingInvoicesRoutes)
  await app.register(billingPaymentsRoutes)
  await app.register(billingDunningRoutes)
  await app.register(billingUsageRoutes)
  await app.register(billingDashboardRoutes)
  await app.register(billingViesRoutes)
}
