'use strict';
// Summarize actual native updater reports; never substitute bandwidth estimates
// or a projection-only microbenchmark for measured update/restart time.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const args = process.argv.slice(2);
const values = name => args.filter(arg => arg.startsWith(`--${name}=`)).map(arg => arg.slice(name.length + 3));
const median = values => { const ordered = [...values].sort((a, b) => a - b), mid = Math.floor(ordered.length / 2); return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2; };
function collect(files) {
    assert(files.length, 'Pass --before=<report.json> and --after=<report.json>');
    return files.flatMap(file => {
        const report = JSON.parse(fs.readFileSync(file, 'utf8')); assert(report.passed, `Incomplete native trial: ${file}`);
        return (report.samples || [report.timings]).map(sample => ({
            report: path.resolve(file), downloadMs: sample.downloadAndVerifyMs, restartMs: sample.installToReadyMs,
            oldExitMs: sample.installToOldExitMs,
            totalMs: sample.downloadAndVerifyMs + sample.installToReadyMs,
            bytes: sample.transferredBytes ?? report.transferredBytes ?? report.installerBytes
        }));
    });
}
function summarize(samples) {
    return { count: samples.length, downloadMs: median(samples.map(s => s.downloadMs)), restartMs: median(samples.map(s => s.restartMs)),
        totalMs: median(samples.map(s => s.totalMs)), bytes: median(samples.map(s => s.bytes)),
        restartRangeMs: [Math.min(...samples.map(s => s.restartMs)), Math.max(...samples.map(s => s.restartMs))] };
}
const before = collect(values('before')), after = collect(values('after'));
const result = { measuredAt: new Date().toISOString(), machine: { os: os.release(), cpu: os.cpus()[0].model, driverNode: process.version,
    electron: require('electron/package.json').version },
    workload: 'Windows x64, normal-compression isolated NSIS fixtures, version 1.1.4 -> 1.1.5, synthetic profile, loopback HTTP. No internet throttling; no gameplay speed claim.',
    before: summarize(before), after: summarize(after), samples: { before, after },
    transition: values('transition').length ? summarize(collect(values('transition'))) : null,
    fallback: values('fallback').length ? summarize(collect(values('fallback'))) : null };
result.restartReductionPercent = 100 * (1 - result.after.restartMs / result.before.restartMs);
result.totalReductionPercent = 100 * (1 - result.after.totalMs / result.before.totalMs);
result.byteReductionPercent = 100 * (1 - result.after.bytes / result.before.bytes);
const output = path.resolve(values('output')[0] || 'output/updater-performance/comparison');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'comparison.json'), JSON.stringify(result, null, 2) + '\n');
const seconds = ms => (ms / 1000).toFixed(1), mb = bytes => (bytes / 1e6).toFixed(1);
const max = Math.max(result.before.totalMs, result.after.totalMs) * 1.05;
const row = (label, stats, color) => `<div class="label"><strong>${label}</strong><span>${seconds(stats.totalMs)} s</span></div><div class="track"><div class="bar" style="width:${stats.totalMs / max * 100}%;background:var(${color})"></div></div>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:var(--font-sans);color:var(--foreground);margin:0}h3{font-size:16px;font-weight:600;margin:0 0 16px}.label{display:flex;justify-content:space-between;font-size:14px;margin:12px 0 7px}.track{height:30px;background:var(--secondary);border-radius:4px;overflow:hidden}.bar{height:30px;display:flex;border-radius:4px}.bar span{background:var(--foreground);opacity:.4;min-width:2px}.caption{color:var(--muted-foreground);font-size:12px;line-height:1.6;margin-top:15px}details{margin-top:12px;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:10px}td,th{text-align:left;padding:7px 4px;border-bottom:1px solid var(--border)}th{font-weight:500}
</style></head><body><h3>Windows update processing time</h3>
${row('Before', result.before, '--chart-1')}${row('After', result.after, '--chart-2')}
<div class="caption">Median combined download/verification + restart to ready. ${result.before.count} before and ${result.after.count} after trials on a local feed. User waiting time is excluded.<br>Transferred: ${mb(result.before.bytes)} MB → ${mb(result.after.bytes)} MB for the small fixture release. Internet download times and larger release changes will differ.</div>
<details><summary>Show measured stages</summary><table><thead><tr><th>Stage</th><th>Before</th><th>After</th></tr></thead><tbody><tr><td>Download + verification</td><td>${seconds(result.before.downloadMs)} s</td><td>${seconds(result.after.downloadMs)} s</td></tr><tr><td>Restart to ready</td><td>${seconds(result.before.restartMs)} s</td><td>${seconds(result.after.restartMs)} s</td></tr></tbody></table></details></body></html>`;
fs.writeFileSync(path.join(output, 'comparison.html'), html);
console.log(JSON.stringify({ ...result, samples: undefined }, null, 2));
