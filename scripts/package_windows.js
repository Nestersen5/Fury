const { spawnSync } = require('child_process');
const path = require('path');
const { verifyApplication, payloadInventory, assertPayloadParity, writeReleaseMetadata } = require('./release_artifacts');
const { verifyPair } = require('./verify_release_pair');

const root = path.resolve(__dirname, '..');
const defaultOutput = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Fury', 'release')
  : path.join(root, 'release');
const outputDirectory = path.resolve(process.env.FURY_RELEASE_DIR || process.env.NESTER_RELEASE_DIR || defaultOutput);
const electronBuilderCli = require.resolve('electron-builder/out/cli/cli.js');

async function main() {
  if (process.platform !== 'win32') throw new Error('Build and verify the Windows pair on Windows.');
  console.log(`Building Windows NSIS and portable ZIP in ${outputDirectory}`);
  const stage = path.join(outputDirectory, 'win-unpacked');
  for (const args of windowsBuildPlan(outputDirectory)) {
    const result = spawnSync(process.execPath, [electronBuilderCli, ...args], { cwd: root, env: process.env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Windows packaging failed (${result.status}).`);
  }
  // NSIS finishes adding its helper before ZIP reads this same application.
  await verifyApplication(root, stage, 'win', 'x64');
  const before = await payloadInventory(stage);
  await verifyPair({ directory: outputDirectory, platform: 'win', arch: 'x64', sourceRoot: root, stage,
    reportFile: path.join(outputDirectory, 'PAIR-win-x64.json') });
  assertPayloadParity(before, await payloadInventory(stage));
  await writeReleaseMetadata(outputDirectory, require('../package.json').version);
}
function windowsBuildPlan(output) {
  const shared = ['--x64', '--publish', 'never', `--config.directories.output=${output}`];
  return [ ['--win', 'nsis', ...shared],
    ['--win', 'zip', '--prepackaged', path.join(output, 'win-unpacked'), ...shared] ];
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main, windowsBuildPlan };
