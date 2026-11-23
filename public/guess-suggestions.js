import { byId, element, roomRequest } from './room-client.js';

export function setupGuessSuggestions(getTurn) {
  const dialog = byId('guess-dialog');
  const answer = byId('guess-answer');
  const matches = byId('guess-matches');
  let timer;
  let version = 0;
  let composing = false;

  function clear() {
    clearTimeout(timer);
    version++;
    matches.hidden = true;
    matches.replaceChildren();
  }

  function search() {
    clear();
    const turn = getTurn();
    const prefix = answer.value.trim();
    if (!dialog.open || !turn || !prefix) return;

    const queryVersion = version;
    const params = new URLSearchParams({ ...turn, prefix });
    timer = setTimeout(async () => {
      try {
        const { names } = await roomRequest('/suggestions?' + params);
        if (queryVersion !== version || !dialog.open || !getTurn()) return;
        matches.replaceChildren(...names.map((name) => {
          const item = element('li');
          const option = element('button', 'game-button guess-match', name);
          option.type = 'button';
          option.addEventListener('click', () => {
            answer.value = name;
            answer.focus();
            clear();
          });
          item.append(option);
          return item;
        }));
        matches.hidden = !names.length;
      } catch {
        // Guessing still works when the suggestions request fails.
      }
    }, 140);
  }

  answer.addEventListener('compositionstart', () => {
    composing = true;
    clear();
  });
  answer.addEventListener('compositionend', () => {
    composing = false;
    search();
  });
  answer.addEventListener('input', (event) => {
    if (!composing && !event.isComposing) search();
  });
  answer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (composing || event.isComposing || event.keyCode === 229)) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    composing = false;
    clear();
  });
  return clear;
}
