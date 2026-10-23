'use strict';

const $ = (id) => document.getElementById(id);
const catalog = JSON.parse($('catalog').textContent);
const SUBJECTS = catalog.subjects;
const ATTRIBUTION = Object.assign({
  title: 'Marble Skill Taxonomy (v1)',
  copyright: '© Generative Spark, Inc. (Marble)',
  url: 'https://withmarble.com',
  databaseLicence: 'ODbL 1.0',
  contentLicence: 'CC BY-SA 4.0',
  source: 'https://github.com/withmarbleapp/os-taxonomy',
  standards: 'Curriculum standards referenced by the taxonomy have their own upstream licences (see PROVENANCE.md in that repository).',
  note: 'This is a starting point, not a diagnosis. Ages are approximate and the taxonomy is not written for learners with additional needs. Treat prerequisite links as a starting point and use professional judgement.'
}, catalog.attribution || {});
const summaries = catalog.topics.map((row) => ({
  i: row[0], si: row[1], d: row[2], n: row[3], a: row[4], b: row[5], c: row[6], mask: row[7]
}));
const byId = new Map(summaries.map((topic) => [topic.i, topic]));
const subjectByCode = new Map(SUBJECTS.map((subject) => [subject.c, subject]));

const topics = new Map();
const edges = new Map();
const loaded = new Set();
const inflight = new Map();
const lvMemo = new Map();
const ancMemo = new Map();

const STORE = 'gapfinder:students:v1';
const TEACHER_KEY = 'gapfinder:teacher';
const STATUS = { s: 'Marked secure', h: 'Marked shaky', n: 'Marked not yet', u: 'Not marked' };

const FLAG_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M5 5.5h14v9H8.5L5 18.5V5.5z"/></svg>';

let state = loadState();
let target = byId.has(catalog.default) ? catalog.default : summaries.find((topic) => topic.mask)?.i;
let subjectFilter = '';
let domainFilter = '';
let ageFilter = '';
let renaming = false;
let pathReady = false;
let showRequest = 0;
let pendingLink = null;
let csrfToken = '';

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 's-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function announce(message) {
  const live = $('live');
  live.textContent = '';
  window.setTimeout(() => { live.textContent = message; }, 30);
}
function age(topic) {
  return topic.a === topic.b ? `age ${topic.a}` : `ages ${topic.a}–${topic.b}`;
}
function validateName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Enter a first name or initials.' };
  if (name.length > 24) return { ok: false, error: 'Use a short first name or initials.' };
  if (/[0-9@]/.test(name)) return { ok: false, error: 'Use a first name or initials only, with no numbers or email address.' };
  if (/\s/.test(name)) return { ok: false, error: 'Use a first name or initials only, not a full name.' };
  const word = /^[\p{L}][\p{L}'’.-]{0,23}$/u;
  const initials = /^[\p{L}](?:\.[\p{L}]){1,3}\.?$/u;
  if (!word.test(name) && !initials.test(name)) return { ok: false, error: 'Use a first name or initials only.' };
  return { ok: true, name };
}
function sanitiseStudent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const named = validateName(raw.name);
  if (!named.ok) return null;
  const marks = {};
  if (raw.marks && typeof raw.marks === 'object') {
    Object.entries(raw.marks).forEach(([id, value]) => {
      if (/^mt_[A-Za-z0-9_-]{10}$/.test(id) && (value === 's' || value === 'h' || value === 'n')) marks[id] = value;
    });
  }
  const id = typeof raw.id === 'string' && /^[A-Za-z0-9-]{8,40}$/.test(raw.id) ? raw.id : uid();
  return { id, name: named.name, marks };
}
function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '{}');
    const students = Array.isArray(raw.students) ? raw.students.map(sanitiseStudent).filter(Boolean) : [];
    const activeId = students.some((student) => student.id === raw.activeId) ? raw.activeId : (students[0] ? students[0].id : '');
    return { students, activeId };
  } catch (e) {
    return { students: [], activeId: '' };
  }
}
function active() {
  return state.students.find((student) => student.id === state.activeId) || null;
}
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ students: state.students, activeId: state.activeId }));
    $('save-warning').hidden = true;
  } catch (e) {
    $('save-warning').hidden = false;
  }
}
function learner() {
  const student = active();
  return student ? student.name : 'the student';
}
function fill(text) {
  return String(text || '').replaceAll('{{name}}', learner());
}
function st(id) {
  const student = active();
  return student && student.marks[id] ? student.marks[id] : 'u';
}

