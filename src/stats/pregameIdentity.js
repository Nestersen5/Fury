'use strict';

function normalizeUuid(value) {
    const uuid = String(value || '').replace(/-/g, '').toLowerCase();
    return /^[a-f0-9]{32}$/.test(uuid) ? uuid : null;
}

function shouldHidePregamePartyMember(name, { isPartyMember, getKnownDenick }) {
    if (isPartyMember(name)) return true;
    const known = getKnownDenick(name);
    const realName = String(known?.realName || known?.realIGN || '').trim();
    return Boolean(realName && isPartyMember(realName));
}

// Pregame chat names are visible nicknames, not necessarily account names.
// A saved mapping is authoritative; otherwise compare a successful name lookup
// with the live tab UUID before allowing its stats into chat or the pregame cache.
function createPregameIdentityLookup({ lookupNick, lookupReal, getKnownDenick, getRosterUuid, isDetectedNick, makeFallback }) {
    function savedIdentity(name) {
        const known = getKnownDenick(name);
        const realName = String(known?.realName || known?.realIGN || '').trim();
        return /^[a-z0-9_]{3,16}$/i.test(realName) && realName.toLowerCase() !== name.toLowerCase()
            ? { ...known, realName } : null;
    }

    async function resolveSaved(known) {
        let profile;
        try { profile = await lookupReal(known.realName); }
        catch (error) { profile = { error: true, message: error?.message }; }
        if (profile?.error || !profile?.data?.player || profile.data.lookupFailed || profile.data.isNicked) {
            profile = makeFallback(known.realName, {
                lookupFailed: true,
                message: profile?.message || profile?.data?.lookupErrorMessage || 'Stats for the saved account are unavailable.'
            });
        }
        return { ...profile, pregameKnownDenick: known, pregameRealName: known.realName };
    }

    return async function lookupPregameIdentity(name) {
        const known = savedIdentity(name);
        if (known) return resolveSaved(known);
        if (isDetectedNick(name)) return makeFallback(name, { isNicked: true });

        const profile = await lookupNick(name);
        // The denicked list or roster may have arrived while the request ran.
        const updatedKnown = savedIdentity(name);
        if (updatedKnown) return resolveSaved(updatedKnown);
        const rosterUuid = normalizeUuid(getRosterUuid(name));
        const lookupUuid = normalizeUuid(profile?.data?.player?.uuid);
        if (isDetectedNick(name) || profile?.data?.isNicked
            || (rosterUuid && lookupUuid && rosterUuid !== lookupUuid)) {
            return makeFallback(name, { isNicked: true });
        }
        return profile;
    };
}

module.exports = { createPregameIdentityLookup, shouldHidePregamePartyMember };
