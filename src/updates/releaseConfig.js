'use strict';

// The launcher's notification-only update check. See docs/UPDATE_NOTIFICATIONS.md.
module.exports = Object.freeze({
    // Published LAST by scripts/publish_release.js, after the six downloads
    // exist and verify. Until that file is public this simply 404s and the
    // check stays silent. A packaged build only accepts an HTTPS URL sharing
    // the download page's origin; the environment cannot repoint it.
    manifestUrl: 'https://furyproxy.online/latest.json',
    // The established Fury download page, and the only destination the update
    // action ever opens.
    downloadPageUrl: 'https://furyproxy.online/'
});
