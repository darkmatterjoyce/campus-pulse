// The incident agent. It keeps a list of assumptions about campus and revises them, together with the heat map, routes
// and suggestions built on them, when reports or automatic feeds (weather) say otherwise. Everything it believes, sees and
// changes is logged here. Reports from several people raise its confidence; fixed-reports and time close them again.
const pct = v => Math.round(v * 100);
const clamp = v => Math.max(0, Math.min(1, v));
const OUTDOOR = ["Queen's Lawn", 'Beit Quad'];
const HOURS = 3600000;

export const world = {
  liftOut: new Set(), closed: new Set(), cancelled: new Set(), access: new Set(), noisy: new Set(),
  surge: new Map(), bias: new Map(), amenityOut: new Map(), flags: new Map(), rain: false,
};
const ledger0 = () => [
  { id: 'attend', text: 'About 80% of each course group comes to campus', conf: 0.7 },
  { id: 'timetable', text: 'Classes run as timetabled', conf: 0.9 },
  { id: 'lifts', text: 'Lifts are working', conf: 0.95 },
  { id: 'access', text: 'Entrances and paths are open and step-free', conf: 0.95 },
  { id: 'open', text: 'Places are open when expected', conf: 0.9 },
  { id: 'amenities', text: 'Microwaves, printers and water refills work', conf: 0.9 },
  { id: 'weather', text: 'It is dry, so outdoor spaces are usable', conf: 0.9 },
  { id: 'predict', text: 'Busyness predictions are right to within about 15%', conf: 0.7 },
];
export const state = { episodes: [], timeline: [], ledger: ledger0(), seq: 1, weather: { ok: null } };

// What people can report. target: what kind of place it applies to ('any' = any known place, null = nowhere in particular).
export const TYPES = {
  lift_out: { label: 'Lift not working', sev: 2, ledger: 'lifts', ttl: 12 },
  access: { label: 'Entrance or path blocked', sev: 2, ledger: 'access', ttl: 12 },
  closed: { label: 'Closed or locked', sev: 3, ledger: 'open', ttl: 6 },
  alarm: { label: 'Fire alarm or evacuation', sev: 1, ledger: 'open', ttl: 2 },
  cancel: { label: 'Classes cancelled', sev: 3, ledger: 'timetable', ttl: 8 },
  event: { label: 'Event or long queue', sev: 3, ledger: 'predict', ttl: 4 },
  crowd: { label: 'Busier or quieter than predicted', sev: null, ledger: 'predict', ttl: 2 },
  amenity: { label: 'Facility broken', sev: 3, ledger: 'amenities', ttl: 24 },
  noise: { label: 'Too loud to work', sev: 3, ledger: 'predict', ttl: 4 },
  other: { label: 'Something else', sev: 3, ledger: null, ttl: 6 },
  rain: { label: 'Raining', sev: 3, ledger: 'weather', ttl: 6 },
};

const near = (a, b) => Math.abs(a.lat - b.lat) < 0.0002 && Math.abs(a.lng - b.lng) < 0.0002;

// Adjust the busyness rows for everything the agent currently believes. Called by getHeat.
export function applyWorld(rows) {
  return rows.map(r => {
    let busy = r.busy, step_free = r.step_free, noise = r.noise; const flags = [...(world.flags.get(r.id) || [])];
    if (world.cancelled.has(r.id)) { busy *= 0.15; flags.push('Classes cancelled'); }
    if (world.closed.has(r.id)) { busy = 0; flags.push('Closed'); }
    if (world.access.has(r.id)) { step_free = false; flags.push('Entrance or path blocked'); }
    for (const id of world.liftOut) { const b = rows.find(x => x.id === id); if (b && (r.id === id || near(r, b))) { step_free = false; flags.push('Lift not working'); break; } }
    if (world.rain) {
      if (OUTDOOR.includes(r.name)) { busy *= 0.1; flags.push('Outdoor space, raining'); }
      else if (r.type !== 'lecture' && r.campus) busy += 0.12;
    }
    if (world.surge.has(r.id)) { busy += world.surge.get(r.id); flags.push('Event or queue'); }
    if (world.bias.has(r.id) && r.type !== 'lecture') { busy += world.bias.get(r.id); flags.push('Adjusted from reports'); }
    if (world.noisy.has(r.id)) { noise = Math.min(5, noise + 1); flags.push('Reported loud'); }
    if (world.amenityOut.has(r.id)) flags.push(`${[...world.amenityOut.get(r.id)].join(', ')} out of order`);
    return { ...r, busy: Math.round(clamp(busy) * 100) / 100, step_free, noise, flags: [...new Set(flags)], closed: world.closed.has(r.id) };
  });
}

