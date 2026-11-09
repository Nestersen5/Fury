'use strict';

const { normalizeUuidText } = require('../util/uuid');

function realAccountUuid(value) {
    const uuid = normalizeUuidText(value);
    return /^[a-f0-9]{32}$/.test(uuid) ? uuid : null;
}

const isAccountName = value => /^[a-z0-9_]{3,16}$/i.test(String(value || ''));

module.exports = { realAccountUuid, isAccountName };
