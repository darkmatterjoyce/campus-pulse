// Predicts how busy food, study, social and music venues will be, half hour by half hour from 07:00 to 23:30.
// 1) a rule-based baseline: students who are on campus but not in class spread across venues. Not every student
//    comes in (80% assumed) and only some stay late. Lunch favours food and common rooms, evenings favour study, social and music.
// 2) Gemini refines the baseline, decides how many students realistically turn up each day, and writes a short insight per half hour.
// If Gemini is unavailable, the baseline is used.
import { GoogleGenAI } from '@google/genai';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export const SLOTS = Array.from({ length: 34 }, (_, i) => `${String(7 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const toMin = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const ATTEND = 0.8; // share of a cohort that comes in on a normal day
// Share of attendees still on campus after their last class: about half just after it ends, plus a few who stay to study.
// The "stay to study" share is about 20% until 18:00, then falls to about 1% by 23:00.
const lateShare = m => m < 1080 ? 0.2 : Math.max(0.01, 0.2 * Math.exp(-(m - 1080) / 120));
const stayShare = (m, lastEnd) => 0.5 * Math.exp(-(m - lastEnd) / 40) + lateShare(m);
const SHARES = { // share of the free students who are at each kind of venue during one half hour
  morning: { food: .06, social: .08, study: .3, music: .02 }, lunch: { food: .18, social: .1, study: .12, music: .02 },
  afternoon: { food: .06, social: .1, study: .32, music: .03 }, evening: { food: .04, social: .12, study: .22, music: .05 },
};
const period = m => m < 690 ? 'morning' : m < 870 ? 'lunch' : m < 1050 ? 'afternoon' : 'evening';

export function baseline(venues, events) {
  const W = {}; for (const v of venues) W[v.type] = (W[v.type] || 0) + v.weight;
  return [1, 2, 3, 4, 5].map(dow => {
    const day = events.filter(e => e.dow === dow), cohorts = new Map();
    for (const e of day) {
      const c = cohorts.get(e.course_id) || { name: e.course, size: e.cohort_size, first: 99, last: 0 };
      c.first = Math.min(c.first, e.start); c.last = Math.max(c.last, e.end); cohorts.set(e.course_id, c);
    }
    return SLOTS.map(t => {
      const m = toMin(t), now = day.filter(e => e.start * 60 <= m && m < e.end * 60), busyIds = new Set(now.map(e => e.course_id)), free = [];
      for (const [id, c] of cohorts) {
        if (busyIds.has(id)) continue;
        let n = 0, late = false;
        if (m >= (c.first - 1) * 60 && m < c.last * 60) n = c.size * ATTEND; // between classes (or arriving early)
        else if (m >= c.last * 60) { n = c.size * ATTEND * stayShare(m, c.last * 60); late = true; } // finished for the day, staying on
        if (n >= 1) free.push({ name: c.name, size: Math.round(n), late });
      }
      const F = free.reduce((s, c) => s + c.size, 0), share = SHARES[period(m)];
      return { t, inClass: now.reduce((s, e) => s + e.size, 0), free, F,
               base: venues.map(v => W[v.type] ? Math.round((1 - Math.exp(-(F * share[v.type] * v.weight / W[v.type]) / v.capacity)) * 100) / 100 : 0) }; // soft saturation: 1.0 only when demand is far above capacity
    });
  });
}

export async function withRetry(fn, waits = [5000, 15000, 30000]) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = String(e.message), daily = /PerDay|free_tier_requests|exceeded your current quota/i.test(msg); // a daily quota will not clear in seconds
      const temporary = !daily && /503|429|UNAVAILABLE|overloaded|high demand|fetch failed/i.test(msg);
      if (!temporary || i >= waits.length) throw e;
      await new Promise(r => setTimeout(r, waits[i]));
    }
  }
}

async function askGemini(ai, dayName, venues, slots) {
  const data = slots.map(s => ({ t: s.t, studentsInClass: s.inClass,
    freeOnCampus: [...s.free].sort((a, b) => b.size - a.size).slice(0, 8).map(c => `${c.name} (${c.size}${c.late ? ', finished for the day and staying on' : ''})`), baseline: s.base.map(x => Math.round(x * 100)) }));
  const prompt = [
    `You are forecasting how busy venues around a university campus (Imperial College London, made-up demo data) will be on ${dayName}, from 07:00 to 23:30.`,
    'Venues, in order:', venues.map((v, i) => `${i}: ${v.name} (${v.type}, ${v.campus ? 'on campus' : 'off campus'}, capacity ${v.capacity})`).join('\n'), '',
    'Below is one entry per half-hour slot: students currently in class, the course groups that are on campus without a class (name and number expected; "finished for the day and staying on" means they have no more classes but are still around), and a rule-based baseline busyness for each venue in the same order, as an integer percent of capacity.',
    'Important: not every student plans to come to campus. The baseline assumes about 80% of each course group turn up, that around half are still on campus just after their last class, and that only a small share stay late (about 20% until 18:00, falling to about 1% by 23:00). Decide whether that fits this day (attendance is usually lower on Fridays and in the evening, and some students skip, work from home or are ill) and adjust the venues to match.',
    'Teaching finishes by about 19:00, so after that no classes run and nobody is "free between classes". For the note on those slots, say that teaching has finished and that only a small number of students are staying on (library, social spaces, music rooms); never describe year groups as free after 19:00. Keep the numbers low late at night (very few people after 22:00).',
    'Students do stay late: the library, social spaces and music rooms stay busy into the evening, while cafes and restaurants quieten after 18:00 except pubs and bars. When several large groups are free at once, especially 12:00 to 14:00, cafes, restaurants and the common rooms (JCR and SCR) fill up. Off-campus venues get fewer students than campus ones, and quiet study places stay calm. Keep clear differences between venues.',
    'For each slot write one short sentence ("note") naming the groups or reasons behind the busiest venues.',
    `Reply with JSON only, no markdown: {"attendance":0.8,"attendanceNote":"one sentence on why you chose this attendance","slots":[{"t":"07:00","note":"...","busy":[integers from 0 to 100]}]}. Return every slot in order, and each busy array must have exactly ${venues.length} integers.`,
    '', JSON.stringify(data),
  ].join('\n');
  const r = await ai.models.generateContent({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash', contents: prompt,
    config: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 30000 } });
  return JSON.parse(r.text.replace(/^```(?:json)?|```$/g, '').trim());
}

const top = (list, n = 3) => [...list].sort((a, b) => b.size - a.size).slice(0, n).map(c => c.name).join(', ');
const fallbackNote = s => {
  const between = s.free.filter(c => !c.late), late = s.free.filter(c => c.late);
  const a = between.reduce((t, c) => t + c.size, 0), b = late.reduce((t, c) => t + c.size, 0), parts = [];
  if (between.length) parts.push(`about ${a} students from ${between.length} course groups are between classes, including ${top(between)}`);
  if (late.length && b >= 1) parts.push(`about ${b} students are staying on after their last class, mostly ${top(late, 2)}`);
  return parts.length ? parts.join('; ') + '.' : 'Very few students are on campus.';
};

export async function predictAll(venues, events) {
  const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
  const base = baseline(venues, events), rows = [], notes = [], days = []; let aiSlots = 0;
  if (ai) console.log('Asking Gemini to predict Monday to Friday (this takes a minute or two)...');
  const answers = await Promise.all(DAYS.map(async (name, d) => {
    if (!ai) return null;
    try { return await withRetry(() => askGemini(ai, name, venues, base[d])); }
    catch (e) { console.warn(`Gemini failed for ${name} (${e.message}). Using the rule-based estimate.`); return null; }
  }));
  DAYS.forEach((name, d) => {
    const a = answers[d], slots = Array.isArray(a?.slots) ? a.slots : [];
    // If the model answered with fractions (0.35) instead of percentages (35), scale them up.
    const frac = slots.length > 0 && slots.every(x => Array.isArray(x.busy) && x.busy.every(v => v <= 1)) && slots.some(x => x.busy.some(v => v > 0 && v < 1));
    let good = 0;
    for (const s of base[d]) {
      const g = slots.find(x => x.t === s.t);
      const ok = g && Array.isArray(g.busy) && g.busy.length === venues.length && g.busy.every(v => typeof v === 'number' && isFinite(v));
      const busy = ok ? g.busy.map(v => frac ? v : v / 100) : s.base, src = ok ? 'gemini' : 'baseline';
      if (ok) { aiSlots++; good++; }
      venues.forEach((v, i) => rows.push([d + 1, s.t, v.id, Math.max(0, Math.min(1, busy[i])), src]));
      notes.push([d + 1, s.t, (ok && g.note) || fallbackNote(s), src]);
    }
    const att = typeof a?.attendance === 'number' ? Math.max(0.3, Math.min(1, a.attendance)) : ATTEND;
    days.push([d + 1, att, (good && a.attendanceNote) || 'Assumes about 80% of students come in, and only a few stay late.', good ? 'gemini' : 'baseline']);
  });
  return { rows, notes, days, aiSlots };
}
