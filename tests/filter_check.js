'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { filterSkills, domainsFor, pickTarget } = require('../public/filter.js');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const match = html.match(/<script id="catalog" type="application\/json">(.*?)<\/script>/);
assert(match, 'catalog embedded');
const catalog = JSON.parse(match[1].replace(/<\\\//g, '</'));
const subjects = catalog.subjects;
const topics = catalog.topics.map((row) => ({
  i: row[0], si: row[1], d: row[2], n: row[3], a: row[4], b: row[5], c: row[6], mask: row[7],
  ac: (catalog.acara && catalog.acara[row[0]]) || []
}));
const fractions = 'mt_-V7EnqU7gG';

function codeOf(topic) {
  return subjects[topic.si].c;
}

const maths = filterSkills(topics, subjects, { subject: 'ma', domain: '', age: '', query: '' }, 40);
const science = filterSkills(topics, subjects, { subject: 'sc', domain: '', age: '', query: '' }, 40);
assert(maths.total > 40, 'mathematics has a long skill list');
assert(science.total > 4, 'science has more than the old starter row');
assert(maths.items.every((topic) => codeOf(topic) === 'ma'), 'mathematics filter stays in mathematics');
assert(science.items.every((topic) => codeOf(topic) === 'sc'), 'science filter stays in science');
assert(!maths.items.some((topic) => science.items.some((other) => other.i === topic.i)), 'subject change replaces the skill list');

const followed = pickTarget(fractions, topics, subjects, { subject: 'sc', domain: '', age: '', query: '' });
assert(followed !== fractions, 'a mathematics skill is not kept when the subject is science');
assert(codeOf(topics.find((topic) => topic.i === followed)) === 'sc', 'the list follows the science subject');
assert.strictEqual(
  pickTarget(followed, topics, subjects, { subject: 'sc', domain: '', age: '', query: '' }),
  followed,
  'a skill already in the subject stays selected'
);

const fractionDomains = domainsFor(topics, subjects, 'ma');
assert(fractionDomains.includes('Fractions'), 'mathematics offers a Fractions domain');
const onlyFractions = filterSkills(topics, subjects, { subject: 'ma', domain: 'Fractions', age: '', query: '' }, 500);
assert(onlyFractions.total > 0 && onlyFractions.total < maths.total, 'domain filter narrows the subject');
assert(onlyFractions.items.every((topic) => topic.d === 'Fractions'), 'every listed skill is in the chosen domain');
const geometry = topics.find((topic) => codeOf(topic) === 'ma' && topic.d === 'Geometry' && topic.mask);
const domainPick = pickTarget(geometry.i, topics, subjects, { subject: 'ma', domain: 'Fractions', age: '', query: '' });
assert.strictEqual(topics.find((topic) => topic.i === domainPick).d, 'Fractions', 'domain filter moves the selection into that domain');

const young = filterSkills(topics, subjects, { subject: 'ma', domain: '', age: '4-6', query: '' }, 500);
assert(young.total > 0 && young.total < maths.total, 'age filter narrows the subject');
assert(young.items.every((topic) => topic.b >= 4 && topic.a <= 6), 'age filter keeps overlapping ages only');
const older = topics.find((topic) => codeOf(topic) === 'ma' && topic.a >= 12 && topic.mask);
const agePick = pickTarget(older.i, topics, subjects, { subject: 'ma', domain: '', age: '4-6', query: '' });
const pickedAge = topics.find((topic) => topic.i === agePick);
assert(pickedAge.a <= 6 && pickedAge.b >= 4, 'age filter moves the selection into that band');

const both = filterSkills(topics, subjects, { subject: 'ma', domain: 'Fractions', age: '9-11', query: '' }, 500);
assert(both.items.every((topic) => topic.d === 'Fractions' && topic.b >= 9 && topic.a <= 11), 'domain and age apply together');
assert(both.total < onlyFractions.total, 'adding an age band narrows the domain list');

const refraction = filterSkills(topics, subjects, { subject: 'sc', domain: '', age: '', query: 'fra' }, 20);
assert(refraction.items.some((topic) => topic.n === 'Reflection & Refraction'), 'science plus a search shows Reflection and Refraction');
assert(!refraction.items.some((topic) => topic.i === fractions), 'science search does not keep adding fractions');

const suggested = filterSkills(topics, subjects, { subject: '', domain: '', age: '', query: '' }, 40, catalog.starters);
assert(suggested.browsing, 'an empty filter shows suggested skills');
assert(suggested.items.some((topic) => codeOf(topic) === 'ma') && suggested.items.some((topic) => codeOf(topic) === 'en'), 'suggestions start in mathematics and english');
assert.strictEqual(pickTarget(fractions, topics, subjects, { subject: '', domain: '', age: '', query: '' }), fractions, 'clearing filters keeps the current skill');

const fractionsTopic = topics.find((topic) => topic.i === fractions);
assert(fractionsTopic.ac.includes('AC9M5N05') && fractionsTopic.ac.includes('AC9M6N05'), 'adding fractions keeps its Australian Curriculum v9 codes');
assert(!JSON.stringify(catalog.acara).includes('uk-nc') && !JSON.stringify(catalog.acara).includes('ccss'), 'only acara-v9 codes are kept');
const withoutCurriculum = topics.find((topic) => topic.mask && !topic.ac.length);
const curriculumOnly = filterSkills(topics, subjects, { subject: '', domain: '', age: '', curriculum: true, query: '' }, 800);
assert(curriculumOnly.total > 0 && curriculumOnly.total < topics.filter((topic) => topic.mask).length, 'the curriculum filter narrows the list');
assert(curriculumOnly.items.every((topic) => topic.ac.length), 'every listed skill has an Australian Curriculum code');
assert(!curriculumOnly.items.some((topic) => topic.i === withoutCurriculum.i), 'a skill without a code is left out');
assert.notStrictEqual(
  pickTarget(withoutCurriculum.i, topics, subjects, { subject: '', domain: '', age: '', curriculum: true, query: '' }),
  withoutCurriculum.i,
  'the curriculum filter moves the selection onto a tagged skill'
);

console.log('filter checks passed');
