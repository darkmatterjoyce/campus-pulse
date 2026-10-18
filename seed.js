import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs';
import { COURSES, makeTimetable } from './courses.js';
import { predictAll } from './predict.js';

const KEY = process.env.GOOGLE_MAPS_API_KEY;
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } });
let seed = 42;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const C = { lat: 51.4988, lng: -0.1752 };
const dist = (a, b) => {
  const r = x => x * Math.PI / 180, k = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(k));
};

const LECTURE_SCALE = 1.2; // more course groups than before, so bigger rooms
// id, name, type, text to snap to a real Google place ('' = demo venue), fallback lat, lng, capacity, noise 1-5, step_free, has_lift, popularity
const LOCS = [
  [1, 'Huxley Building', 'lecture', 'Huxley Building', 51.49915, -0.17830, 300, 3, true, true, 3],
  [2, 'Blackett Laboratory', 'lecture', 'Blackett Laboratory', 51.49985, -0.17590, 220, 3, true, true, 1],
  [3, 'Skempton Building', 'lecture', 'Skempton Building', 51.49935, -0.17700, 200, 3, false, true, 2],
  [4, 'Dyson School of Design Engineering', 'lecture', 'Dyson School of Design Engineering', 51.49890, -0.17560, 220, 3, true, true, 2],
  [5, 'Sir Alexander Fleming Building', 'lecture', 'Sir Alexander Fleming Building', 51.49860, -0.17470, 260, 3, true, true, 3],
  [6, 'Royal School of Mines', 'lecture', 'Royal School of Mines', 51.49920, -0.17620, 160, 3, false, false, 1],
  [7, 'Abdus Salam Library', 'study', 'Abdus Salam Library', 51.49820, -0.17720, 250, 2, true, true, 5],
  [8, 'Huxley Building study space', 'study', 'Huxley Building', 51.49915, -0.17830, 80, 3, true, false, 1],
  [9, 'Sherfield Learning Hub', 'study', 'Sherfield Building', 51.49870, -0.17670, 120, 4, true, true, 2],
  [10, 'Blackett quiet room', 'study', 'Blackett Laboratory', 51.49985, -0.17590, 40, 1, false, true, 1],
  [11, 'Fleming Atrium', 'study', 'Sir Alexander Fleming Building', 51.49860, -0.17470, 70, 4, true, true, 1],
  [12, 'Eastside Bar and Kitchen', 'food', 'Eastside Bar', 51.49895, -0.17695, 120, 4, true, false, 8],
  [13, 'Imperial College Library Cafe', 'food', 'Imperial College Library Cafe', 51.49830, -0.17700, 60, 4, true, false, 5],
  [14, 'Sherfield Food Court', 'food', 'Sherfield Building food court', 51.49875, -0.17640, 90, 4, true, false, 6],
  [17, 'Bessemer Building', 'lecture', 'Bessemer Building', 51.49995, -0.17730, 160, 3, true, true, 1],
  [18, 'Roderic Hill Building', 'lecture', 'Roderic Hill Building', 51.49950, -0.17850, 160, 3, true, true, 1],
  [19, 'Electrical and Electronic Engineering', 'lecture', 'Electrical and Electronic Engineering Building', 51.49890, -0.17590, 200, 3, true, true, 2],
  [20, 'Faculty Building', 'lecture', 'Faculty Building', 51.49895, -0.17510, 160, 3, true, true, 1],
  [21, 'Chemistry Building', 'lecture', 'Chemistry Building', 51.49840, -0.17600, 200, 3, true, true, 2],
  [22, 'Imperial College Business School', 'lecture', 'Imperial College Business School', 51.49905, -0.17480, 220, 3, true, true, 2],
  [23, 'Imperial College Union', 'study', 'Imperial College Union', 51.49890, -0.17690, 100, 4, true, true, 2],
  [24, 'Junior Common Room (demo)', 'social', '', 51.49885, -0.17700, 90, 4, true, false, 4],
  [25, 'Senior Common Room (demo)', 'social', '', 51.49878, -0.17712, 40, 2, true, false, 2],
  [26, 'Dyson study pods (demo)', 'study', '', 51.49895, -0.17565, 30, 2, true, true, 1],
  [27, 'Chemistry reading room (demo)', 'study', '', 51.49845, -0.17605, 30, 1, true, true, 1],
  [28, 'Beit Quad', 'social', 'Beit Quad Imperial College', 51.49890, -0.17690, 150, 4, true, false, 3],
  [29, "Queen's Lawn", 'social', "Queen's Lawn Imperial College London", 51.49845, -0.17670, 200, 2, true, false, 2],
  [31, 'Music practice rooms (demo)', 'music', '', 51.49880, -0.17720, 40, 3, true, false, 3],
  [32, 'Jam room (demo)', 'music', '', 51.49870, -0.17730, 24, 4, true, false, 1],
].map(([id, name, type, q, lat, lng, capacity, noise, step_free, has_lift, weight]) => ({
  id, name, type, q, lat, lng, noise, step_free, has_lift, weight, campus: true, place_id: null,
  capacity: type === 'lecture' ? Math.round(capacity * LECTURE_SCALE) : capacity }));

