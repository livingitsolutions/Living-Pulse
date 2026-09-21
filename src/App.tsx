import { useEffect, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, BarChart3, Check, CircleCheck, Clipboard, Download, ExternalLink, Lightbulb, Plus, QrCode, Trash2, Users } from 'lucide-react'
import QRCode from 'qrcode'
import { api } from './api'
import { poweredByPath, preserveAttribution } from './acquisition'
import { creatorKeyFromLocation, privateResultsPath, publishedPath } from './creatorAccess'
import { statusDescriptions, statusOptions } from './lifecycle'
import { publicPulsePath, publicPulseUrl } from './publicPulse'
import type { FollowUp, PublicPulse, PulseOption, Results } from './types'
import { hasEnoughOptions } from './validation'

const newOption = (label = ''): PulseOption => ({ id: crypto.randomUUID(), label })

function usePublicPulseSharing(id: string) {
  const url = publicPulseUrl(window.location.origin, id)
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => { void QRCode.toDataURL(url, { width: 640, margin: 2, color: { dark: '#20241f', light: '#f8f5ed' } }).then(setQr) }, [url])
  async function copy() { await navigator.clipboard.writeText(url); setCopied(true); void api.event('pulse_link_copied', id); setTimeout(() => setCopied(false), 1800) }
  function download() { const link = document.createElement('a'); link.href = qr; link.download = `living-pulse-${id}.png`; link.click(); void api.event('qr_downloaded', id) }
  return { url, qr, copied, copy, download }
}

function PulseMark({ decorative = true }: { decorative?: boolean }) {
  return <svg className="pulse-mark" viewBox="0 0 36 36" role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : 'Living Pulse signal mark'}><path d="M2 18h6l4-9 6 18 5-14 4 5h7" /></svg>
}
function Logo() { return <Link className="logo" to="/" aria-label="Living Pulse home"><PulseMark /><span>Living Pulse</span></Link> }
function ButtonLink({ to, children, secondary = false }: { to: string; children: React.ReactNode; secondary?: boolean }) { return <Link className={secondary ? 'button secondary' : 'button'} to={to}>{children}<ArrowRight size={18} /></Link> }

