# Public prospect discovery provider

Growth owns a provider-neutral `ProspectDiscoveryProvider` application boundary. Its
authoritative contract accepts validated category, location, and a result limit plus
an `AbortSignal`; it returns evidence-backed discovery candidates. Vendor request and
response shapes do not cross that boundary.

Tavily is the first live infrastructure adapter. The Growth Netlify Function selects
it only when the server-side `TAVILY_API_KEY` is configured. The variable is a
Growth-only secret and must never be added to Public configuration, browser-prefixed
configuration, responses, logs, audit events, or stored records. Missing credentials
fail closed; there is no mock or fabricated production fallback.

The adapter makes one native-fetch request to a code-owned Tavily Search endpoint.
The operator controls only category, location, and the accepted-result limit. The
query and all provider options are constructed on the server. Search asks Tavily for
raw text from public sources, so this implementation does not contain a Growth-owned
webpage fetcher or crawler. Tavily output is untrusted data and is never interpreted
as instructions.

Upstream search work is capped at three times the requested accepted-result limit and
never more than 20 results. The transport timeout is seven seconds within the
application's existing eight-second overall deadline. The response body is capped at
1 MB and accepted evidence excerpts are capped at 1,000 characters (normally about
360 characters). There are no retries.

A search hit is not a candidate. Living Pulse accepts only a supported public source
class with a safe public URL, a source-backed business name, and a syntactically valid
email copied from retrieved source content. The evidence URL is the retrieved source
URL, and the bounded verbatim excerpt must contain the exact mailbox after
case-normalization. Casing differences are accepted; fuzzy matches, enrichment,
domain-derived addresses, guessed mailboxes, employee permutations, and summaries
without source text are rejected. The original spelling, casing, and surrounding text
remain unchanged in the excerpt.

Discovery results remain ephemeral. The application flags existing prospects using
normalized email, but discovery and review do not write to the database. Only an
authenticated operator's explicit import creates a pending, not-contacted prospect;
it does not qualify, queue, create an outreach attempt, or send email.

A replacement provider implements the same interface in Growth infrastructure,
keeps its transport types private, honors the abort/deadline and evidence rules, and
is selected only through server-side Growth wiring. Application, browser, database,
and Public contracts do not change when the infrastructure adapter is replaced.
