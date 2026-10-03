"""Immutable HUD review sheets: confirmation uses the saved sheet manifest."""
import json, sys, time
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3] / 'output' / 'anticheat-lab' / 'mod-real'
if sys.argv[1] == 'confirm':
    manifest = json.loads(Path(sys.argv[2]).read_text())
    number = int(sys.argv[3])
    entries = manifest['sheets'][number - 1]
    review_file = Path(manifest['reviewFile'])
    reviews = json.loads(review_file.read_text()) if review_file.exists() else {}
    for entry in entries:
        assert all(Path(file).exists() for file in entry['files'])
        reviews[entry['key']] = {'status': 'confirmed', 'note': f"Manually inspected {manifest['directory']}/sheet-{number:02d}.png; immutable manifest"}
    review_file.write_text(json.dumps(reviews, indent=2) + '\n')
    print(json.dumps({'confirmed': [entry['id'] for entry in entries]}))
    sys.exit()

part = sys.argv[1]
pilot = '--pilot' in sys.argv
explicit_base = next((arg.split('=', 1)[1] for arg in sys.argv if arg.startswith('--base=')), None)
data_root = Path(explicit_base).resolve() if explicit_base else ROOT / 'improvements' / 'fresh' if '--fresh' in sys.argv else ROOT
base = data_root / (part if part in ['scaffold', 'jump-reset'] else '')
plan_file = ('PILOT_PLAN.json' if pilot else 'FULL_PLAN.json') if part == 'jump-reset' else f'FULL_PLAN_{part}.json'
plan = json.loads((base / plan_file).read_text())
review_file = base / ('PILOT_HUD_REVIEW.json' if pilot else 'FULL_HUD_REVIEW.json')
reviews = json.loads(review_file.read_text()) if review_file.exists() else {}
def optional(name, default):
    file = base / name
    return json.loads(file.read_text()) if file.exists() else default
excluded = optional('FULL_EXCLUSIONS.json', {'runs': {}})['runs']
replay_excluded = optional('FULL_REPLAY_EXCLUSIONS.json', {'runs': {}})['runs']
addendum = optional('FULL_PROTOCOL_ADDENDUM.json', None)
items = []
for spec in plan['trials']:
    for file in sorted(base.glob(f"{'pilot' if pilot else 'full'}-*/{spec['id']}/attempt-*/ground-truth.json")):
        run = file.parents[2].name
        if run in excluded or spec['id'] in replay_excluded.get(run, {}): continue
        if addendum and run == addendum['supersededRun'] and spec['id'] in addendum['correctionIds']: continue
        truth = json.loads(file.read_text())
        if not truth.get('automatedValid'): continue
        if part == 'scaffold' and spec['scenarioId'] == 'L10' and (base / 'CAREFUL_CONTROL_ADDENDUM.json').exists() and len(truth.get('intentionalAirClicks', [])) < 3: continue
        if part == 'jump-reset' and pilot and spec['scenarioId'] in ['L13', 'L14', 'L15'] and truth.get('inputProtocol') != 'actor-view-controls-v2': continue
        if addendum and spec['id'] in addendum['correctionIds'] and not truth.get('protocolBehavior'): continue
        directory = file.parent
        key = directory.relative_to(base).as_posix()
        if reviews.get(key, {}).get('status') in ['invalid', 'rejected']: continue
        if reviews.get(key, {}).get('status') != 'confirmed':
            names = ['hud_all_off.png'] + [f"hud_after_{name.lower()}.png" for name in spec['enabled']]
            items.append({'id': spec['id'], 'key': key, 'names': names, 'files': [str(directory / name) for name in names]})
        break
out = base / f'hud-review-{time.time_ns()}'
out.mkdir()
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 16)
sheets = [items[i:i + 8] for i in range(0, len(items), 8)]
for number, entries in enumerate(sheets, 1):
    canvas = Image.new('RGB', (4 * 668, len(entries) * 124), '#242424')
    draw = ImageDraw.Draw(canvas)
    for row, entry in enumerate(entries):
        for column, (name, file) in enumerate(zip(entry['names'], entry['files'])):
            draw.text((column * 668 + 4, row * 124 + 3), f"{entry['id']}  {name}", fill='white', font=font)
            if Path(file).exists():
                with Image.open(file) as shot:
                    canvas.paste(shot.convert('RGB').crop((300, 30, 968, 122)), (column * 668, row * 124 + 32))
            else: draw.text((column * 668 + 4, row * 124 + 40), 'MISSING', fill='red', font=font)
    canvas.save(out / f'sheet-{number:02d}.png')
manifest = {'part': part, 'reviewFile': str(review_file), 'directory': str(out), 'sheets': sheets}
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2))
print(json.dumps({'trials': len(items), 'sheets': len(sheets), 'manifest': str(out / 'manifest.json')}))
