#!/usr/bin/env python3
"""Run deterministic author-side checks before a BFN bank reaches a reviewer.

The production validator intentionally requires an independent approval. This
wrapper supplies a marked-pending approval record, filters just those expected
missing-approval errors, and fails on every author-controlled defect instead.
It gives authors one local repair loop rather than consuming a blind reviewer
for answer-shape, source, count, hash, or author-review mistakes.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


ABSOLUTE_WORDS = re.compile(r"\b(?:always|every|guarantee|never|only)\b", re.IGNORECASE)
MISSING_APPROVAL = re.compile(r"^.+: missing independent approval record$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bfn_root", type=Path, help="Big Fat Notebook source root")
    parser.add_argument("chapter", type=Path, help="One authored chapter directory")
    parser.add_argument("--expected-items", type=int, choices=(5, 18), default=18)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    sys.path.insert(0, str(args.bfn_root))
    from validate_question_banks import (  # pylint: disable=import-outside-toplevel
        APPROVAL_SCHEMA,
        document_sha256,
        read,
        validate,
    )

    worksheet = args.chapter / "worksheet.yml"
    author_review = args.chapter / "author-review.yml"
    try:
        bank = read(worksheet)
        author = read(author_review)
    except (OSError, ValueError) as error:
        raise SystemExit(f"REJECTED: cannot load author artifacts: {error}") from error

    bank_id = bank.get("id")
    pending_approval = {
        "schema": APPROVAL_SCHEMA,
        "bank": bank_id,
        "source_bank_sha256": document_sha256(bank),
        "reviewer": "pending-independent-reviewer",
        "items": {},
    }
    errors = validate(bank, author, pending_approval, expected_items=args.expected_items)
    author_errors = [error for error in errors if not MISSING_APPROVAL.match(error)]
    if author_errors:
        print("REJECTED author preflight")
        print("\n".join(author_errors))
        raise SystemExit(1)

    warnings: list[str] = []
    for item in bank.get("items", []):
        if not isinstance(item, dict):
            continue
        for decoy in item.get("decoys", []):
            if isinstance(decoy, str) and ABSOLUTE_WORDS.search(decoy):
                warnings.append(f"{item.get('id', '<unknown>')}: absolute-language decoy: {decoy!r}")

    print(
        "APPROVED author preflight: "
        f"{args.expected_items} items, canonical hash {document_sha256(bank)}"
    )
    if warnings:
        print("WARNINGS — resolve before independent review:")
        print("\n".join(warnings))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
