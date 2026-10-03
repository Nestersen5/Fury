"""Make contact sheets for human review of every full-trial HUD toggle screenshot."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3] / "output" / "anticheat-lab" / "mod-real"
part = sys.argv[1]
assert part in ("autoblock", "scaffold")
base = ROOT / ("scaffold" if part == "scaffold" else "")
plan = json.loads((base / f"FULL_PLAN_{part}.json").read_text())
exclusion_file = base / "FULL_EXCLUSIONS.json"
excluded_runs = json.loads(exclusion_file.read_text())["runs"] if exclusion_file.exists() else {}
addendum_file = base / "FULL_PROTOCOL_ADDENDUM.json"
addendum = json.loads(addendum_file.read_text()) if addendum_file.exists() else None
replay_exclusions_file = base / "FULL_REPLAY_EXCLUSIONS.json"
replay_exclusions = json.loads(replay_exclusions_file.read_text())["runs"] if replay_exclusions_file.exists() else {}
arguments = sys.argv[2:]
unreviewed = "--unreviewed" in arguments
review_file = base / "FULL_HUD_REVIEW.json"
reviews = json.loads(review_file.read_text()) if review_file.exists() else {}
out = base / ("hud-sheets-unreviewed" if unreviewed else "hud-sheets")
out.mkdir(exist_ok=True)
font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 16)

items = []
for spec in plan["trials"]:
    attempts = sorted(file for file in base.glob(f"full-*/{spec['id']}/attempt-*/ground-truth.json")
                      if file.parents[2].name not in excluded_runs and
                      spec["id"] not in replay_exclusions.get(file.parents[2].name, {}) and
                      not (addendum and spec["id"] in addendum["correctionIds"] and
                           file.parents[2].name == addendum["supersededRun"]))
    if not attempts:
        continue
    chosen = None
    for file in attempts:
        truth = json.loads(file.read_text())
        if truth.get("automatedValid"):
            chosen = file.parent
            break
    if chosen is None:
        chosen = attempts[-1].parent
    if unreviewed and reviews.get(chosen.relative_to(base).as_posix(), {}).get("status") == "confirmed":
        continue
    names = ["hud_all_off.png"] + [f"hud_after_{name.lower()}.png" for name in spec["enabled"]]
    items.append((spec, chosen, names))

cols, crop_w, crop_h, label_h, rows_per_sheet = 4, 668, 92, 32, 8
for sheet_no in range((len(items) + rows_per_sheet - 1) // rows_per_sheet):
    group = items[sheet_no * rows_per_sheet:(sheet_no + 1) * rows_per_sheet]
    canvas = Image.new("RGB", (cols * crop_w, len(group) * (crop_h + label_h)), "#242424")
    draw = ImageDraw.Draw(canvas)
    for i, (spec, directory, names) in enumerate(group):
        y = i * (crop_h + label_h)
        for j, name in enumerate(names):
            file = directory / name
            label = ("ALL OFF" if j == 0 else f"+{spec['enabled'][j-1]}")
            draw.text((j * crop_w + 5, y + 2), f"{spec['id']}  {label}  {directory.parent.name}", fill="white", font=font)
            if file.exists():
                with Image.open(file) as shot:
                    canvas.paste(shot.convert("RGB").crop((300, 30, 968, 122)), (j * crop_w, y + label_h))
            else:
                draw.text((j * crop_w + 5, y + label_h + 10), "MISSING SCREENSHOT", fill="red", font=font)
    file = out / f"sheet-{sheet_no + 1:02d}.png"
    canvas.save(file)
confirm_arg = next((arg for arg in arguments if arg.startswith("--confirm-sheet=")), None)
if confirm_arg:
    sheet_no = int(confirm_arg.split("=", 1)[1])
    group = items[(sheet_no - 1) * rows_per_sheet:sheet_no * rows_per_sheet]
    assert len(group) == rows_per_sheet, "Review only a complete eight-trial sheet"
    review = json.loads(review_file.read_text()) if review_file.exists() else {}
    for spec, directory, names in group:
        assert all((directory / name).exists() for name in names)
        key = directory.relative_to(base).as_posix()
        review[key] = {"status": "confirmed", "note": f"Manually inspected all-off and every toggle in {out.name}/sheet-{sheet_no:02d}.png"}
    review_file.write_text(json.dumps(review, indent=2) + "\n")
print(json.dumps({"part": part, "trialScreenshots": len(items), "sheets": (len(items) + rows_per_sheet - 1) // rows_per_sheet,
                  "output": str(out)}))
