'use strict';
const attribute = require('./runtime/node_modules/prismarine-physics/lib/attribute');
// Experimental adapter, explicitly enabled in fidelity pilots only. Vanilla
// EntityPlayer.onLivingUpdate sets air/land factors AFTER super's integration
// (trusted Forge 1.8.9 sources, EntityPlayer.java:613-628). This preserves that
// one-tick delay without modifying the trusted collision dependency.
class VanillaMovementFactors {
    constructor() { this.land = Math.fround(0.1); this.air = Math.fround(0.02); }
    prepare(state, physics) {
        const name = physics.movementSpeedAttribute, current = state.attributes?.[name];
        const speed = current ? { value: current.value, modifiers: current.modifiers.filter(m => m.uuid !== physics.sprintingUUID) }
            : { value: physics.playerSpeed, modifiers: [] };
        if (state.control.sprint) speed.modifiers.push({ uuid: physics.sprintingUUID, amount: 0.3, operation: 2 });
        const nextLand = Math.fround(attribute.getAttributeValue(speed));
        const multiplier = state.control.sprint ? 1.3 : 1;
        state.attributes = { ...state.attributes, [name]: { value: this.land / multiplier, modifiers: [] } };
        physics.airborneAcceleration = this.air / multiplier;
        this.land = nextLand;
        this.air = state.control.sprint ? Math.fround(Math.fround(0.02) + Math.fround(0.02) * 0.3) : Math.fround(0.02);
    }
}
module.exports = { VanillaMovementFactors };
