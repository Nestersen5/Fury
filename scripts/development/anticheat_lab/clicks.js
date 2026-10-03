'use strict';

// Independently authored cadence model from the static audit. This file neither
// imports nor executes original code. Game-input sampling remains a separate
// fidelity requirement: cadence output alone is not a tested gameplay scenario.
const { JavaRandom, JavaSplittableRandom, mix64, U64, GAMMA } = require('./random');
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

class ExtraPlusCadence {
    constructor(seed) {
        const mixed = mix64(U64(BigInt(seed)) ^ GAMMA);
        this.rng = new JavaSplittableRandom(mixed);
        this.salt = mix64(mixed - 3335678366873096957n);
        this.initialized = false;
        this.previous = 0;
        this.repeatChance = 0.06;
        this.pauseOffset = 0;
        this.fatigue = 0;
        this.calls = 0;
        this.burst = 0;
        this.last = 0;
    }
    normal() {
        let sum = 0;
        for (let i = 0; i < 6; i++) sum += this.rng.nextDouble();
        return (sum - 3) * 1.22474487139;
    }
    configure(min, max) {
        this.min = Math.max(0.5, Math.max(0, min) * 1.5);
        this.max = Math.max(this.min + 0.1, Math.max(0.5, Math.max(Math.max(0, min), max) * 1.5));
        if (!this.initialized) {
            this.target = (this.min + this.max) / 2;
            this.current = clamp(this.target + this.normal() * 0.25, this.min, this.max);
        }
    }
    duration(now, min, max) {
        const time = Number((BigInt(Math.trunc(now)) ^ this.salt) & 0xffffn);
        const range = max - min + 1;
        return min + (time + this.rng.nextInt(range)) % range;
    }
    setTarget() {
        this.target = clamp((this.min + this.max) / 2 + (this.rng.nextDouble() * 2 - 1) * 0.75, this.min, this.max);
    }
    noise() {
        const normal = this.normal(), roll = this.rng.nextDouble();
        if (roll < 0.12) return (this.rng.nextDouble() - 0.5) * 3;
        if (roll < 0.17) return normal * (1.4 + this.rng.nextDouble() * 0.6);
        return normal;
    }
    next(now) {
        if (!this.initialized) {
            this.initialized = true;
            this.nextDrift = now + this.duration(now, 1200, 3200);
            this.nextTarget = now + this.duration(now, 30000, 90000);
            this.setTarget();
            this.last = now;
        }
        const idle = this.last === 0 ? 0 : now - this.last;
        if (idle >= 1200) {
            this.fatigue = Math.max(0, this.fatigue - 0.004 * Math.min(5000, idle) / 10);
            this.burst = this.rng.nextDouble() < 0.7 ? 2 + this.rng.nextInt(4) : 0;
            this.repeatChance = 0.03 + this.rng.nextDouble() * 0.06;
            this.pauseOffset = this.rng.nextDouble() * 0.04;
        }
        if (++this.calls > 80 + this.rng.nextInt(120)) {
            this.repeatChance = 0.03 + this.rng.nextDouble() * 0.06;
            this.pauseOffset = this.rng.nextDouble() * 0.04;
            this.calls = 0;
        }
        if (now >= this.nextDrift) {
            this.current += 0.25 * (this.target - this.current) + 0.45 * this.normal();
            if (this.rng.nextDouble() < 0.03) this.current += (this.rng.nextDouble() - 0.5) * 1.2;
            this.current = clamp(this.current, this.min, this.max);
            this.nextDrift = now + this.duration(now, 1200, 3200);
        }
        if (now >= this.nextTarget) {
            this.setTarget();
            this.nextTarget = now + this.duration(now, 30000, 90000);
        }
        const burst = this.burst > 0;
        let effective = this.current;
        if (burst) { effective *= 1 + 0.05 * (0.4 + 0.8 * this.rng.nextDouble()); this.burst--; }
        effective = clamp(effective * (1 - Math.min(0.4, this.fatigue)), this.min, this.max);
        const multiplier = Math.exp(0.24 * this.noise());
        const maxJitter = 35 + this.rng.nextInt(11) - 5;
        let delay = 1000 / effective * multiplier + this.rng.nextInt(Math.max(1, maxJitter) + 1);
        if (burst) delay += this.rng.nextInt(15);
        if (this.previous > 0 && this.rng.nextDouble() < this.repeatChance) delay = this.previous + this.rng.nextInt(7) - 3;
        if (this.rng.nextDouble() < 0.07) delay *= 0.7 + this.rng.nextDouble() * 0.2;
        const pauseChance = Math.min(0.04 + 0.12 * this.fatigue + this.pauseOffset, 0.18);
        if (this.rng.nextDouble() < pauseChance) delay += 50 + this.rng.nextInt(101);
        this.fatigue = Math.min(0.4, this.fatigue + 0.015);
        this.last = now;
        this.previous = Math.trunc(clamp(delay, 1, 0x7fffffff));
        return this.previous;
    }
}

