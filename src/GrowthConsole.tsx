import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, Check, ChevronRight, LogOut, Menu, Search, ShieldCheck, X } from 'lucide-react'
import type { DiscoveryCandidate } from './prospectDiscovery'
import type { GrowthAttempt, GrowthOverview, GrowthProspectDetail, GrowthProspectSummary, GrowthSuppression } from './growthTypes'

type View = 'overview' | 'prospects' | 'discover' | 'outreach' | 'suppression'
type DialogAction = 'reject' | 'suppress' | 'queue'
const views: Array<{ id: View; label: string }> = [{ id: 'overview', label: 'Overview' }, { id: 'prospects', label: 'Prospects' }, { id: 'discover', label: 'Discover' }, { id: 'outreach', label: 'Outreach' }, { id: 'suppression', label: 'Suppression' }]
const qualificationLabels = { pending: 'Pending', qualified: 'Qualified', rejected: 'Rejected' }
const outreachLabels = { not_contacted: 'Not contacted', queued: 'Queued', sent: 'Sent', replied: 'Replied', converted: 'Converted', suppressed: 'Suppressed' }

async function operatorRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/operator${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error || (response.status === 401 ? 'Authentication required' : 'The request could not be completed.'))
  return body
}

function Mark() { return <svg className="growth-mark" viewBox="0 0 36 36" aria-hidden="true"><path d="M2 18h6l4-9 6 18 5-14 4 5h7" /></svg> }
function Status({ value, kind }: { value: string; kind: 'qualification' | 'outreach' }) {
  const labels = kind === 'qualification' ? qualificationLabels : outreachLabels
  return <span className={`growth-status status-${value}`}>{labels[value as keyof typeof labels]}</span>
}
function Empty({ children }: { children: React.ReactNode }) { return <div className="growth-empty"><span>—</span><p>{children}</p></div> }
function DateText({ value }: { value: string | null }) { return <>{value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—'}</> }

function Login({ onAuthenticated }: { onAuthenticated(): void }) {
  const [credential, setCredential] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { await operatorRequest('/login', { method: 'POST', body: JSON.stringify({ credential }) }); onAuthenticated() }
    catch { setError('Authentication failed. Check the credential and try again.') }
    finally { setCredential(''); setBusy(false) }
  }
  return <main className="growth-login">
    <section aria-labelledby="growth-login-title">
      <div className="growth-login-brand"><Mark /><span>Living Pulse</span></div>
      <p className="growth-kicker">Internal acquisition operations</p>
      <h1 id="growth-login-title">Growth<br /><em>Console</em></h1>
      <p className="growth-login-note"><ShieldCheck size={18} /> Private operator access</p>
      <form onSubmit={submit}>
        <label htmlFor="operator-credential">Operator credential</label>
        <input id="operator-credential" type="password" autoComplete="current-password" value={credential} onChange={(event) => setCredential(event.target.value)} required autoFocus aria-describedby={error ? 'operator-error' : undefined} aria-invalid={Boolean(error)} />
        {error && <p className="growth-form-error" id="operator-error" role="alert">{error}</p>}
        <button className="growth-primary" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}<ChevronRight size={18} /></button>
      </form>
    </section>
    <aside><span>LP / OPS</span><p>Prospect review<br />Qualification<br />Outreach preparation</p><small>Delivery remains disabled.</small></aside>
  </main>
}

