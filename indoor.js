// Demo indoor maps. The layouts are GENERATED (a corridor spine with rooms either side, a lift and stairs),
// they are not real Imperial floor plans. Replace the generator with surveyed data for real use.
const BUILDINGS = [
  { id: 'huxley', name: 'Huxley Building', loc: 1, short: 'Huxley', floors: 4, bays: 7 },
  { id: 'fleming', name: 'Sir Alexander Fleming Building', loc: 5, short: 'Fleming', floors: 4, bays: 6 },
  { id: 'library', name: 'Abdus Salam Library', loc: 7, short: 'Library', floors: 5, bays: 6, library: true },
  { id: 'dyson', name: 'Dyson School of Design Engineering', loc: 4, short: 'Dyson', floors: 3, bays: 5 },
  { id: 'blackett', name: 'Blackett Laboratory', loc: 2, short: 'Blackett', floors: 5, bays: 6 },
];
const fl = f => (f === 0 ? 'Ground floor' : `Floor ${f}`);
const KINDS = ['lecture theatre', 'seminar room', 'teaching lab', 'study room', 'office'];
const kindOf = (b, f, n) => n === 2 ? 'toilets' : f === 0 && n === 1 ? 'cafe'
  : b.library ? (n % 3 === 0 ? 'quiet study' : 'group study') : KINDS[(f + n) % 5];

const G = {}, ROOMS = [];
for (const b of BUILDINGS) {
  const nodes = {}, adj = {};
  const add = (id, o) => { nodes[id] = { id, ...o }; adj[id] = []; };
  const link = (a, c, cost, o = {}) => { adj[a].push({ to: c, cost, ...o }); adj[c].push({ to: a, cost, ...o }); };
  for (let f = 0; f < b.floors; f++) {
    for (let i = 0; i <= b.bays; i++) {
      add(`c${f}_${i}`, { floor: f, x: i * 10, y: 0, type: 'corridor', name: 'Corridor' });
      if (i) link(`c${f}_${i - 1}`, `c${f}_${i}`, 10, { corridor: true });
      for (const [side, y] of [['N', -9], ['S', 9]]) {
        const n = i * 2 + (side === 'S' ? 2 : 1), kind = kindOf(b, f, n), num = `${f}.${String(n).padStart(2, '0')}`;
        const name = kind === 'toilets' ? `${b.short} toilets, ${fl(f).toLowerCase()}` : kind === 'cafe' ? `${b.short} cafe` : `${b.short} ${num}`;
        add(`r${f}_${n}`, { floor: f, x: i * 10, y, type: 'room', kind, name, label: kind === 'toilets' ? 'WC' : kind === 'cafe' ? 'Cafe' : num });
        link(`c${f}_${i}`, `r${f}_${n}`, 8);
        ROOMS.push({ kind: 'room', name, sub: `${b.name}, ${fl(f).toLowerCase()}, ${kind}`, building: b.id, node: `r${f}_${n}`, loc: b.loc, floor: f, text: `${name} ${kind} ${b.name}`.toLowerCase() });
      }
    }
    add(`lift${f}`, { floor: f, x: b.bays * 10 + 10, y: -9, type: 'lift', name: `Lift, ${fl(f).toLowerCase()}`, label: 'L' });
    add(`st${f}`, { floor: f, x: b.bays * 10 + 10, y: 9, type: 'stairs', name: `Stairs, ${fl(f).toLowerCase()}`, label: 'S' });
    link(`c${f}_${b.bays}`, `lift${f}`, 12);
    link(`c${f}_${b.bays}`, `st${f}`, 12);
    if (f) { link(`lift${f - 1}`, `lift${f}`, 4, { lift: true }); link(`st${f - 1}`, `st${f}`, 14, { stairs: true }); }
  }
  add('ent', { floor: 0, x: -14, y: 0, type: 'entrance', name: 'Main entrance', label: 'Entrance' });
  link('ent', 'c0_0', 14);
  G[b.id] = { b, nodes, adj };
}

export const get = id => G[id]?.b;
export const byLoc = loc => BUILDINGS.find(b => b.loc === loc);
// Node id of a demo room such as "Huxley 1.05" (floor 1, room 5), or null if this building has no such room.
export const roomNode = (bid, name) => { const m = /(\d+)\.(\d+)\s*$/.exec(name || ''); const id = m && `r${+m[1]}_${+m[2]}`; return id && G[bid]?.nodes[id] ? id : null; };
export const rooms = needle => ROOMS.filter(r => r.text.includes(needle)).slice(0, 6).map(({ text, ...r }) => r);

