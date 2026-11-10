# Calculator rubric CSV

Runtime rubrics live in `src/scoring/rubrics/`. The analytics calculator loads
the default file through `src.scoring.load_rubric()` and accepts another loaded
rubric through `score_transcribe_items(..., rubric=...)`.

Required columns:

| Column | Purpose |
| --- | --- |
| `rubric_version` | Version returned with analytics results. |
| `minimum_speaking_seconds` | Minimum estimated speech required for scoring. |
| `metric` | Calculator metric receiving the score. |
| `score` | Integer score from 0 through 4. |
| `min_value`, `max_value` | Band boundaries; blank means unbounded. |
| `min_inclusive`, `max_inclusive` | `true` or `false`; blank when unbounded. |

Every row in a file must use the same version and minimum speaking duration.
Each possible metric value must match exactly one band. To create a new rubric,
copy the current CSV, change its version or thresholds, and load that file.

Filler detection, pause detection, and metric formulas stay in Python because
they define the measurements themselves. The rubric CSV only maps those
measurements to eligibility and scores.
