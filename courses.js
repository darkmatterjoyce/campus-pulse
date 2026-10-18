// Made-up departments, year groups and weekly timetables for the demo (not real Imperial data).
// lec = campus location ids (see seed.js) where the department usually has teaching.
export const DEPTS = [
  { name: 'Design Engineering', years: 3, size: 110, lec: [4, 1] },
  { name: 'Mechanical Engineering', years: 3, size: 160, lec: [1, 6, 3] },
  { name: 'Electrical Engineering', years: 3, size: 150, lec: [19, 2] },
  { name: 'Computing', years: 3, size: 150, lec: [5, 19] },
  { name: 'Civil Engineering', years: 3, size: 120, lec: [3, 6] },
  { name: 'Chemical Engineering', years: 3, size: 120, lec: [21, 6] },
  { name: 'Physics', years: 2, size: 160, lec: [2, 5] },
  { name: 'Mathematics', years: 2, size: 150, lec: [20, 3] },
  { name: 'Business Management', years: 2, size: 130, lec: [22, 20] },
  { name: 'Aeronautics', years: 3, size: 110, lec: [17, 1] },
  { name: 'Bioengineering', years: 2, size: 100, lec: [5, 21] },
];
export const COURSES = DEPTS.flatMap((d, i) => Array.from({ length: d.years }, (_, y) => ({
  id: (i + 1) * 10 + y + 1, dept: d.name, year: y + 1, name: `${d.name} Y${y + 1}`, size: d.size - y * 5, lec: d.lec })));

const BUILDING = { 1: 'Huxley', 2: 'Blackett', 3: 'Skempton', 4: 'Dyson', 5: 'Fleming', 6: 'RSM', 17: 'Bessemer', 18: 'Roderic Hill', 19: 'EEE', 20: 'Faculty', 21: 'Chemistry', 22: 'Business School' };
const ALL_LECTURE = Object.keys(BUILDING).map(Number);
const ROOM_NUMBERS = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; // matches room names in indoor.js (2 is the toilets)

// Every cohort gets a lunch-free window each day (12-14, 12-13 or 13-14), so several cohorts are free at once.
// A few evening sessions run until 19:00.
export function makeTimetable(rnd) {
  const pick = a => a[Math.floor(rnd() * a.length)], events = [];
  for (const c of COURSES) for (let dow = 1; dow <= 5; dow++) {
    const lunch = pick([[12, 14], [12, 13], [13, 14], [12, 14], [13, 14]]);
    for (let h = 9; h <= 18; h++) {
      if (h >= lunch[0] && h < lunch[1]) continue;
      if (rnd() > (h === 18 ? 0.12 : c.year === 3 ? 0.45 : 0.55)) continue;
      const loc = rnd() < 0.8 ? pick(c.lec) : pick(ALL_LECTURE);
      const kind = pick(['lecture', 'lecture', 'tutorial', 'lab']);
      events.push({
        course_id: c.id, course: c.name, cohort_size: c.size, dow, start: h, end: h + 1, location_id: loc, kind,
        size: kind === 'lab' ? Math.round(c.size / 3) : kind === 'tutorial' ? Math.round(c.size / 2) : c.size,
        room: `${BUILDING[loc]} ${1 + Math.floor(rnd() * 2)}.${String(pick(ROOM_NUMBERS)).padStart(2, '0')}`,
      });
    }
  }
  return events;
}
