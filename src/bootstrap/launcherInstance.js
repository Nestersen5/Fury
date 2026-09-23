'use strict';

// Call only after migration and Electron userData selection, before loading
// mutable owners. Electron keys the lock to userData (and app name on Windows).
function acquireLauncherInstance({ app, getWindow, isQuitting }) {
    if (!app.requestSingleInstanceLock()) {
        // No owners or quit handlers have been installed in this process yet.
        app.exit(0);
        return false;
    }
    app.on('second-instance', () => {
        // Ownership lasts until actual process exit, including the F7 drain.
        // A second launch must not restart or interrupt a quitting primary.
        if (isQuitting()) return;
        const window = getWindow();
        if (!window || window.isDestroyed()) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
    });
    return true;
}

module.exports = { acquireLauncherInstance };
