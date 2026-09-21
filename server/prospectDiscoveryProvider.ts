import { DiscoveryProviderUnavailableError, type DiscoveryCriteria, type ProspectDiscoveryProvider } from '../src/prospectDiscovery.js'

/** Fail-closed until a vetted public-web search API and credential are configured. */
export class UnconfiguredPublicWebDiscoveryProvider implements ProspectDiscoveryProvider {
  readonly id = 'unconfigured_public_web'
  async discover(criteria: DiscoveryCriteria, signal: AbortSignal): Promise<never> {
    void criteria
    void signal
    throw new DiscoveryProviderUnavailableError()
  }
}
