const colors = ['#80e798', '#ffe08d', '#ff8da4', '#8bdbff', '#c6a7ff', '#fff4d5'];
let context;
let overlay;
let cleanup;

function unlockSound() {
  const AudioContext = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    context ??= new AudioContext();
    if (context.state !== 'running') context.resume().catch(() => {});
  } catch {}
}

window.addEventListener('click', unlockSound, { capture: true, passive: true });
window.addEventListener('pointerdown', unlockSound, { capture: true, passive: true });
window.addEventListener('keydown', unlockSound, { passive: true });

export function activeAudioContext() {
  return context?.state === 'running' ? context : null;
}

function playChime() {
  if (context?.state !== 'running') return;
  const start = context.currentTime;
  for (const [index, pitch] of [523.25, 659.25, 783.99, 1046.5].entries()) {
    const onset = start + index * .072;
    const note = context.createOscillator();
    const volume = context.createGain();
    note.type = 'triangle';
    note.frequency.value = pitch;
    volume.gain.setValueAtTime(0, onset);
    volume.gain.linearRampToValueAtTime(.085, onset + .018);
    volume.gain.exponentialRampToValueAtTime(.001, onset + .26);
    note.connect(volume).connect(context.destination);
    note.start(onset);
    note.stop(onset + .27);
  }
}

export function celebrateGuess(players) {
  clearTimeout(cleanup);
  overlay?.remove();
  overlay = document.createElement('div');
  overlay.className = 'guess-celebration';
  overlay.setAttribute('aria-hidden', 'true');
  const banner = document.createElement('p');
  banner.className = 'guess-celebration-title';
  banner.textContent = `${players.join('、')} 猜中了！`;
  overlay.append(banner);

  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (let index = 0; index < 88; index++) {
      const piece = document.createElement('i');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.backgroundColor = colors[index % colors.length];
      piece.style.setProperty('--drift', `${(Math.random() - .5) * 48}vw`);
      piece.style.setProperty('--spin', `${(Math.random() - .5) * 1250}deg`);
      piece.style.animationDelay = `${Math.random() * .32}s`;
      piece.style.animationDuration = `${1.35 + Math.random() * .75}s`;
      overlay.append(piece);
    }
  }
  if (typeof overlay.showPopover === 'function') {
    overlay.setAttribute('popover', 'manual');
    document.body.append(overlay);
    overlay.showPopover();
  } else {
    (Array.from(document.querySelectorAll('dialog[open]')).at(-1) ?? document.body).append(overlay);
  }
  cleanup = setTimeout(() => { overlay.remove(); overlay = null; }, 2500);
  playChime();
}
