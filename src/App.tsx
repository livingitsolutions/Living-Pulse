import { useEffect, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, Clipboard, Download, ExternalLink, Plus, QrCode, Trash2 } from 'lucide-react'
import QRCode from 'qrcode'
import { api } from './api'
import { poweredByPath, preserveAttribution } from './acquisition'
import type { FollowUp, Pulse, PulseOption, Results } from './types'
import { hasEnoughOptions } from './validation'

const newOption = (label = ''): PulseOption => ({ id: crypto.randomUUID(), label })
const statusOptions = ['Draft', 'Testing', 'Planned', 'Coming Soon', 'Launched', 'Archived']

function Logo() { return <Link className="logo" to="/" aria-label="Living Pulse home"><span className="pulse-dot" />Living Pulse</Link> }
function ButtonLink({ to, children, secondary = false }: { to: string; children: React.ReactNode; secondary?: boolean }) { return <Link className={secondary ? 'button secondary' : 'button'} to={to}>{children}<ArrowRight size={18} /></Link> }

function Landing() {
  useEffect(() => { void api.event('landing_viewed') }, [])
  const industries = ['Restaurants', 'Retail', 'Gyms', 'Salons', 'Real Estate', 'SaaS', 'Events']
  return <>
    <header className="nav"><Logo /><ButtonLink to="/create" secondary>Create a Pulse</ButtonLink></header>
    <main>
      <section className="hero page-grid">
        <div className="hero-copy"><p className="eyebrow">One question. An actual signal.</p><h1>Stop guessing what your customers want.</h1><p className="lede">Ask one simple question. Share it anywhere. See real demand before you spend time or money.</p><ButtonLink to="/create">Create a Free Pulse</ButtonLink><p className="micro">No login. No sprawling survey. Just a clearer next move.</p></div>
        <div className="demo-card" aria-label="Example pulse"><span className="card-number">01</span><p className="small-label">Antonio's Café is asking</p><h2>Would you use Sunday delivery?</h2>{['Definitely', 'Probably', 'Maybe', 'No'].map((answer, i) => <div className={i === 0 ? 'demo-answer selected' : 'demo-answer'} key={answer}><span>{answer}</span>{i === 0 && <Check size={18} />}</div>)}<div className="card-stamp">A 10-second Pulse</div></div>
      </section>
      <section className="thinking"><div><p className="eyebrow">You’re thinking</p><blockquote>“Should we offer<br />Sunday delivery?”</blockquote></div><ol className="flow">{['Idea', 'Ask Customers', 'QR / Link', 'Responses', 'Better Decision'].map((item, i) => <li key={item}><span>0{i + 1}</span>{item}</li>)}</ol></section>
      <section className="uses"><div><p className="eyebrow">Built for everyday decisions</p><h2>Any business with customers has something worth asking.</h2></div><div className="industry-list">{industries.map((item, i) => <span key={item}><b>{String(i + 1).padStart(2, '0')}</b>{item}</span>)}</div></section>
      <section className="bottom-cta"><p>Ask before you invest.</p><ButtonLink to="/create">Create a Free Pulse</ButtonLink></section>
    </main><footer><Logo /><span>Declared interest, not guaranteed demand.</span></footer>
  </>
}

function OptionEditor({ options, setOptions, min = 2 }: { options: PulseOption[]; setOptions: (v: PulseOption[]) => void; min?: number }) {
  return <div className="option-editor">{options.map((option, index) => <div className="option-row" key={option.id}><span>{String.fromCharCode(65 + index)}</span><input aria-label={`Option ${index + 1}`} value={option.label} onChange={(e) => setOptions(options.map((o) => o.id === option.id ? { ...o, label: e.target.value } : o))} required /><button type="button" aria-label={`Remove option ${index + 1}`} disabled={options.length <= min} onClick={() => setOptions(options.filter((o) => o.id !== option.id))}><Trash2 size={17} /></button></div>)}<button className="add-option" type="button" onClick={() => setOptions([...options, newOption()])}><Plus size={17} />Add option</button></div>
}

