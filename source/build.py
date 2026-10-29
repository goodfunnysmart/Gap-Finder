#!/usr/bin/env python3
"""Rebuild the Gap Finder site data from the Marble taxonomy.

Usage (from anywhere):
    python3 source/build.py

Reads source/data/topics.json and source/data/dependencies.json plus
source/template.html. Writes public/index.html (catalog embedded) and
public/data/<subject>.json (full skill text and prerequisite reasons).

The Marble files are not rewritten. No student records are read or written.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(__file__).resolve().parent / "data"
TEMPLATE = Path(__file__).resolve().parent / "template.html"
PUBLIC = ROOT / "public"
OUT_DATA = PUBLIC / "data"

# Stable codes. Bit order in the catalog mask follows this list.
SUBJECTS = [
    ("ma", "Mathematics", True),
    ("en", "English", True),
    ("sc", "Science", False),
    ("hi", "History", False),
    ("ge", "Geography", False),
    ("co", "Computing", False),
    ("ls", "Life Skills", False),
    ("ps", "Personal & Social Development", False),
    ("ll", "Learning to Learn", False),
]

DEFAULT_ID = "mt_-V7EnqU7gG"  # Adding fractions (different denominators)
NOTE = (
    "This is a starting point, not a diagnosis. Ages are approximate and the "
    "taxonomy is not written for learners with additional needs. Treat "
    "prerequisite links as a starting point and use professional judgement."
)
ATTRIBUTION = {
    "title": "Marble Skill Taxonomy (v1)",
    "copyright": "© Generative Spark, Inc. (Marble)",
    "url": "https://withmarble.com",
    "databaseLicence": "ODbL 1.0",
    "contentLicence": "CC BY-SA 4.0",
    "source": "https://github.com/withmarbleapp/os-taxonomy",
    "standards": (
        "Curriculum standards referenced by the taxonomy have their own upstream "
        "licences (see PROVENANCE.md in that repository)."
    ),
    "note": NOTE,
}
ALIASES = {
    "ma": ["maths", "math", "numeracy"],
    "en": ["literacy", "reading", "writing"],
    "sc": ["science"],
    "hi": ["history"],
    "ge": ["geography"],
    "co": ["computing", "digital", "coding"],
    "ls": ["life skills"],
    "ps": ["personal", "social", "wellbeing"],
    "ll": ["learning to learn", "metacognition"],
}


def load() -> tuple[list[dict], list[dict]]:
    topics_doc = json.loads((DATA / "topics.json").read_text(encoding="utf-8"))
    deps_doc = json.loads((DATA / "dependencies.json").read_text(encoding="utf-8"))
    topics = topics_doc["topics"]
    deps = deps_doc["dependencies"]
    if topics_doc.get("version") != "v1":
        raise SystemExit("Expected Marble taxonomy version v1")
    return topics, deps


def ancestor_counts(topics: list[dict], deps: list[dict]) -> dict[str, int]:
    ids = {t["id"] for t in topics}
    pre: dict[str, list[str]] = defaultdict(list)
    for edge in deps:
        if edge["topicId"] in ids and edge["prerequisiteId"] in ids:
            pre[edge["topicId"]].append(edge["prerequisiteId"])
    memo: dict[str, set[str]] = {}

    def anc(topic_id: str, stack: set[str] | None = None) -> set[str]:
        if topic_id in memo:
            return memo[topic_id]
        stack = stack or set()
        if topic_id in stack:
            return set()
        stack.add(topic_id)
        found: set[str] = set()
        for prereq in pre.get(topic_id, []):
            found.add(prereq)
            found |= anc(prereq, stack)
        stack.remove(topic_id)
        memo[topic_id] = found
        return found

    return {topic_id: len(anc(topic_id)) for topic_id in ids}


def closure_masks(topics: list[dict], deps: list[dict], index_of: dict[str, int]) -> dict[str, int]:
    subject_of = {t["id"]: t["subject"] for t in topics}
    code_of = {name: code for code, name, _recommended in SUBJECTS}
    bit_of = {code: 1 << index for index, (code, _name, _rec) in enumerate(SUBJECTS)}
    ids = set(subject_of)
    pre: dict[str, list[str]] = defaultdict(list)
    for edge in deps:
        if edge["topicId"] in ids and edge["prerequisiteId"] in ids:
            pre[edge["topicId"]].append(edge["prerequisiteId"])
    memo: dict[str, int] = {}

    def mask(topic_id: str, stack: set[str] | None = None) -> int:
        if topic_id in memo:
            return memo[topic_id]
        stack = stack or set()
        if topic_id in stack:
            return 0
        stack.add(topic_id)
        bits = 0
        for prereq in pre.get(topic_id, []):
            code = code_of[subject_of[prereq]]
            bits |= bit_of[code]
            bits |= mask(prereq, stack)
        stack.remove(topic_id)
        memo[topic_id] = bits
        return bits

    return {topic_id: mask(topic_id) for topic_id in ids}


def pick_starters(topics: list[dict], counts: dict[str, int], subject: str) -> list[str]:
    def collect(min_n: int, max_n: int, min_age: int, max_age: int) -> list[dict]:
        found = []
        for topic in topics:
            if topic["subject"] != subject:
                continue
            count = counts[topic["id"]]
            if count < min_n or count > max_n:
                continue
            if topic["ageRangeEnd"] < min_age or topic["ageRangeStart"] > max_age:
                continue
            found.append(topic)
        found.sort(key=lambda topic: (-float(topic["centrality"]), topic["name"]))
        return found

    pools = (
        collect(3, 36, 6, 12),
        collect(2, 80, 5, 14),
        collect(1, 10_000, 0, 99),
    )
    picked: list[str] = []
    used_domains: set[str] = set()
    for pool in pools:
        for topic in pool:
            if topic["id"] in picked or topic["domain"] in used_domains:
                continue
            picked.append(topic["id"])
            used_domains.add(topic["domain"])
            if len(picked) == 4:
                return picked
        if len(picked) >= 2 and pool is pools[0]:
            break
    for pool in pools:
        for topic in pool:
            if topic["id"] not in picked:
                picked.append(topic["id"])
            if len(picked) == 4:
                return picked
    if not picked:
        raise SystemExit(f"No starter skills for {subject}")
    return picked


def acara_codes(topic: dict) -> list[str]:
    found: list[str] = []
    for entry in topic.get("standards") or []:
        if not isinstance(entry, str) or not entry.startswith("acara-v9:"):
            continue
        code = entry.split(":", 1)[1].strip()
        if code and code not in found:
            found.append(code)
    return found


def compact_topic(topic: dict) -> dict:
    return {
        "i": topic["id"],
        "d": topic["domain"],
        "n": topic["name"],
        "ds": topic["description"],
        "a": topic["ageRangeStart"],
        "b": topic["ageRangeEnd"],
        "c": round(float(topic["centrality"]), 4),
        "e": topic["evidence"],
        "p": topic["assessmentPrompt"],
    }


def dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def main() -> None:
    topics, deps = load()
    names = [name for _code, name, _rec in SUBJECTS]
    found = sorted({t["subject"] for t in topics})
    if found != sorted(names):
        raise SystemExit(f"Subject list does not match the taxonomy: {found}")
    by_id = {t["id"]: t for t in topics}
    if DEFAULT_ID not in by_id:
        raise SystemExit("Default skill is missing from the taxonomy")
    if by_id[DEFAULT_ID]["name"] != "Adding fractions (different denominators)":
        raise SystemExit("Default skill id no longer matches Adding fractions")

    counts = ancestor_counts(topics, deps)
    index_of = {name: index for index, (_code, name, _rec) in enumerate(SUBJECTS)}
    masks = closure_masks(topics, deps, index_of)
    code_of = {name: code for code, name, _rec in SUBJECTS}

    starters = {code: pick_starters(topics, counts, name) for code, name, _rec in SUBJECTS}
    if DEFAULT_ID not in starters["ma"]:
        starters["ma"] = [DEFAULT_ID] + [item for item in starters["ma"] if item != DEFAULT_ID][:3]

    catalog_topics = []
    for topic in topics:
        catalog_topics.append([
            topic["id"],
            index_of[topic["subject"]],
            topic["domain"],
            topic["name"],
            topic["ageRangeStart"],
            topic["ageRangeEnd"],
            round(float(topic["centrality"]), 4),
            masks[topic["id"]],
        ])

    catalog = {
        "v": "v1",
        "attribution": ATTRIBUTION,
        "default": DEFAULT_ID,
        "subjects": [
            {"c": code, "n": name, "r": 1 if recommended else 0, "f": f"data/{code}.json", "a": ALIASES[code]}
            for code, name, recommended in SUBJECTS
        ],
        "starters": starters,
        "acara": {
            topic["id"]: acara_codes(topic)
            for topic in topics
            if acara_codes(topic)
        },
        "topics": catalog_topics,
    }

    OUT_DATA.mkdir(parents=True, exist_ok=True)
    kept_edges = 0
    for code, name, _recommended in SUBJECTS:
        subject_topics = [t for t in topics if t["subject"] == name]
        ids = {t["id"] for t in subject_topics}
        edges = []
        for edge in deps:
            if edge["topicId"] not in ids or edge["prerequisiteId"] not in by_id:
                continue
            if edge["strength"] not in ("hard", "soft"):
                raise SystemExit(f"Unexpected strength {edge['strength']!r}")
            edges.append([
                edge["topicId"],
                edge["prerequisiteId"],
                1 if edge["strength"] == "hard" else 0,
                edge.get("reason") or "",
            ])
            kept_edges += 1
        payload = {
            "v": "v1",
            "attribution": ATTRIBUTION,
            "code": code,
            "subject": name,
            "topics": [compact_topic(topic) for topic in subject_topics],
            "edges": edges,
        }
        (OUT_DATA / f"{code}.json").write_text(dumps(payload), encoding="utf-8")

    if kept_edges == 0:
        raise SystemExit("No prerequisite links were written")

    html = TEMPLATE.read_text(encoding="utf-8")
    if "__CATALOG__" not in html:
        raise SystemExit("template.html is missing __CATALOG__")
    html = html.replace("__CATALOG__", dumps(catalog))
    if "__CATALOG__" in html:
        raise SystemExit("Catalog placeholder was not replaced")
    (PUBLIC / "index.html").write_text(html, encoding="utf-8")

    catalog_bytes = len(dumps(catalog).encode("utf-8"))
    print(f"Wrote public/index.html with catalog ({catalog_bytes} bytes)")
    print(f"Wrote {len(SUBJECTS)} subject files, {len(topics)} skills, {kept_edges} links")
    for code, name, recommended in SUBJECTS:
        path = OUT_DATA / f"{code}.json"
        mark = "recommended" if recommended else "available"
        print(f"  {code} {name}: {path.stat().st_size} bytes ({mark})")


if __name__ == "__main__":
    main()