function Overview({ data }: { data: GrowthOverview | null }) {
  if (!data) return <div className="growth-loading" aria-label="Loading overview"><i /><i /><i /></div>
  const counts = [['Total prospects', data.total], ['Pending', data.pending], ['Qualified', data.qualified], ['Queued', data.queued], ['Sent', data.sent], ['Replied', data.replied], ['Converted', data.converted], ['Suppressed', data.suppressed]]
  return <><div className="growth-page-head"><div><p className="growth-kicker">Acquisition / current state</p><h1>Overview</h1></div><p className="growth-date">Validation-stage operating view</p></div>
    <section className="growth-counts">{counts.map(([label, value], index) => <div className={index === 0 ? 'primary-count' : ''} key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
    <section className="growth-policy"><div><span>Sending</span><strong>Disabled</strong></div><div><span>Daily limit</span><strong>{data.policy.dailyLimit}</strong></div><div><span>Maximum attempts</span><strong>{data.policy.maximumAttempts}</strong></div><p>Queueing prepares records for future outreach. No delivery controls are available in this console.</p></section></>
}

function ProspectTable({ prospects, onSelect }: { prospects: GrowthProspectSummary[]; onSelect(id: string): void }) {
  const [search, setSearch] = useState('')
  const [qualification, setQualification] = useState('all')
  const [outreach, setOutreach] = useState('all')
  const filtered = useMemo(() => prospects.filter((item) => {
    const text = `${item.businessName} ${item.industry || ''} ${item.locationText || ''}`.toLowerCase()
    return text.includes(search.toLowerCase()) && (qualification === 'all' || item.qualificationStatus === qualification) && (outreach === 'all' || item.outreachStatus === outreach)
  }), [prospects, search, qualification, outreach])
  return <><div className="growth-page-head"><div><p className="growth-kicker">Review queue</p><h1>Prospects</h1></div><p className="growth-date">{filtered.length} of {prospects.length} records</p></div>
    <div className="growth-filters"><label><span>Search</span><input type="search" placeholder="Business, industry, location" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label><span>Qualification</span><select value={qualification} onChange={(event) => setQualification(event.target.value)}><option value="all">All</option><option value="pending">Pending</option><option value="qualified">Qualified</option><option value="rejected">Rejected</option></select></label><label><span>Outreach</span><select value={outreach} onChange={(event) => setOutreach(event.target.value)}><option value="all">All</option>{Object.entries(outreachLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
    {!filtered.length ? <Empty>No prospects match the current filters.</Empty> : <div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>Business</th><th>Industry / location</th><th>Qualification</th><th>Outreach</th><th>Attempts</th><th>Source</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id} onClick={() => onSelect(item.id)}><td><button className="growth-row-link">{item.businessName}</button></td><td>{item.industry || '—'}<small>{item.locationText || 'No location'}</small></td><td><Status value={item.qualificationStatus} kind="qualification" /></td><td><Status value={item.outreachStatus} kind="outreach" /></td><td>{item.attemptCount} / 2</td><td>{item.sourceType.replaceAll('_', ' ')}</td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></div>}
  </>
}

const emptyCandidate = (): DiscoveryCandidate => ({ businessName: '', industry: '', locationText: '', websiteUrl: '', sourceType: 'business_website', sourceUrl: '', sourceObservedAt: new Date().toISOString(), evidenceNote: '', potentialUseCase: '', personalizationContext: '', personalizationEvidence: '', publicEmailEvidence: { email: '', sourceUrl: '', observedText: '' } })

function Discovery({ onImported }: { onImported(): Promise<void> }) {
  const [criteria, setCriteria] = useState({ category: '', location: '', maximumResults: 1 })
  const [candidate, setCandidate] = useState<DiscoveryCandidate>(emptyCandidate)
  const [preview, setPreview] = useState<DiscoveryCandidate | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const update = (key: keyof DiscoveryCandidate, value: string) => setCandidate((current) => ({ ...current, [key]: value }))
  const updateEmail = (key: keyof DiscoveryCandidate['publicEmailEvidence'], value: string) => setCandidate((current) => ({ ...current, publicEmailEvidence: { ...current.publicEmailEvidence, [key]: value } }))
  async function discover(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); setPreview(null); try { const result = await operatorRequest<{ candidates: DiscoveryCandidate[] }>('/prospects/discover', { method: 'POST', body: JSON.stringify({ criteria, candidate }) }); setPreview(result.candidates[0]); setMessage('Evidence validated. Review the candidate before importing.') } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) } }
  async function confirm() { if (!preview) return; setBusy(true); setMessage(''); try { await operatorRequest('/prospects/import', { method: 'POST', body: JSON.stringify({ candidate: preview }) }); await onImported(); setCandidate(emptyCandidate()); setPreview(null); setMessage('Imported as Pending · Not contacted. No email was sent.') } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) } }
  return <><div className="growth-page-head"><div><p className="growth-kicker">Prospects / controlled intake</p><h1>Discover prospects</h1></div><p className="growth-date">Operator-assisted · public sources only</p></div>
    <div className="growth-discovery-policy"><ShieldCheck size={20} /><p>Record only intentionally published business contact details. Evidence is validated and previewed before import. This workflow never qualifies, queues, or contacts a prospect.</p></div>
    <form className="growth-discovery-form" onSubmit={discover}>
      <fieldset><legend>Discovery criteria</legend><div className="growth-field-grid"><label><span>Business category</span><input value={criteria.category} onChange={(e) => setCriteria({ ...criteria, category: e.target.value })} placeholder="Independent restaurant" required /></label><label><span>Location</span><input value={criteria.location} onChange={(e) => setCriteria({ ...criteria, location: e.target.value })} placeholder="Bristol, UK" required /></label><label><span>Maximum results</span><input type="number" min="1" max="100" value={criteria.maximumResults} onChange={(e) => setCriteria({ ...criteria, maximumResults: Number(e.target.value) })} /></label></div></fieldset>
      <fieldset><legend>Observed business</legend><div className="growth-field-grid"><label><span>Business name</span><input value={candidate.businessName} onChange={(e) => update('businessName', e.target.value)} required /></label><label><span>Category / industry</span><input value={candidate.industry || ''} onChange={(e) => update('industry', e.target.value)} required /></label><label><span>City / region / country</span><input value={candidate.locationText || ''} onChange={(e) => update('locationText', e.target.value)} required /></label><label><span>Website</span><input type="url" value={candidate.websiteUrl || ''} onChange={(e) => update('websiteUrl', e.target.value)} placeholder="https://" /></label><label><span>Source type</span><select value={candidate.sourceType} onChange={(e) => update('sourceType', e.target.value)}><option value="business_website">Official business website</option><option value="public_business_directory">Public business directory</option><option value="public_social_business_page">Public business social page</option><option value="manual">Other public source</option></select></label><label><span>Exact source URL</span><input type="url" value={candidate.sourceUrl} onChange={(e) => update('sourceUrl', e.target.value)} placeholder="https://" required /></label><label className="wide"><span>Evidence note — what was actually observed</span><textarea value={candidate.evidenceNote} onChange={(e) => update('evidenceNote', e.target.value)} required /></label><label className="wide"><span>Potential Living Pulse use case</span><textarea value={candidate.potentialUseCase || ''} onChange={(e) => update('potentialUseCase', e.target.value)} placeholder="Potential Pulse: …" /></label></div></fieldset>
      <fieldset><legend>Public email evidence</legend><div className="growth-field-grid"><label><span>Exact publicly listed business email</span><input type="email" value={candidate.publicEmailEvidence.email} onChange={(e) => updateEmail('email', e.target.value)} required /></label><label><span>URL showing that email</span><input type="url" value={candidate.publicEmailEvidence.sourceUrl} onChange={(e) => updateEmail('sourceUrl', e.target.value)} placeholder="https://" required /></label><label className="wide"><span>Observed excerpt containing the exact email</span><textarea value={candidate.publicEmailEvidence.observedText} onChange={(e) => updateEmail('observedText', e.target.value)} required /></label></div></fieldset>
      <fieldset><legend>Optional personalization</legend><div className="growth-field-grid"><label className="wide"><span>Observed personalization context</span><textarea value={candidate.personalizationContext || ''} onChange={(e) => update('personalizationContext', e.target.value)} /></label><label><span>Evidence URL (required with context)</span><input type="url" value={candidate.personalizationEvidence || ''} onChange={(e) => update('personalizationEvidence', e.target.value)} placeholder="https://" /></label></div></fieldset>
      <button className="growth-primary" disabled={busy}><Search size={16} />{busy ? 'Validating…' : 'Preview candidate'}</button>
    </form>
    {message && <p className={`growth-notice ${preview ? '' : 'growth-notice-error'}`} role="status">{message}</p>}
    {preview && <section className="growth-preview"><p className="growth-kicker">Validated preview · not yet saved</p><h2>{preview.businessName}</h2><dl><div><dt>Location</dt><dd>{preview.locationText}</dd></div><div><dt>Website</dt><dd>{preview.websiteUrl || '—'}</dd></div><div><dt>Public email</dt><dd>{preview.publicEmailEvidence.email}</dd></div><div><dt>Source</dt><dd>{preview.sourceType.replaceAll('_', ' ')} · {preview.sourceUrl}</dd></div><div><dt>Evidence</dt><dd>{preview.evidenceNote}</dd></div><div><dt>Potential use case</dt><dd>{preview.potentialUseCase || '—'}</dd></div></dl><div className="growth-actions"><button className="growth-primary" onClick={confirm} disabled={busy}>Confirm import</button><button className="growth-secondary" onClick={() => setPreview(null)}>Edit evidence</button></div></section>}
  </>
}

