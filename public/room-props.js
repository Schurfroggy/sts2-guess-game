import { activeAudioContext } from './celebration.js';
import { propBatchLimit, propInterval } from './prop-rules.js';
import { element, roomRequest } from './room-client.js';

const sprites = {
  flower: '/assets/room/prop-flower.svg',
  egg: '/assets/room/prop-egg.svg',
  splat: '/assets/room/prop-egg-splat.svg'
};
const flushDelay = 260;
const effectLimit = 28;
const incomingLimit = 16;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let lastSound = -Infinity;
let noise;

function impactSound(kind) {
  const sound = activeAudioContext();
  if (!sound || document.hidden || sound.currentTime - lastSound < .12) return;
  const start = sound.currentTime;
  lastSound = start;
  const tone = sound.createOscillator();
  const volume = sound.createGain();
  const egg = kind === 'egg';
  tone.type = egg ? 'sine' : 'triangle';
  tone.frequency.setValueAtTime(egg ? 190 : 780, start);
  tone.frequency.exponentialRampToValueAtTime(egg ? 73 : 1250, start + .085);
  volume.gain.setValueAtTime(egg ? .08 : .045, start);
  volume.gain.exponentialRampToValueAtTime(.001, start + .14);
  tone.connect(volume).connect(sound.destination);
  tone.start(start);
  tone.stop(start + .15);
  if (!egg) return;

  if (!noise) {
    noise = sound.createBuffer(1, Math.ceil(sound.sampleRate * .13), sound.sampleRate);
    const samples = noise.getChannelData(0);
    for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
  }
  const crack = sound.createBufferSource();
  crack.buffer = noise;
  const filter = sound.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2600, start);
  filter.frequency.exponentialRampToValueAtTime(480, start + .09);
  const snap = sound.createGain();
  snap.gain.setValueAtTime(.11, start);
  snap.gain.exponentialRampToValueAtTime(.001, start + .11);
  crack.connect(filter).connect(snap).connect(sound.destination);
  crack.start(start);
}