function Create() {
  const navigate = useNavigate()
  const [acquisition] = useState(() => preserveAttribution(window.location.search, sessionStorage))
  const [businessName, setBusinessName] = useState("Antonio's Café")
  const [idea, setIdea] = useState('Sunday Delivery')
  const [question, setQuestion] = useState('Would you use Sunday delivery?')
  const [options, setOptions] = useState([newOption('Definitely'), newOption('Probably'), newOption('Maybe'), newOption('No')])
  const [hasFollowUp, setHasFollowUp] = useState(false)
  const [followQuestion, setFollowQuestion] = useState('How often?')
  const [followOptions, setFollowOptions] = useState([newOption('Weekly'), newOption('Monthly'), newOption('Occasionally')])
  const [allowUpdates, setAllowUpdates] = useState(false)
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  useEffect(() => { void api.event('create_started', acquisition?.sourcePulseId, acquisition || undefined) }, [acquisition])
  async function submit(e: React.FormEvent) { e.preventDefault(); setError(''); if (!hasEnoughOptions(options)) return setError('Add at least two response options.'); if (hasFollowUp && !hasEnoughOptions(followOptions)) return setError('Add at least two follow-up options.'); setSaving(true); try { const followUp: FollowUp | null = hasFollowUp ? { question: followQuestion, options: followOptions } : null; const pulse = await api.create({ businessName, idea, question, options, followUp, allowUpdates }, acquisition); navigate(`/published/${pulse.id}?key=${pulse.creatorKey}`) } catch (err) { setError(err instanceof Error ? err.message : 'Could not create Pulse') } finally { setSaving(false) } }
  return <main className="form-page"><header className="form-nav"><Logo /><span>New Pulse</span></header><div className="form-layout"><aside><p className="eyebrow">Make the decision smaller</p><h1>What do you need to know?</h1><p>Keep it quick. One clear idea gets a clearer signal.</p><div className="step-mark"><b>01</b><span>Write<br />the question</span></div></aside><form onSubmit={submit} className="create-form">
    <label><span>Business name</span><input value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={120} required /></label>
    <label><span>Idea</span><input value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={160} required /></label>
    <label><span>Question</span><textarea value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} rows={2} required /><small>Ask one thing your customers can answer quickly.</small></label>
    <fieldset><legend>Response options</legend><OptionEditor options={options} setOptions={setOptions} /></fieldset>
    <div className="switch-row"><div><b>Ask one follow-up</b><span>Multiple choice only</span></div><button type="button" role="switch" aria-checked={hasFollowUp} className={`switch ${hasFollowUp ? 'on' : ''}`} onClick={() => setHasFollowUp(!hasFollowUp)}><i /></button></div>
    {hasFollowUp && <div className="inset"><label><span>Follow-up question</span><input value={followQuestion} onChange={(e) => setFollowQuestion(e.target.value)} required /></label><OptionEditor options={followOptions} setOptions={setFollowOptions} /></div>}
    <div className="switch-row"><div><b>Allow customers to request an update if this launches.</b><span>Email is asked only after their response and is always optional.</span></div><button type="button" role="switch" aria-checked={allowUpdates} className={`switch ${allowUpdates ? 'on' : ''}`} onClick={() => setAllowUpdates(!allowUpdates)}><i /></button></div>
    {error && <p className="error" role="alert">{error}</p>}<button className="button submit" disabled={saving}>{saving ? 'Publishing…' : 'Publish my Pulse'}<ArrowRight size={18} /></button>
  </form></div></main>
}