function Landing() {
  useEffect(() => { void api.event('landing_viewed') }, [])
  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>('.reveal-on-scroll')
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      elements.forEach((element) => element.classList.add('is-visible'))
      return
    }
    document.documentElement.classList.add('motion-enabled')
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      })
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' })
    elements.forEach((element) => observer.observe(element))
    return () => {
      observer.disconnect()
      document.documentElement.classList.remove('motion-enabled')
    }
  }, [])
  const steps = [
    { name: 'Idea', description: "Start with something you're considering.", icon: Lightbulb },
    { name: 'Ask Customers', description: 'Turn it into one simple question.', icon: Users },
    { name: 'QR / Link', description: 'Put it wherever your customers already are.', icon: QrCode },
    { name: 'Responses', description: 'See declared demand and intent.', icon: BarChart3 },
    { name: 'Better Decision', description: 'Use the signal before you invest.', icon: CircleCheck },
  ]
  const industries = [
    ['Restaurants', 'Menu items · opening hours · delivery'], ['Retail', 'Products · variants · inventory'],
    ['Gyms', 'Classes · facilities · programs'], ['Salons', 'Services · treatments'],
    ['Real Estate', 'Unit types · locations · amenities'], ['SaaS', 'Features · integrations · pricing'],
    ['Events', 'Topics · venues · dates'],
  ]
  const faqs = [
    ['What is Living Pulse?', 'Living Pulse is a simple way to test customer interest before you invest in a new product, service, feature, schedule, location, or idea. Create a question, share it with a link or QR code, and see how people respond.'],
    ['What is a Pulse?', 'A Pulse is a simple question you share with customers to test an idea. For example, a café could ask, “Would you use Sunday delivery?” and measure the responses before deciding whether to offer it.'],
    ['Is Living Pulse a survey tool?', 'Not exactly. Living Pulse is designed for quick demand and intent testing rather than long surveys. The goal is to help you answer a specific business question before making a decision.'],
    ['Do my customers need an account to respond?', 'No. Customers can open your Pulse and respond without creating an account or logging in.'],
    ['How do I share a Pulse?', 'Each published Pulse gets a shareable link and QR code. You can put it on social media, your website, a menu, poster, counter display, email, or anywhere your customers can access it.'],
    ['What can I test with Living Pulse?', 'You can test things like a new menu item, product, service, class, feature, delivery option, opening hours, event, property preference, pricing direction, or almost any idea where customer interest could help inform your decision.'],
    ['Does a positive response guarantee customers will buy?', 'No. Living Pulse measures declared interest and intent. Responses can help inform a decision, but they do not guarantee purchases, revenue, or the success of an idea.'],
    ['Is Living Pulse free?', "Living Pulse is currently free to try while we're validating and improving the product. If paid plans are introduced later, we'll make pricing clear before charging for anything."],
  ]
  return <>
    <header className="nav landing-nav"><Logo /><nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#use-cases">Use cases</a><a href="#faq">FAQ</a></nav><ButtonLink to="/create">Create a Free Pulse</ButtonLink></header>
    <main className="landing">
      <section className="hero page-grid">
        <div className="hero-copy"><p className="eyebrow">Know before you build.</p><h1>Stop guessing<br />what your<br />customers<br />want.</h1><p className="lede">Test your next product, service, feature, or idea with real customers in minutes. Share a link or QR code. See declared demand and intent before you invest.</p><ButtonLink to="/create">Create a Free Pulse</ButtonLink><ul className="reassurance" aria-label="What to expect"><li>No login required</li><li>Takes about a minute</li><li>Free to try</li></ul></div>
        <div className="demo-wrap"><div className="coral-orbit" aria-hidden="true" /><div className="demo-card" aria-label="Illustrative example Pulse"><p className="small-label">Antonio's Café</p><h2>Would you use<br />Sunday delivery?</h2>{[['Definitely', 47], ['Probably', 31], ['Maybe', 17], ['No', 5]].map(([answer, value]) => <div className="demo-answer" key={answer}><i aria-hidden="true" style={{ '--demo-width': `${value}%` } as React.CSSProperties} /><span>{answer}</span><b>{value}%</b></div>)}<p className="demo-note">Illustrative example — not live customer data</p></div><div className="annotation" aria-hidden="true"><span>Turn uncertainty<br />into clarity.</span><svg viewBox="0 0 100 80"><path d="M88 4c-3 33-22 54-63 63" /><path d="m35 55-12 13 18 4" /></svg></div><div className="decision-badge"><Users aria-hidden="true" /><span>Built to help businesses<br />make better decisions.</span></div></div>
      </section>
      <section className="thinking reveal-on-scroll" id="how-it-works"><div><p className="eyebrow">How it works</p><blockquote>“Should we offer<br />Sunday delivery?”</blockquote></div><ol className="flow">{steps.map(({ name, description, icon: Icon }, i) => <li key={name}><span>0{i + 1}</span><Icon aria-hidden="true" /><b>{name}</b><p>{description}</p></li>)}</ol></section>
      <section className="uses reveal-on-scroll" id="use-cases"><div><p className="eyebrow">Built for everyday decisions</p><h2>Every business has a decision worth testing.</h2></div><div className="industry-list">{industries.map(([name, example], i) => <span key={name}><b>{String(i + 1).padStart(2, '0')}</b><strong>{name}</strong><em>{example}</em></span>)}</div></section>
      <section className="faq reveal-on-scroll" id="faq"><div className="faq-inner"><div className="faq-heading"><p className="eyebrow">FAQ</p><h2>Questions before<br />your first Pulse.</h2></div><div className="faq-list">{faqs.map(([question, answer]) => <details key={question}><summary><span>{question}</span><i aria-hidden="true" /></summary><p>{answer}</p></details>)}</div></div></section>
      <section className="bottom-cta reveal-on-scroll"><div><p>Ask before you invest.</p><ButtonLink to="/create">Create a Free Pulse</ButtonLink></div></section>
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
  async function submit(e: React.FormEvent) { e.preventDefault(); setError(''); if (!hasEnoughOptions(options)) return setError('Add at least two response options.'); if (hasFollowUp && !hasEnoughOptions(followOptions)) return setError('Add at least two follow-up options.'); setSaving(true); try { const followUp: FollowUp | null = hasFollowUp ? { question: followQuestion, options: followOptions } : null; const pulse = await api.create({ businessName, idea, question, options, followUp, allowUpdates }, acquisition); navigate(publishedPath(pulse.id, pulse.creatorKey || '')) } catch (err) { setError(err instanceof Error ? err.message : 'Could not create Pulse') } finally { setSaving(false) } }
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
  const { id = '' } = useParams(); const key = creatorKeyFromLocation(window.location.search, window.location.hash); const sharing = usePublicPulseSharing(id); const [resultsCopied, setResultsCopied] = useState(false)
  const resultsPath = privateResultsPath(id, key)
  const resultsUrl = `${window.location.origin}${resultsPath}`
  async function copyResults() { await navigator.clipboard.writeText(resultsUrl); setResultsCopied(true); setTimeout(() => setResultsCopied(false), 1800) }
  return <main className="success-page"><Logo /><header className="success-heading"><p className="eyebrow">Published</p><h1>Your Pulse is Live</h1></header><section className="publish-section public-share"><div><h2>Share with customers</h2><p>Anyone with this link can respond to your Pulse.</p><div className="link-box public-link"><span>{sharing.url}</span><button onClick={() => void sharing.copy()}>{sharing.copied ? <Check /> : <Clipboard />}<b>{sharing.copied ? 'Copied' : 'Copy Pulse Link'}</b></button></div><div className="action-row"><button className="button" onClick={sharing.download} disabled={!sharing.qr}><Download size={18} />Download QR</button><Link className="button secondary" to={publicPulsePath(id)} target="_blank">View Public Pulse<ExternalLink size={17} /></Link></div></div><div className="qr-frame">{sharing.qr ? <img src={sharing.qr} alt="QR code for public Pulse" /> : <div className="qr-loading"><QrCode /></div>}<span>Scan to answer</span></div></section><section className="publish-section results-access"><div><h2>Your results</h2><p>See responses as they come in.</p><Link className="button" to={resultsPath}>View Results<ArrowRight size={18} /></Link></div><div className="private-return"><h3>Save your private results link</h3><p>You'll need this private link to return to your results later. Keep it somewhere safe.</p><button className="button secondary" onClick={() => void copyResults()}>{resultsCopied ? <Check size={18} /> : <Clipboard size={18} />}{resultsCopied ? 'Copied' : 'Copy Results Link'}</button><small>Anyone with this private link can access your results. Don't share it publicly.</small></div></section></main>
}

