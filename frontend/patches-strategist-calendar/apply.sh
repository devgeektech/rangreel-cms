#!/usr/bin/env bash
# Installs strategist calendar: reels + static posts + carousels.
# Run from repo root:   sudo bash frontend/patches-strategist-calendar/apply.sh
# Or from frontend/:    sudo bash patches-strategist-calendar/apply.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CAL_SRC="$SCRIPT_DIR/StrategistReelCalendar.jsx"
CAL_DST="$FRONTEND_ROOT/components/strategist/StrategistReelCalendar.jsx"
PAGE="$FRONTEND_ROOT/app/(dashboard)/strategist/page.jsx"

if [[ ! -f "$CAL_SRC" ]]; then
  echo "Missing $CAL_SRC" >&2
  exit 1
fi

echo "Copying StrategistReelCalendar.jsx -> $CAL_DST"
cp "$CAL_SRC" "$CAL_DST"

echo "Patching strategist page.jsx (plan calendar entries)"
python3 << PY
from pathlib import Path
p = Path(r"$PAGE")
text = p.read_text(encoding="utf-8")
old = """  const reelPlanEntries = useMemo(
    () =>
      planStages.filter(
        (e) =>
          String(e.contentType || "").toLowerCase() === "reel" && isPlanPendingStage(e.stage)
      ),
    [planStages]
  );"""
new = """  const planCalendarEntries = useMemo(
    () =>
      planStages.filter((e) => {
        const ct = String(e.contentType || "").toLowerCase();
        const onCalendar =
          ct === "reel" || ct === "static_post" || ct === "carousel";
        return onCalendar && isPlanPendingStage(e.stage);
      }),
    [planStages]
  );"""
if old not in text:
    raise SystemExit("page.jsx: expected reelPlanEntries block not found — edit manually or merge")
text = text.replace(old, new, 1)
text = text.replace(
    "Plan, submit, and keep content aligned — reels on the calendar, all tasks below.",
    "Plan, submit, and keep content aligned — calendar shows reels, posts, and carousels; full task list below.",
)
text = text.replace("reelPlanEntries.length", "planCalendarEntries.length")
text = text.replace("reelPlanEntries={reelPlanEntries}", "planEntries={planCalendarEntries}")
p.write_text(text, encoding="utf-8")
print("page.jsx updated OK")
PY

echo "Done."