function Detail({ prospect, onBack, onMutate }: { prospect: GrowthProspectDetail; onBack(): void; onMutate(action: string, body?: object): Promise<void> }) {
  const [dialog, setDialog] = useState<DialogAction | null>(null)
  const [reason, setReason] = useState('manual')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function qualify() { setBusy(true); setMessage(''); try { await onMutate('qualify'); setMessage('Prospect qualified.') } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) } }
  async function confirmAction() {
    if (!dialog) return
    setBusy(true); setMessage('')
    try { await onMutate(dialog, dialog === 'reject' || dialog === 'suppress' ? { reason } : undefined); setDialog(null); setMessage(dialog === 'queue' ? 'Prospect queued. No email was sent.' : dialog === 'suppress' ? 'Prospect suppressed.' : 'Prospect rejected.') }
    catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }
  const safety = [['Public source evidence', prospect.safety.publicSourceEvidence], ['Valid public email', prospect.safety.validPublicEmail], ['Qualified', prospect.safety.qualified], ['Not suppressed', prospect.safety.notSuppressed], ['Attempt capacity', prospect.safety.attemptCapacity]]
  return <><button className="growth-back" onClick={onBack}><ArrowLeft size={17} />All prospects</button><div className="growth-detail-head"><div><p className="growth-kicker">Prospect record</p><h1>{prospect.businessName}</h1><p>{prospect.industry || 'Industry not recorded'} · {prospect.locationText || 'Location not recorded'}</p></div><div><Status value={prospect.qualificationStatus} kind="qualification" /><Status value={prospect.outreachStatus} kind="outreach" /></div></div>
    {message && <p className="growth-notice" role="status">{message}</p>}
    <div className="growth-detail-grid">
      <section><h2>Business</h2><dl><div><dt>Business name</dt><dd>{prospect.businessName}</dd></div><div><dt>Industry</dt><dd>{prospect.industry || '—'}</dd></div><div><dt>Location</dt><dd>{prospect.locationText || '—'}</dd></div><div><dt>Website</dt><dd>{prospect.websiteUrl ? <a href={prospect.websiteUrl} target="_blank" rel="noreferrer">Open website</a> : '—'}</dd></div></dl></section>
      <section><h2>Public contact</h2><dl><div><dt>Business email</dt><dd>{prospect.publicContactEmail}</dd></div><div><dt>Email evidence</dt><dd><a href={prospect.emailSourceUrl} target="_blank" rel="noreferrer">Inspect source</a></dd></div><div><dt>Source type</dt><dd>{prospect.sourceType.replaceAll('_', ' ')}</dd></div><div><dt>Source URL</dt><dd><a href={prospect.sourceUrl} target="_blank" rel="noreferrer">Inspect source</a></dd></div><div><dt>Observed</dt><dd><DateText value={prospect.sourceObservedAt} /></dd></div></dl></section>
      <section><h2>Discovery evidence</h2><dl><div><dt>Observed</dt><dd>{prospect.evidenceNote}</dd></div><div><dt>Potential use</dt><dd>{prospect.potentialUseCase || '—'}</dd></div>{prospect.personalizationContext && <><div><dt>Context</dt><dd>{prospect.personalizationContext}</dd></div><div><dt>Evidence</dt><dd>{prospect.personalizationEvidence ? <a href={prospect.personalizationEvidence} target="_blank" rel="noreferrer">Inspect evidence</a> : '—'}</dd></div></>}</dl></section>
      <section><h2>Qualification</h2><p><Status value={prospect.qualificationStatus} kind="qualification" /></p>{prospect.rejectionReason && <p className="growth-muted">Reason: {prospect.rejectionReason}</p>}{prospect.qualificationStatus === 'pending' && <div className="growth-actions"><button className="growth-primary" onClick={qualify} disabled={busy}>Qualify</button><button className="growth-secondary" onClick={() => { setReason(''); setDialog('reject') }}>Reject</button></div>}</section>
      <section><h2>Outreach</h2><dl><div><dt>Status</dt><dd>{outreachLabels[prospect.outreachStatus]}</dd></div><div><dt>Attempts used</dt><dd>{prospect.attemptCount} / 2</dd></div>{prospect.suppression && <div><dt>Suppression</dt><dd>{prospect.suppression.reason} · <DateText value={prospect.suppression.createdAt} /></dd></div>}</dl>{prospect.qualificationStatus === 'qualified' && prospect.outreachStatus === 'not_contacted' && prospect.safety.notSuppressed && <button className="growth-primary" onClick={() => setDialog('queue')}>Queue for outreach</button>}{prospect.outreachStatus !== 'suppressed' && <button className="growth-danger" onClick={() => { setReason('manual'); setDialog('suppress') }}>Do not contact</button>}</section>
      <section><h2>Safety</h2><ul className="growth-safety">{safety.map(([label, okay]) => <li key={String(label)} className={okay ? 'safe' : ''}>{okay ? <Check size={15} /> : <X size={15} />}<span>{label}</span></li>)}</ul></section>
    </div>
    {dialog && <div className="growth-dialog-backdrop" role="presentation"><div className="growth-dialog" role="dialog" aria-modal="true" aria-labelledby="growth-dialog-title"><button className="growth-dialog-close" onClick={() => setDialog(null)} aria-label="Close"><X /></button><p className="growth-kicker">Confirm operation</p><h2 id="growth-dialog-title">{dialog === 'queue' ? 'Queue this prospect?' : dialog === 'reject' ? 'Reject this prospect?' : 'Do not contact?'}</h2>{dialog === 'queue' ? <p>This prepares the prospect for future outreach. <strong>No email will be sent.</strong></p> : dialog === 'reject' ? <label><span>Rejection reason</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} required autoFocus /></label> : <label><span>Suppression reason</span><select value={reason} onChange={(event) => setReason(event.target.value)}><option value="manual">Manual</option><option value="unsubscribe">Unsubscribe</option><option value="bounce">Bounce</option><option value="complaint">Complaint</option><option value="invalid">Invalid</option></select></label>}<div className="growth-actions"><button className={dialog === 'suppress' ? 'growth-danger' : 'growth-primary'} onClick={confirmAction} disabled={busy || (dialog === 'reject' && !reason.trim())}>{busy ? 'Saving…' : 'Confirm'}</button><button className="growth-secondary" onClick={() => setDialog(null)}>Cancel</button></div></div></div>}
  </>
}

