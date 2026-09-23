'use strict';

const { mergeTextureProperties } = require('./skinTextures.js');
const { rewriteChatRanks } = require('./chatRanks.js');

// Render a known nicked player under their REAL IGN in-game.
//
// How the 1.8 client decides what to draw above a head:
//
//   scoreboard_team.prefix + <GameProfile name> + scoreboard_team.suffix
//
// The middle part is the profile name, which the client takes from the tab
// list (`player_info` ADD_PLAYER) and binds to the entity at spawn —
// `named_entity_spawn` carries only a UUID, no name. So the nick cannot be
// hidden with a prefix/suffix; it has to be replaced at the source, before the
// packet reaches the client.
//
// Two packets therefore need rewriting:
//   1. player_info ADD_PLAYER — the name the entity and tab row are built from.
//   2. scoreboard_team        — Hypixel adds players to teams BY NAME. Miss
//                               this and a renamed player silently falls out
//                               of their team, losing their team colour and
//                               Hypixel's own prefix (they render plain white
//                               and look broken).
//   3. scoreboard_score      — scores are keyed by name too, and Hypixel
//                               drives the teammate health readout with them.
//                               Miss this and a renamed teammate shows 0 HP.
//
// Hard rule: this is DISPLAY ONLY. Every internal system — gameRoster,
// lobbyPlayers, overlayPlayerStats, chat parsing, denick tracking — keys on
// the nick Hypixel actually uses. The rewrite happens on a COPY handed to the
// client; the packet used for bookkeeping is never touched. Leaking the real
// IGN into internal state would break stat lookups and denick tracking.
//
// The rename must be STICKY and RETROACTIVE, and both halves matter:
//
//   Sticky — the decision is frozen the first time it is made and never
//   re-derived. It used to be recomputed per packet, so the answer changed as
//   denick data arrived: Hypixel sends the team packet early (nick not resolved
//   yet, so it kept the nick) and player_info is handled later (denick resolved,
//   so it got the real IGN). The two disagreed, the renamed player belonged to
//   no team, and rendered as plain white text with no team prefix.
//
//   Retroactive — freezing alone only stops FUTURE packets from disagreeing.
//   Whatever the client was already told under the old name (its tab row, its
//   team membership, its health score) still points at a name that no longer
//   exists, so on the first rename those entries are re-issued under the real
//   IGN. That is what makes the client converge instead of staying half-renamed.
//
// To do that this module tracks what the client actually received, keyed by the
// name it received it UNDER — which is the nick before the rename and the real
// IGN after it.

const VALID_NAME = /^[A-Za-z0-9_]{3,16}$/;

function isRenderableName(value) {
    return typeof value === 'string' && VALID_NAME.test(value);
}

function nameKey(value) {
    return String(value || '').trim().toLowerCase();
}

function profileUuid(entry) {
    return entry?.uuid || entry?.UUID || null;
}