// Google lookups are saved in places-cache.json, so re-running the seed does not use up the daily Places quota.
const CACHE_FILE = 'places-cache.json';
let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}
async function places(body, mask) {
  const key = JSON.stringify([body, mask]);
  if (cache[key]) return cache[key];
  const out = await placesLive(body, mask);
  cache[key] = out; try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch {}
  return out;
}
async function placesLive(body, mask) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': mask },
    body: JSON.stringify({ languageCode: 'en', ...body }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `Places API error ${r.status}`);
  return j.places || [];
}
const bias = radius => ({ circle: { center: { latitude: C.lat, longitude: C.lng }, radius } });
const at = p => ({ lat: p.location.latitude, lng: p.location.longitude });

// 1. Snap campus locations to their real Google place (accurate coordinates and place IDs).
let snapped = 0, added = 0;
if (!KEY) console.warn('No GOOGLE_MAPS_API_KEY: using built-in approximate coordinates.');
else for (const l of LOCS) {
  if (!l.q) continue; // demo venues have no real Google place
  try {
    const [p] = await places({ textQuery: `${l.q}, Imperial College London`, locationBias: bias(800), maxResultCount: 1 }, 'places.id,places.location');
    if (p && dist(C, at(p)) < 900) { Object.assign(l, at(p), { place_id: p.id }); snapped++; }
    else console.warn(`Could not find "${l.q}", keeping approximate position.`);
  } catch (e) { console.warn(`Places lookup failed for "${l.q}": ${e.message}`); break; }
}

// 2. Real places near campus: restaurants and cafes, libraries and quiet places, parks, music spaces.
const ALL = [...LOCS];
const NEARBY = [['food', 'restaurant', 900, 14], ['food', 'cafe', 900, 12], ['food', 'sandwich shop', 800, 6], ['food', 'pub', 900, 6], ['food', 'bakery', 900, 4],
  ['study', 'library', 1600, 5], ['study', 'coworking space', 1600, 3], ['social', 'park', 1200, 3], ['music', 'music practice rooms', 1600, 3]];
const CAP = { food: () => 25 + rnd() * 31, study: () => 50 + rnd() * 100, social: () => 80 + rnd() * 80, music: () => 20 + rnd() * 20 };
const NOISE = { food: 4, study: 1, social: 2, music: 3 };
const FOOD = ['cafe', 'coffee_shop', 'bar', 'pub', 'bakery', 'meal_takeaway', 'sandwich_shop'];
if (KEY && snapped) {
  let id = 100;
  for (const [type, q, radius, cap] of NEARBY) {
    try {
      let n = 0;
      const list = await places({ textQuery: `${q} near Imperial College London South Kensington`, locationBias: bias(radius), maxResultCount: 20 }, 'places.id,places.displayName,places.location,places.types');
      for (const p of list) {
        const t = p.types || [], pos = at(p);
        if (n >= cap || t.some(x => ['lodging', 'museum', 'university', 'school'].includes(x))) continue;
        if (type === 'food' && !t.some(x => x.endsWith('restaurant') || FOOD.includes(x))) continue;
        if (dist(C, pos) > radius + 100 || ALL.some(l => l.place_id === p.id || dist(l, pos) < 25)) continue;
        ALL.push({ id: id++, name: p.displayName.text, type, ...pos, campus: false, capacity: Math.round(CAP[type]()), noise: NOISE[type],
                   step_free: true, has_lift: false, weight: 0.4 + rnd() * 0.8, place_id: p.id });
        n++; added++;
      }
    } catch (e) { console.warn(`Nearby search for "${q}" failed: ${e.message}`); }
  }
}
// Nudge pins that share a building so they stay separately clickable.
for (let i = 0; i < ALL.length; i++) for (let j = 0; j < i; j++) if (dist(ALL[i], ALL[j]) < 12) ALL[i].lat += 0.00013;

