import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, type FieldErrors } from './api';
import ConfirmDialog from './ConfirmDialog';
import { copyText } from './clipboard';
import { FORMAT_LABEL, ScriptStatusPill } from './scriptLabels';
import type { AdminScript } from './types';
import { formatDate, formatNumber } from '../lib/format';
import { useSeo } from '../lib/seo';

interface JobInfo {
  id: string;
  slug: string;
  title: string;
  status: string;
  updatedAt?: string;
}

const TARGETS = {
  short: { min: 130, max: 200, text: '১৩০–২০০ শব্দ (৬০–৯০ সেকেন্ড)' },
  full: { min: 400, max: 700, text: '৪০০–৭০০ শব্দ (৩–৫ মিনিট)' },
} as const;

const WORDS_PER_MINUTE = 130;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function estimate(words: number): string {
  if (words === 0) return '—';
  const seconds = Math.round((words / WORDS_PER_MINUTE) * 60);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `প্রায় ${formatNumber(minutes)} মিনিট ${formatNumber(rest)} সেকেন্ড` : `প্রায় ${formatNumber(rest)} সেকেন্ড`;
}

export default function ScriptEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [script, setScript] = useState<AdminScript | null>(null);
  const [job, setJob] = useState<JobInfo | null>(null);
  const [title, setTitle] = useState('');
  const [aiTool, setAiTool] = useState('');
  const [content, setContent] = useState('');
  const [baseline, setBaseline] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useSeo({ title: 'স্ক্রিপ্ট — অ্যাডমিন', description: 'ইউটিউব স্ক্রিপ্ট সম্পাদনা', path: '/admin/scripts/edit', noindex: true });

  function applyScript(next: AdminScript) {
    setScript(next);
    setTitle(next.title);
    setAiTool(next.aiTool);
    setContent(next.content ?? '');
    setBaseline(JSON.stringify([next.title, next.aiTool, next.content ?? '']));
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    api<{ script: AdminScript; job: JobInfo | null }>('GET', `/api/admin/scripts/${id}`)
      .then((response) => {
        if (!active) return;
        applyScript(response.script);
        setJob(response.job);
      })
      .catch((caught: unknown) => active && setBanner({ kind: 'error', text: caught instanceof ApiError ? caught.message : 'স্ক্রিপ্ট লোড করা যায়নি।' }))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  const dirty = script !== null && JSON.stringify([title, aiTool, content]) !== baseline;

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const words = useMemo(() => countWords(content), [content]);
  const stale = Boolean(script?.promptGeneratedAt && job?.updatedAt && new Date(job.updatedAt) > new Date(script.promptGeneratedAt));

  async function copy(kind: 'prompt' | 'content') {
    const text = kind === 'prompt' ? script?.prompt ?? '' : content;
    if (!text.trim()) return;
    const ok = await copyText(text);
    setBanner(ok ? { kind: 'ok', text: kind === 'prompt' ? 'প্রম্পট কপি হয়েছে। এখন ChatGPT, Claude বা Gemini-তে পেস্ট করুন।' : 'স্ক্রিপ্ট কপি হয়েছে।' } : { kind: 'error', text: 'কপি করা যায়নি। লেখাটি নির্বাচন করে হাতে কপি করুন।' });
    if (!ok && kind === 'prompt') promptRef.current?.select();
  }

  async function save(final: boolean) {
    setBusy(true);
    setErrors({});
    setBanner(null);
    try {
      const response = await api<{ script: AdminScript }>('PUT', `/api/admin/scripts/${id}`, { title, aiTool, content, final });
      applyScript(response.script);
      setBanner({ kind: 'ok', text: final ? 'স্ক্রিপ্ট চূড়ান্ত হিসেবে সংরক্ষিত হয়েছে।' : 'সংরক্ষিত হয়েছে।' });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setErrors(caught.details);
        setBanner({ kind: 'error', text: caught.message });
      } else {
        setBanner({ kind: 'error', text: 'সংরক্ষণ করা যায়নি।' });
      }
    } finally {
      setBusy(false);
    }
  }

  async function refreshPrompt() {
    setBusy(true);
    setBanner(null);
    try {
      const response = await api<{ script: AdminScript }>('POST', `/api/admin/scripts/${id}/refresh-prompt`);
      // keep unsaved edits in the editor; only the prompt changes
      setScript((current) => (current ? { ...current, prompt: response.script.prompt, promptGeneratedAt: response.script.promptGeneratedAt, jobTitle: response.script.jobTitle } : current));
      setJob((current) => (current ? { ...current, updatedAt: response.script.promptGeneratedAt } : current));
      setBanner({ kind: 'ok', text: 'চাকরির সর্বশেষ তথ্য থেকে প্রম্পট হালনাগাদ হয়েছে।' });
    } catch (caught) {
      setBanner({ kind: 'error', text: caught instanceof ApiError ? caught.message : 'প্রম্পট হালনাগাদ করা যায়নি।' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api('DELETE', `/api/admin/scripts/${id}`);
      navigate('/admin/scripts', { replace: true });
    } catch (caught) {
      setConfirmDelete(false);
      setBanner({ kind: 'error', text: caught instanceof ApiError ? caught.message : 'মুছে ফেলা যায়নি।' });
      setBusy(false);
    }
  }

  if (loading) return <p className="text-slate-600">লোড হচ্ছে…</p>;
  if (!script) {
    return (
      <div>
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{banner?.text ?? 'স্ক্রিপ্ট পাওয়া যায়নি।'}</p>
        <p className="mt-4"><Link to="/admin/scripts" className="text-brand-700 hover:underline">← সব স্ক্রিপ্ট</Link></p>
      </div>
    );
  }

  const target = TARGETS[script.format];
  const outOfRange = words > 0 && (words < target.min || words > target.max);

  return (
    <div>
      <p className="text-sm"><Link to="/admin/scripts" className="text-brand-700 hover:underline">← সব স্ক্রিপ্ট</Link></p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">ইউটিউব স্ক্রিপ্ট</h1>
        <div className="flex items-center gap-2">
          <span className="badge bg-brand-50 text-brand-700">{FORMAT_LABEL[script.format]}</span>
          <ScriptStatusPill status={script.status} />
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        চাকরি:{' '}
        {job ? <Link to={`/admin/jobs/${job.id}/edit`} className="font-medium text-brand-700 hover:underline">{job.title}</Link> : <span>{script.jobTitle} (চাকরিটি আর নেই)</span>}
      </p>

      <div aria-live="polite">
        {banner && (
          <div role={banner.kind === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-lg border p-3 text-sm ${banner.kind === 'ok' ? 'border-accent-100 bg-accent-50 text-accent-700' : 'border-red-200 bg-red-50 text-red-800'}`}>
            {banner.text}
          </div>
        )}
      </div>

      <section className="card mt-6 space-y-3 p-5" aria-labelledby="step1">
        <h2 id="step1" className="text-lg font-bold text-slate-900">ধাপ ১: প্রম্পট কপি করুন</h2>
        <p className="text-sm text-slate-600">
          প্রম্পটটি কপি করে ChatGPT, Claude, Gemini বা অন্য কোনো AI সহকারীতে পেস্ট করুন। এই অ্যাপ নিজে কোনো AI স্ক্রিপ্ট তৈরি করে না।
        </p>
        {stale && (
          <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            প্রম্পট তৈরির পর চাকরির তথ্য বদলেছে। সর্বশেষ তথ্য নিতে "প্রম্পট হালনাগাদ করুন" চাপুন।
          </div>
        )}
        <label htmlFor="prompt" className="sr-only">AI প্রম্পট</label>
        <textarea id="prompt" ref={promptRef} readOnly value={script.prompt ?? ''} className="input min-h-[260px] font-mono text-xs leading-relaxed" onFocus={(e) => e.currentTarget.select()} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" onClick={() => copy('prompt')}>প্রম্পট কপি করুন</button>
          <button type="button" className="btn btn-outline" onClick={refreshPrompt} disabled={busy || !job}>প্রম্পট হালনাগাদ করুন</button>
          {script.promptGeneratedAt && <span className="text-xs text-slate-500">তৈরি/হালনাগাদ: {formatDate(script.promptGeneratedAt.slice(0, 10))}</span>}
        </div>
      </section>

      <section className="card mt-6 space-y-4 p-5" aria-labelledby="step2">
        <h2 id="step2" className="text-lg font-bold text-slate-900">ধাপ ২: AI-এর স্ক্রিপ্ট এখানে পেস্ট করুন</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="script-title" className="mb-1 block text-sm font-medium text-slate-700">স্ক্রিপ্টের শিরোনাম (ঐচ্ছিক)</label>
            <input id="script-title" className="input" value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
            {errors.title && <p className="mt-1 text-xs font-medium text-red-700">{errors.title}</p>}
          </div>
          <div>
            <label htmlFor="script-tool" className="mb-1 block text-sm font-medium text-slate-700">কোন AI ব্যবহার করেছেন (ঐচ্ছিক)</label>
            <input id="script-tool" className="input" value={aiTool} maxLength={60} placeholder="যেমন: ChatGPT, Claude, Gemini" onChange={(e) => setAiTool(e.target.value)} />
            {errors.aiTool && <p className="mt-1 text-xs font-medium text-red-700">{errors.aiTool}</p>}
          </div>
        </div>
        <div>
          <label htmlFor="script-content" className="mb-1 block text-sm font-medium text-slate-700">স্ক্রিপ্ট</label>
          <textarea id="script-content" className="input min-h-[300px]" value={content} maxLength={20000} onChange={(e) => setContent(e.target.value)} />
          {errors.content && <p className="mt-1 text-xs font-medium text-red-700">{errors.content}</p>}
          <p className="mt-1 text-xs text-slate-500">
            শব্দ: {formatNumber(words)} · আনুমানিক সময়: {estimate(words)} · লক্ষ্য: {target.text}
            {outOfRange && <span className="font-medium text-amber-700"> — লক্ষ্যের বাইরে</span>}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          প্রকাশের আগে স্ক্রিপ্টের নাম, তারিখ, পদসংখ্যা, ফি ও লিংক অফিসিয়াল বিজ্ঞপ্তির সাথে মিলিয়ে নিন। AI ভুল বা বানানো তথ্য দিতে পারে।
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-outline" onClick={() => save(false)} disabled={busy}>{busy ? 'সংরক্ষণ হচ্ছে…' : 'খসড়া সংরক্ষণ'}</button>
          <button type="button" className="btn btn-accent" onClick={() => save(true)} disabled={busy || !content.trim()}>চূড়ান্ত হিসেবে সংরক্ষণ</button>
          <button type="button" className="btn btn-outline" onClick={() => copy('content')} disabled={!content.trim()}>স্ক্রিপ্ট কপি করুন</button>
          {dirty && <span className="text-sm font-medium text-amber-700">সংরক্ষণহীন পরিবর্তন আছে</span>}
          <button type="button" className="btn btn-outline ml-auto !text-red-700" onClick={() => setConfirmDelete(true)} disabled={busy}>মুছুন</button>
        </div>
      </section>

      <ConfirmDialog open={confirmDelete} title="স্ক্রিপ্ট মুছে ফেলবেন?" message="প্রম্পট ও পেস্ট করা স্ক্রিপ্ট স্থায়ীভাবে মুছে যাবে।" confirmLabel="হ্যাঁ, মুছে ফেলুন" busy={busy} onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
    </div>
  );
}
