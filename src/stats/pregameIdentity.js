'use strict';

function normalizeUuid(value) {
    const uuid = String(value || '').replace(/-/g, '').toLowerCase();
    return /^[a-f0-9]{32}$/.test(uuid) ? uuid : null;
}

// A successful username lookup can belong to somebody else who owns that IGN.
// Only compare valid identities; missing data and API failures prove nothing.
function isRosterProfileMismatch(profile, rosterUuid) {
    if (profile?.error || profile?.data?.lookupFailed || profile?.data?.isNicked) return false;
    const visibleUuid = normalizeUuid(rosterUuid);
    const lookupUuid = normalizeUuid(profile?.data?.player?.uuid);
    return Boolean(visibleUuid && lookupUuid && visibleUuid !== lookupUuid);
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
function createPregameIdentityLookup({ lookupNick, lookupReal, getKnownDenick, getPendingDenick = () => null,
    getRosterUuid, isDetectedNick, makeFallback }) {
    function savedIdentity(name) {
        const known = getKnownDenick(name);
        const realName = String(known?.realName || known?.realIGN || '').trim();
        return /^[a-z0-9_]{3,16}$/i.test(realName) && realName.toLowerCase() !== name.toLowerCase()
            ? { ...known, nick: name, realName } : null;
    }

    async function resolveSaved(known) {
        let profile;
        try { profile = await lookupReal(known.realName, known); }
        catch (error) { profile = { error: true, message: error?.message }; }
        if (profile?.error || !profile?.data?.player || profile.data.lookupFailed || profile.data.isNicked) {
            profile = makeFallback(known.realName, {
                lookupFailed: true,
                message: profile?.message || profile?.data?.lookupErrorMessage || 'Stats for the saved account are unavailable.'
            });
        }
        const current = savedIdentity(known.nick);
        if (!current) return makeFallback(known.nick, { isNicked: true });
        if (known.realUuid ? current.realUuid !== known.realUuid : current.realName !== known.realName) return resolveSaved(current);
        return { ...profile, pregameKnownDenick: current, pregameRealName: current.realName };
    }

    return async function lookupPregameIdentity(name) {
        const known = savedIdentity(name);
        if (known) return resolveSaved(known);
        if (getPendingDenick(name) || isDetectedNick(name)) return makeFallback(name, { isNicked: true });

        const profile = await lookupNick(name);
        // The denicked list or roster may have arrived while the request ran.
        const updatedKnown = savedIdentity(name);
        if (updatedKnown) return resolveSaved(updatedKnown);
        if (getPendingDenick(name) || isDetectedNick(name) || profile?.data?.isNicked
            || isRosterProfileMismatch(profile, getRosterUuid(name))) {
            return makeFallback(name, { isNicked: true });
        }
        return profile;
    };
}

module.exports = { createPregameIdentityLookup, shouldHidePregamePartyMember, isRosterProfileMismatch };