function Outreach({ attempts }: { attempts: GrowthAttempt[] }) {
  const [filter, setFilter] = useState('all')
  const rows = filter === 'all' ? attempts : attempts.filter((item) => item.outreachStatus === filter)
  return <><div className="growth-page-head"><div><p className="growth-kicker">Read-only operations</p><h1>Outreach</h1></div><p className="growth-date">Delivery controls unavailable</p></div><div className="growth-outreach-filter"><label><span>Operational stage</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All active stages</option><option value="queued">Queued</option><option value="sent">Sent</option><option value="replied">Replied</option><option value="converted">Converted</option></select></label></div>{!rows.length ? <Empty>{attempts.length ? 'No outreach records match this stage.' : 'No prospects are currently queued.'}</Empty> : <div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>Business</th><th>Sequence</th><th>Stage</th><th>Attempt state</th><th>Scheduled</th><th>Sent</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td>{item.businessName}</td><td>Attempt {item.sequenceNumber}</td><td><Status value={item.outreachStatus} kind="outreach" /></td><td><span className={`growth-status status-${item.status}`}>{item.status}</span></td><td><DateText value={item.scheduledFor} /></td><td><DateText value={item.sentAt} /></td></tr>)}</tbody></table></div>}</>
}
function Suppressions({ suppressions }: { suppressions: GrowthSuppression[] }) { return <><div className="growth-page-head"><div><p className="growth-kicker">Do-not-contact ledger</p><h1>Suppression</h1></div><p className="growth-date">Permanent in this console</p></div>{!suppressions.length ? <Empty>No suppressed addresses.</Empty> : <div className="growth-table-wrap"><table className="growth-table"><thead><tr><th>Business</th><th>Reason</th><th>Date</th></tr></thead><tbody>{suppressions.map((item, index) => <tr key={`${item.prospectId}-${index}`}><td>{item.businessName || 'Unmatched address'}</td><td>{item.reason}</td><td><DateText value={item.createdAt} /></td></tr>)}</tbody></table></div>}</> }