const log = (ep, kind, text) => state.timeline.push({ t: new Date().toISOString(), ep: ep.id, kind, text });
const led = id => state.ledger.find(x => x.id === id);
function setLedger(id, conf, note, status) { const a = led(id); if (!a) return; a.was = a.was ?? a.conf; a.conf = clamp(conf); a.note = note; a.status = status; }
const confOf = ep => Math.min(0.95, 0.5 + 0.2 * (ep.reporters.length - 1));
export const confidence = confOf;

function sync() { world.rain = state.episodes.some(e => e.type === 'rain' && e.status === 'open'); }

// Look for an open report of the same kind at the same place, so repeat reports add evidence instead of duplicating.
const sameOpen = (type, targetId, extra) => state.episodes.find(e => e.type === type && e.status !== 'resolved' && e.target === targetId && (type !== 'amenity' || e.amenityKind === extra) && (type !== 'other' || e.text === extra));

function effect(ep, target) {
  const id = target?.id;
  if (ep.type === 'lift_out' && id != null) world.liftOut.add(id);
  if (ep.type === 'access' && id != null) world.access.add(id);
  if (ep.type === 'closed' && id != null) world.closed.add(id);
  if (ep.type === 'alarm' && id != null) world.closed.add(id);
  if (ep.type === 'cancel' && id != null) world.cancelled.add(id);
  if (ep.type === 'event' && id != null) world.surge.set(id, 0.4);
  if (ep.type === 'noise' && id != null) world.noisy.add(id);
  if (ep.type === 'amenity' && id != null) { const s = world.amenityOut.get(id) || new Set(); s.add(ep.amenityKind); world.amenityOut.set(id, s); }
  if (ep.type === 'crowd' && id != null) { ep.predicted = target.busy; world.bias.set(id, Math.max(-1, Math.min(1, (world.bias.get(id) ?? 0) + 0.7 * (ep.level - target.busy)))); }
  if (ep.type === 'other') { const l = world.flags.get(id) || []; l.push(ep.label); if (id != null) world.flags.set(id, l); }
  sync();
}

// Record a report. Returns { ep, merged }. `target` is a getHeat() row or null.
export function report({ type, target, level, amenityKind, text, sid, source = 'user' }) {
  const T = TYPES[type]; if (!T) throw new Error('Unknown kind of problem.');
  const extra = type === 'amenity' ? amenityKind : type === 'other' ? text : undefined;
  const dup = type !== 'crowd' && sameOpen(type, target?.id ?? null, extra);
  if (dup) {
    if (!dup.reporters.includes(sid)) { dup.reporters.push(sid); const L = TYPES[type].ledger && led(TYPES[type].ledger); if (L && type !== 'crowd') L.conf = clamp((L.was ?? L.conf) * (1 - confOf(dup))); log(dup, 'evidence', `${dup.reporters.length} people now report this${dup.targetName ? ' at ' + dup.targetName : ''}.`); }
    return { ep: dup, merged: true };
  }
  const label = type === 'other' ? (text || 'Reported problem').slice(0, 80) : T.label;
  const ep = { id: state.seq++, type, label, sev: T.sev, target: target?.id ?? null, targetName: target?.name ?? null, status: type === 'crowd' ? 'learned' : 'open',
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + T.ttl * HOURS).toISOString(), reporters: [sid || 'anon'], confirmers: [], fixed: [], source, level, amenityKind, text };
  effect(ep, target);
  return { ep, merged: false };
}

