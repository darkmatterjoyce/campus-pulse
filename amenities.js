// Demo amenities: what each campus place offers. The counts are made up for the demo.
// Availability is estimated from how busy the place is, since there are no real sensors.
export const KINDS = {
  microwave: { label: 'microwave', words: ['microwave', 'heat up', 'reheat', 'warm up my food', 'warm my food'] },
  water: { label: 'water refill station', words: ['water', 'refill', 'drink', 'bottle'] },
  charging: { label: 'charging point', words: ['charge', 'charging', 'plug', 'socket', 'outlet', 'power'] },
  printer: { label: 'printer', words: ['print', 'scan', 'photocopy'] },
  prayer: { label: 'prayer or reflection room', words: ['pray', 'prayer', 'reflection', 'multifaith', 'multi-faith', 'wudu'] },
  shower: { label: 'shower', words: ['shower', 'changing room', 'locker'] },
  vending: { label: 'vending machine', words: ['vending', 'snack', 'vending machine', 'chocolate', 'crisps'] },
  whiteboard: { label: 'whiteboard group room', words: ['whiteboard', 'group room', 'group work', 'meeting room', 'project room'] },
};

// [place name as stored in the database, kind, how many, where in the building]
export const AMENITIES = [
  ['Imperial College Union', 'microwave', 6, 'Beit Quad level, next to the JCR'],
  ['Imperial College Union', 'water', 3, 'Union reception'],
  ['Imperial College Union', 'vending', 2, 'Union corridor'],
  ['Junior Common Room (demo)', 'microwave', 4, 'JCR kitchenette'],
  ['Junior Common Room (demo)', 'charging', 12, 'sofa area'],
  ['Senior Common Room (demo)', 'microwave', 2, 'SCR kitchenette'],
  ['Senior Common Room (demo)', 'water', 1, 'by the entrance'],
  ['Sherfield Learning Hub', 'microwave', 3, 'ground floor kitchenette'],
  ['Sherfield Learning Hub', 'charging', 20, 'study desks'],
  ['Sherfield Learning Hub', 'printer', 2, 'ground floor'],
  ['Sherfield Learning Hub', 'whiteboard', 5, 'first floor'],
  ['Sherfield Food Court', 'microwave', 5, 'self-service area'],
  ['Sherfield Food Court', 'water', 2, 'next to the tills'],
  ['Abdus Salam Library', 'charging', 60, 'every floor'],
  ['Abdus Salam Library', 'printer', 6, 'ground and first floor'],
  ['Abdus Salam Library', 'water', 4, 'each floor'],
  ['Abdus Salam Library', 'whiteboard', 8, 'group study rooms, second floor'],
  ['Huxley Building study space', 'charging', 15, 'ground floor'],
  ['Huxley Building study space', 'microwave', 2, 'level 3 kitchenette'],
  ['Huxley Building study space', 'water', 2, 'level 2 corridor'],
  ['Huxley Building', 'prayer', 1, 'level 1, room 1.10'],
  ['Huxley Building', 'vending', 2, 'ground floor'],
  ['Dyson School of Design Engineering', 'microwave', 3, 'level 2 kitchen'],
  ['Dyson School of Design Engineering', 'water', 2, 'atrium'],
  ['Dyson School of Design Engineering', 'whiteboard', 4, 'level 1 project rooms'],
  ['Dyson study pods (demo)', 'charging', 10, 'inside the pods'],
  ['Dyson study pods (demo)', 'whiteboard', 3, 'pod walls'],
  ['Sir Alexander Fleming Building', 'microwave', 2, 'Fleming Atrium kitchenette'],
  ['Sir Alexander Fleming Building', 'water', 3, 'atrium'],
  ['Sir Alexander Fleming Building', 'vending', 2, 'ground floor'],
  ['Fleming Atrium', 'charging', 14, 'atrium tables'],
  ['Blackett Laboratory', 'water', 2, 'level 1'],
  ['Blackett Laboratory', 'prayer', 1, 'level 2, room 2.40'],
  ['Chemistry Building', 'water', 2, 'foyer'],
  ['Chemistry Building', 'vending', 1, 'foyer'],
  ['Electrical and Electronic Engineering', 'microwave', 2, 'level 4 common area'],
  ['Electrical and Electronic Engineering', 'printer', 1, 'level 3'],
  ['Imperial College Business School', 'microwave', 3, 'student lounge'],
  ['Imperial College Business School', 'water', 2, 'lobby'],
  ['Imperial College Business School', 'charging', 18, 'lounge'],
  ['Imperial College Library Cafe', 'water', 1, 'by the counter'],
  ['Beit Quad', 'water', 1, 'near the Union entrance'],
  ['Music practice rooms (demo)', 'charging', 6, 'corridor'],
];

// Same answer for the same place, kind and half hour (no flicker between refreshes).
const noise = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };

// loc: row from getHeat(); returns the amenity list with an estimate of how many are free.
export function amenitiesFor(loc, slot) {
  return AMENITIES.filter(a => a[0] === loc.name).map(([, kind, count, where]) => {
    const used = Math.min(count, Math.round(count * Math.min(1, loc.busy * (0.7 + 0.6 * noise(loc.name + kind + slot)) + 0.05)));
    return { kind, count, where, free: count - used };
  });
}

export const detectKind = q => {
  const t = ' ' + q.toLowerCase() + ' ';
  return Object.keys(KINDS).find(k => KINDS[k].words.some(w => t.includes(w))) || null;
};