function shortest(g, src, dst, { stepFree, crowd, liftOut }) {
  const dist = { [src]: 0 }, prev = {}, todo = new Set([src]);
  while (todo.size) {
    let u = null;
    for (const k of todo) if (u === null || dist[k] < dist[u]) u = k;
    todo.delete(u);
    if (u === dst) break;
    for (const e of g.adj[u]) {
      if (stepFree && e.stairs) continue;
      if (liftOut && e.lift) continue; // lift out of service
      const w = e.cost * (e.corridor ? 1 + crowd * 0.8 : 1); // busy buildings: prefer shorter corridor stretches
      if (dist[e.to] === undefined || dist[u] + w < dist[e.to]) { dist[e.to] = dist[u] + w; prev[e.to] = u; todo.add(e.to); }
    }
  }
  if (dist[dst] === undefined) return null;
  const path = [];
  for (let n = dst; n !== undefined; n = prev[n]) path.unshift(n);
  return path;
}

// screen coordinates (y points down): positive cross product = right turn
function turnDir(a, b, c) {
  const v1 = [b.x - a.x, b.y - a.y], v2 = [c.x - b.x, c.y - b.y];
  const cr = v1[0] * v2[1] - v1[1] * v2[0], m = Math.hypot(...v1) * Math.hypot(...v2);
  return m && Math.abs(cr) > 0.5 * m ? (cr > 0 ? 'right' : 'left') : null;
}

function describe(g, path) {
  const N = path.map(id => g.nodes[id]), steps = [];
  let walk = 0, metres = 0, secs = 0, vert = null;
  const say = (text, floor) => steps.push({ text, floor });
  const target = n => n.type === 'room' ? `into ${n.name}` : n.type === 'lift' ? 'towards the lift' : n.type === 'stairs' ? 'towards the stairs' : 'along the corridor';
  const flushVert = () => { if (vert) { say(`Take the ${vert.mode} from ${fl(vert.from).toLowerCase()} to ${fl(vert.to).toLowerCase()}`, vert.to); vert = null; } };
  say(`Start at ${N[0].name}`, N[0].floor);
  for (let i = 1; i < N.length; i++) {
    const a = N[i - 1], b = N[i], c = N[i + 1], e = g.adj[a.id].find(x => x.to === b.id);
    if (a.floor !== b.floor) {
      const mode = e.stairs ? 'stairs' : 'lift';
      if (walk >= 3) { say(`Walk ${Math.round(walk)} m to the ${mode}`, a.floor); walk = 0; }
      if (vert && vert.mode === mode) vert.to = b.floor;
      else { flushVert(); vert = { mode, from: a.floor, to: b.floor }; secs += mode === 'lift' ? 20 : 0; }
      secs += mode === 'lift' ? 4 : 12; metres += e.cost;
      continue;
    }
    flushVert();
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    walk += d; metres += d; secs += d / 1.3;
    if (c && c.floor === b.floor) {
      const t = turnDir(a, b, c);
      if (t) { say(walk >= 3 ? `Walk ${Math.round(walk)} m, then turn ${t} ${target(c)}` : `Turn ${t} ${target(c)}`, b.floor); walk = 0; }
    }
  }
  flushVert();
  const last = N[N.length - 1];
  if (walk >= 3) say(`Walk ${Math.round(walk)} m`, last.floor);
  say(`You have arrived at ${last.name}`, last.floor);
  return { steps, metres: Math.round(metres), seconds: Math.round(secs), path: N.map(({ id, floor, x, y, name }) => ({ id, floor, x, y, name })) };
}

function planFor(g, f) {
  const nodes = Object.values(g.nodes).filter(n => n.floor === f);
  const links = [];
  for (const n of nodes) for (const e of g.adj[n.id]) if (g.nodes[e.to].floor === f && n.id < e.to) links.push([n.id, e.to, !!e.corridor]);
  return { nodes: nodes.map(({ id, x, y, type, label }) => ({ id, x, y, type, label })), links };
}

export function route(bid, from, to, { stepFree = false, crowd = 0, liftOut = false } = {}) {
  const g = G[bid];
  if (!g || !g.nodes[from] || !g.nodes[to]) return null;
  const path = shortest(g, from, to, { stepFree, crowd, liftOut });
  if (!path) return null;
  const out = describe(g, path), floors = [...new Set(out.path.map(p => p.floor))].sort((a, b) => a - b);
  return { ...out, building: { id: g.b.id, name: g.b.name }, plan: Object.fromEntries(floors.map(f => [f, planFor(g, f)])) };
}
