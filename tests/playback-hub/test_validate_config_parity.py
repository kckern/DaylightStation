"""
Asserts validate_config.py rejects every invalid/*.yml fixture and accepts
every valid/*.yml fixture, producing the canonical JSON in *.expected.json.

The JS-side parity test will be added later in a separate task.
Both must stay in lockstep.
"""
import json
import subprocess
import sys
from pathlib import Path

FIXTURES = Path(__file__).parent.parent / "fixtures" / "playback-hub"
VALIDATOR = (
    Path(__file__).parent.parent.parent
    / "_extensions" / "playback-hub" / "validate_config.py"
)


def run_validator(yml_path):
    """Returns (returncode, stdout, stderr) tuple."""
    result = subprocess.run(
        [sys.executable, str(VALIDATOR), str(yml_path)],
        capture_output=True, text=True, timeout=5
    )
    return result.returncode, result.stdout, result.stderr


def test_invalid_fixtures_all_rejected():
    """Every invalid/*.yml must exit non-zero."""
    invalid_files = sorted((FIXTURES / "invalid").glob("*.yml"))
    assert len(invalid_files) >= 11, (
        f"expected at least 11 invalid fixtures, got {len(invalid_files)}"
    )
    for f in invalid_files:
        rc, _, err = run_validator(f)
        assert rc != 0, (
            f"fixture {f.name} should have been REJECTED but validator accepted it"
        )
        assert "config validation failed" in err, (
            f"fixture {f.name} rejected without the expected error prefix; stderr={err!r}"
        )


def test_valid_fixtures_all_accepted_and_canonical():
    """Every valid/*.yml must exit 0 and produce the matching .expected.json."""
    valid_files = sorted((FIXTURES / "valid").glob("*.yml"))
    assert len(valid_files) >= 2, (
        f"expected at least 2 valid fixtures, got {len(valid_files)}"
    )
    for yml_path in valid_files:
        expected_path = yml_path.with_suffix(".expected.json")
        assert expected_path.exists(), f"missing expected JSON for {yml_path.name}"
        rc, stdout, err = run_validator(yml_path)
        assert rc == 0, (
            f"fixture {yml_path.name} should have been ACCEPTED, but rc={rc} stderr={err!r}"
        )
        actual = json.loads(stdout)
        expected = json.loads(expected_path.read_text())
        assert actual == expected, (
            f"fixture {yml_path.name} normalized to:\n"
            f"{json.dumps(actual, indent=2)}\n"
            f"but expected:\n{json.dumps(expected, indent=2)}"
        )
