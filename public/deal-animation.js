import { element } from './room-client.js';
import { renderCard } from './renderer.js';

const seenRoundKey = 'spire.seen-deal-round';
const edgePadding = 5;

function sameSeat(previous, room) {
  return previous?.id === room.id && previous?.self === room.self;
}

async function waitForImages(previews) {
  const images = previews.flatMap((preview) => [...preview.querySelectorAll('img')]);
  let timer;
  try {
    await Promise.race([
      Promise.allSettled(images.map((image) => image.decode?.())),
      new Promise((resolve) => { timer = setTimeout(resolve, 500); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createDealAnimation(layer, seats, loadCard) {
  let room;
  let seen;
  let generation = 0;
  try { seen = JSON.parse(sessionStorage.getItem(seenRoundKey)); } catch {}

  function positionPreviews() {
    if (!layer.childElementCount) return;
    const board = layer.getBoundingClientRect();
    const grid = getComputedStyle(seats).display === 'grid';
    const anchors = new Map([...seats.children].map((seat) => [seat.dataset.seatPlayer, seat]));
    const visible = new Map(room.players.filter((player) => player.id !== room.self && player.card)
      .map((player) => [player.id, player.card.deal]));
    for (const preview of [...layer.children]) {
      const { player, deal } = preview.dataset;
      const anchor = anchors.get(player);
      if (!anchor || visible.get(player) !== deal) {
        preview.remove();
        continue;
      }

      const seat = anchor.getBoundingClientRect();
      const height = Math.min((seat.width + 8) * 4 / 3, seat.height + (grid ? 8 : 28), board.height - edgePadding * 2);
      const width = height * 3 / 4;
      const left = seat.left - board.left + (seat.width - width) / 2;
      const top = seat.top - board.top + Math.min((seat.height - height) / 2, 0);
      preview.style.width = `${width}px`;
      preview.style.left = `${Math.max(edgePadding, Math.min(left, board.width - width - edgePadding))}px`;
      preview.style.top = `${Math.max(edgePadding, Math.min(top, board.height - height - edgePadding))}px`;
    }
  }

  async function showDealtCards(snapshot, expectedGeneration) {
    const visible = snapshot.players.filter((player) => player.id !== snapshot.self && player.card);
    const results = await Promise.allSettled(visible.map(async ({ id, card: { deal } }) => {
      const { card, database } = await loadCard(id, deal);
      const preview = element('div', 'deal-preview');
      preview.dataset.player = id;
      preview.dataset.deal = deal;
      preview.append(renderCard(card, database));
      for (let index = 0; index < 6; index++) preview.append(element('i', 'deal-spark'));
      preview.addEventListener('animationend', (event) => {
        if (event.target === preview) preview.remove();
      });
      return preview;
    }));
    if (expectedGeneration !== generation) return;
    const previews = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    if (!previews.length) return;
    await waitForImages(previews);
    if (expectedGeneration !== generation) return;
    layer.replaceChildren(...previews);
    positionPreviews();
  }

  window.addEventListener('resize', positionPreviews);
  return function update(next) {
    room = next;
    if (sameSeat(seen, next) && seen.round === next.round) {
      positionPreviews();
      return;
    }

    const newRound = sameSeat(seen, next) && next.round > seen.round;
    seen = { id: next.id, self: next.self, round: next.round };
    try { sessionStorage.setItem(seenRoundKey, JSON.stringify(seen)); } catch {}
    generation++;
    layer.replaceChildren();
    if (newRound) void showDealtCards(next, generation);
  };
}