const SCHEMA = `
DROP TABLE IF EXISTS checkins, tapins, course_events, courses, predictions, insights, day_notes, timetable_events, locations CASCADE;
CREATE TABLE locations (id int PRIMARY KEY, name text, type text, lat float8, lng float8,
  capacity int, noise int, step_free bool, has_lift bool, place_id text, campus bool);
CREATE TABLE courses (course_id int PRIMARY KEY, dept text, year int, name text, size int);
CREATE TABLE course_events (course_id int, course text, cohort_size int, size int, dow int, start_time time, end_time time,
  location_id int REFERENCES locations(id), room text, kind text);
CREATE INDEX ON course_events (dow, start_time, end_time);
CREATE TABLE tapins (time timestamptz NOT NULL, student_id int, location_id int, direction text);
SELECT create_hypertable('tapins', 'time');
CREATE INDEX ON tapins (student_id, time DESC);
CREATE TABLE checkins (time timestamptz NOT NULL DEFAULT now(), student_id text, location_id int,
  rating int, lat float8, lng float8);
SELECT create_hypertable('checkins', 'time');
CREATE TABLE predictions (dow int, slot time, location_id int, busy real, src text);
CREATE INDEX ON predictions (dow, slot);
CREATE TABLE insights (dow int, slot time, note text, src text);
CREATE TABLE day_notes (dow int, attendance real, note text, src text);
`;

// 3. Made-up course timetables, then predictions (Gemini, or a rule-based fallback) for every non-lecture venue.
const events = makeTimetable(rnd);
const { rows: pred, notes, days, aiSlots } = await predictAll(ALL.filter(l => l.type !== 'lecture'), events);

const hh = h => String(h).padStart(2, '0') + ':00';
const cols = (rows, n) => Array.from({ length: n }, (_, i) => rows.map(r => r[i]));
const c = await pool.connect();
try {
  await c.query(SCHEMA);
  for (const l of ALL) await c.query('INSERT INTO locations VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [l.id, l.name, l.type, l.lat, l.lng, l.capacity, l.noise, l.step_free, l.has_lift, l.place_id, l.campus]);
  for (const k of COURSES) await c.query('INSERT INTO courses VALUES ($1,$2,$3,$4,$5)', [k.id, k.dept, k.year, k.name, k.size]);
  const col = k => events.map(e => e[k]);
  await c.query('INSERT INTO course_events SELECT * FROM unnest($1::int[],$2::text[],$3::int[],$4::int[],$5::int[],$6::time[],$7::time[],$8::int[],$9::text[],$10::text[])',
    [col('course_id'), col('course'), col('cohort_size'), col('size'), col('dow'), events.map(e => hh(e.start)), events.map(e => hh(e.end)), col('location_id'), col('room'), col('kind')]);
  await c.query('INSERT INTO predictions SELECT * FROM unnest($1::int[],$2::time[],$3::int[],$4::real[],$5::text[])', cols(pred, 5));
  await c.query('INSERT INTO insights SELECT * FROM unnest($1::int[],$2::time[],$3::text[],$4::text[])', cols(notes, 4));
  await c.query('INSERT INTO day_notes SELECT * FROM unnest($1::int[],$2::real[],$3::text[],$4::text[])', cols(days, 4));

  // Simulated ID tap-ins for today (weekends reuse Friday's timetable): the first 85% of each cohort session attends.
  const now = "(SELECT now() AT TIME ZONE 'Europe/London' AS t) n";
  await c.query(`INSERT INTO tapins
    SELECT ((n.t::date + e.start_time) AT TIME ZONE 'Europe/London') + random() * 5 * interval '1 minute', e.course_id * 1000 + g, e.location_id, 'in'
    FROM course_events e, ${now}, generate_series(1, 400) g
    WHERE e.dow = LEAST(EXTRACT(isodow FROM n.t), 5) AND e.start_time <= n.t::time AND g <= e.size * 0.85`);
  await c.query(`INSERT INTO tapins
    SELECT ((n.t::date + e.end_time) AT TIME ZONE 'Europe/London') - random() * 2 * interval '1 minute', e.course_id * 1000 + g, e.location_id, 'out'
    FROM course_events e, ${now}, generate_series(1, 400) g
    WHERE e.dow = LEAST(EXTRACT(isodow FROM n.t), 5) AND e.end_time <= n.t::time AND g <= e.size * 0.85`);

  console.log(`Seeded ${ALL.length} locations (${snapped} snapped to Google places, ${added} nearby places added), ${COURSES.length} course groups, ${events.length} sessions, ` +
    `${aiSlots} of ${notes.length} half-hour predictions from Gemini (the rest are rule-based).`);
} finally { c.release(); await pool.end(); }