// Fill in what the agent believed, saw, concluded and did. before/after are getHeat() rows.
export function finish(ep, before, after, sessions) {
  const t = ep.target != null ? before.find(r => r.id === ep.target) : null, tn = ep.targetName || 'this place';
  const moved = after.map(a => ({ a, b: before.find(r => r.id === a.id) })).filter(x => x.b && Math.abs(x.a.busy - x.b.busy) >= 0.08 && x.a.id !== ep.target)
    .sort((x, y) => Math.abs(y.a.busy - y.b.busy) - Math.abs(x.a.busy - x.b.busy)).slice(0, 3);
  const shifts = moved.map(({ a, b }) => `${a.name} ${b.busy < a.busy ? 'up' : 'down'} from ${pct(b.busy)}% to ${pct(a.busy)}%`);
  const lostSF = after.filter(a => a.step_free === false && before.find(r => r.id === a.id)?.step_free).length;
  const who = ep.source === 'auto' ? 'The weather service' : 'A student';
  const actions = [], T = TYPES[ep.type], kind = ep.amenityKind;
  switch (ep.type) {
    case 'lift_out':
      ep.belief = `All lifts were working, so step-free routes to every floor of ${tn} were valid.`;
      ep.evidence = `${who} reports the lift in ${tn} is not working.`;
      ep.revision = `Step-free routes to upper floors of ${tn} are no longer possible, and ${lostSF} place${lostSF === 1 ? '' : 's'} there lost the step-free tag.`;
      actions.push('Blocked the lift in step-free routing', 'Removed affected places from step-free suggestions'); break;
    case 'access':
      ep.belief = `${tn} was open and step-free.`;
      ep.evidence = `${who} reports an entrance or path at ${tn} is blocked.`;
      ep.revision = `${tn} is no longer counted as step-free, so step-free suggestions avoid it.`;
      actions.push('Removed it from step-free suggestions', 'Flagged it on the map'); break;
    case 'closed':
      ep.belief = `${tn} was open (${pct(t?.busy ?? 0)}% busy).`;
      ep.evidence = `${who} reports ${tn} is closed or locked.`;
      ep.revision = `${tn} is treated as closed and empty, and people are expected to move to nearby places.${shifts.length ? ' ' + shifts.join('; ') + '.' : ''}`;
      actions.push('Marked it closed', 'Removed it from recommendations'); break;
    case 'alarm':
      ep.belief = `${tn} was open and in use (${pct(t?.busy ?? 0)}% busy).`;
      ep.evidence = `${who} reports a fire alarm in ${tn}. The building is being evacuated.`;
      ep.revision = `${tn} is treated as closed and empty. People will gather outside and in nearby spaces.${shifts.length ? ' ' + shifts.join('; ') + '.' : ''}`;
      actions.push('Marked the building closed', 'Removed it from recommendations'); break;
    case 'cancel':
      ep.belief = `${tn} was running its timetabled classes, about ${t?.timetable ?? 0} students expected.`;
      ep.evidence = `${who} reports classes in ${tn} are cancelled.`;
      ep.revision = `${tn} drops to about ${pct(after.find(r => r.id === ep.target)?.busy ?? 0)}% busy. Students who would have been there are free, so nearby food and study spaces may fill.`;
      actions.push('Cleared the timetable load for the building'); break;
    case 'event':
      ep.belief = `${tn} was expected to be ${pct(t?.busy ?? 0)}% busy from the usual pattern.`;
      ep.evidence = `${who} reports an event or long queue at ${tn}.`;
      ep.revision = `${tn} is now expected to be much busier, about ${pct(after.find(r => r.id === ep.target)?.busy ?? 0)}%. Quieter alternatives are ranked higher.`;
      actions.push('Raised the expected crowd', 'Ranked quieter places higher'); break;
    case 'noise':
      ep.belief = `${tn} was rated ${t?.noise ?? '?'} out of 5 for noise.`;
      ep.evidence = `${who} reports ${tn} is too loud to work.`;
      ep.revision = `${tn} is rated one point louder for now, so quiet-space suggestions rank it lower.`;
      actions.push('Raised its noise rating', 'Ranked it lower for quiet study'); break;
    case 'amenity':
      ep.belief = `${tn} was expected to have a working ${kind}.`;
      ep.evidence = `${who} reports the ${kind} at ${tn} is broken or unavailable.`;
      ep.revision = `${tn} is no longer suggested for ${kind} questions until someone says it works again.`;
      actions.push(`Marked the ${kind} at ${tn} as out of order`, 'Ask AI skips it for this'); break;
    case 'rain':
      ep.belief = `It was dry, so ${OUTDOOR.join(' and ')} counted as normal places to sit and meet.`;
      ep.evidence = ep.source === 'auto' ? `The weather service shows rain over campus${state.weather.precip != null ? ` (${state.weather.precip} mm)` : ''}.` : 'Rain was simulated for the demo.';
      ep.revision = `Outdoor spaces are treated as nearly empty and indoor spaces get busier.${shifts.length ? ' ' + shifts.join('; ') + '.' : ''}`;
      actions.push('Moved crowds from outdoor to indoor spaces', 'Ranked indoor spaces higher'); break;
    case 'crowd': {
      const b = ep.predicted ?? 0, err = ep.level - b;
      ep.belief = `${tn} was predicted at ${pct(b)}% busy.`;
      ep.evidence = `${who} reports ${tn} is ${pct(ep.level)}% busy.`;
      ep.revision = Math.abs(err) < 0.1 ? 'The report agrees with the prediction, so confidence is unchanged.'
        : `The prediction was off by ${pct(Math.abs(err))} points. The agent now adjusts ${tn} ${err > 0 ? 'upwards' : 'downwards'} and trusts predictions a little less.`;
      actions.push(`Adjusted ${tn} from ${pct(b)}% to ${pct(after.find(r => r.id === ep.target)?.busy ?? b)}%`);
      setLedger('predict', led('predict').conf - Math.min(0.25, Math.abs(err) * 0.5), `${tn}: predicted ${pct(b)}%, reported ${pct(ep.level)}%`, Math.abs(err) < 0.1 ? 'holding' : 'revised');
      break;
    }
    default:
      ep.belief = `Nothing unusual was known about ${tn}.`;
      ep.evidence = `${who} reports: "${ep.text}"`;
      ep.revision = `This isn't a problem I have an automatic fix for. I've flagged ${tn} on the map, I'll mention it when people ask about it, and I'll ask others nearby to confirm.`;
      actions.push(`Flagged ${tn}`, 'Passed the report to Ask AI as context'); break;
  }
  if (T.ledger && ep.type !== 'crowd') setLedger(T.ledger, (led(T.ledger).was ?? led(T.ledger).conf) * (1 - confOf(ep)), ep.source === 'auto' ? 'Detected automatically' : `Reported at ${tn}`, 'revised');
  if (sessions?.n && ['lift_out', 'alarm', 'closed', 'cancel'].includes(ep.type)) actions.push(`Flagged ${sessions.n} session${sessions.n === 1 ? '' : 's'} today in ${tn}${sessions.courses.length ? ` (${sessions.courses.slice(0, 3).join(', ')})` : ''} on affected timetables`);
  if (ep.type !== 'crowd') actions.push('Re-ranked lunch, study and Ask AI answers');
  ep.actions = actions;
  ep.update = ep.type === 'crowd' ? ep.revision : `${ep.label}${ep.targetName ? ' at ' + ep.targetName : ''}. ${ep.revision} We'll update this when it is resolved.`;
  log(ep, 'belief', ep.belief); log(ep, 'evidence', ep.evidence); log(ep, 'revision', ep.revision); actions.forEach(a => log(ep, 'action', a));
  state.episodes.unshift(ep); sync();
  return ep;
}

