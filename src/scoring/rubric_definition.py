"""Load score bands used by the speaking analytics calculator."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
import math
from pathlib import Path
from typing import Mapping


DEFAULT_RUBRIC_PATH = (
    Path(__file__).resolve().parent / "rubrics" / "speaking-2026-10-31.csv"
)
REQUIRED_COLUMNS = (
    "rubric_version",
    "minimum_speaking_seconds",
    "metric",
    "score",
    "min_value",
    "min_inclusive",
    "max_value",
    "max_inclusive",
)


@dataclass(frozen=True)
class ScoreBand:
    """One numeric interval mapped to a rubric score."""

    score: int
    min_value: float | None
    min_inclusive: bool | None
    max_value: float | None
    max_inclusive: bool | None

    def contains(self, value: float) -> bool:
        """Return whether value is inside this interval."""

        if self.min_value is not None:
            if value < self.min_value or (
                value == self.min_value and not self.min_inclusive
            ):
                return False
        if self.max_value is not None:
            if value > self.max_value or (
                value == self.max_value and not self.max_inclusive
            ):
                return False
        return True


@dataclass(frozen=True)
class RubricDefinition:
    """Validated eligibility and score bands for one rubric version."""

    version: str
    minimum_speaking_seconds: float
    bands: Mapping[str, tuple[ScoreBand, ...]]

    def score(self, metric: str, value: float) -> int:
        """Return the unique score band for a measured metric value."""

        if not math.isfinite(value):
            raise ValueError(f"Metric {metric} must be finite")
        matches = [band.score for band in self.bands.get(metric, ()) if band.contains(value)]
        if len(matches) != 1:
            raise ValueError(
                f"Rubric {self.version} has {len(matches)} matching bands for "
                f"{metric}={value}"
            )
        return matches[0]


@lru_cache(maxsize=16)
def load_rubric(path: str | Path = DEFAULT_RUBRIC_PATH) -> RubricDefinition:
    """Load and validate one calculator-ready rubric CSV."""

    rubric_path = Path(path)
    with rubric_path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != REQUIRED_COLUMNS:
            raise ValueError("Rubric CSV columns do not match the required schema")
        rows = list(reader)
    if not rows:
        raise ValueError("Rubric CSV must contain at least one score band")

    versions = {row["rubric_version"].strip() for row in rows}
    minimums = {row["minimum_speaking_seconds"].strip() for row in rows}
    if len(versions) != 1 or "" in versions:
        raise ValueError("Rubric CSV must contain one non-empty version")
    if len(minimums) != 1:
        raise ValueError("Rubric CSV must contain one eligibility threshold")
    minimum_speaking_seconds = _finite_number(minimums.pop(), "minimum_speaking_seconds")
    if minimum_speaking_seconds < 0:
        raise ValueError("minimum_speaking_seconds cannot be negative")

    grouped: dict[str, list[ScoreBand]] = {}
    for row in rows:
        metric = row["metric"].strip()
        if not metric:
            raise ValueError("Rubric metric cannot be empty")
        try:
            score = int(row["score"])
        except ValueError as error:
            raise ValueError("Rubric scores must be integers") from error
        if not 0 <= score <= 4:
            raise ValueError("Rubric scores must be between 0 and 4")
        minimum, minimum_inclusive = _boundary(row, "min")
        maximum, maximum_inclusive = _boundary(row, "max")
        if minimum is not None and maximum is not None and minimum >= maximum:
            raise ValueError("Rubric band minimum must be less than maximum")
        grouped.setdefault(metric, []).append(
            ScoreBand(
                score,
                minimum,
                minimum_inclusive,
                maximum,
                maximum_inclusive,
            )
        )

    return RubricDefinition(
        version=versions.pop(),
        minimum_speaking_seconds=minimum_speaking_seconds,
        bands={metric: tuple(bands) for metric, bands in grouped.items()},
    )


def _boundary(row: Mapping[str, str], side: str) -> tuple[float | None, bool | None]:
    raw_value = row[f"{side}_value"].strip()
    raw_inclusive = row[f"{side}_inclusive"].strip()
    if not raw_value:
        if raw_inclusive:
            raise ValueError(f"Unbounded {side} cannot set inclusivity")
        return None, None
    if raw_inclusive not in {"true", "false"}:
        raise ValueError(f"Bounded {side} must set inclusivity to true or false")
    return _finite_number(raw_value, f"{side}_value"), raw_inclusive == "true"


def _finite_number(value: str, name: str) -> float:
    try:
        result = float(value)
    except ValueError as error:
        raise ValueError(f"{name} must be numeric") from error
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result