export function createAvatarProps({ seats, layer, menu }) {
  const status = menu.querySelector('[role="status"]');
  let room;
  let scope;
  let target;
  let lastId = 0;
  let lastThrow = -Infinity;
  let held;
  let flushTimer;
  let incomingTimer;
  let sending = false;
  let outgoing = [];
  let incoming = [];

  const seat = (id) => seats.querySelector(`[data-seat-player="${CSS.escape(id)}"]`);
  const trigger = (id) => seat(id)?.querySelector('[data-avatar-player]');

  function stopHold() {
    if (!held) return;
    clearTimeout(held.timer);
    held = null;
  }

  function close(restoreFocus = false) {
    stopHold();
    if (!target) return;
    const anchor = trigger(target);
    anchor?.setAttribute('aria-expanded', 'false');
    target = null;
    menu.hidden = true;
    if (restoreFocus) anchor?.focus({ preventScroll: true });
  }

  function positionMenu() {
    if (!target) return;
    const anchor = trigger(target);
    if (!anchor) return close();
    anchor.setAttribute('aria-expanded', 'true');
    const bounds = anchor.getBoundingClientRect();
    const gap = 8;
    const { offsetWidth: width, offsetHeight: height } = menu;
    let left = bounds.right + gap;
    if (left + width + gap > innerWidth && bounds.left >= width + gap * 2) left = bounds.left - width - gap;
    const top = bounds.top + (bounds.height - height) / 2;
    menu.style.left = `${Math.max(gap, Math.min(left, innerWidth - width - gap))}px`;
    menu.style.top = `${Math.max(gap, Math.min(top, innerHeight - height - gap))}px`;
  }

  function point(id, bounds) {
    const rect = seat(id)?.querySelector('.avatar')?.getBoundingClientRect();
    if (!rect) return null;
    return { x: rect.left + rect.width / 2 - bounds.left, y: rect.top + rect.height / 2 - bounds.top };
  }

  function impact(kind, id) {
    const end = point(id, layer.getBoundingClientRect());
    if (!end || layer.childElementCount >= effectLimit || document.hidden) return;
    const sprite = element('img', `prop-impact prop-impact-${kind}`);
    sprite.src = kind === 'egg' ? sprites.splat : sprites.flower;
    sprite.alt = '';
    sprite.style.left = `${end.x}px`;
    sprite.style.top = `${end.y}px`;
    sprite.addEventListener('animationend', () => sprite.remove(), { once: true });
    layer.append(sprite);
    impactSound(kind);
  }

  function animateThrow({ kind, from, target: receiver }) {
    if (document.hidden || layer.childElementCount >= effectLimit) return;
    const bounds = layer.getBoundingClientRect();
    const start = point(from, bounds);
    const end = point(receiver, bounds);
    if (!start || !end) return;
    if (reducedMotion.matches || typeof layer.animate !== 'function') return impact(kind, receiver);
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const lift = Math.min(95, Math.max(16, distance * .29));
    const spin = end.x >= start.x ? 1 : -1;
    const object = element('img', 'prop-flight');
    object.src = sprites[kind];
    object.alt = '';
    layer.append(object);
    const animation = object.animate([0, .25, .5, .75, 1].map((step) => {
      const x = start.x + (end.x - start.x) * step;
      const y = Math.max(16, start.y + (end.y - start.y) * step - 4 * lift * step * (1 - step));
      return { transform: `translate(${x}px,${y}px) translate(-50%,-50%) rotate(${spin * (280 * step - 26)}deg)` };
    }), { duration: Math.min(650, 350 + distance * .4), easing: 'ease-in-out', fill: 'both' });
    const context = scope;
    animation.onfinish = () => {
      object.remove();
      if (scope === context) impact(kind, receiver);
    };
  }

  function drainIncoming() {
    incomingTimer = null;
    if (!incoming.length || document.hidden) return;
    animateThrow(incoming.shift());
    if (incoming.length) incomingTimer = setTimeout(drainIncoming, 105);
  }

  function scheduleFlush() {
    if (!flushTimer && !sending) flushTimer = setTimeout(flush, flushDelay);
  }

  async function flush() {
    flushTimer = null;
    if (!outgoing.length || !room) return;
    const items = [];
    for (const entry of outgoing) {
      const last = items.at(-1);
      if (last?.kind === entry.kind && last.target === entry.target) last.count++;
      else items.push({ ...entry, count: 1 });
    }
    outgoing = [];
    const context = scope;
    sending = true;
    try {
      await roomRequest('/props', { roomId: room.id, memberId: room.self, round: room.round, items });
    } catch (error) {
      if (scope === context && target) {
        status.textContent = error.message;
        positionMenu();
      }
    } finally {
      sending = false;
      if (outgoing.length) scheduleFlush();
    }
  }

  function send(kind) {
    const now = performance.now();
    if (!target || !trigger(target) || outgoing.length >= propBatchLimit || now - lastThrow < propInterval - 5) return;
    lastThrow = now;
    status.textContent = '';
    outgoing.push({ kind, target });
    animateThrow({ kind, from: room.self, target });
    scheduleFlush();
  }

  for (const button of menu.querySelectorAll('[data-prop]')) {
    const kind = button.dataset.prop;
    button.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.button !== 0 || held) return;
      button.setPointerCapture(event.pointerId);
      held = { id: event.pointerId };
      const repeat = () => {
        if (held?.id !== event.pointerId) return;
        send(kind);
        held.timer = setTimeout(repeat, propInterval);
      };
      send(kind);
      held.timer = setTimeout(repeat, 270);
    });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(eventName, (event) => { if (held?.id === event.pointerId) stopHold(); });
    }
    button.addEventListener('click', (event) => {
      if (event.detail === 0 && !event.pointerType) send(kind);
    });
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  seats.addEventListener('click', (event) => {
    const button = event.target.closest('[data-avatar-player]');
    if (!button) return;
    const id = button.dataset.avatarPlayer;
    if (target === id) return close();
    close();
    target = id;
    const player = room?.players.find(({ id: playerId }) => playerId === id);
    menu.setAttribute('aria-label', `给${player?.name ?? '玩家'}发送道具`);
    status.textContent = '';
    menu.hidden = false;
    positionMenu();
    if (event.detail === 0) menu.querySelector('button').focus({ preventScroll: true });
  });
  document.addEventListener('pointerdown', (event) => {
    if (target && !menu.contains(event.target) && !event.target.closest('[data-avatar-player]')) close();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && target) close(menu.contains(document.activeElement));
  });
  window.addEventListener('blur', stopHold);
  window.addEventListener('resize', positionMenu, { passive: true });
  window.addEventListener('scroll', positionMenu, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    close();
    clearTimeout(incomingTimer);
    incomingTimer = null;
    incoming = [];
  });

  return (state) => {
    room = state;
    const nextScope = `${state.id}/${state.self}/${state.round}`;
    const events = state.props ?? [];
    if (scope !== nextScope) {
      scope = nextScope;
      close();
      lastId = events.at(-1)?.id ?? 0;
      lastThrow = -Infinity;
      clearTimeout(flushTimer);
      clearTimeout(incomingTimer);
      flushTimer = incomingTimer = null;
      outgoing = [];
      incoming = [];
      for (const animation of layer.getAnimations?.({ subtree: true }) ?? []) animation.cancel();
      layer.replaceChildren();
      return;
    }
    positionMenu();
    for (const event of events) {
      if (event.id <= lastId) continue;
      lastId = event.id;
      if (event.from === state.self || document.hidden) continue;
      for (let index = 0; index < event.count && incoming.length < incomingLimit; index++) incoming.push(event);
    }
    if (incoming.length && !incomingTimer) drainIncoming();
  };
}
