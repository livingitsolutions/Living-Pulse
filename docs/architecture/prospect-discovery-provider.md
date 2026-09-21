# Public prospect discovery provider

Growth now owns a provider-neutral `ProspectDiscoveryProvider` boundary. The
production adapter fails closed because this repository and its Netlify site do
not currently provide a supported public-web search capability or credential.
It does not scrape search-result HTML, fetch arbitrary operator-supplied URLs,
or fabricate candidates.

Live discovery requires a vetted public-web search API that is contractually
appropriate for intentionally public business websites, public business
directories, and technically accessible public business social pages. Its
adapter must return exact email evidence (address, source URL, excerpt, source
type, and observation time), accept an abort signal, cap results at ten, and
honor the existing URL and evidence validators. Any paid provider requires an
explicit architectural decision and credential configuration before enabling
the adapter.

The current workflow stores no discovery preview. An authenticated operator
must explicitly import one reviewed result; import then uses the existing
transactional uniqueness checks and creates only a pending, not-contacted
prospect.