class ClickCadence {
    constructor({ min = 6, max = 13, mode = 'extra', seed = 1 } = {}) {
        if (!['normal', 'extra', 'extra+'].includes(mode) || !Number.isFinite(min) || !Number.isFinite(max)
            || min < 1 || max > 20 || max < min) throw new Error('Unsupported AutoClicker settings');
        this.min = Math.trunc(min); this.max = Math.trunc(max); this.mode = mode;
        this.rng = new JavaRandom(seed);
        // Original hold split constructs fresh unseeded Randoms. A distinct,
        // reproducible stream preserves formulas/distributions, not entropy.
        this.holdRng = new JavaRandom(BigInt(seed) ^ 0x5d19n);
        this.plus = new ExtraPlusCadence(seed);
        this.burst = false; this.burstCount = 0; this.burstLength = 0;
        this.fast = true; this.fastCount = 0; this.fastLength = 0;
        this.slowCount = 0; this.slowLength = 0; this.last = 0;
    }
    engineDelay(now) {
        const range = this.max - this.min;
        const cps = range <= 0 ? this.min : this.rng.nextInt(range) + this.min + 1;
        if (this.mode === 'normal') return this.last = Math.trunc(1000 / cps);
        if (this.mode === 'extra+') { this.plus.configure(this.min, this.max); return this.plus.next(now); }
        if (!this.burst) {
            this.last = Math.trunc(1000 / cps);
            if (this.rng.nextInt(4) === 1) {
                this.burst = true; this.burstLength = 1 + this.rng.nextInt(5);
            } else if (this.rng.nextInt(10) !== 1 && this.rng.nextInt(10) === 1) {
                this.burst = true; this.burstLength = 5 + this.rng.nextInt(10);
            }
        }
        if (this.burst && ++this.burstCount >= this.burstLength) { this.burstCount = 0; this.burst = false; }
        if (this.rng.nextInt(48) % (this.fast ? 6 : 10) === 0 && !this.burst) this.last += this.rng.nextInt(45) + 40;
        if (this.fast) {
            if (++this.fastCount >= this.fastLength) {
                this.slowLength = 75 + this.rng.nextInt(125);
                this.fast = false; this.fastCount = 0;
            }
            return this.last + (this.rng.nextInt(5) === 3 ? 50 : 25);
        }
        if (++this.slowCount >= this.slowLength) {
            this.fast = true; this.fastLength = 7 + this.rng.nextInt(8); this.slowCount = 0;
        }
        return this.last;
    }
    cycle(now) {
        const engineDelayMs = this.engineDelay(now);
        let delayMs = engineDelayMs - 5;
        if (delayMs - 50 <= 0) delayMs = 45;
        const scale = (100 - Math.min(delayMs, 99) + 45) / 100;
        const releaseFraction = (30 + this.holdRng.nextInt() % 10 + 40 * scale) / 100;
        const holdMs = Math.trunc(delayMs * (1 - releaseFraction));
        const releaseMs = Math.trunc(delayMs * releaseFraction);
        return { engineDelayMs, holdMs, releaseMs, workerPauseMs: 5, cycleMs: holdMs + releaseMs + 5 };
    }
}

module.exports = { ClickCadence, ExtraPlusCadence };
