export const defaultBackground = 'crystal';

export const roomBackgrounds = Object.freeze({
  crystal: '/assets/room/crystal-hall.webp',
  architect: '/assets/room/background-architect.webp',
  queen: '/assets/room/background-queen.webp',
  waterfall: '/assets/room/background-waterfall.webp',
  overgrowth: '/assets/room/background-overgrowth.webp'
});

export function backgroundUrl(id) {
  return roomBackgrounds[Object.hasOwn(roomBackgrounds, id) ? id : defaultBackground];
}

export function backgroundImage(id) {
  const url = backgroundUrl(id);
  return url === roomBackgrounds.crystal ? 'var(--crystal-backdrop)' : `url("${url}")`;
}
