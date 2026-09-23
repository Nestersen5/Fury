'use strict';

// Shared desktop presentation. Keep the existing inputs, listeners and save paths.
function mount({ document, icon, navigate, invoke }) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'src/launcher/styles/launcher_windows_settings.css';
    document.head.appendChild(stylesheet);
    const syncers = [];
    const el = (tag, className = '', text = '') => {
        const node = document.createElement(tag);
        node.className = className;
        if (text) node.textContent = text;
        return node;
    };

    // These two pages share the same feature header and neutral card treatment.
    // Enhance their existing containers so controls and navigation keep working.
    for (const category of ['gameplay', 'denick']) {
        document.querySelector(`[data-settings-subpage="${category}"]`).classList.add('fc-consistent-page');
    }
    for (const [id, category, iconName] of [
        ['auto-gambler-enabled', 'Queue automation', 'cardCheck'],
        ['party-split-warnings-enabled', 'Party safety', 'users']
    ]) {
        const card = document.getElementById(id).closest('.feature-card');
        const module = el('section', 'fc-module');
        card.before(module);
        module.append(card);
        card.classList.add('fc-module-head');
        card.firstElementChild.prepend(el('span', 'eyebrow', category));
        const symbol = el('span', 'fc-module-icon');
        symbol.setAttribute('aria-hidden', 'true');
        symbol.innerHTML = icon(iconName);
        card.prepend(symbol);
    }
    document.querySelector('.auto-dodge-module').classList.add('fc-module');
    document.querySelector('.auto-dodge-hero').classList.add('fc-module-head');
    document.querySelector('.auto-dodge-hero-icon').classList.add('fc-module-icon');
    document.querySelector('.denick-settings-module').classList.add('fc-module');
    document.querySelector('.denick-settings-intro').classList.add('fc-module-head');
    document.querySelector('.denick-settings-intro-icon').classList.add('fc-module-icon');
    document.querySelector('.denick-settings-intro .denick-workflow-eyebrow').textContent = 'Nickname detection';
    document.getElementById('denick-detection-title').textContent = 'Matching methods';
    document.getElementById('denick-results-title').textContent = 'Where matches appear';
    document.querySelector('.denick-saved-explainer h4').textContent = 'Saved matches';
    const check = (id, title, visibleTitle = title) => {
        const input = document.getElementById(id);
        const label = el('label', 'switch fc-check settings-search-item');
        label.dataset.settingsLabel = title;
        input.setAttribute('aria-label', title);
        input.dataset.notificationLabel = title;
        const box = el('span', 'fc-check-box');
        box.setAttribute('aria-hidden', 'true');
        label.append(input, box);
        if (visibleTitle) label.append(el('span', 'fc-check-text', visibleTitle));
        return label;
    };
    const mergeCards = (choices, title, description, id) => {
        const cards = choices.map(([key]) => document.getElementById(key).closest('.feature-card'));
        const card = cards[0];
        const copy = el('div', 'fc-group-copy');
        copy.append(el('h3', '', title), el('div', 'note', description));
        const group = el('div', 'fc-check-group');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', title);
        choices.forEach(([key, label]) => group.append(check(key, `${title}: ${label}`, label)));
        card.id = id;
        card.classList.add('fc-group-card');
        card.replaceChildren(copy, group);
        cards.slice(1).forEach(node => node.remove());
    };
    mergeCards([
        ['denick-real-ign-nametags', 'In-game name'],
        ['denick-real-skin', 'Skin'],
        ['denick-real-ign-chat', 'Chat name']
    ], 'Show real identity', 'Replace names and skins using saved nick matches.', 'real-identity-options');


    // Keep existing choice cards and icons; replace only their toggle presentation.
    for (const selector of ['.auto-dodge-choice-grid', '.share-include-grid', '.denick-method-grid', '.chat-stats-source-list']) {
        const group = document.querySelector(selector);
        for (const card of group.children) {
            const input = card.querySelector('.switch input[type="checkbox"]');
            if (!input) continue;
            const title = card.querySelector('h3,h4,strong').textContent.trim();
            const previousLabel = input.closest('.switch');
            previousLabel.replaceWith(check(input.id, title, ''));
            card.classList.add('fc-choice-card');
            card.addEventListener('click', event => {
                if (!event.target.closest('label,input,button,a,select') && !input.disabled) input.click();
            });
        }
    }

    const slider = (id, title) => {
        const number = document.getElementById(id);
        const min = Number(number.min), max = Number(number.max);
        const range = el('input', 'fc-range');
        range.type = 'range';
        range.id = `${id}-slider`;
        range.min = number.min;
        range.max = number.max;
        range.step = number.step;
        range.setAttribute('aria-label', title);
        number.dataset.notificationLabel = title;
        // Keep each input associated with its own label.
        const numberLabel = number.closest('label');
        const wrapper = el('div', 'fc-slider-control');
        numberLabel.before(wrapper);
        wrapper.append(numberLabel, range);
        const sync = () => {
            range.value = number.value;
            range.style.setProperty('--fc-fill', `${(Number(range.value) - min) / (max - min) * 100}%`);
            range.disabled = number.disabled;
            range.setAttribute('aria-valuetext', `${range.value} ${id.includes('delay') ? 'seconds' : 'Ender Dust'}`);
        };
        range.addEventListener('input', () => {
            number.value = range.value;
            number.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
        });
        number.addEventListener('input', sync);
        number.addEventListener('change', () => {
            number.value = String(Math.min(max, Math.max(min, Math.round(Number(number.value) || min))));
            sync();
        }, true);
        syncers.push(sync);
        sync();
    };
    slider('auto-dodge-delay-seconds', 'Leave delay');
    slider('ender-dust-reminder-threshold', 'Ender Dust alert target');

    // Copy changes use the original description slots, without altering their styling.
    const descriptions = new Map([
        ['Scans, threat rules, lookup pacing, and the information that decides who needs your attention.', 'Choose who scans flag and what to share.'],
        ['Choose whether scans show threats, all players, or stay disabled.', 'Show all players, only threats, or no scan results.'],
        ["Enables /po, which manually checks the current party's BedWars stats and provider tags. Results appear only in your own Minecraft chat; it never sends party, all-chat, or any server message. Caution tags show their full provider reason.", 'Use /po to check your party’s BedWars stats and tags. Only you see the results.'],
        ['After a scan, send selected threats to party chat. Manual /share remains available.', 'Send selected scan results to party chat automatically. Use /share for manual sharing.'],
        ['Adds stars, compact separators, icons, and clearer threat details.', 'Add stars, icons and separators to shared results.'],
        ['Colorizes your local copy by team, stats, and tags. Party members still receive plain text.', 'Color your copy of shared results. Your party still sees plain text.'],
        ['Sends each team together instead of posting players as soon as lookups finish.', 'Keep players from the same team together.'],
        ['Sharing, optional automations, and in-game helpers that shape how a match feels.', 'Queue rules and in-game helpers.'],
        ['Automatically accepts the quest from the gambler George.', 'Accept Gambler George’s quest automatically.'],
        ['Leave BedWars queues before the game starts when a player or party matches your rules.', 'Leave a BedWars queue when a player matches your rules.'],
        ['Choose how long you have to decide whether to stay.', 'Set how long Fury waits before leaving.'],
        ['Decision window before Fury sends /l', 'Wait before sending /l'],
        ['The leave delay is your time to decide whether to stay. If the game-start countdown gets close to zero, Fury leaves early enough to keep you out of the match no matter how much of the delay remains.', 'Fury may leave sooner if the game is about to start.'],
        ['Automatically group games into play sessions, design the post-game recap, and choose what appears in progression history.', 'Track sessions and choose what recaps and history show.'],
        ['Starts with your first supported game and ends after the selected period of inactivity.', 'Start on your first supported game; end after the selected idle time.'],
        ['Choose how much information Fury prints after a verified game.', 'Show a recap in your chat after each verified game.'],
        ['Older completed sessions are removed locally unless Infinite is selected.', 'Keep this many sessions. Infinite keeps them all.'],
        ['Choose how Fury finds the real account behind a nick and what happens when a match is found.', 'Find the account behind a nick and choose how to show matches.'],
        ['Fury checks players already identified as nicked, then links a confirmed match to the real Minecraft account.', 'Match detected nicked players to their real accounts.'],
        ['Compares skin and cosmetic data with known accounts. Confirmed matches are saved automatically.', 'Match skins and cosmetics to known accounts. Save confirmed matches.'],
        ['Searches the final-kill and bed values captured during a Bed Wars game for a matching account.', 'Match final kills and beds to an account during BedWars.'],
        ['Each confirmed nick-to-IGN link is kept under Nicks and reused in later games. Turning detection off never removes saved matches.', 'Matches stay under Nicks for future games, even when detection is off.'],
        ['These controls only affect display and messages. Detection and saved matches continue to work when they are off.', 'Choose how matches appear. Detection and saved matches stay active.'],
        ['Shows nickname (real IGN) in these two views. In-world nametags stay separate under Custom Nametags.', 'Show nickname (real IGN) in these views. Set in-game labels under Custom Nametags.'],
        ['Prints progress, confirmed matches, and the matched player’s stats to your own chat.', 'Show match progress, results and player stats in your chat.'],
        ['Sends new and saved nick-to-IGN matches to Hypixel party chat, where party members can see them.', 'Share new and saved nick matches with your party.'],
        ['Overlay controls populate the launcher player board. Chat Stats print player intelligence inside Minecraft chat.', 'Choose who appears on the Overlay and when Minecraft chat shows stats.'],
        ['Choose which social events automatically add a player to the Overlay tab.', 'Add players to the Overlay from selected social events.'],
        ['When a message contains one of these phrases, its sender is added to the Overlay with the matched phrase as a marker.', 'Add a sender to the Overlay when their message contains a listed phrase.'],
        ['Configure stat lines printed inside Minecraft. These settings are separate from the launcher Overlay.', 'Show player stats in Minecraft chat. Set Overlay additions separately.'],
        ['Show cached stats in Minecraft chat when a player speaks before the game starts.', 'Show cached stats when a player chats before a game.'],
        ['Print one stat line per player per lobby when one of the selected message types appears.', 'Show stats once per player per lobby for the selected message types.'],
        ['Tab stats and live name-label layouts that Fury shows while games are active.', 'Choose what the Tab list and player nametags show.'],
        ['Choose and arrange the information shown beside players in BedWars and SkyWars.', 'Choose and order Tab stats for BedWars and SkyWars.'],
        ["Choose what appears before and after each player's name. The preview updates instantly.", 'Choose what appears before and after names. Preview changes live.'],
        ['Wrap the BedWars level and star icon in dark gray brackets, for example: [385✫].', 'Show BedWars stars in gray brackets: [385✫].'],
        ['Choose compact acronyms or full classification labels. Urchin renders pink; Seraph renders dark aqua. The preview uses Urchin.', 'Show tag acronyms or full names. Urchin is pink; Seraph is dark aqua.'],
        ['Keys stay on this computer. Open a provider to paste, test, or replace its key; everything else remains tucked away.', 'Keys stay on this computer. Open a provider to add or test a key.'],
        ['See the active route, validate endpoints, and know exactly which changes require a restart.', 'Check the active route and edit connection settings.'],
        ['Warn when the proxy lags and temporarily pause expensive optional packet features.', 'Warn about proxy lag and pause optional packet features until it recovers.'],
        ['Another alert can appear after two hours if dust stays at the target.', 'Repeat after two hours if dust is still at the target.'],
        ['Once ready, Fury alerts when you enter a lobby, pregame, or another game. Use /reminder george claimed if claim chat is not detected.', 'Once ready, alert when you change lobbies or games. Use /reminder george claimed if a claim is missed.']
    ]);
    document.querySelectorAll('[data-settings-subpage] .note, [data-settings-subpage] p, [data-settings-subpage] small, [data-page="reminders"] small, .reminder-repeat-limit > span').forEach(node => {
        const text = node.textContent.replace(/\s+/g, ' ').trim();
        if (descriptions.has(text)) node.textContent = descriptions.get(text);
    });
    const usability = require('./launcher_windows_usability').mount({ document, navigate, invoke });
    return { sync: () => syncers.forEach(sync => sync()), syncState: usability.syncState };
}

module.exports = { mount };