function Published() {
  const { id = '' } = useParams(); const [params] = useSearchParams(); const key = params.get('key') || ''; const [qr, setQr] = useState(''); const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/p/${id}`
  useEffect(() => { void QRCode.toDataURL(url, { width: 640, margin: 2, color: { dark: '#20241f', light: '#f8f5ed' } }).then(setQr) }, [url])
  async function copy() { await navigator.clipboard.writeText(url); setCopied(true); void api.event('pulse_link_copied', id); setTimeout(() => setCopied(false), 1800) }
  function download() { const link = document.createElement('a'); link.href = qr; link.download = `living-pulse-${id}.png`; link.click(); void api.event('qr_downloaded', id) }
  return <main className="success-page"><Logo /><section className="success-card"><div><p className="eyebrow">Published</p><h1>Your Pulse is Live</h1><p>Put this link—or the QR code—where your customers can see it.</p><div className="link-box"><span>{url}</span><button onClick={copy}>{copied ? <Check /> : <Clipboard />}<b>{copied ? 'Copied' : 'Copy Link'}</b></button></div><div className="action-row"><button className="button" onClick={download} disabled={!qr}><Download size={18} />Download QR</button><Link className="button secondary" to={`/p/${id}`} target="_blank">View Pulse<ExternalLink size={17} /></Link><Link className="text-link" to={`/results/${id}?key=${key}`}>View Results<ArrowRight size={16} /></Link></div></div><div className="qr-frame">{qr ? <img src={qr} alt="QR code for public Pulse" /> : <div className="qr-loading"><QrCode /></div>}<span>Scan to answer</span></div></section></main>
}

function PublicPulse() {
  const { id = '' } = useParams(); const [pulse, setPulse] = useState<Pulse | null>(null); const [selected, setSelected] = useState(''); const [follow, setFollow] = useState(''); const [stage, setStage] = useState<'primary' | 'follow' | 'email' | 'done'>('primary'); const [email, setEmail] = useState(''); const [error, setError] = useState('')
  useEffect(() => { api.pulse(id).then((p) => { setPulse(p); void api.event('public_pulse_viewed', id) }).catch((e) => setError(e.message)) }, [id])
  function primary(optionId: string) { setSelected(optionId); void api.event('response_started', id); if (pulse?.followUp) setStage('follow'); else if (pulse?.allowUpdates) setStage('email'); else void finish(optionId) }
  function chooseFollow(optionId: string) { setFollow(optionId); if (pulse?.allowUpdates) setStage('email'); else void finish(selected, optionId) }
  async function finish(optionId = selected, followUpOptionId = follow, submittedEmail?: string) { try { await api.respond(id, { optionId, followUpOptionId: followUpOptionId || undefined, email: submittedEmail || undefined }); setStage('done') } catch (e) { setError(e instanceof Error ? e.message : 'Could not save response') } }
  const acquisitionPath = poweredByPath(id)
  function poweredByClick() { void api.event('powered_by_clicked', id, { source: 'powered_by' }) }
  if (error && !pulse) return <main className="public-shell"><div className="public-card"><p className="error">{error}</p><Link to="/">Return home</Link></div></main>
  if (!pulse) return <main className="public-shell"><div className="public-card skeleton"><i /><i /><i /><i /></div></main>
  return <main className="public-shell"><div className="public-top"><Logo /><span>Quick question</span></div><section className="public-card">
    {stage === 'primary' && <><p className="business">{pulse.businessName} is asking</p><h1>{pulse.question}</h1><div className="answer-grid">{pulse.options.map((option) => <button key={option.id} onClick={() => primary(option.id)}>{option.label}<ArrowRight size={20} /></button>)}</div></>}
    {stage === 'follow' && pulse.followUp && <><p className="step-count">One quick follow-up</p><h1>{pulse.followUp.question}</h1><div className="answer-grid">{pulse.followUp.options.map((option) => <button key={option.id} onClick={() => chooseFollow(option.id)}>{option.label}<ArrowRight size={20} /></button>)}</div></>}
    {stage === 'email' && <><p className="step-count">Response saved next</p><h1>Want to know if this launches?</h1><p className="muted">Optional. Your email won't be shown in results.</p><form onSubmit={(e) => { e.preventDefault(); void finish(selected, follow, email) }}><label><span>Email address (optional)</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label><button className="button wide">Notify Me</button></form><button className="skip" onClick={() => void finish()}>Skip</button></>}
    {stage === 'done' && <div className="thanks"><div className="checkmark"><Check /></div><p className="eyebrow">Response received</p><h1>Thanks for helping {pulse.businessName}.</h1><div className="acquisition"><span>Have a decision of your own?</span><Link className="button" to={acquisitionPath} onClick={poweredByClick}>Create your own Pulse<ArrowRight size={18} /></Link></div></div>}
    {error && <p className="error" role="alert">{error}</p>}
  </section><Link className="powered" to={acquisitionPath} onClick={poweredByClick}>Powered by <b>Living Pulse</b></Link></main>
}

function ResultsPage() {
  const { id = '' } = useParams(); const [params] = useSearchParams(); const key = params.get('key') || ''; const [data, setData] = useState<Results | null>(null); const [error, setError] = useState(''); const [showFeedback, setShowFeedback] = useState(false); const [feedbackSent, setFeedbackSent] = useState(false)
  useEffect(() => { api.results(id, key).then((value) => { setData(value); void api.event('results_viewed', id) }).catch((e) => setError(e.message)) }, [id, key])
  async function changeStatus(status: string) { if (!data) return; await api.status(id, key, status); setData({ ...data, pulse: { ...data.pulse, status } }) }
  if (error) return <main className="results-page"><Logo /><p className="error">{error}</p></main>
  if (!data) return <main className="results-page"><Logo /><div className="results-skeleton" /></main>
  return <main className="results-page"><header><Logo /><ButtonLink to="/create" secondary>New Pulse</ButtonLink></header><section className="results-head"><div><p className="eyebrow">Declared customer interest</p><h1>{data.pulse.idea}</h1><p>{data.pulse.question}</p></div><label className="status-select"><span>Signal status</span><select value={data.pulse.status} onChange={(e) => void changeStatus(e.target.value)}>{statusOptions.map((status) => <option key={status}>{status}</option>)}</select></label></section>
    <section className="result-summary"><div className="total"><strong>{data.total}</strong><span>{data.total === 1 ? 'response' : 'responses'}</span></div><div className="bars">{data.options.map((option) => <div className="bar-row" key={option.id}><div><b>{option.label}</b><span>{option.count} · {option.percentage}%</span></div><div className="bar-track"><i style={{ transform: `scaleX(${option.percentage / 100})` }} /></div></div>)}</div></section>
    {data.total === 0 && <div className="empty"><QrCode /><h2>Your signal is waiting.</h2><p>Share the public link or QR code to collect the first response.</p><Link className="button" to={`/published/${id}?key=${key}`}>Sharing tools<ArrowRight size={18} /></Link></div>}
    {data.followUp.length > 0 && <section className="follow-results"><div><p className="eyebrow">Follow-up</p><h2>{data.pulse.followUp?.question}</h2></div><div>{data.followUp.map((option) => <p key={option.id}><span>{option.label}</span><b>{option.count}</b><em>{option.percentage}%</em></p>)}</div></section>}
    <section className="optins"><span>Requested an update</span><strong>{data.updateOptIns}</strong><small>Email addresses stay private.</small></section>
    {data.total > 0 && <section className="feedback-callout"><div><p className="eyebrow">Help validate Living Pulse</p><h2>Did this change your decision?</h2></div><button className="button secondary" onClick={() => setShowFeedback(true)}>Share feedback<ArrowRight size={18} /></button></section>}
    {showFeedback && <FeedbackModal id={id} accessKey={key} done={feedbackSent} onDone={() => setFeedbackSent(true)} onClose={() => setShowFeedback(false)} />}
  </main>
}

function FeedbackModal({ id, accessKey, done, onDone, onClose }: { id: string; accessKey: string; done: boolean; onDone: () => void; onClose: () => void }) {
  const questions = [['decision', 'What were you trying to decide?'], ['useful', 'Did these responses tell you anything useful?'], ['affectedPlan', 'Did the result affect what you planned to do?'], ['useAgain', 'Would you use Living Pulse again?'], ['worthPaying', 'What would make Living Pulse useful enough to pay for?']] as const
  const [values, setValues] = useState<Record<string, string>>({}); const [error, setError] = useState('')
  async function submit(e: React.FormEvent) { e.preventDefault(); try { await api.feedback(id, accessKey, values); onDone() } catch (err) { setError(err instanceof Error ? err.message : 'Could not save feedback') } }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title"><button className="modal-close" onClick={onClose} aria-label="Close">×</button>{done ? <div className="thanks"><div className="checkmark"><Check /></div><h2 id="feedback-title">Thanks. That helps.</h2><p>Your feedback is stored for validation analysis.</p></div> : <form onSubmit={submit}><p className="eyebrow">Five short questions</p><h2 id="feedback-title">Help us learn.</h2>{questions.map(([name, question]) => <label key={name}><span>{question}</span><textarea rows={2} required value={values[name] || ''} onChange={(e) => setValues({ ...values, [name]: e.target.value })} /></label>)}{error && <p className="error">{error}</p>}<button className="button wide">Submit feedback</button></form>}</div></div>
}

export default function App() { return <Routes><Route path="/" element={<Landing />} /><Route path="/create" element={<Create />} /><Route path="/published/:id" element={<Published />} /><Route path="/p/:id" element={<PublicPulse />} /><Route path="/results/:id" element={<ResultsPage />} /><Route path="*" element={<Landing />} /></Routes> }