function codesFromMask(mask) {
  const codes = [];
  SUBJECTS.forEach((subject, index) => {
    if (mask & (1 << index)) codes.push(subject.c);
  });
  return codes;
}
function loadSubject(code) {
  if (loaded.has(code)) return Promise.resolve();
  if (inflight.has(code)) return inflight.get(code);
  const subject = subjectByCode.get(code);
  const job = fetch(subject.f, { credentials: 'same-origin' }).then((response) => {
    if (!response.ok) throw new Error('missing');
    return response.json();
  }).then((data) => {
    data.topics.forEach((topic) => {
      topics.set(topic.i, { ...topic, s: data.subject, code: data.code });
    });
    data.edges.forEach(([from, to, hard, reason]) => {
      if (!edges.has(from)) edges.set(from, []);
      edges.get(from).push({ id: to, hard, reason: reason || '' });
    });
    loaded.add(code);
    lvMemo.clear();
    ancMemo.clear();
  }).finally(() => inflight.delete(code));
  inflight.set(code, job);
  return job;
}
function ensurePath(id) {
  const summary = byId.get(id);
  const codes = new Set(codesFromMask(summary.mask));
  codes.add(SUBJECTS[summary.si].c);
  return Promise.all([...codes].map((code) => loadSubject(code)));
}
function P(id) {
  return (edges.get(id) || []).filter((item) => topics.has(item.id));
}
function lv(id, stack) {
  if (lvMemo.has(id)) return lvMemo.get(id);
  const seen = stack || new Set();
  if (seen.has(id)) return 0;
  seen.add(id);
  const prereqs = P(id);
  const value = prereqs.length ? 1 + Math.max(...prereqs.map((item) => lv(item.id, seen))) : 0;
  seen.delete(id);
  lvMemo.set(id, value);
  return value;
}
function anc(id, stack) {
  if (ancMemo.has(id)) return ancMemo.get(id);
  const seen = stack || new Set();
  if (seen.has(id)) return new Set();
  seen.add(id);
  const found = new Set();
  P(id).forEach((item) => {
    found.add(item.id);
    anc(item.id, seen).forEach((next) => found.add(next));
  });
  seen.delete(id);
  ancMemo.set(id, found);
  return found;
}

