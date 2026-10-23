#!/usr/bin/env python3
"""Check the built Gap Finder data, credit, and that student records are not shipped."""

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
failed = 0


def check(ok: bool, message: str) -> None:
    global failed
    if ok:
        print(f"ok  {message}")
    else:
        failed += 1
        print(f"FAIL {message}", file=sys.stderr)


html = (PUBLIC / "index.html").read_text(encoding="utf-8")
match = re.search(r'<script id="catalog" type="application/json">(.*?)</script>', html)
check(match is not None and "__CATALOG__" not in html, "catalog is embedded in the page")
catalog = json.loads(match.group(1).replace("<\\/", "</"))
check(catalog["v"] == "v1", "catalog version is v1")
check(len(catalog["subjects"]) == 9, "all nine subjects are listed")
recommended = [subject["c"] for subject in catalog["subjects"] if subject["r"]]
check(recommended == ["ma", "en"], "Mathematics and English are the recommended starts")
check(catalog["default"] == "mt_-V7EnqU7gG", "the default skill is adding fractions")
credit = catalog["attribution"]
for phrase in ("ODbL 1.0", "CC BY-SA 4.0", "https://withmarble.com", "https://github.com/withmarbleapp/os-taxonomy", "starting point, not a diagnosis"):
    check(phrase in json.dumps(credit), f"catalog credit includes {phrase}")
    check(phrase in html, f"page includes {phrase}")

by_subject = {}
for subject in catalog["subjects"]:
    path = PUBLIC / subject["f"]
    check(path.is_file(), f"{subject['f']} exists")
    data = json.loads(path.read_text(encoding="utf-8"))
    check(data["attribution"]["databaseLicence"] == "ODbL 1.0", f"{subject['c']} file carries the database licence")
    by_subject[subject["c"]] = data

# Starters may live in that subject. Check directly.
for subject in catalog["subjects"]:
    ids = {topic["i"] for topic in by_subject[subject["c"]]["topics"]}
    for starter in catalog["starters"][subject["c"]]:
        check(starter in ids, f"starter {starter} is in {subject['n']}")

topics = {}
pre = defaultdict(list)
for data in by_subject.values():
    for topic in data["topics"]:
        topics[topic["i"]] = topic
    for edge in data["edges"]:
        pre[edge[0]].append(edge[1])
check(len(topics) == 1930, f"all 1930 skills are bundled ({len(topics)} found)")
check(all(prereq in topics for prereqs in pre.values() for prereq in prereqs), "every prerequisite points at a skill")

memo = {}

def anc(topic_id: str, stack=None) -> set[str]:
    if topic_id in memo:
        return memo[topic_id]
    stack = stack or set()
    if topic_id in stack:
        return set()
    stack.add(topic_id)
    found = set()
    for prereq in pre.get(topic_id, []):
        found.add(prereq)
        found |= anc(prereq, stack)
    stack.remove(topic_id)
    memo[topic_id] = found
    return found

source_topics = json.loads((ROOT / "source/data/topics.json").read_text(encoding="utf-8"))["topics"]
source_deps = json.loads((ROOT / "source/data/dependencies.json").read_text(encoding="utf-8"))["dependencies"]
source_ids = {topic["id"] for topic in source_topics}
source_pre = defaultdict(list)
for edge in source_deps:
    if edge["topicId"] in source_ids and edge["prerequisiteId"] in source_ids:
        source_pre[edge["topicId"]].append(edge["prerequisiteId"])
source_memo = {}

def source_anc(topic_id: str, stack=None) -> set[str]:
    if topic_id in source_memo:
        return source_memo[topic_id]
    stack = stack or set()
    if topic_id in stack:
        return set()
    stack.add(topic_id)
    found = set()
    for prereq in source_pre.get(topic_id, []):
        found.add(prereq)
        found |= source_anc(prereq, stack)
    stack.remove(topic_id)
    source_memo[topic_id] = found
    return found

default = catalog["default"]
check(anc(default) == source_anc(default), "built prerequisite closure matches the Marble source")
check(len(anc(default)) == 31, "adding fractions has the expected 31 underlying skills")

app = (PUBLIC / "app.js").read_text(encoding="utf-8")
check("JSON.stringify(payload)" in app, "feedback sends only the explicit payload")
check("gapfinder:students:v1" in app, "marks use browser storage")
check("https://withmarble.com" in app and "ODbL 1.0" in app and "CC BY-SA 4.0" in app, "exports include the Marble credit")
check("This link looks wrong" in app, "each prerequisite link can be flagged")
check("Teach next" in app and "Check these first" in app and "Secure, and all below" in app, "core teaching actions are present")
for needle in ("david@", "cubedigital", "localStorage.getItem('gap:marks')"):
    check(needle not in html and needle not in app, f"{needle} is not in the page")

joined = html + app + (PUBLIC / "feedback.php").read_text(encoding="utf-8")
check("info@betterschools.com.au" not in joined, "the public page does not embed the feedback inbox")

if failed:
    print(f"{failed} failed", file=sys.stderr)
    sys.exit(1)
print("path checks passed")