function lift(ep) {
  const id = ep.target;
  if (ep.type === 'lift_out') world.liftOut.delete(id);
  if (ep.type === 'access') world.access.delete(id);
  if (ep.type === 'closed' || ep.type === 'alarm') { if (!state.episodes.some(e => e !== ep && e.status === 'open' && ['closed', 'alarm'].includes(e.type) && e.target === id)) world.closed.delete(id); }
  if (ep.type === 'cancel') world.cancelled.delete(id);
  if (ep.type === 'event') world.surge.delete(id);
  if (ep.type === 'noise') world.noisy.delete(id);
  if (ep.type === 'crowd') world.bias.delete(id);
  if (ep.type === 'amenity') { const s = world.amenityOut.get(id); if (s) { s.delete(ep.amenityKind); if (!s.size) world.amenityOut.delete(id); } }
  if (ep.type === 'other') { const l = (world.flags.get(id) || []).filter(x => x !== ep.label); if (l.length) world.flags.set(id, l); else world.flags.delete(id); }
}

export function resolve(id, why = 'Closed') {
  const ep = state.episodes.find(e => e.id === id);
  if (!ep || ep.status === 'resolved') throw new Error('That issue is already closed.');
  lift(ep); ep.status = 'resolved'; ep.resolvedAt = new Date().toISOString(); sync();
  const T = TYPES[ep.type], a = T.ledger && led(T.ledger);
  if (a && !state.episodes.some(e => e.status === 'open' && TYPES[e.type].ledger === T.ledger)) { a.was = a.conf; a.conf = Math.min(0.9, Math.max(a.conf, 0.85)); a.note = 'Restored after the issue closed'; a.status = 'restored'; }
  log(ep, 'closed', `${why}: ${ep.label}${ep.targetName ? ', ' + ep.targetName : ''}. Normal predictions and routes restored.`);
  return ep;
}

