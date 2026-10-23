'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
assert(!app.includes('topics.get(b).c - topics.get(a).c'), 'Check these first is not re-sorted by centrality');
assert(app.includes('class="step-num"'), 'the path and the side lists share a step number');
assert(app.includes('teach-next') && app.includes('Teach next'), 'Teach next is marked on the path');

const topics = new Map();
const edges = new Map();
for (const code of ['ma', 'en', 'sc', 'hi', 'ge', 'co', 'ls', 'ps', 'll']) {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'public/data', `${code}.json`), 'utf8'));
  data.topics.forEach((topic) => topics.set(topic.i, topic));
  data.edges.forEach(([from, to]) => {
    if (!edges.has(from)) edges.set(from, []);
    edges.get(from).push(to);
  });
}

const target = 'mt_-V7EnqU7gG';
const ancMemo = new Map();
function anc(id, stack = new Set()) {
  if (ancMemo.has(id)) return ancMemo.get(id);
  if (stack.has(id)) return new Set();
  stack.add(id);
  const found = new Set();
  (edges.get(id) || []).forEach((prereq) => {
    if (!topics.has(prereq)) return;
    found.add(prereq);
    anc(prereq, stack).forEach((next) => found.add(next));
  });
  stack.delete(id);
  ancMemo.set(id, found);
  return found;
}
const lvMemo = new Map();
function lv(id, stack = new Set()) {
  if (lvMemo.has(id)) return lvMemo.get(id);
  if (stack.has(id)) return 0;
  stack.add(id);
  const prereqs = (edges.get(id) || []).filter((prereq) => topics.has(prereq));
  const value = prereqs.length ? 1 + Math.max(...prereqs.map((prereq) => lv(prereq, stack))) : 0;
  stack.delete(id);
  lvMemo.set(id, value);
  return value;
}
function prior(id) {
  return (edges.get(id) || []).filter((prereq) => topics.has(prereq));
}

const ids = [...anc(target)];
ids.sort((a, b) => lv(a) - lv(b) || topics.get(a).a - topics.get(b).a || topics.get(a).n.localeCompare(topics.get(b).n));
ids.push(target);
assert.strictEqual(topics.get(ids[0]).n, 'One-to-one counting', 'the first step is a foundation skill');
assert.strictEqual(topics.get(ids[ids.length - 1]).n, 'Adding fractions (different denominators)', 'the target is the last step');
assert(ids.every((id, index) => index === 0 || lv(id) >= lv(ids[index - 1])), 'each step is at least as deep as the one before it');

const secure = new Set(ids.filter((id) => lv(id) === 0));
const ready = (id) => prior(id).every((prereq) => secure.has(prereq));
const check = ids.filter((id) => !secure.has(id) && id !== target && ready(id)).slice(0, 4);
const names = check.map((id) => topics.get(id).n);
assert.deepStrictEqual(names, ['How Many in Total?', 'Rote counting to 100', 'Writing digits 0-9']);
const byCentrality = [...check].sort((a, b) => topics.get(b).c - topics.get(a).c).map((id) => topics.get(id).n);
assert.notDeepStrictEqual(names, byCentrality, 'path order and centrality order really do differ here');
assert.deepStrictEqual(check.map((id) => ids.indexOf(id) + 1), [4, 5, 6], 'the side list uses the same step numbers as the path');

console.log('order checks passed');
