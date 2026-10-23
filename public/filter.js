'use strict';

// Pure skill-list filtering. The page and the node test both use this file.
const AGE_BANDS = [
  { id: '', label: 'Any age' },
  { id: '4-6', label: 'Ages 4–6', min: 4, max: 6 },
  { id: '7-8', label: 'Ages 7–8', min: 7, max: 8 },
  { id: '9-11', label: 'Ages 9–11', min: 9, max: 11 },
  { id: '12-14', label: 'Ages 12–14', min: 12, max: 14 },
  { id: '15', label: 'Age 15+', min: 15, max: 99 }
];

function ageBand(id) {
  return AGE_BANDS.find((band) => band.id === id) || AGE_BANDS[0];
}

function skillMatches(topic, subjects, filters) {
  if (!topic || !topic.mask) return false;
  const subject = subjects[topic.si];
  if (!subject) return false;
  if (filters.subject && subject.c !== filters.subject) return false;
  if (filters.domain && topic.d !== filters.domain) return false;
  const band = ageBand(filters.age || '');
  if (band.min != null && (topic.b < band.min || topic.a > band.max)) return false;
  const query = String(filters.query || '').trim().toLowerCase();
  if (query.length >= 2) {
    const hay = `${topic.n} ${topic.d} ${subject.n} ${(subject.a || []).join(' ')}`.toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
}

function filterSkills(topics, subjects, filters, limit, starters) {
  const query = String(filters.query || '').trim().toLowerCase();
  const browsing = !filters.subject && !filters.domain && !filters.age && query.length < 2;
  let matched;
  if (browsing && starters) {
    const byId = new Map(topics.map((topic) => [topic.i, topic]));
    matched = [];
    ['ma', 'en'].forEach((code) => {
      (starters[code] || []).forEach((id) => {
        const topic = byId.get(id);
        if (topic && topic.mask) matched.push(topic);
      });
    });
  } else {
    matched = topics.filter((topic) => skillMatches(topic, subjects, filters));
    matched.sort((a, b) => {
      const aStart = query.length >= 2 && a.n.toLowerCase().startsWith(query) ? 1 : 0;
      const bStart = query.length >= 2 && b.n.toLowerCase().startsWith(query) ? 1 : 0;
      return bStart - aStart || b.c - a.c || a.n.localeCompare(b.n);
    });
  }
  const cap = limit || matched.length;
  return { total: matched.length, items: matched.slice(0, cap), browsing };
}

function domainsFor(topics, subjects, subjectCode) {
  const found = new Set();
  topics.forEach((topic) => {
    if (!topic.mask) return;
    if (subjectCode && subjects[topic.si].c !== subjectCode) return;
    found.add(topic.d);
  });
  return [...found].sort((a, b) => a.localeCompare(b));
}

// Keep the current skill when it is still in the filtered set.
// Otherwise follow the first skill the filters now show.
function pickTarget(currentId, topics, subjects, filters) {
  const active = !!(filters.subject || filters.domain || filters.age || String(filters.query || '').trim().length >= 2);
  if (!active) return currentId;
  if (topics.some((topic) => topic.i === currentId && skillMatches(topic, subjects, filters))) return currentId;
  const next = filterSkills(topics, subjects, filters, 1);
  return next.items[0] ? next.items[0].i : currentId;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AGE_BANDS, skillMatches, filterSkills, domainsFor, pickTarget };
}
