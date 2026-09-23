'use strict';

// A disposable auth process makes cancellation real: no device-code polling
// or partially written credentials remain in the active account directory.
const { Authflow, Titles } = require('prismarine-auth');
process.once('message', async ({ username, cachePath }) => {
    try {
        const auth = new Authflow(username, cachePath, {
            flow: 'live', authTitle: Titles.MinecraftNintendoSwitch, forceRefresh: true
        }, data => process.send?.({ type: 'code', data }));
        const result = await auth.getMinecraftJavaToken({ fetchProfile: true, fetchCertificates: false });
        if (!result?.profile?.id || !result?.profile?.name) throw new Error('This Microsoft account does not have a Minecraft Java profile.');
        process.send?.({ type: 'success', profile: result.profile });
    } catch (error) {
        process.send?.({ type: 'error', error: String(error?.message || 'Microsoft sign-in failed.') });
    }
    process.disconnect?.();
});
