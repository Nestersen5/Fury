'use strict';

// Design A's limit sliders. The number input keeps ownership of the value,
// validation and autosave; the native range keeps focus, keyboard and slider
// semantics in the same units. Positions follow a curve so the low values
// players usually pick get most of the track. Drags land on round numbers for
// their speed, Shift slows a drag down and Escape cancels it.
const CURVE = 2.5, FINE = 0.1, NICE = [1, 2, 5];
const SLIDER_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

function create({ document, input, ceiling, title, id, host }) {
    const View = document.defaultView;
    const make = (tag, className) => { const node = document.createElement(tag); node.className = className; return node; };
    const control = make('div', 'da-range-control'), slider = make('input', 'da-range');
    const track = make('span', 'da-range-track'), thumb = make('span', 'da-range-thumb');
    track.append(make('span', 'da-range-fill'));
    track.setAttribute('aria-hidden', 'true'); thumb.setAttribute('aria-hidden', 'true');
    slider.type = 'range'; slider.id = id; slider.setAttribute('aria-label', title);
    slider.min = input.min || '0'; slider.step = input.step || '1';
    control.title = 'Hold Shift while dragging for finer control';
    control.append(slider, track, thumb);

    const min = Number(slider.min), step = Number(slider.step) || 1;
    const decimals = (slider.step.split('.')[1] || '').length;
    let max = ceiling, previous = '', drag = null;
    const clamp = t => Math.min(1, Math.max(0, t));
    const format = value => String(Number(value.toFixed(decimals)));
    const position = value => clamp((value - min) / (max - min || 1)) ** (1 / CURVE);
    const current = () => Number(input.value) || 0;
    // Round to the coarsest 1/2/5 multiple of the step that `pixel` of track
    // travel can reach here, so a quick drag gives 500 rather than 503.
    function valueAt(t, pixel) {
        if (t <= 0) return format(min);
        if (t >= 1) return format(max);
        const reach = (max - min) * CURVE * t ** (CURVE - 1) * pixel / step;
        let units = 1;
        for (let scale = 1; scale <= reach; scale *= 10) for (const n of NICE) if (scale * n <= reach) units = scale * n;
        const raw = (max - min) * t ** CURVE, size = step * units;
        return format(Math.min(max, min + Math.round(raw / size) * size));
    }
    function set(value) {
        if (value === input.value) return false;
        input.value = value;
        input.dispatchEvent(new View.Event('input', { bubbles: true }));
        return true;
    }
    const commit = () => input.dispatchEvent(new View.Event('change', { bubbles: true }));

    function sync(force) {
        const signature = `${input.value}:${input.disabled}`;
        if (signature === previous && !force) return;
        previous = signature;
        const value = current();
        // A drag keeps its scale even when it passes a typed value above the ceiling.
        if (!drag) { max = Math.max(ceiling, value); slider.max = String(max); }
        slider.value = String(value);
        slider.disabled = input.disabled;
        control.classList.toggle('is-disabled', input.disabled);
        control.style.setProperty('--da-p', position(value).toFixed(4));
    }

    // Any drag that sent `input` finishes with one `change`, even when Escape
    // restores the original value, so the settings owners close their draft.
    function end(event, cancel) {
        if (!drag || (event && event.pointerId !== drag.id)) return;
        const { id: pointer, original, dirty } = drag;
        if (cancel) set(original);
        drag = null;
        control.classList.remove('is-active', 'is-dragging', 'is-fine');
        host.classList.remove('is-adjusting');
        if (control.hasPointerCapture(pointer)) control.releasePointerCapture(pointer);
        if (dirty) commit();
        sync(true);
    }
    control.addEventListener('pointerdown', event => {
        if (event.button !== 0 || slider.disabled || drag) return;
        event.preventDefault();
        slider.focus({ preventScroll: true, focusVisible: false });
        const box = control.getBoundingClientRect(), size = thumb.offsetWidth;
        const travel = Math.max(1, box.width - size), start = box.left + size / 2, at = position(current());
        drag = { id: event.pointerId, original: input.value, travel, t: at, anchorT: at, anchorX: event.clientX, fine: event.shiftKey, moved: false, dirty: false };
        control.setPointerCapture(event.pointerId);
        control.classList.add('is-active');
        control.classList.toggle('is-fine', drag.fine);
        host.classList.add('is-adjusting');
        // Pressing the track glides there; pressing the thumb keeps its offset.
        if (Math.abs(event.clientX - (start + travel * at)) > size / 2 + 4) {
            drag.t = drag.anchorT = clamp((event.clientX - start) / travel);
            drag.dirty = set(valueAt(drag.t, 2 / travel));
        }
    });
    control.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.id) return;
        if (event.shiftKey !== drag.fine) {
            drag.fine = event.shiftKey; drag.anchorT = clamp(drag.t); drag.anchorX = event.clientX;
            control.classList.toggle('is-fine', drag.fine);
        }
        const t = drag.anchorT + (event.clientX - drag.anchorX) / drag.travel * (drag.fine ? FINE : 1);
        if (t === drag.t) return;
        if (!drag.moved) { drag.moved = true; control.classList.add('is-dragging'); }
        drag.t = t;
        if (set(valueAt(clamp(t), (drag.fine ? FINE : 2) / drag.travel))) drag.dirty = true;
    });
    control.addEventListener('pointerup', event => end(event, false));
    // A touch that turns into scrolling leaves the value as it was.
    control.addEventListener('pointercancel', event => end(event, true));
    control.addEventListener('lostpointercapture', event => end(event, false));
    // The slider sits inside the number's label; keep focus on the slider.
    control.addEventListener('click', event => event.preventDefault());

    slider.addEventListener('keydown', event => {
        if (drag) {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); end(null, true); }
            else if (event.key === 'Shift') control.classList.add('is-fine');
            else if (SLIDER_KEYS.has(event.key)) event.preventDefault();
            return;
        }
        // Plain arrows, Home and End stay native. Shift+arrows move ten steps;
        // Page Up/Down move a tenth of the visible track.
        const page = event.key === 'PageUp' || event.key === 'PageDown';
        if (!page && !(event.shiftKey && /^Arrow/.test(event.key))) return;
        event.preventDefault();
        if (slider.disabled) return;
        const up = ['PageUp', 'ArrowUp', 'ArrowRight'].includes(event.key), value = current();
        let next = page ? valueAt(clamp(position(value) + (up ? .1 : -.1)), .02) : format(value + (up ? 10 : -10) * step);
        if (page && Number(next) === value) next = format(value + (up ? step : -step));
        next = format(Math.min(max, Math.max(min, Number(next))));
        if (set(next)) commit();
    });
    slider.addEventListener('keyup', event => { if (drag && event.key === 'Shift') control.classList.remove('is-fine'); });
    slider.addEventListener('input', () => set(format(Number(slider.value))));
    slider.addEventListener('change', commit);
    input.addEventListener('input', () => sync(false));
    input.addEventListener('change', () => sync(false));
    sync(true);
    return { element: control, sync: () => sync(false) };
}

module.exports = { create };