function listFilters(query) {
  return {
    subject: subjectFilter,
    domain: domainFilter,
    age: ageFilter,
    query: query == null ? $('q').value : query
  };
}
function renderSubjects() {
  const board = $('subject-board');
  if (!board.childElementCount) {
    SUBJECTS.forEach((subject) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'subject-chip';
      button.dataset.subject = subject.c;
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = subject.r
        ? `<span class="subject-name">${esc(subject.n)}</span><span class="badge">Start</span>`
        : `<span class="subject-name">${esc(subject.n)}</span>`;
      board.appendChild(button);
    });
  }
  document.querySelectorAll('[data-subject]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.subject === subjectFilter));
  });
}
function renderDomainOptions() {
  const select = $('domain-filter');
  const domains = domainsFor(summaries, SUBJECTS, subjectFilter);
  if (domainFilter && !domains.includes(domainFilter)) domainFilter = '';
  const current = domainFilter;
  select.replaceChildren();
  const any = document.createElement('option');
  any.value = '';
  any.textContent = 'All domains';
  select.appendChild(any);
  domains.forEach((domain) => {
    const option = document.createElement('option');
    option.value = domain;
    option.textContent = domain;
    select.appendChild(option);
  });
  select.value = current;
}
function renderAgeOptions() {
  const select = $('age-filter');
  select.title = 'Skills whose age range overlaps this band.';
  if (select.childElementCount) return;
  AGE_BANDS.forEach((band) => {
    const option = document.createElement('option');
    option.value = band.id;
    option.textContent = band.label;
    select.appendChild(option);
  });
}
function renderSkillList() {
  const result = filterSkills(summaries, SUBJECTS, listFilters(), 40, catalog.starters);
  const host = $('skill-list');
  const count = $('skill-count');
  host.replaceChildren();
  if (!result.total) {
    count.textContent = 'No skills match.';
    return;
  }
  count.textContent = result.browsing
    ? 'Suggested skills'
    : (result.items.length === result.total ? `${result.total} skills` : `Showing ${result.items.length} of ${result.total}`);
  result.items.forEach((topic) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'skill-pick';
    button.dataset.pick = topic.i;
    const current = topic.i === target;
    button.setAttribute('aria-current', String(current));
    button.innerHTML = `<span class="skill-name">${esc(topic.n)}</span><small>${esc(SUBJECTS[topic.si].n)} · ${esc(topic.d)} · ${esc(age(topic))}</small>`;
    host.appendChild(button);
  });
}
function applyFilters(follow) {
  if (follow) $('q').value = '';
  renderSubjects();
  renderDomainOptions();
  const next = follow ? pickTarget(target, summaries, SUBJECTS, listFilters()) : target;
  if (next !== target) choose(next, false);
  else renderSkillList();
}
function renderRoster() {
  const student = active();
  $('roster').innerHTML = state.students.map((item) => (
    `<li><button type="button" data-student="${esc(item.id)}" aria-pressed="${item.id === state.activeId}">${esc(item.name)}</button></li>`
  )).join('');
  $('rename-student').disabled = !student;
  $('remove-student').disabled = !student;
  $('export-backup').disabled = !state.students.length;
  $('active-label').textContent = student ? `Marks showing for ${student.name}.` : 'Add a student before marking.';
}

