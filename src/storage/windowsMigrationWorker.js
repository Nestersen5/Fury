'use strict';

// Invoked with the NEW packaged Electron's RunAsNode runtime, never the old
// application's code or a machine-wide Node installation. Outputs only status.
const fs = require('fs');
const migration = require('./windowsMigration');
const [requestFile, phase] = process.argv.slice(2);
try {
    const request = migration.readJson(requestFile);
    if (request.schema !== 1) migration.fail('INVALID_REQUEST');
    const options = request.options;
    let result;
    if (phase === 'plan') result = migration.plan(options);
    else if (phase === 'preserve') result = migration.preserve(options, migration.readJson(request.planFile));
    else if (phase === 'activate') {
        const ids = [...new Set([...migration.readJson(request.preservedFile), ...migration.pending(options)])].sort();
        result = migration.activate(options, ids);
    } else migration.fail('INVALID_REQUEST');
    migration.writeJson(request[phase === 'plan' ? 'planFile' : phase === 'preserve' ? 'preservedFile' : 'resultFile'], result);
} catch (error) {
    // Never serialize exception messages, filenames, store contents or tokens.
    const safeCodes = new Set(['UNSAFE_LINK', 'UNSAFE_FILE', 'OVERLAPPING_ROOTS', 'INSTALL_DATA_OVERLAP', 'PAYLOAD_LIMIT',
        'SOURCE_CHANGED', 'INSUFFICIENT_SPACE', 'OWNERSHIP_OR_WRITERS', 'RECOVERY_LIMIT', 'STAGING_CHANGED',
        'COPY_VERIFICATION_FAILED', 'INVALID_MANIFEST', 'DESTINATION_CHANGED', 'EACCES', 'EPERM', 'ENOSPC', 'EBUSY']);
    process.stderr.write(safeCodes.has(error.code) ? error.code : 'MIGRATION_FAILED');
    process.exitCode = 1;
}
