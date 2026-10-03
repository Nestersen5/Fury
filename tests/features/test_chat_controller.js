const assert = require('assert');
const controller = require('../../features/chat_controller.js');

function clickValue(component) {
    return component?.clickEvent?.value || '';
}

function clickAction(component) {
    return component?.clickEvent?.action || '';
}

let row = controller.binary('Power', true, '/feature on', '/feature off');
assert.strictEqual(row[1].text, 'ON');
assert.strictEqual(row[1].color, 'green');
assert.strictEqual(clickAction(row[1]), 'run_command');
assert.strictEqual(clickValue(row[1]), '/feature on');
assert.strictEqual(row[3].text, 'OFF');
assert.strictEqual(row[3].color, 'gray');
assert.strictEqual(clickValue(row[3]), '/feature off');
assert.strictEqual(row[1].underlined, false);

row = controller.binary('Power', false, '/feature on', '/feature off');
assert.strictEqual(row[1].color, 'gray');
assert.strictEqual(row[3].color, 'red');

const included = controller.option('Tagged', true, '/share include tagged', 'Toggle tagged.');
const excluded = controller.option('Nicked', false, '/share include nicks', 'Toggle nicked.');
const locked = controller.option('Threats', true, '/share include threats', 'Locked.', {
    locked: true,
    lockedHover: 'Not editable now.'
});
assert.strictEqual(included.color, 'green');
assert.strictEqual(clickValue(included), '/share include tagged');
assert.strictEqual(excluded.color, 'red');
assert.strictEqual(clickValue(excluded), '/share include nicks');
assert.strictEqual(locked.color, 'dark_gray');
assert.strictEqual(locked.clickEvent, undefined);

const down = controller.adjust('-0.5', 'red', '/overlay threat fkdr 2.5', 'Lower FKDR.');
const disabledDown = controller.adjust('-1', 'red', '/overlay threat swlevel 0', 'Minimum.', false);
assert.strictEqual(down.text, '[-0.5]');
assert.strictEqual(down.color, 'red');
assert.strictEqual(clickValue(down), '/overlay threat fkdr 2.5');
assert.strictEqual(disabledDown.text, '[-1]');
assert.strictEqual(disabledDown.color, 'dark_gray');
assert.strictEqual(disabledDown.clickEvent, undefined);

const edit = controller.suggest('Edit', '/overlay threat fkdr ', 'Type a value.');
assert.strictEqual(edit.color, 'aqua');
assert.strictEqual(clickAction(edit), 'suggest_command');
assert.strictEqual(clickValue(edit), '/overlay threat fkdr ');
assert.strictEqual(edit.underlined, false);

console.log('Chat controller tests passed.');

const usage = [];
const guide = controller.createUsage(message => usage.push(message), 'Example', 'Description.');
guide.section('Controls');
guide.command('/example start', 'Start the feature.');
guide.example('/example status');
assert.strictEqual(usage[0].extra[0].color, 'gold');
assert(usage[2].extra.every(part => part.color === 'gold' && part.bold));
assert.deepStrictEqual(usage[3].extra.map(part => [part.text, part.color]), [
    ['/example start', 'white'], [' - Start the feature.', 'gray']
]);
assert(!JSON.stringify(usage).match(/clickEvent|hoverEvent/), 'Static usage must not gain actions');