export default function GrowthConsole() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [view, setView] = useState<View>('overview')
  const [mobileNav, setMobileNav] = useState(false)
  const [overview, setOverview] = useState<GrowthOverview | null>(null)
  const [prospects, setProspects] = useState<GrowthProspectSummary[]>([])
  const [attempts, setAttempts] = useState<GrowthAttempt[]>([])
  const [suppressions, setSuppressions] = useState<GrowthSuppression[]>([])
  const [detail, setDetail] = useState<GrowthProspectDetail | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const [overviewData, prospectData, attemptData, suppressionData] = await Promise.all([operatorRequest<GrowthOverview>('/acquisition/overview'), operatorRequest<GrowthProspectSummary[]>('/prospects'), operatorRequest<GrowthAttempt[]>('/outreach'), operatorRequest<GrowthSuppression[]>('/suppressions')])
      setOverview(overviewData); setProspects(prospectData); setAttempts(attemptData); setSuppressions(suppressionData); setError('')
    } catch (loadError) { if ((loadError as Error).message === 'Authentication required') setAuthenticated(false); else setError((loadError as Error).message) }
  }, [])
  useEffect(() => { void operatorRequest<{ authenticated: boolean }>('/session').then((session) => { setAuthenticated(session.authenticated); if (session.authenticated) void load() }).catch(() => setAuthenticated(false)) }, [load])
  async function openDetail(id: string) { try { setDetail(await operatorRequest(`/prospects/${id}`)); setError('') } catch (detailError) { setError((detailError as Error).message) } }
  async function mutate(action: string, body?: object) { if (!detail) return; await operatorRequest(`/prospects/${detail.id}/${action}`, { method: 'POST', body: JSON.stringify(body || {}) }); await load(); setDetail(await operatorRequest(`/prospects/${detail.id}`)) }
  async function logout() { await operatorRequest('/logout', { method: 'POST', body: '{}' }); setAuthenticated(false); setOverview(null); setProspects([]); setDetail(null) }
  if (authenticated === null) return <div className="growth-boot"><Mark /><span>Checking operator session</span></div>
  if (!authenticated) return <Login onAuthenticated={() => { setAuthenticated(true); void load() }} />
  return <div className="growth-shell"><header className="growth-topbar"><div className="growth-brand"><Mark /><div><strong>Living Pulse</strong><span>Growth Console</span></div></div><button className="growth-menu" onClick={() => setMobileNav(!mobileNav)} aria-expanded={mobileNav}><Menu /><span>Menu</span></button><nav className={mobileNav ? 'open' : ''}>{views.map((item) => <button className={view === item.id ? 'active' : ''} key={item.id} onClick={() => { setView(item.id); setDetail(null); setMobileNav(false) }}>{item.label}</button>)}</nav><button className="growth-logout" onClick={logout}><LogOut size={16} />Logout</button></header><main className="growth-main">{error && <p className="growth-notice growth-notice-error" role="alert">{error}</p>}{detail ? <Detail prospect={detail} onBack={() => setDetail(null)} onMutate={mutate} /> : view === 'overview' ? <Overview data={overview} /> : view === 'prospects' ? <ProspectTable prospects={prospects} onSelect={openDetail} /> : view === 'discover' ? <Discovery onImported={load} /> : view === 'outreach' ? <Outreach attempts={attempts} /> : <Suppressions suppressions={suppressions} />}</main><footer className="growth-footer"><span>Private operator surface</span><strong>Sending disabled</strong></footer></div>
}
