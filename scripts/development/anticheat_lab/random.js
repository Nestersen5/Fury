'use strict';

// Independent implementations of Java's public seeded RNG algorithms. These
// are lab-only and are checked against the installed, trusted JDK, not Vape.
const U64 = value => BigInt.asUintN(64, value);
const GAMMA = 0x9e3779b97f4a7c15n;
function mix64(value) {
    let z = U64(value);
    z = U64((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
    z = U64((z ^ (z >> 27n)) * 0x94d049bb133111ebn);
    return U64(z ^ (z >> 31n));
}
function validBound(bound) {
    if (!Number.isInteger(bound) || bound < 1 || bound > 0x7fffffff) throw new RangeError('Positive Java int bound required');
}
class JavaRandom {
    constructor(seed) { this.seed = (BigInt(seed) ^ 0x5deece66dn) & ((1n << 48n) - 1n); }
    bits(count) {
        this.seed = (this.seed * 0x5deece66dn + 11n) & ((1n << 48n) - 1n);
        return Number(this.seed >> BigInt(48 - count));
    }
    nextInt(bound) {
        if (bound === undefined) return this.bits(32) | 0;
        validBound(bound);
        if ((bound & (bound - 1)) === 0) return Math.floor(bound * this.bits(31) / 0x80000000);
        let bits, value;
        do { bits = this.bits(31); value = bits % bound; } while (((bits - value + bound - 1) | 0) < 0);
        return value;
    }
    nextDouble() { return (this.bits(26) * 134217728 + this.bits(27)) / 9007199254740992; }
    nextFloat() { return this.bits(24) / 16777216; }
}
class JavaSplittableRandom {
    constructor(seed) { this.seed = U64(BigInt(seed)); }
    nextSeed() { this.seed = U64(this.seed + GAMMA); return this.seed; }
    int32() {
        let z = this.nextSeed();
        z = U64((z ^ (z >> 33n)) * 0x62a9d9ed799705f5n);
        z = U64((z ^ (z >> 28n)) * 0xcb24d0a5c88c35b3n);
        return Number(z >> 32n) | 0;
    }
    nextInt(bound) {
        if (bound === undefined) return this.int32();
        validBound(bound);
        let r = this.int32();
        const mask = bound - 1;
        if ((bound & mask) === 0) return r & mask;
        let unsigned = r >>> 1;
        while (true) {
            r = unsigned % bound;
            if (((unsigned + mask - r) | 0) >= 0) return r;
            unsigned = this.int32() >>> 1;
        }
    }
    nextDouble() { return Number(mix64(this.nextSeed()) >> 11n) / 9007199254740992; }
}
module.exports = { JavaRandom, JavaSplittableRandom, mix64, U64, GAMMA };
