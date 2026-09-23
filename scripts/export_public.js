'use strict';

// Deterministic public export. Copies exactly the files the public Fury
// repository should contain into a target directory, and refuses to export
// anything that fails the privacy gate.
//
// It reads Git's tracked and untracked, nonignored working-tree files so
// accepted source can be checked before it is staged. The allowlist below
// is a second, explicit gate: a new top-level path is excluded until
// somebody classifies it here. That is deliberate. "Copy the directory and
// trust .gitignore" is what this script exists to avoid.
//
// It never writes to Git, never contacts the network, and never touches the
// private archive. Publication remains a separate, approved step.
//
//   node scripts/export_public.js --check            privacy and runtime completeness gates
//   node scripts/export_public.js --list             resolved export manifest
//   node scripts/export_public.js <target-directory> write the export
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runtimeFiles } = require('./verify_packaged_sources');

const root = path.resolve(__dirname, '..');

// Included categories. Each entry is a prefix or an exact filename; `test`
// receives the repository-relative POSIX path.
const INCLUDE = [
    // Order matters: the first matching rule assigns the category, so the
    // specific root-level rules come before the broad ones.
    // Permanent regression coverage.
    { category: 'tests', test: p => /^tests\/[^/]+\/test_[^/]+\.js$/.test(p) },
    // Licence and security policy.
    { category: 'legal', test: p => ['LICENSE', 'SECURITY.md'].includes(p) },
    // Production source and the renderer it mounts.
    { category: 'production source', test: p => /^[^/]+\.js$/.test(p) },
    { category: 'production source', test: p => p === 'launcher.html' },
    { category: 'production source', test: p => p.startsWith('src/') },
    { category: 'production source', test: p => p.startsWith('features/') },
    // Assets the packaged application needs.
    { category: 'assets', test: p => p.startsWith('assets/') },
    // Package metadata and the packaging hooks electron-builder owns.
    // .gitattributes is required, not cosmetic: it pins LF on every checkout so
    // the Windows and macOS halves of a release agree on one source snapshot.
    { category: 'package metadata', test: p => ['package.json', 'package-lock.json', '.gitignore', '.gitattributes', '.env.example'].includes(p) },
    { category: 'package metadata', test: p => p === 'cosmetic_search_package.json' },
    { category: 'package metadata', test: p => p === 'build/installer.nsh' },
    // Permanent scripts and development tooling.
    { category: 'scripts', test: p => p.startsWith('scripts/') },
    // Application documentation and historical verification records.
    { category: 'docs', test: p => /^[^/]+\.md$/.test(p) },
    { category: 'docs', test: p => p.startsWith('docs/') },
    // Public CI.
    { category: 'workflows', test: p => p.startsWith('.github/workflows/') },
];