function prereqItem(skillId, skill, item) {
  const prior = topics.get(item.id);
  if (!prior) return '';
  const strength = item.hard ? 'essential' : 'helpful';
  const label = `This link looks wrong: ${skill.n} needs ${prior.n}`;
  return `<li class="prereq-card"><div class="prereq-body"><b>${esc(prior.n)}</b> <span class="reason">${strength}: ${esc(item.reason || 'no reason recorded')}</span></div>
    <button type="button" class="flag wrong" title="This link looks wrong" aria-label="${esc(label)}" data-topic-id="${esc(skillId)}" data-topic-name="${esc(skill.n)}" data-prereq-id="${esc(item.id)}" data-prereq-name="${esc(prior.n)}" data-strength="${item.hard ? 'hard' : 'helpful'}" data-reason="${esc(item.reason || '')}">${FLAG_ICON}</button></li>`;
}
function renderPath() {
  if (!pathReady || !topics.has(target)) return;
  const open = new Set([...document.querySelectorAll('#path details[open]')].map((node) => node.dataset.for));
  const focused = document.activeElement;
  const focusPanel = focused && focused.dataset && focused.dataset.mark ? focused.dataset.id : '';
  const focusPanelMark = focusPanel ? focused.dataset.mark : '';
  const focusRow = !focusPanel && focused && focused.closest ? focused.closest('[data-id]') : null;
  const focusMark = focused && focused.dataset ? focused.dataset.s || '' : '';
  const y = window.scrollY;
  lvMemo.clear();
  ancMemo.clear();
  const skill = topics.get(target);
  const ids = [...anc(target)];
  // Foundations first: shortest prerequisite chain, then younger age, then name. Target last.
  // Teach next and Check these first use this same order.
  ids.sort((a, b) => lv(a) - lv(b) || topics.get(a).a - topics.get(b).a || topics.get(a).n.localeCompare(topics.get(b).n));
  ids.push(target);
  const { teach } = suggestions(ids);
  const teachSet = new Set(teach);
  const linksInline = ids.length <= 45;
  const counts = { s: 0, h: 0, n: 0, u: 0 };
  ids.forEach((id) => { counts[st(id)] += 1; });
  const rows = ids.map((id, index) => {
    const topic = topics.get(id);
    const mark = st(id);
    const priors = P(id);
    const linkHtml = priors.map((item) => prereqItem(id, topic, item)).join('');
    const links = linkHtml
      ? (linksInline
        ? `<p class="needs">Needs first</p><ul class="prereqs">${linkHtml}</ul>`
        : `<details data-for="${esc(id)}" ${open.has(id) ? 'open' : ''}><summary>Needs first (${priors.length})</summary><ul class="prereqs">${linkHtml}</ul></details>`)
      : '';
    const below = anc(id).size ? '<button type="button" class="all" data-s="all">Secure, and all below</button>' : '';
    const teachNext = teachSet.has(id);
    return `<li class="row ${mark}${id === target ? ' tgt' : ''}${teachNext ? ' teach-next' : ''}" data-id="${esc(id)}">
      <div class="top"><span class="nm"><span class="step-num">${index + 1}</span>${teachNext ? '<span class="teach-flag">Teach next</span>' : ''}${id === target ? '<span class="target-flag">Target</span>' : ''}${esc(topic.n)}</span><span class="meta">${esc(topic.s)} · ${esc(topic.d)} · ${esc(age(topic))}</span></div>
      <p class="status-word">${STATUS[mark]}</p>
      <div class="st" role="group" aria-label="Status for ${esc(topic.n)}">${[['s', 'Secure'], ['h', 'Shaky'], ['n', 'Not yet']].map(([key, label]) => `<button type="button" data-s="${key}" aria-pressed="${mark === key}">${label}</button>`).join('')}${below}</div>
      <details data-for="${esc(id)}" ${open.has(id) ? 'open' : ''}><summary>Check question</summary>
        <p>${esc(topic.ds || '')}</p>
        <ul>${(topic.e || []).map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
        <div class="ask">${esc(fill(topic.p))}</div>
      </details>
      ${links}
    </li>`;
  }).join('');
  $('path').innerHTML = `<p class="kicker"><span class="step-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="step">2</span> Mark what they can do</p>
    <h2 id="path-heading" tabindex="-1">${esc(skill.n)}</h2>
    <p class="path-intro">${ids.length} steps · foundations first, target last</p>
    <ul class="legend"><li><span class="swatch s" aria-hidden="true"></span> Secure</li><li><span class="swatch h" aria-hidden="true"></span> Shaky</li><li><span class="swatch n" aria-hidden="true"></span> Not yet</li><li><span class="swatch" aria-hidden="true"></span> Not marked</li></ul>
    <ol class="path">${rows}</ol>
    <p><button id="clear-marks" type="button" class="text-button">Clear all marks${active() ? ` for ${esc(active().name)}` : ''}</button></p>`;
  renderPanel(ids, counts);
  window.scrollTo(0, y);
  if (focusPanel && focusPanelMark) {
    const button = document.querySelector(`#panel [data-id="${CSS.escape(focusPanel)}"][data-mark="${CSS.escape(focusPanelMark)}"]`);
    if (button) button.focus({ preventScroll: true });
  } else if (focusRow && focusMark) {
    const row = document.querySelector(`#path [data-id="${CSS.escape(focusRow.dataset.id)}"]`);
    const button = row && row.querySelector(`[data-s="${CSS.escape(focusMark)}"]`);
    if (button) button.focus({ preventScroll: true });
  }
}
function suggestions(ids) {
  const gaps = new Set();
  ids.forEach((id) => {
    if (st(id) === 'h' || st(id) === 'n') {
      gaps.add(id);
      anc(id).forEach((next) => gaps.add(next));
    }
  });
  const ready = (id) => P(id).every((item) => st(item.id) === 's');
  const hasGap = ids.some((id) => st(id) === 'h' || st(id) === 'n');
  const teach = ids.filter((id) => (st(id) === 'h' || st(id) === 'n') && ready(id)).slice(0, 3);
  const check = ids.filter((id) => st(id) === 'u' && ready(id) && (!hasGap || gaps.has(id)) && id !== target).slice(0, 4);
  return { teach, check, hasGap };
}
function renderPanel(ids, counts) {
  const done = counts.s;
  const { teach, check, hasGap } = suggestions(ids);
  const card = (id) => {
    const topic = topics.get(id);
    const mark = st(id);
    const step = ids.indexOf(id) + 1;
    const marks = [['s', 'Secure'], ['h', 'Shaky'], ['n', 'Not yet']].map(([key, label]) => (
      `<button type="button" data-mark="${key}" data-id="${esc(id)}" aria-pressed="${mark === key}">${label}</button>`
    )).join('');
    return `<article class="suggest"><h4><span class="step-num">${step}</span> ${esc(topic.n)}</h4><p class="meta">${esc(topic.d)} · ${esc(age(topic))}</p>
      <div class="suggest-actions"><button type="button" class="jump" data-jump="${esc(id)}">Jump to it</button>
      <span class="mark-label">Mark it</span>
      <div class="st" role="group" aria-label="Mark it: ${esc(topic.n)}">${marks}</div></div></article>`;
  };
  const seg = (count, name) => (count ? `<i class="seg ${name}" style="flex:${count}"></i>` : '');
  const who = active() ? ` · ${esc(active().name)}` : '';
  let html = `<p class="kicker"><span class="step-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3.5v17M6 5h11.2L14.6 8.6 17.2 12.2H6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg></span><span class="step">3</span> See where to start${who}</p>
    <h2 id="where-heading">${st(target) === 's' ? 'Target is secure' : 'Where to start'}</h2>
    <p class="count-line">${done} of ${ids.length} secure · ${counts.h} shaky · ${counts.n} not yet · ${counts.u} not marked</p>
    <div class="bar" aria-hidden="true">${seg(counts.s, 'ok')}${seg(counts.h, 'sh')}${seg(counts.n, 'no')}${seg(counts.u, 'rest')}</div>`;
  if (st(target) === 's') {
    html += '<p>This skill is secure. Pick a harder one.</p>';
  } else if (teach.length) {
    html += `<h3>Teach next</h3><p class="meta">Earliest gap. The skills under it are secure.</p>${teach.slice(0, 3).map(card).join('')}`;
    if (check.length) html += `<h3>Check these first</h3><p class="meta">Not marked yet. Mark each one, or jump to it.</p>${check.map(card).join('')}`;
  } else if (check.length) {
    html += `<h3>Check these first</h3><p class="meta">${hasGap ? 'Not marked yet, under a gap. Mark each one, or jump to it.' : 'Not marked yet. Start here, then mark each one.'}</p>${check.map(card).join('')}`;
  } else {
    html += '<p>Mark skills on the left to see where to start.</p>';
  }
  $('panel').innerHTML = html;
}
function jumpTo(id) {
  const row = document.querySelector(`#path li.row[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  row.classList.add('jumped');
  row.scrollIntoView({ block: 'center', inline: 'nearest' });
  const name = row.querySelector('.nm');
  if (!name) return;
  name.setAttribute('tabindex', '-1');
  name.focus({ preventScroll: true });
}

async function showPath(moveFocus) {
  const token = ++showRequest;
  pathReady = false;
  $('path').innerHTML = '<div class="empty"><p>Loading the prerequisite path…</p></div>';
  $('panel').innerHTML = '<h2 id="where-heading">Where to start</h2><p>Loading skills.</p>';
  try {
    await ensurePath(target);
  } catch (e) {
    if (token !== showRequest) return;
    $('path').innerHTML = '<div class="empty"><p>The prerequisite data could not be loaded. Refresh the page and try again.</p></div>';
    $('panel').innerHTML = '<h2 id="where-heading">Where to start</h2><p>The skills could not be loaded.</p>';
    return;
  }
  if (token !== showRequest) return;
  pathReady = true;
  renderPath();
  if (moveFocus) {
    const heading = $('path-heading');
    if (heading) heading.focus();
  }
}
function setMark(id, key) {
  const student = active();
  if (!student) {
    $('student-error').textContent = 'Add a first name or initials before marking.';
    $('student-name').focus();
    return;
  }
  $('student-error').textContent = '';
  if (key === 'all') {
    student.marks[id] = 's';
    anc(id).forEach((next) => { student.marks[next] = 's'; });
    announce(`Marked ${topics.get(id).n}, and the skills below it, secure.`);
  } else if (student.marks[id] === key) {
    delete student.marks[id];
    announce(`${topics.get(id).n} is not marked.`);
  } else {
    student.marks[id] = key;
    announce(`${topics.get(id).n}: ${STATUS[key]}.`);
  }
  save();
  renderPath();
}

function choose(id, moveFocus) {
  if (!byId.has(id)) return;
  target = id;
  renderSkillList();
  showPath(moveFocus);
}

function backup() {
  return {
    application: 'Better Schools Gap Finder',
    note: ATTRIBUTION.note,
    attribution: ATTRIBUTION,
    exportedAt: new Date().toISOString(),
    students: state.students.map((student) => ({ id: student.id, name: student.name, marks: { ...student.marks } }))
  };
}
function ask(message, yesLabel) {
  const dialog = $('confirm-dialog');
  $('confirm-text').textContent = message;
  $('confirm-yes').textContent = yesLabel;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      resolve(value);
    };
    $('confirm-yes').onclick = () => finish(true);
    $('confirm-no').onclick = () => finish(false);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    }, { once: true });
    dialog.showModal();
  });
}

function loadTeacher() {
  try { return JSON.parse(localStorage.getItem(TEACHER_KEY) || '{}'); } catch (e) { return {}; }
}
function rememberTeacher(name, email) {
  if (!name && !email) return;
  try { localStorage.setItem(TEACHER_KEY, JSON.stringify({ name, email })); } catch (e) {}
}
async function getToken(force) {
  if (csrfToken && !force) return csrfToken;
  const response = await fetch('feedback.php', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const data = await response.json();
  if (!data.csrf) throw new Error('Feedback is not available right now.');
  csrfToken = data.csrf;
  return csrfToken;
}
async function postFeedback(payload) {
  const send = (token) => fetch('feedback.php', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': token },
    body: JSON.stringify(payload)
  });
  try {
    let token = await getToken(false);
    let response = await send(token);
    if (response.status === 403) {
      token = await getToken(true);
      response = await send(token);
    }
    let data = {};
    try { data = await response.json(); } catch (e) { data = {}; }
    if (!response.ok || !data.ok) throw new Error(data.error || 'The note could not be sent. Nothing about a student was sent.');
    return data.message || 'Thank you. Your note was sent.';
  } catch (error) {
    if (error instanceof TypeError) throw new Error('The note stayed on this page. Nothing about a student was sent.');
    throw error;
  }
}
async function sendFeedback(payload, statusEl, button) {
  statusEl.className = 'help';
  statusEl.textContent = 'Sending…';
  button.disabled = true;
  try {
    const message = await postFeedback(payload);
    rememberTeacher(payload.teacherName, payload.teacherEmail);
    statusEl.className = 'form-ok';
    statusEl.textContent = `${message} Nothing about a student was included.`;
  } catch (error) {
    statusEl.className = 'form-error';
    statusEl.textContent = error.message || 'The note could not be sent.';
  } finally {
    button.disabled = false;
  }
}
function openLink(button) {
  pendingLink = {
    topicId: button.dataset.topicId,
    topicName: button.dataset.topicName,
    prerequisiteId: button.dataset.prereqId,
    prerequisiteName: button.dataset.prereqName,
    strength: button.dataset.strength,
    reason: button.dataset.reason || ''
  };
  const word = pendingLink.strength === 'hard' ? 'essential' : 'helpful';
  $('link-what').textContent = `${pendingLink.topicName} is listed as needing ${pendingLink.prerequisiteName} (${word}). ${pendingLink.reason}`.trim();
  $('link-comment').value = '';
  $('link-status').textContent = '';
  $('link-status').className = 'help';
  const teacher = loadTeacher();
  if (!$('link-teacher').value) $('link-teacher').value = teacher.name || '';
  if (!$('link-email').value) $('link-email').value = teacher.email || '';
  $('link-dialog').showModal();
  $('link-comment').focus();
}

$('student-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const result = validateName($('student-name').value);
  if (!result.ok) {
    $('student-error').textContent = result.error;
    return;
  }
  const wasRename = renaming;
  if (renaming && active()) {
    active().name = result.name;
    renaming = false;
    $('add-student').textContent = 'Add student';
  } else {
    const student = { id: uid(), name: result.name, marks: {} };
    state.students.push(student);
    state.activeId = student.id;
    renaming = false;
  }
  $('student-name').value = '';
  $('student-error').textContent = '';
  save();
  renderRoster();
  renderPath();
  announce(wasRename ? `Student name saved as ${result.name}.` : `${result.name} added. Marks stay in this browser.`);
});
$('student-name').addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && renaming) {
    renaming = false;
    $('student-name').value = '';
    $('add-student').textContent = 'Add student';
  }
});
$('rename-student').addEventListener('click', () => {
  const student = active();
  if (!student) return;
  renaming = true;
  $('student-name').value = student.name;
  $('add-student').textContent = 'Save name';
  $('student-name').focus();
});
$('remove-student').addEventListener('click', async () => {
  const student = active();
  if (!student) return;
  const yes = await ask(`Remove ${student.name} and the marks saved for them in this browser?`, 'Remove student');
  if (!yes) return;
  state.students = state.students.filter((item) => item.id !== student.id);
  state.activeId = state.students[0] ? state.students[0].id : '';
  save();
  renderRoster();
  renderPath();
  announce(`${student.name} removed from this browser.`);
});
$('roster').addEventListener('click', (event) => {
  const button = event.target.closest('[data-student]');
  if (!button) return;
  state.activeId = button.dataset.student;
  save();
  renderRoster();
  renderPath();
});
$('export-backup').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(backup(), null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'gap-finder-backup.json';
  link.click();
  URL.revokeObjectURL(link.href);
  announce('Backup downloaded. It stays on this computer and includes the Marble credit.');
});
$('import-button').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async () => {
  const file = $('import-file').files && $('import-file').files[0];
  $('import-file').value = '';
  if (!file) return;
  let data;
  try {
    const text = await file.text();
    if (text.length > 1000000) throw new Error('big');
    data = JSON.parse(text);
  } catch (e) {
    $('student-error').textContent = 'That file could not be read as a Gap Finder backup.';
    return;
  }
  if (!data || !Array.isArray(data.students)) {
    $('student-error').textContent = 'That file is not a Gap Finder backup.';
    return;
  }
  const incoming = data.students.map(sanitiseStudent).filter(Boolean);
  const skipped = data.students.length - incoming.length;
  if (!incoming.length) {
    $('student-error').textContent = 'No students with a first name or initials were found in that file.';
    return;
  }
  if (state.students.length) {
    const yes = await ask(`Replace the ${state.students.length} student${state.students.length === 1 ? '' : 's'} saved in this browser with ${incoming.length} from the file?`, 'Replace students');
    if (!yes) return;
  }
  state.students = incoming;
  state.activeId = incoming[0].id;
  save();
  renderRoster();
  renderPath();
  $('student-error').textContent = '';
  announce(`Imported ${incoming.length} students. Marks stay in this browser.${skipped ? ` ${skipped} skipped because the name was not a first name or initials.` : ''}`);
});

$('subject-board').addEventListener('click', (event) => {
  const button = event.target.closest('[data-subject]');
  if (!button) return;
  subjectFilter = subjectFilter === button.dataset.subject ? '' : button.dataset.subject;
  applyFilters(true);
});
$('domain-filter').addEventListener('change', () => {
  domainFilter = $('domain-filter').value;
  applyFilters(true);
});
$('age-filter').addEventListener('change', () => {
  ageFilter = $('age-filter').value;
  applyFilters(true);
});
$('skill-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-pick]');
  if (button) choose(button.dataset.pick, true);
});
$('skill-list').addEventListener('pointerover', (event) => {
  const button = event.target.closest('[data-pick]');
  if (!button) return;
  const summary = byId.get(button.dataset.pick);
  if (!summary) return;
  const codes = new Set(codesFromMask(summary.mask));
  codes.add(SUBJECTS[summary.si].c);
  codes.forEach((code) => { loadSubject(code).catch(() => {}); });
});
$('q').addEventListener('input', () => {
  renderSkillList();
});
$('q').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const button = $('skill-list').querySelector('.skill-pick');
  if (!button) return;
  event.preventDefault();
  choose(button.dataset.pick, true);
});
$('search-form').addEventListener('submit', (event) => event.preventDefault());
$('panel').addEventListener('click', (event) => {
  const jump = event.target.closest('[data-jump]');
  if (jump) {
    jumpTo(jump.dataset.jump);
    return;
  }
  const mark = event.target.closest('[data-mark]');
  if (mark) setMark(mark.dataset.id, mark.dataset.mark);
});
$('path').addEventListener('click', async (event) => {
  const wrong = event.target.closest('.wrong');
  if (wrong) { openLink(wrong); return; }
  const button = event.target.closest('button');
  if (!button) return;
  if (button.id === 'clear-marks') {
    const student = active();
    if (!student) return;
    const yes = await ask(`Clear every mark for ${student.name} in this browser?`, 'Clear marks');
    if (!yes) return;
    student.marks = {};
    save();
    renderPath();
    announce(`Marks cleared for ${student.name}.`);
    return;
  }
  if (!button.dataset.s) return;
  const row = button.closest('[data-id]');
  if (row) setMark(row.dataset.id, button.dataset.s);
});

$('general-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const payload = {
    kind: 'general',
    comment: $('general-comment').value.trim(),
    teacherName: $('general-teacher').value.trim(),
    teacherEmail: $('general-email').value.trim(),
    company: $('general-company').value
  };
  sendFeedback(payload, $('general-status'), $('general-send'));
});
$('link-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!pendingLink) return;
  const payload = {
    kind: 'link',
    comment: $('link-comment').value.trim(),
    teacherName: $('link-teacher').value.trim(),
    teacherEmail: $('link-email').value.trim(),
    topicId: pendingLink.topicId,
    topicName: pendingLink.topicName,
    prerequisiteId: pendingLink.prerequisiteId,
    prerequisiteName: pendingLink.prerequisiteName,
    strength: pendingLink.strength,
    reason: pendingLink.reason,
    company: $('link-company').value
  };
  sendFeedback(payload, $('link-status'), $('link-send'));
});
$('link-cancel').addEventListener('click', () => $('link-dialog').close());

const savedTeacher = loadTeacher();
if (savedTeacher.name) $('general-teacher').value = savedTeacher.name;
if (savedTeacher.email) $('general-email').value = savedTeacher.email;
renderAgeOptions();
renderSubjects();
renderDomainOptions();
renderRoster();
renderSkillList();
showPath(false);
