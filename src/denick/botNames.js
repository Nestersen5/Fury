'use strict';

// Hypixel spawns entities under generated names - ten lowercase characters with
// digits mixed in ("xf2l22s65j", "0x20o4ur65") - and the denick, nametag and
// scan paths all need to tell those apart from a real player's name before
// treating one as a nick.
//
// The digit is what separates a generated name from an ordinary ten-letter
// username. Across this project's captured recordings, 55 of the 56
// ten-character lowercase names carry one, and the only one that does not
// ("plainhuman") is a real player. Without that requirement every all-lowercase
// ten-letter name read as generated - "samplename" among them - so a nicked
// player with such a name was never marked as a nick, never annotated above
// their head, and never reached /scan.

function isLikelyBot(name) {
    const value = String(name || '');
    const hasCapital = /[A-Z]/.test(value);
    const hasUnderscore = /_/.test(value);
    const vowelCount = (value.match(/[aeiou]/gi) || []).length;
    const numberCount = (value.match(/\d/g) || []).length;
    const isExactly10Chars = value.length === 10;
    const startsWithNumber = /^\d/.test(value);

    const isLowercaseNumberBot = isExactly10Chars
        && numberCount > 0
        && /^[a-z0-9]+$/.test(value)
        && !hasCapital;

    return !hasCapital && !hasUnderscore && (startsWithNumber || vowelCount === 0 || isLowercaseNumberBot);
}

module.exports = { isLikelyBot };