// "I see this too" / "It's fixed". Two fixed-votes (or the only reporter saying so) close it.
export function vote(id, kind, sid) {
  const ep = state.episodes.find(e => e.id === id);
  if (!ep || ep.status === 'resolved') throw new Error('That issue is already closed.');
  sid = sid || 'anon';
  if (kind === 'confirm') {
    if (ep.reporters.includes(sid) || ep.confirmers.includes(sid)) throw new Error('You have already reported this.');
    ep.confirmers.push(sid); ep.reporters.push(sid);
    log(ep, 'evidence', `${ep.reporters.length} people now report this${ep.targetName ? ' at ' + ep.targetName : ''}. Confidence is ${pct(confOf(ep))}%.`);
    const T = TYPES[ep.type]; if (T.ledger && ep.type !== 'crowd') { const a = led(T.ledger); a.conf = clamp((a.was ?? a.conf) * (1 - confOf(ep))); }
    return ep;
  }
  if (ep.fixed.includes(sid)) throw new Error('You have already said this is fixed.');
  ep.fixed.push(sid);
  if (ep.fixed.length >= 2 || (ep.reporters.length === 1 && ep.reporters[0] === sid)) return resolve(id, 'Reported fixed');
  log(ep, 'evidence', 'One person says this is fixed. Waiting for a second to confirm.');
  return ep;
}

// Close anything past its time limit. Called whenever the state is read.
export function sweep() {
  const now = Date.now();
  for (const ep of state.episodes) if (ep.status !== 'resolved' && ep.source !== 'auto' && ep.expiresAt && Date.parse(ep.expiresAt) < now) resolve(ep.id, 'Expired, no new reports');
}

export const openRain = () => state.episodes.find(e => e.type === 'rain' && e.status === 'open');
export function reset() { for (const k of ['liftOut', 'closed', 'cancelled', 'access', 'noisy']) world[k].clear(); for (const k of ['surge', 'bias', 'amenityOut', 'flags']) world[k].clear(); world.rain = false; state.episodes = []; state.timeline = []; state.ledger = ledger0(); }
export const activeText = () => state.episodes.filter(e => e.status !== 'resolved' && e.type !== 'crowd').map(e => `${e.label}${e.targetName ? ' at ' + e.targetName : ''} (${e.reporters.length} report${e.reporters.length === 1 ? '' : 's'}${e.reporters.length < 2 ? ', unconfirmed' : ''})`);