function createDenickDisplayNames({
    isEnabled = () => false,
    // (name, surface) -> the name to display, or falsy to leave it alone.
    // Injected so this module never reaches into denick history, in-session
    // denicks, friend aliases, or own-identity checks itself.
    //
    // `surface` is one of:
    //   'world' - the GameProfile name (nametag + tab row + team/score keys)
    //   'chat'  - visible chat text only
    //   'skin'  - the real Mojang account to pull a skin from. This one must
    //             never answer with a custom alias: a skin is looked up by
    //             name, and a nickname you invented is not an account.
    resolveRealName = () => null,
    // (name) -> true when that name is ALREADY visible in the tab list.
    // Renaming onto a name that is genuinely present would put two entries
    // under one name, and scoreboard teams are keyed by name — the client
    // would then shuffle team membership between them and colours would go
    // wrong. Skipping the rename is always the safer outcome.
    isNameTaken = () => false,
    // (packetName, payload) -> void. Writes a packet STRAIGHT to the client,
    // bypassing this module — the convergence packets are already final, and
    // one of them deliberately carries the old name (to retire it), which a
    // second pass through the rewriter would undo.
    resend = () => {},
    // ({ nick, real }) -> void, once per player, right after convergence. The
    // host uses it to re-apply anything it had layered on the old tab row.
    onRename = () => {},
    // (profile) -> void after a profile is removed and re-added. Minecraft
    // 1.8 bakes a player's GameProfile into the already-spawned entity, so the
    // host uses this hook to destroy/re-spawn that one entity after a live
    // name or skin change.
    onProfileReissued = () => {},
    // Skin replacement is deliberately separate from name replacement. The
    // lookup is asynchronous and returns Mojang-signed `textures` properties;
    // until it resolves, the original Hypixel profile remains on screen.
    isSkinReplacementEnabled = () => false,
    // Chat replacement is independent of in-world name rendering: it only
    // changes visible chat text in the packet forwarded to the client.
    isChatReplacementEnabled = () => false,
    resolveChatRankedName = () => null,
    resolveSkinProperties = async () => null,
    logger = console
} = {}) {
    // Nicks we have actually rewritten, so the host can tell which tab rows
    // need re-sending when a denick is discovered after the player spawned.
    const rewritten = new Map();

    // What the client currently holds, keyed by the name it was sent under.
    const sentProfiles = new Map();  // nameKey -> the ADD_PLAYER entry forwarded
    const sentTeams = new Map();     // nameKey -> Set<team id>
    const sentScores = new Map();    // nameKey -> Map<objective, value>
    const originalProfileProperties = new Map(); // uuid -> Hypixel's original properties
    const skinOverrides = new Map(); // uuid -> nameKey currently using the real skin
    const skinRequests = new Map();  // uuid -> in-flight real-skin lookup
    let lastNameReplacementEnabled = null;
    let lastSkinReplacementEnabled = null;

    function nameReplacementEnabled() {
        try {
            return Boolean(isEnabled());
        } catch (error) {
            logger.error?.('[Denick] Real-IGN toggle lookup failed:', error?.message || error);
            return false;
        }
    }

    function skinReplacementEnabled() {
        try {
            return Boolean(isSkinReplacementEnabled());
        } catch (error) {
            logger.error?.('[Denick] Real-skin toggle lookup failed:', error?.message || error);
            return false;
        }
    }

    function chatReplacementEnabled() {
        try {
            return Boolean(isChatReplacementEnabled());
        } catch (error) {
            logger.error?.('[Denick] Real-IGN chat toggle lookup failed:', error?.message || error);
            return false;
        }
    }

    function rememberOriginalProperties(entry) {
        const uuid = profileUuid(entry);
        if (!uuid) return;
        originalProfileProperties.set(uuid, {
            present: Object.prototype.hasOwnProperty.call(entry, 'properties'),
            value: Array.isArray(entry.properties)
                ? entry.properties.map(property => ({ ...property }))
                : entry.properties
        });
    }

    function withOriginalProperties(profile, original) {
        const restored = { ...profile };
        if (!original?.present) delete restored.properties;
        else restored.properties = Array.isArray(original.value)
            ? original.value.map(property => ({ ...property }))
            : original.value;
        return restored;
    }

    function reissueProfile(profile) {
        const uuid = profileUuid(profile);
        if (uuid) emit('player_info', { action: 'remove_player', data: [{ uuid }] });
        emit('player_info', { action: 'add_player', data: [profile] });
        try {
            onProfileReissued(profile);
        } catch (error) {
            logger.error?.('[Denick] Profile reissue hook failed:', error?.message || error);
        }
    }

    function revertSkinOverrides() {
        skinOverrides.forEach((profileKey, uuid) => {
            const current = sentProfiles.get(profileKey);
            if (!current || profileUuid(current) !== uuid) return;
            const restored = withOriginalProperties(current, originalProfileProperties.get(uuid));
            sentProfiles.set(profileKey, restored);
            reissueProfile(restored);
        });
        skinOverrides.clear();
    }

    function scheduleRealSkin(real, profile, profileKey = nameKey(profile?.name)) {
        if (!skinReplacementEnabled()) return;
        const uuid = profileUuid(profile);
        if (!uuid || skinRequests.has(uuid)) return;
        if (!profileKey) return;

        const request = Promise.resolve()
            .then(() => resolveSkinProperties(real))
            .then((textures) => {
                if (!skinReplacementEnabled() || !Array.isArray(textures) || textures.length === 0) return;
                const current = sentProfiles.get(profileKey);
                if (!current || profileUuid(current) !== uuid) return;

                const skinned = {
                    ...current,
                    properties: mergeTextureProperties(current.properties, textures)
                };
                sentProfiles.set(profileKey, skinned);
                skinOverrides.set(uuid, profileKey);
                reissueProfile(skinned);
            })
            .catch((error) => {
                logger.error?.(`[Denick] Applying real skin for ${real} failed:`, error?.message || error);
            })
            .finally(() => {
                if (skinRequests.get(uuid) === request) skinRequests.delete(uuid);
            });
        skinRequests.set(uuid, request);
    }

    function syncSkinReplacementToggle() {
        const enabled = skinReplacementEnabled();
        if (lastSkinReplacementEnabled === enabled) return;
        const wasEnabled = lastSkinReplacementEnabled;
        lastSkinReplacementEnabled = enabled;

        if (!enabled && (wasEnabled === true || skinOverrides.size > 0)) {
            revertSkinOverrides();
            return;
        }
        if (wasEnabled === false && enabled) {
            scheduleKnownRealSkins();
        }
    }

    function resolvedRealName(nick, { checkCollision = true, surface = 'world' } = {}) {
        if (!isRenderableName(nick)) return null;

        // The frozen answer is the DISPLAY name, which may be a custom alias.
        // A skin lookup needs the account behind the player, so it always asks
        // the resolver instead of reading the frozen decision.
        if (surface !== 'skin') {
            const frozen = rewritten.get(nameKey(nick));
            if (frozen) return frozen.real;
        }

        let real = null;
        try {
            real = resolveRealName(nick, surface);
        } catch (error) {
            logger.error?.('[Denick] Real-IGN lookup failed:', error?.message || error);
            return null;
        }

        if (!isRenderableName(real) || nameKey(real) === nameKey(nick)) return null;
        if (!checkCollision) return real;

        try {
            return isNameTaken(real) ? null : real;
        } catch (error) {
            logger.error?.('[Denick] Name-collision check failed:', error?.message || error);
            return null;
        }
    }

    // Skin replacement also works while the real-IGN rendering option is
    // off. A skin is UUID-bound, so it is safe to resolve the real account
    // without changing the text name sent to the client.
    function realNameForSkin(nick) {
        return resolvedRealName(nick, { checkCollision: false, surface: 'skin' });
    }

    function frozenRenameForRenderedName(name) {
        const key = nameKey(name);
        return Array.from(rewritten.values()).find(entry => nameKey(entry.nick) === key || nameKey(entry.real) === key) || null;
    }

    function scheduleKnownRealSkins() {
        Array.from(sentProfiles.values()).forEach((profile) => {
            const frozen = frozenRenameForRenderedName(profile?.name);
            // frozen.skinName, not frozen.real: the displayed name can be a
            // custom alias, which is nobody's account.
            const skinName = frozen ? frozen.skinName : realNameForSkin(profile?.name);
            if (skinName) scheduleRealSkin(skinName, profile);
        });
    }

    function restoreNickname(nick, real, skinName = real) {
        const nickKeyValue = nameKey(nick);
        const realKey = nameKey(real);
        if (nickKeyValue === realKey) return;

        const profile = sentProfiles.get(realKey);
        if (profile) {
            const restored = { ...profile, name: nick };
            const uuid = profileUuid(restored);
            sentProfiles.delete(realKey);
            sentProfiles.set(nickKeyValue, restored);
            if (uuid && skinOverrides.get(uuid) === realKey) skinOverrides.set(uuid, nickKeyValue);
            reissueProfile(restored);
            if (skinReplacementEnabled() && skinName) scheduleRealSkin(skinName, restored, nickKeyValue);
        }

        const teams = sentTeams.get(realKey);
        if (teams) {
            sentTeams.delete(realKey);
            sentTeams.set(nickKeyValue, mergeSets(sentTeams.get(nickKeyValue), teams));
            teams.forEach((team) => {
                emit('scoreboard_team', { team, mode: 4, players: [real] });
                emit('scoreboard_team', { team, mode: 3, players: [nick] });
            });
        }

        const scores = sentScores.get(realKey);
        if (scores) {
            sentScores.delete(realKey);
            sentScores.set(nickKeyValue, scores);
            scores.forEach((value, objective) => {
                emit('scoreboard_score', { itemName: real, scoreName: objective, action: 1 });
                emit('scoreboard_score', { itemName: nick, scoreName: objective, value, action: 0 });
            });
        }
    }

    function syncNameReplacementToggle() {
        const enabled = nameReplacementEnabled();
        if (lastNameReplacementEnabled === enabled) return false;
        const wasEnabled = lastNameReplacementEnabled;
        lastNameReplacementEnabled = enabled;

        if (!enabled) {
            if (wasEnabled === true || rewritten.size > 0) {
                Array.from(rewritten.values()).forEach(({ nick, real, skinName }) => restoreNickname(nick, real, skinName));
            }
            return true;
        }

        // Apply a newly-enabled setting to every profile the client already
        // has. This is the important hot-apply path: it does not wait for a
        // later Hypixel tab update or a player death.
        Array.from(sentProfiles.values()).forEach((profile) => {
            const nick = profile?.name;
            const frozen = frozenRenameForRenderedName(nick);
            if (frozen) {
                if (nameKey(nick) === nameKey(frozen.nick)) converge(frozen.nick, frozen.real, frozen.skinName);
                return;
            }
            const real = resolvedRealName(nick);
            if (real) freeze(nick, real);
        });
        return true;
    }

    // Re-derive every rename from scratch.
    //
    // syncNameReplacementToggle only fires when the TOGGLE flips, and the
    // frozen decisions are deliberately sticky, so neither picks up a change to
    // the underlying data - adding or editing a friend alias mid-game would
    // otherwise not show until the next match. Restoring first and re-freezing
    // afterwards reuses the same convergence path a toggle does, so the client
    // never ends up half-renamed.
    function refreshRenames() {
        if (rewritten.size === 0 && !nameReplacementEnabled()) return false;

        Array.from(rewritten.values()).forEach(({ nick, real, skinName }) => restoreNickname(nick, real, skinName));
        rewritten.clear();
        if (!nameReplacementEnabled()) return true;

        Array.from(sentProfiles.values()).forEach((profile) => {
            const nick = profile?.name;
            if (!isRenderableName(nick)) return;
            const real = resolvedRealName(nick);
            if (real) freeze(nick, real);
        });
        return true;
    }

    // The name to display for `nick`, or null to leave it alone: the real IGN
    // for a known nick, a custom alias for a friend you have named.
    function displayNameFor(nick) {
        syncSkinReplacementToggle();
        if (!nameReplacementEnabled()) return null;

        // Sticky: once a player has been renamed the answer is fixed for the
        // rest of the session. Re-deriving it here is what let the packets that
        // name a player drift apart as denick data arrived mid-game.
        const frozen = rewritten.get(nameKey(nick));
        if (frozen) return frozen.real;

        const real = resolvedRealName(nick);
        if (!real) return null;

        freeze(nick, real);
        return real;
    }

    // Lock the mapping in and drag everything the client already holds under
    // the nick over to the real IGN.
    function freeze(nick, real) {
        // skinName is the account to pull a skin from, and it only equals
        // `real` when the rename came from a denick. A custom alias has no
        // account of its own, so this stays null unless the player is also a
        // known nick.
        const skinName = realNameForSkin(nick) || null;
        rewritten.set(nameKey(nick), { nick, real, skinName, at: Date.now() });
        converge(nick, real, skinName);
        try {
            onRename({ nick, real });
        } catch (error) {
            logger.error?.('[Denick] Rename hook failed:', error?.message || error);
        }
    }

    function emit(packetName, payload) {
        try {
            resend(packetName, payload);
        } catch (error) {
            logger.error?.(`[Denick] Re-issuing ${packetName} failed:`, error?.message || error);
        }
    }

    // Re-issue every entry the client was already given under `nick`.
    //
    // Order within each pair is retire-then-add: the client keys team
    // membership and scores by name, so the stale entry has to go or it lingers
    // forever under a name nothing else refers to.
    function converge(nick, real, skinName = real) {
        const oldKey = nameKey(nick);
        const newKey = nameKey(real);
        if (oldKey === newKey) return;

        // The tab row, which is also where the client got the profile name it
        // binds to the entity. Re-adding it under the real IGN fixes the tab
        // immediately; an entity that is already spawned keeps the old name
        // until it respawns, because 1.8 bakes the profile in at spawn time.
        const profile = sentProfiles.get(oldKey);
        if (profile) {
            const renamed = { ...profile, name: real };
            const uuid = profileUuid(renamed);
            sentProfiles.delete(oldKey);
            sentProfiles.set(newKey, renamed);
            if (uuid && skinOverrides.get(uuid) === oldKey) skinOverrides.set(uuid, newKey);
            reissueProfile(renamed);
            if (skinName) scheduleRealSkin(skinName, renamed);
        }

        const teams = sentTeams.get(oldKey);
        if (teams) {
            sentTeams.delete(oldKey);
            sentTeams.set(newKey, mergeSets(sentTeams.get(newKey), teams));
            teams.forEach((team) => {
                emit('scoreboard_team', { team, mode: 4, players: [nick] });
                emit('scoreboard_team', { team, mode: 3, players: [real] });
            });
        }

        const scores = sentScores.get(oldKey);
        if (scores) {
            sentScores.delete(oldKey);
            sentScores.set(newKey, scores);
            scores.forEach((value, objective) => {
                emit('scoreboard_score', { itemName: nick, scoreName: objective, action: 1 });
                emit('scoreboard_score', { itemName: real, scoreName: objective, value, action: 0 });
            });
        }
    }

    function mergeSets(into, from) {
        if (!into) return from;
        from.forEach(value => into.add(value));
        return into;
    }

    // Every rewrite runs inline on the clientbound packet path. This codebase's
    // rule for that path (see the detectors) is that a bug in an add-on must
    // never break packet forwarding — a throw here would kill the connection.
    // So both entry points fall back to the untouched packet on any error.
    function safely(label, packet, work) {
        try {
            return work();
        } catch (error) {
            logger.error?.(`[Denick] ${label} rewrite failed, forwarding unchanged:`, error?.message || error);
            return packet;
        }
    }

    // Rewrite the names in a player_info ADD_PLAYER packet. Returns the SAME
    // object when nothing changed, so the common path allocates nothing.
    function rewritePlayerInfo(data, action) {
        return safely('player_info', data, () => rewritePlayerInfoUnsafe(data, action));
    }

    function rewritePlayerInfoUnsafe(data, action) {
        if (!data || !Array.isArray(data.data)) return data;

        // A player who leaves takes their tab row with them, so there is
        // nothing left to re-issue under that name.
        if (action === 'remove_player' || data.action === 4) {
            data.data.forEach(entry => forgetProfileByUuid(profileUuid(entry)));
            return data;
        }

        // Only ADD_PLAYER carries a name; the other actions are UUID-keyed.
        const isAdd = action === 'add_player' || data.action === 0;
        if (!isAdd) return data;

        let changed = false;
        const entries = data.data.map((entry) => {
            rememberOriginalProperties(entry);
            const real = entry?.name ? displayNameFor(entry.name) : null;
            const sent = real ? { ...entry, name: real } : entry;
            // Remember the row exactly as the client received it: an entry that
            // is NOT renamed today is precisely the one that has to be re-issued
            // if the denick lands later in the game.
            if (isRenderableName(sent?.name)) sentProfiles.set(nameKey(sent.name), sent);
            const skinReal = skinReplacementEnabled() && entry?.name
                ? realNameForSkin(entry.name)
                : null;
            if (skinReal) scheduleRealSkin(skinReal, sent);
            if (real) changed = true;
            return sent;
        });

        return changed ? { ...data, data: entries } : data;
    }

    function forgetProfileByUuid(uuid) {
        if (!uuid) return;
        sentProfiles.forEach((entry, key) => {
            if (profileUuid(entry) === uuid) sentProfiles.delete(key);
        });
        originalProfileProperties.delete(uuid);
        skinOverrides.delete(uuid);
        skinRequests.delete(uuid);
    }

    // Rewrite team membership so a renamed player keeps their team colour.
    // Applies to create (0), add-players (3) and remove-players (4).
    function rewriteTeamPacket(data) {
        return safely('scoreboard_team', data, () => rewriteTeamPacketUnsafe(data));
    }

    function rewriteTeamPacketUnsafe(data) {
        if (!data) return data;
        const mode = Number(data.mode);
        const team = data.team ? String(data.team) : '';

        // The team itself is gone, so it cannot be holding a stale name.
        if (mode === 1) {
            if (team) sentTeams.forEach(teams => teams.delete(team));
            return data;
        }

        if (!Array.isArray(data.players) || data.players.length === 0) return data;

        let changed = false;
        const players = data.players.map((player) => {
            const real = displayNameFor(player);
            if (real) changed = true;
            const sent = real || player;
            // Team entries are not always player names — the sidebar hacks push
            // arbitrary text through here — so only track ones that could be.
            if (team && isRenderableName(sent)) {
                if (mode === 4) dropTeamMember(sent, team);
                else if (mode === 0 || mode === 3) addTeamMember(sent, team);
            }
            return sent;
        });

        return changed ? { ...data, players } : data;
    }

    function addTeamMember(name, team) {
        const key = nameKey(name);
        if (!sentTeams.has(key)) sentTeams.set(key, new Set());
        sentTeams.get(key).add(team);
    }

    function dropTeamMember(name, team) {
        const teams = sentTeams.get(nameKey(name));
        if (!teams) return;
        teams.delete(team);
        if (teams.size === 0) sentTeams.delete(nameKey(name));
    }

    // Rewrite a scoreboard score entry.
    //
    // Scoreboard scores are keyed by player NAME, and Hypixel drives the
    // teammate health readout with them. Rename a player without rewriting
    // this and their health score stays attached to a name the client no
    // longer knows — the renamed player reads 0.
    function rewriteScorePacket(data) {
        return safely('scoreboard_score', data, () => {
            if (!data || typeof data.itemName !== 'string') return data;
            const real = displayNameFor(data.itemName);
            const sent = real || data.itemName;

            if (isRenderableName(sent)) {
                const key = nameKey(sent);
                const objective = String(data.scoreName || '');
                if (Number(data.action) === 1) {
                    const scores = sentScores.get(key);
                    if (scores) {
                        scores.delete(objective);
                        if (scores.size === 0) sentScores.delete(key);
                    }
                } else {
                    if (!sentScores.has(key)) sentScores.set(key, new Map());
                    sentScores.get(key).set(objective, data.value);
                }
            }

            return real ? { ...data, itemName: real } : data;
        });
    }

    // Chat components can contain text in a root component, nested `extra`
    // components, or translation arguments. Rewrite only those visible fields;
    // click/hover metadata deliberately stays untouched.
    function rewriteChatPacket(data) {
        return safely('chat', data, () => {
            if (!chatReplacementEnabled() || !data || typeof data.message !== 'string') return data;

            let message;
            try {
                message = JSON.parse(data.message);
            } catch (error) {
                return data;
            }

            const replaceNames = (text) => String(text).replace(/[A-Za-z0-9_]{3,16}/g, (name) => {
                let real = null;
                try {
                    real = resolveRealName(name, 'chat');
                } catch (error) {
                    logger.error?.('[Denick] Real-IGN chat lookup failed:', error?.message || error);
                }
                return isRenderableName(real) && nameKey(real) !== nameKey(name) ? real : name;
            });

            const rewriteComponent = (component) => {
                if (typeof component === 'string') {
                    const text = replaceNames(component);
                    return { value: text, changed: text !== component };
                }
                if (Array.isArray(component)) {
                    let changed = false;
                    const value = component.map((child) => {
                        const rewritten = rewriteComponent(child);
                        changed ||= rewritten.changed;
                        return rewritten.value;
                    });
                    return { value: changed ? value : component, changed };
                }
                if (!component || typeof component !== 'object') return { value: component, changed: false };

                let changed = false;
                let value = component;
                const copy = () => {
                    if (value === component) value = { ...component };
                    return value;
                };

                if (typeof component.text === 'string') {
                    const text = replaceNames(component.text);
                    if (text !== component.text) {
                        copy().text = text;
                        changed = true;
                    }
                }
                ['extra', 'with'].forEach((key) => {
                    if (component[key] === undefined) return;
                    const rewritten = rewriteComponent(component[key]);
                    if (rewritten.changed) {
                        copy()[key] = rewritten.value;
                        changed = true;
                    }
                });
                return { value, changed };
            };

            const rankedMessage = rewriteChatRanks(message, resolveChatRankedName);
            const rewritten = rewriteComponent(rankedMessage);
            return rewritten.changed || rankedMessage !== message
                ? { ...data, message: JSON.stringify(rewritten.value) } : data;
        });
    }

    // Single entry point for the clientbound path: hands back a rewritten COPY
    // for the packets that carry a player name, and the original otherwise.
    function rewriteClientbound(packetName, data, action = null) {
        if (packetName === 'player_info') return rewritePlayerInfo(data, action);
        if (packetName === 'scoreboard_team') return rewriteTeamPacket(data);
        if (packetName === 'scoreboard_score') return rewriteScorePacket(data);
        if (packetName === 'chat') return rewriteChatPacket(data);
        return data;
    }

    // Nicks currently being displayed under a different name.
    function activeRenames() {
        return Array.from(rewritten.values());
    }

    function wasRewritten(nick) {
        return rewritten.has(nameKey(nick));
    }

    function forget(nick) {
        return rewritten.delete(nameKey(nick));
    }

    function clear() {
        rewritten.clear();
        sentProfiles.clear();
        sentTeams.clear();
        sentScores.clear();
        originalProfileProperties.clear();
        skinOverrides.clear();
        skinRequests.clear();
        lastNameReplacementEnabled = null;
        lastSkinReplacementEnabled = null;
    }

    return {
        displayNameFor,
        rewritePlayerInfo,
        rewriteTeamPacket,
        rewriteScorePacket,
        rewriteChatPacket,
        rewriteClientbound,
        refreshNameReplacement: syncNameReplacementToggle,
        refreshRenames,
        refreshSkinReplacement: syncSkinReplacementToggle,
        activeRenames,
        wasRewritten,
        forget,
        clear
    };
}

module.exports = {
    createDenickDisplayNames,
    isRenderableName,
    nameKey,
    VALID_NAME
};
