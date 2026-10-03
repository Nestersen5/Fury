"""Standalone plots of completed cohorts only; existing matplotlib, no installs."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

BASE = Path(__file__).resolve().parents[3] / 'output' / 'anticheat-lab' / 'mod-real'
OUT = BASE / 'overnight' / 'figures'
OUT.mkdir(exist_ok=True)
COLORS = ['#64748b', '#d39313']

def load(relative):
    file = BASE / relative
    return json.loads(file.read_text(encoding='utf-8')) if file.exists() else None

def rates(ax, labels, variants, names):
    x = np.arange(len(labels))
    width = 0.75 / len(variants)
    for index, series in enumerate(variants):
        xx = x - 0.375 + width / 2 + index * width
        values = [100 * r['p'] for r in series]
        errors = [[max(0, 100 * (r['p'] - r['low'])) for r in series],
                  [max(0, 100 * (r['high'] - r['p'])) for r in series]]
        ax.bar(xx, values, width=width, label=names[index], color=COLORS[index],
               yerr=errors, capsize=3, error_kw={'elinewidth': 1})
        for where, value, rate in zip(xx, values, series):
            ax.text(where, max(100 * rate['high'] + 2, 5), f"{rate['k']}/{rate['n']}", ha='center', va='bottom', fontsize=9)
    ax.set_xticks(x, labels)
    ax.set_ylim(0, 112)
    ax.set_ylabel('Trials (%)')
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(axis='y', alpha=.18)
    ax.set_axisbelow(True)
    ax.legend(frameon=False)

def save(fig, name):
    fig.savefig(OUT / f'{name}.png', dpi=180, bbox_inches='tight')
    fig.savefig(OUT / f'{name}.svg', bbox_inches='tight')
    plt.close(fig)

a = load('overnight/measurement-autoblock/FULL_RESULTS.json')
if a:
    ids = ['C1','C2','C3','C4','C5','C6']
    labels = ['C1\nNoItemRelease','C2\nNoSlowdown','C3\nBlock + clicker','C4\nManual Block','C5\nAura + Block','C6\nCombined']
    fig = plt.figure(figsize=(13.5, 8))
    grid = fig.add_gridspec(2, 2, height_ratios=[1.3,1])
    top = fig.add_subplot(grid[0,:])
    axes = {(1,0): fig.add_subplot(grid[1,0]), (1,1): fig.add_subplot(grid[1,1])}
    rates(top, labels, [[a['stats'][v]['scenarios'][i]['targetAny'] for i in ids] for v in ['OLD','NEW']], ['OLD','NEW'])
    top.set_title('Original Autoblock: detection per cheat scenario — same recordings')
    rates(axes[1,0], ['Legit controls'], [[a['stats'][v]['overall']['falseAnyDetector']] for v in ['OLD','NEW']], ['OLD','NEW'])
    axes[1,0].set_title('False flags by any detector')
    axes[1,0].set_ylim(0, 20)
    details = load('overnight/measurement-autoblock/FULL_REPLAY_DETAILS.json')
    for index, variant in enumerate(['OLD','NEW']):
        times = []
        for trial in a['trials']:
            if not trial['effectExpected']: continue
            result = next(r for r in details['variants'][variant] if r['id'] == trial['id'])
            flags = [f for f in result['flags'] if f['family'] == 'Autoblock' and f['at'] >= trial['startedAt']]
            if flags: times.append((min(f['at'] for f in flags)-trial['startedAt'])/1000)
        times.sort()
        axes[1,1].step(times, np.arange(1,len(times)+1)/len(times), where='post', color=COLORS[index], label=f'{variant} (n={len(times)})')
    axes[1,1].set_title('Time to first flag — detected trials only')
    axes[1,1].set_xlabel('Seconds since logged active cheat start')
    axes[1,1].set_ylabel('Fraction of detected trials')
    axes[1,1].spines[['top','right']].set_visible(False)
    axes[1,1].grid(alpha=.18)
    axes[1,1].legend(frameon=False)
    fig.suptitle('110 validated real Forge trials · 58 cheat / 52 legit', fontsize=15)
    fig.text(.05,.015,'Wilson 95% bars. Time curves use different detected subsets; common 20 timestamps are identical. Scripted port, vanilla local server.',fontsize=9)
    fig.tight_layout(rect=[0,.04,1,.96])
    save(fig,'autoblock-original')

b = load('overnight/measurement-scaffold/FULL_RESULTS.json')
if b:
    ids = ['S1','S2','S3','S4','S5']
    fig, axes = plt.subplots(1,2,figsize=(13,4.5),gridspec_kw={'width_ratios':[3,1]})
    rates(axes[0],['Legit\nstraight','Legit\ndiagonal','GodBridge\nstraight','GodBridge\nturns','TellyBridge'],
          [[b['stats']['NEW']['scenarios'][i]['targetAny'] for i in ids]], ['Unchanged Scaffold'])
    rates(axes[1],['L7–L11'], [[b['stats']['NEW']['overall']['falseAnyDetector']]], ['Any detector'])
    axes[0].set_title('Cheat detection')
    axes[1].set_title('Legit false flags')
    fig.suptitle('Original Scaffold: 82 validated real Forge trials · Wilson 95% intervals')
    fig.tight_layout()
    save(fig,'scaffold-original')

j = load('jump-reset/FULL_RESULTS_EVALUATION.json')
if j:
    fig, axes = plt.subplots(1,2,figsize=(14,5))
    for ax, ids, title in [(axes[0],['J1','J2','J3','J4'],'Cheat detection'),
                           (axes[1],['L12','L13','L14','L15'],'Legit false flags by any detector')]:
        rates(ax, ids, [[j['variants'][v]['scenarios'][i]['targetAny' if i.startswith('J') else 'falseAnyDetector'] for i in ids]
                       for v in ['PILOT_BASELINE','CALIBRATED']], ['Initial thresholds','Calibrated'])
        ax.set_title(title)
    fig.suptitle('Jump Reset: independent 160-trial evaluation · Possible alerts only')
    fig.tight_layout()
    save(fig,'jump-reset-held-out')

grid = load('jump-reset/CALIBRATION_SEARCH.json')
frozen = load('jump-reset/FROZEN_CANDIDATE.json')
if grid and frozen:
    points = sorted(set((r['falseFlags']['p']*100,r['sensitivity']['p']*100) for r in grid['grid']))
    fig, ax = plt.subplots(figsize=(7,5))
    ax.scatter([p[0] for p in points], [p[1] for p in points], c=COLORS[0], alpha=.65, label='Threshold candidates')
    winner = frozen['calibration']
    ax.scatter([100*winner['falseFlags']['p']], [100*winner['sensitivity']['p']], c=COLORS[1], s=110, marker='*', label='Frozen winner',zorder=3)
    ax.set_xlabel('False flags on 80 calibration legit trials (%)')
    ax.set_ylabel('Detection on 80 calibration cheat trials (%)')
    ax.set_title('Jump Reset calibration tradeoff — not held-out accuracy')
    ax.spines[['top','right']].set_visible(False)
    ax.grid(alpha=.18)
    ax.legend(frameon=False)
    fig.tight_layout()
    save(fig,'jump-reset-calibration-tradeoff')
for split in ['CALIBRATION', 'EVALUATION']:
    a = load(f'improvements/fresh/{split}_RESULTS.json')
    prefix = 'CORROBORATION_' if split == 'CALIBRATION' else ''
    b = load(f'improvements/fresh/scaffold/{prefix}{split}_RESULTS.json')
    if not (a and b):
        continue
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    for ax, result, title in [(axes[0], a, 'Autoblock'), (axes[1], b, 'Scaffold')]:
        rates(ax, ['Cheat detection', 'Legit false flags'],
              [[result['summaries'][v]['overall'][key] for key in ['targetAny', 'falseAnyDetector']]
               for v in ['BASELINE', 'CANDIDATE']], ['Pinned NEW baseline', 'Candidate'])
        ax.set_title(f"{title}: {len(result['trials'])} validated trials")
    fig.suptitle('Calibration only — used for selection, not held-out accuracy' if split == 'CALIBRATION'
                 else 'Fresh independent evaluation — frozen candidate, no retuning')
    fig.text(.05, .015, 'Wilson 95% intervals. Scripted Forge port on a vanilla loopback server; small samples have wide bounds.', fontsize=9)
    fig.tight_layout(rect=[0, .04, 1, .95])
    save(fig, 'followup-' + split.lower())
print(OUT)
