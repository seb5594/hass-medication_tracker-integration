"""Releases keep the YYYY.M.D.B version scheme of the original project, e.g. 2026.10.20.0."""
import json
import re
from datetime import date
from pathlib import Path

version = json.loads(Path("custom_components/medication_tracker/manifest.json").read_text())["version"]
found = re.fullmatch(r"(\d{4})\.(\d{1,2})\.(\d{1,2})\.(\d+)", version)
assert found, f"Version {version} must look like YYYY.M.D.B, e.g. 2026.10.20.0"
date(*map(int, found.groups()[:3]))  # raises ValueError for an impossible date
print(f"Version {version} follows YYYY.M.D.B")