// Never exported, even if something above would match. These are the classes
// the privacy audit identified: local machine state, private deployment
// overrides, generated artifacts and anything credential-shaped.
const EXCLUDE = [
    { reason: 'private agent guidance', test: p => p === 'AGENTS.md' || p.startsWith('.agents/') },
    { reason: 'separate website and download tracker', test: p => p.startsWith('website/') || p.startsWith('cloudflare/download-stats/') },
    { reason: 'deployment-only tooling', test: p => p.startsWith('scripts/fixtures/gallery-skins/') || ['scripts/prepare_release.js', 'scripts/publish_release.js', 'scripts/release_plan.js', 'scripts/stage_download_site.js', 'scripts/test_download_workflow.js', 'scripts/capture_site_gallery.js', 'tests/release/test_release_publication.js', 'docs/RELEASE_PUBLISHING.md', 'docs/PUBLIC_RELEASE_CHECKLIST.md'].includes(p) },
    { reason: 'private archive or local git state', test: p => p === '.git' || p.startsWith('.git/') },
    { reason: 'agent-local settings', test: p => p.startsWith('.claude/') },
    { reason: 'local runtime data', test: p => /^(auth_tokens|launcher_data|packet_logs|recordings|backups|quickbuy_presets|diagnostics)\//.test(p) },
    { reason: 'generated or temporary output', test: p => /^(output|tmp|dist|out|release|release-.*|\.wrangler)\//.test(p) },
    { reason: 'unrelated sibling project', test: p => /^(NesterForge189|statmod-overlay|admin-web)\//.test(p) },
    { reason: 'private deployment override', test: p => /(^|\/)(\.env|\.env\..*|\.dev\.vars.*|.*\.local\.json|wrangler\.local\..*)$/.test(p) && p !== '.env.example' },
    { reason: 'credential or signing material', test: p => /\.(pem|p12|pfx|cer|keystore|jks)$/i.test(p) || /(^|\/)id_rsa(\..*)?$/.test(p) },
    { reason: 'local machine state', test: p => /\.(log|stackdump|bak)$/i.test(p) },
    { reason: 'private player data', test: p => /^(json-data|session_data|encounter_data|denicked|friend_aliases|presets|own_cosmetics|anticheat_history)\.json$/.test(p) },
];

// Content the public repository must never carry. Hadex, Nestersen and
// Nestersen5 are the intended public identity and are deliberately absent.
// Each pattern is stored split so this file does not itself contain the value.
const FORBIDDEN_CONTENT = [
    { label: 'real legal name', pattern: () => new RegExp(['Tom', 'asz'].join('') + '\\s+' + ['Budz', 'ejko'].join(''), 'i') },
    { label: 'real surname', pattern: () => new RegExp(['Budz', 'ejko'].join(''), 'i') },
    { label: 'personal email local part', pattern: () => new RegExp(['tomek', '\\.', 'budz', 'ejko'].join(''), 'i') },
    { label: 'old GitHub account', pattern: () => new RegExp(['tom', 'budz5'].join(''), 'i') },
    { label: 'personal DDNS endpoint', pattern: () => new RegExp(['nestersen', '\\.', 'duckdns', '\\.', 'org'].join(''), 'i') },
    { label: 'private cosmetic-search host', pattern: () => new RegExp(['92', '5', '52', '168'].join('\\.')) },
    { label: 'Cloudflare account identifier', pattern: () => /["']?account_id["']?\s*[:=]\s*["'][0-9a-f]{32}["']/i },
    { label: 'AWS access key', pattern: () => /AKIA[0-9A-Z]{16}/ },
    { label: 'GitHub token', pattern: () => /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
    { label: 'Google API key', pattern: () => /\bAIza[0-9A-Za-z_-]{35}\b/ },
    { label: 'OpenAI-style key', pattern: () => /\bsk-[A-Za-z0-9]{32,}/ },
    { label: 'JSON web token', pattern: () => /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/ },
    { label: 'private key block', pattern: () => /-----BEGIN [A-Z ]*PRIVATE KEY/ },
    { label: 'credentialed connection URI', pattern: () => /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/[^\s"'/]+:[^\s"'@]+@/ },
];

// Binary payloads are exported byte for byte but not content-scanned.
const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|ttf|otf|woff2?|zip|dmg|exe|jar|mp4|mov|webm|pdf)$/i;

// Everything Git would commit from this working tree: tracked files plus
// untracked files that are not ignored. Ignored and local-only files can never
// reach the export, whether or not they have been committed yet.
function trackedFiles() {
    const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { cwd: root, encoding: 'buffer', maxBuffer: 1 << 28 });
    assert.equal(result.status, 0, `git ls-files failed: ${result.stderr}`);
    return result.stdout.toString('utf8').split('\0').filter(Boolean)
        // A tracked path that was deleted in the working tree is already gone.
        .filter(file => fs.existsSync(path.join(root, file)))
        .sort();
}

function classify(file) {
    const excluded = EXCLUDE.find(rule => rule.test(file));
    if (excluded) return { include: false, reason: excluded.reason };
    const included = INCLUDE.find(rule => rule.test(file));
    if (included) return { include: true, category: included.category };
    return { include: false, reason: 'not classified by the export allowlist' };
}

function scan(files) {
    const findings = [];
    for (const file of files) {
        if (BINARY.test(file)) continue;
        const contents = fs.readFileSync(path.join(root, file), 'utf8');
        for (const { label, pattern } of FORBIDDEN_CONTENT) {
            const match = contents.match(pattern());
            if (!match) continue;
            const line = contents.slice(0, match.index).split('\n').length;
            // Report the location, never the value.
            findings.push(`${file}:${line}: ${label}`);
        }
    }
    return findings;
}

function assertApplicationComplete(included) {
    const exported = new Set(included.map(entry => typeof entry === 'string' ? entry : entry.file));
    const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const packaged = runtimeFiles(root, config);
    const required = new Set([...packaged, '.gitattributes',
        'launcher.js', 'launcher.html', 'proxy.js', 'cosmetic_search_api.js']);
    const localFile = (from, specifier) => {
        const base = path.resolve(root, path.dirname(from), specifier);
        assert(base.startsWith(root + path.sep), `Runtime path escapes the repository: ${from} -> ${specifier}`);
        const resolved = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')]
            .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        assert(resolved, `Missing local runtime dependency: ${from} -> ${specifier}`);
        return path.relative(root, resolved).split(path.sep).join('/');
    };
    for (const file of packaged.filter(name => /\.(js|html)$/.test(name))) {
        const source = fs.readFileSync(path.join(root, file), 'utf8');
        for (const match of source.matchAll(/\brequire\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g)) {
            required.add(localFile(file, match[2]));
        }
        if (file === 'launcher.html') {
            for (const match of source.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/g)) {
                if (/^(?:[a-z]+:|\/\/|#)/i.test(match[1])) continue;
                required.add(localFile(file, match[1]));
            }
        }
    }
    for (const file of packaged.filter(name => name.endsWith('.css'))) {
        const source = fs.readFileSync(path.join(root, file), 'utf8');
        for (const match of source.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
            if (/^(?:[a-z]+:|\/\/|#)/i.test(match[2])) continue;
            const dependency = localFile(file, match[2]);
            if (!dependency.startsWith('node_modules/')) required.add(dependency);
        }
    }
    for (const file of required) {
        assert(exported.has(file), `Required application file missing from public export: ${file}`);
    }
}

function plan() {
    const included = [], excluded = [];
    for (const file of trackedFiles()) {
        const verdict = classify(file);
        (verdict.include ? included : excluded).push({ file, ...verdict });
    }
    assertApplicationComplete(included);
    return { included, excluded, findings: scan(included.map(entry => entry.file)) };
}

function copy(target) {
    const result = plan();
    assert.equal(result.findings.length, 0,
        `Export refused. Forbidden content:\n  ${result.findings.join('\n  ')}`);
    const destination = path.resolve(root, target);
    assert(!destination.startsWith(path.join(root, '.git')), 'Refusing to export into the Git directory');
    assert(destination !== root, 'Refusing to export over the working tree');
    for (const { file } of result.included) {
        const to = path.join(destination, file);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(path.join(root, file), to);
    }
    return { destination, ...result };
}

function main(argv) {
    const [first] = argv;
    if (first === '--check' || first === '--list' || first === undefined) {
        const result = plan();
        const counts = {};
        for (const entry of result.included) counts[entry.category] = (counts[entry.category] || 0) + 1;
        if (first === '--list') for (const entry of result.included) console.log(`${entry.category}\t${entry.file}`);
        else {
            for (const [category, count] of Object.entries(counts).sort()) console.log(`${String(count).padStart(4)}  ${category}`);
            console.log(`${String(result.included.length).padStart(4)}  TOTAL exported`);
            console.log(`${String(result.excluded.length).padStart(4)}  excluded`);
            for (const entry of result.excluded) console.log(`      - ${entry.file} (${entry.reason})`);
        }
        assert.equal(result.findings.length, 0,
            `Privacy gate failed:\n  ${result.findings.join('\n  ')}`);
        console.log('Privacy gate passed: no forbidden identity, endpoint or credential content.');
        return;
    }
    assert(!first.startsWith('--'), `Unknown option: ${first}`);
    const result = copy(first);
    console.log(`Exported ${result.included.length} files to ${result.destination}`);
    console.log(`Excluded ${result.excluded.length}. Nothing public was contacted or changed.`);
}

if (require.main === module) {
    try { main(process.argv.slice(2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { INCLUDE, EXCLUDE, FORBIDDEN_CONTENT, assertApplicationComplete, classify, plan, scan, trackedFiles };