function PublicPulse() {
  const { id = '' } = useParams(); const [pulse, setPulse] = useState<PublicPulse | null>(null); const [selected, setSelected] = useState(''); const [follow, setFollow] = useState(''); const [stage, setStage] = useState<'primary' | 'follow' | 'email' | 'done'>('primary'); const [email, setEmail] = useState(''); const [error, setError] = useState('')
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
  const { id = '' } = useParams(); const key = creatorKeyFromLocation(window.location.search, window.location.hash); const sharing = usePublicPulseSharing(id); const [data, setData] = useState<Results | null>(null); const [error, setError] = useState(''); const [statusError, setStatusError] = useState(''); const [showFeedback, setShowFeedback] = useState(false); const [feedbackSent, setFeedbackSent] = useState(false); const [copied, setCopied] = useState(false)
  useEffect(() => { api.results(id, key).then((value) => { setData(value); void api.event('results_viewed', id) }).catch((e) => setError(e.message)) }, [id, key])
  async function changeStatus(status: string) { if (!data) return; const previous = data.pulse.status; setStatusError(''); setData({ ...data, pulse: { ...data.pulse, status } }); try { await api.status(id, key, status) } catch (err) { setData((current) => current ? { ...current, pulse: { ...current.pulse, status: previous } } : current); setStatusError(err instanceof Error ? err.message : 'Could not save status') } }
  async function copyResultsLink() { await navigator.clipboard.writeText(`${window.location.origin}${privateResultsPath(id, key)}`); setCopied(true); setTimeout(() => setCopied(false), 1800) }
  if (error) return <main className="results-page"><Logo /><p className="error">{error}</p></main>
  if (!data) return <main className="results-page"><Logo /><div className="results-skeleton" /></main>
  return <main className="results-page"><header><Logo /><div className="results-actions"><button className="button secondary" onClick={() => void copyResultsLink()}>{copied ? <Check size={18} /> : <Clipboard size={18} />}{copied ? 'Copied' : 'Copy Results Link'}</button><ButtonLink to="/create" secondary>New Pulse</ButtonLink></div></header><section className="results-head"><div><p className="eyebrow">Private creator view · Declared customer interest</p><h1>{data.pulse.idea}</h1><p>{data.pulse.question}</p></div><div className="status-control"><p>Track what happens to this idea after testing.</p><label className="status-select"><span>Signal status</span><select value={data.pulse.status} onChange={(e) => void changeStatus(e.target.value)}>{statusOptions.map((status) => <option key={status}>{status}</option>)}</select></label><p className="status-description" aria-live="polite">{statusDescriptions[data.pulse.status]}</p>{statusError && <p className="error" role="alert">{statusError}</p>}</div></section>
    <section className="result-summary"><div className="total"><strong>{data.total}</strong><span>{data.total === 1 ? 'response' : 'responses'}</span></div><div className="bars">{data.options.map((option) => <div className="bar-row" key={option.id}><div><b>{option.label}</b><span>{option.count} · {option.percentage}%</span></div><div className="bar-track"><i style={{ transform: `scaleX(${option.percentage / 100})` }} /></div></div>)}</div></section>
    <section className="results-share"><div><p className="eyebrow">Public customer link</p><h2>Share this Pulse</h2><p>Want more responses? Share your Pulse with more customers.</p></div><div className="action-row"><button className="button" onClick={() => void sharing.copy()}>{sharing.copied ? <Check size={18} /> : <Clipboard size={18} />}{sharing.copied ? 'Copied' : 'Copy Pulse Link'}</button><button className="button secondary" onClick={sharing.download} disabled={!sharing.qr}><Download size={18} />Download QR</button><Link className="button secondary" to={publicPulsePath(id)} target="_blank">View Public Pulse<ExternalLink size={17} /></Link></div></section>
    {data.total === 0 && <div className="empty"><QrCode /><h2>Your signal is waiting.</h2><p>Share the public link or QR code to collect the first response.</p><Link className="button" to={publishedPath(id, key)}>Sharing tools<ArrowRight size={18} /></Link></div>}
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
