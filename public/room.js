import { byId, element, roomRequest } from './room-client.js';
import { renderCard } from './renderer.js';
import { avatarUrl } from './avatars.js';
import { celebrateGuess } from './celebration.js';
import { backgroundImage } from './room-backgrounds.js';
import { banter, banterDuration, createBanterTracker, reactions } from './room-banter.js';
import { setupGuessSuggestions } from './guess-suggestions.js';
import { createDealAnimation } from './deal-animation.js';
import { createAvatarProps } from './room-props.js';
import { renderCommunityBadge } from './community-score.js';
import { createKaoStrip } from './card-kao-ui.js';

const notices = { correct: '猜出了自己的牌。', incorrect: '这次没猜中。', replaced: '的牌已通过投票更换。' };
const ownCardReplaced = '你的牌已更换，请重新猜测。';
const roundDialogs = ['banter-dialog', 'settings-dialog', 'guess-dialog', 'card-dialog', 'confirm-dialog'];
let room;
let config;
let snapshot = '';
let online = true;
let busy = false;
let requestVersion = 0;
let shownCard;
let guessTurn;
let confirmation;
let settingsContext;
const updateBanter = createBanterTracker();
const updateDealAnimation = createDealAnimation(byId('deal-layer'), byId('seats'), loadCard);
const updateAvatarProps = createAvatarProps({ seats: byId('seats'), layer: byId('prop-layer'), menu: byId('prop-menu') });
const roomKao = createKaoStrip(byId('rate-card'));
byId('room-kao-stats').append(roomKao.node);

const isHost = () => room && room.host === room.self;
const self = () => room.players.find((player) => player.id === room.self);
const clearGuessSuggestions = setupGuessSuggestions(() => room?.guessSuggestions ? guessTurn : null);

function roomContext() {
  return { roomId: room.id, memberId: room.self, round: room.round };
}

function sameRound(context, state) {
  return context.roomId === state?.id && context.memberId === state?.self && context.round === state?.round;
}

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}
byId('card-dialog').addEventListener('close', () => { shownCard = null; });

function applyState(next) {
  if (!next) {
    location.replace('/');
    return;
  }
  const { revision, props, ...visual } = next;
  const fingerprint = JSON.stringify(visual);
  if (fingerprint === snapshot) {
    room = next;
    updateAvatarProps(next);
    return;
  }
  const continuing = room && sameRound(roomContext(), next);
  const newlySolved = continuing ? next.players.filter((player) =>
    player.solved && room.players.some((previous) => previous.id === player.id && !previous.solved)
  ) : [];
  if (room && !continuing) {
    for (const id of roundDialogs) byId(id).close();
    shownCard = guessTurn = confirmation = settingsContext = null;
    clearGuessSuggestions();
  }
  snapshot = fingerprint;
  room = next;
  renderRoom();
  updateAvatarProps(next);
  const banterDialog = byId('banter-dialog');
  if (banterDialog.open && byId('open-banter').hidden) banterDialog.close();
  if (byId('settings-dialog').open) byId('settings-form').hidden = room.phase === 'playing';
  if (!isHost() && byId('settings-dialog').open) byId('settings-dialog').close();
  if (byId('guess-dialog').open && (room.current !== room.self || room.turn !== guessTurn?.turn || room.ownDealVersion !== guessTurn?.dealVersion)) {
    byId('guess-answer').value = '';
    clearGuessSuggestions();
    byId('guess-dialog').close();
  }
  if (byId('guess-dialog').open) updateGuessRemaining();
  if (confirmation?.action === 'browse-catalog' && (!room.canSpendTurnForCatalog || room.turn !== confirmation.data.turn)) {
    byId('confirm-dialog').close();
  }
  if (shownCard && byId('card-dialog').open) {
    const target = room.players.find(({ id }) => id === shownCard.target);
    if (!target?.card || target.card.deal !== shownCard.deal) byId('card-dialog').close();
    else renderCardActions(target);
  }
  if (newlySolved.length) celebrateGuess(newlySolved.map((player) => player.name));
}

async function act(action, data = {}) {
  if (busy || !room) throw new Error('请等待连接恢复或上一步完成。');
  busy = true;
  requestVersion++;
  try {
    const result = await roomRequest('', { action, ...roomContext(), ...data });
    online = true;
    applyState(result.room);
    if (result.room) updateConnection();
  } finally {
    busy = false;
  }
}

async function handle(control, status, work) {
  if (control.disabled) return;
  control.disabled = true;
  if (status) status.textContent = '';
  try { await work(); }
  catch (error) { (status ?? byId('game-notice')).textContent = error.message || '操作失败，请重试。'; }
  finally {
    control.disabled = false;
    if ((control.id === 'vote-card' || control.id === 'rate-card') && shownCard && room) {
      const target = room.players.find(({ id }) => id === shownCard.target);
      if (target) renderCardActions(target);
    }
  }
}

function updateConnection() {
  const label = byId('room-status');
  label.dataset.offline = String(!online);
  if (!online) label.textContent = '连接中断 · 正在重连';
  else if (room) label.textContent = self().spectator ? '观战中' : '';
}

async function poll() {
  const version = requestVersion;
  try {
    if (!busy) {
      const result = await roomRequest();
      if (version === requestVersion && !busy) {
        if (result.room && !result.room.id) {
          byId('room-status').textContent = '请重启服务以启用新规则';
          return;
        }
        online = true;
        applyState(result.room);
      }
    }
  } catch {
    if (version === requestVersion && !busy) online = false;
  } finally {
    updateConnection();
    setTimeout(poll, document.hidden ? 3000 : 1000);
  }
}

function renderRoom() {
  updateConnection();
  byId('room-pin').textContent = room.pin;
  byId('arena').style.setProperty('--room-backdrop', backgroundImage(room.background));
  const live = room.phase === 'playing';
  const finished = room.phase === 'settled';
  const participants = room.players.filter((player) => !player.spectator);
  const spectators = room.players.filter((player) => player.spectator);
  const { speeches, announcement } = updateBanter(room);
  const canSpeak = live && !self().spectator;
  byId('open-banter').hidden = !canSpeak;
  byId('room-reactions').hidden = !canSpeak;
  if (announcement !== null) byId('banter-announcer').textContent = announcement;
  byId('room-compendium').hidden = live;
  byId('host-settings').hidden = !isHost();
  byId('end-round').hidden = !isHost() || !live;
  byId('exit-room').hidden = live && !self().spectator;
  byId('spectators').hidden = !spectators.length;
  byId('spectators').textContent = spectators.length ? `观战 · ${spectators.map(({ name }) => name).join('、')}` : '';
  const myCardReplaced = live && room.ownDealChanged;
  const ownNotice = byId('own-card-notice');
  const ownMessage = myCardReplaced ? ownCardReplaced : '';
  if (ownNotice.textContent !== ownMessage) ownNotice.textContent = ownMessage;
  const notice = room.notice;
  const duplicateNotice = myCardReplaced && notice?.kind === 'replaced' && notice.playerId === room.self;
  byId('game-notice').textContent = notice && !duplicateNotice ? notice.player + notices[notice.kind] : '';
  const memory = room.memory;
  const onlineCount = participants.filter(({ online }) => online).length;
  const canDeal = memory.total - memory.used >= onlineCount;
  byId('memory-status').hidden = !memory.used;
  byId('memory-usage').textContent = memory.locked ? '记忆池已达 70% · 待清空' : `记忆池 ${Math.floor(memory.used / memory.total * 100)}%`;
  byId('clear-memory').hidden = !isHost() || live || !memory.used;
  byId('round-label').hidden = !live;
  byId('round-label').textContent = live ? `第 ${room.round} 局 · 回合 ${room.turn}` : '';
  const turn = room.players.find(({ id }) => id === room.current);
  byId('turn-label').textContent = live ? room.current === room.self ? '你的回合' : `轮到 ${turn.name}` : finished ? '已结算' : '等待开局';
  byId('turn-detail').textContent = live ? !turn.online ? '等待玩家重连'
    : room.current === room.self && room.maxGuesses > 1 ? `剩余 ${room.guessesLeft} 次` : ''
    : memory.locked ? '请房主清空记忆池' : onlineCount < 2 ? '等待两名玩家在线' : !canDeal ? '未用卡牌不足' : '';
  const action = byId('table-action');
  const myTurn = live && room.current === room.self;
  const showTurnCatalog = live && (room.canViewCatalog || room.canSpendTurnForCatalog);
  byId('skip-turn').hidden = !myTurn;
  byId('turn-catalog').hidden = !showTurnCatalog;
  action.hidden = live ? !myTurn : !isHost();
  byId('turn-actions').hidden = action.hidden && !showTurnCatalog;
  action.classList.toggle('turn-button', live);
  action.textContent = live ? '猜测' : finished ? '开始下一局' : '开始游戏';
  action.disabled = !live && (onlineCount < 2 || memory.locked || !canDeal);

  const seats = byId('seats');
  const focused = document.activeElement?.dataset?.player;
  const focusedAvatar = document.activeElement?.dataset?.avatarPlayer;
  const canThrow = Array.isArray(room.props) && !self().spectator;
  const nodes = participants.map((player, index) => {
    const seat = element('li', 'seat');
    seat.dataset.seatPlayer = player.id;
    const angle = index / participants.length * Math.PI * 2;
    const x = Math.sin(angle);
    const y = Math.cos(angle);
    seat.style.setProperty('--seat-x', `${50 + x * 37}%`);
    seat.style.setProperty('--seat-y', `${50 + y * 35}%`);
    seat.dataset.bubbleSide = x > 0.1 ? 'left' : x < -0.1 ? 'right' : 'center';
    seat.classList.toggle('seat-near-top', y < -0.65);
    seat.classList.toggle('current-seat', live && player.id === room.current);
    seat.classList.toggle('solved-seat', player.solved);
    if (live && player.id === room.current) seat.setAttribute('aria-current', 'true');
    const avatar = element('img', 'avatar');
    avatar.src = avatarUrl(player.avatar);
    avatar.alt = '';
    const portrait = element('div', 'seat-portrait');
    if (canThrow && player.id !== room.self) {
      const button = element('button', 'avatar-trigger');
      button.type = 'button';
      button.dataset.avatarPlayer = player.id;
      button.setAttribute('aria-label', `给${player.name}发送道具`);
      button.setAttribute('aria-controls', 'prop-menu');
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-expanded', 'false');
      button.append(avatar);
      portrait.append(button);
    } else portrait.append(avatar);
    const speech = speeches.get(player.id);
    if (speech) portrait.append(speechBubble(speech));
    const badge = player.id === room.host ? '房主' : player.id === room.self ? '你' : `座位 ${index + 1}`;
    const progress = player.solved ? ' · 已猜出' : !player.online ? ' · 离线' : '';
    seat.append(portrait, element('strong', 'seat-name', player.name), element('span', 'seat-state', badge + progress));
    if (player.card) {
      const button = element('button', finished ? 'card-name card-reveal' : 'card-name', player.card.name);
      button.type = 'button';
      button.setAttribute('aria-haspopup', 'dialog');
      button.dataset.player = player.id;
      button.addEventListener('click', () => handle(button, null, () => openCard(player.id, player.card.deal)));
      seat.append(button);
    } else if (live) seat.append(element('span', 'hidden-card', '你的牌 · 隐藏'));
    return seat;
  });
  seats.replaceChildren(...nodes);
  updateDealAnimation(room);
  if (focused) seats.querySelector(`[data-player="${focused}"]`)?.focus({ preventScroll: true });
  if (focusedAvatar) seats.querySelector(`[data-avatar-player="${focusedAvatar}"]`)?.focus({ preventScroll: true });
}

function reactionIcon({ path }) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 72 72');
  svg.setAttribute('class', 'reaction-icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const layer of ['outline', 'color', 'shine']) {
    const stroke = document.createElementNS(namespace, 'path');
    stroke.setAttribute('class', `reaction-${layer}`);
    stroke.setAttribute('d', path);
    svg.append(stroke);
  }
  return svg;
}

function speechBubble({ phrase, elapsed }) {
  const reaction = reactions[phrase];
  const bubble = reaction
    ? element('span', `seat-bubble reaction-bubble ${phrase}`)
    : element('span', `seat-bubble banter-line banter-${phrase}`, banter[phrase].text);
  if (reaction) bubble.append(reactionIcon(reaction));
  bubble.style.setProperty('--speech-duration', `${banterDuration}ms`);
  bubble.style.animationDelay = `${-elapsed}ms`;
  bubble.addEventListener('animationend', () => { bubble.hidden = true; }, { once: true });
  return bubble;
}

function openBanter() {
  const dialog = byId('banter-dialog');
  const context = roomContext();
  const status = byId('banter-status');
  status.textContent = '';
  const phrases = room.banterPhrases ?? Object.keys(banter).filter((phrase) => !phrase.startsWith('nndx-'));
  byId('banter-options').replaceChildren(...phrases.filter((phrase) => Object.hasOwn(banter, phrase)).map((phrase) => {
    const line = banter[phrase];
    const option = element('button', 'banter-option');
    option.type = 'button';
    const avatar = element('img', 'banter-avatar');
    avatar.src = avatarUrl(line.avatar);
    avatar.alt = '';
    const text = element('span', 'banter-option-text');
    text.append(element('strong', '', line.name), element('span', `banter-line banter-${phrase}`, line.text));
    option.append(avatar, text);
    option.addEventListener('click', () => handle(option, status, async () => {
      await act('banter', { phrase, ...context });
      if (dialog.open) dialog.close();
    }));
    return option;
  }));
  dialog.showModal();
}

function getConfig() {
  config ??= roomRequest('/config').catch((error) => {
    config = null;
    throw error;
  });
  return config;
}

async function openSettings() {
  const context = roomContext();
  const { poolOptions } = await getConfig();
  if (!sameRound(context, room) || !isHost()) return;
  settingsContext = context;
  const playing = room.phase === 'playing';
  byId('settings-status').textContent = '';
  byId('settings-form').hidden = playing;
  byId('guess-limit').value = String(room.maxGuesses);
  byId('guess-suggestions').checked = Boolean(room.guessSuggestions);
  byId('allow-catalog-lookup').checked = Boolean(room.allowCatalogLookup);
  byId('settings-pools').replaceChildren(...poolOptions.map(({ value, name }) => {
    const label = element('label', 'setting-chip');
    const input = element('input');
    input.type = 'checkbox';
    input.name = 'pools';
    input.value = value;
    input.checked = room.pools.includes(value);
    label.append(input, element('span', '', name));
    return label;
  }));
  const players = room.players.filter((player) => player.id !== room.self && !player.spectator);
  byId('transfer-form').hidden = !players.length;
  byId('transfer-player').replaceChildren(new Option('选择玩家', ''), ...players.map((player) => new Option(player.name, player.id)));
  byId('settings-dialog').showModal();
}

function renderCardActions(target, animateScore = true) {
  const vote = byId('vote-card');
  vote.hidden = !target.vote;
  if (target.vote) {
    vote.disabled = target.vote.cast;
    vote.textContent = `${target.vote.cast ? '已投票' : '投票换牌'} · ${target.vote.count}/${target.vote.required}`;
  }
  const rate = byId('rate-card');
  const rated = Boolean(target.card?.rated);
  rate.hidden = !target.card?.canRate;
  rate.classList.toggle('primary', !rated);
  rate.setAttribute('aria-pressed', String(rated));
  rate.title = rated ? '取消考评分' : '添加考评分';
  rate.textContent = rated ? '已考' : '考';
  roomKao.update(target.card ?? {}, animateScore);
}

async function loadCard(targetId, deal) {
  const cardArgs = new URLSearchParams({ player: targetId, deal });
  const [card, database] = await Promise.all([roomRequest('/card?' + cardArgs), getConfig()]);
  return { card, database };
}

async function openCard(targetId, deal) {
  const context = roomContext();
  const { card, database } = await loadCard(targetId, deal);
  const player = room.players.find(({ id }) => id === targetId);
  if (!sameRound(context, room) || player?.card?.deal !== deal || byId('card-dialog').open) return;
  shownCard = { target: targetId, deal, card, database, context };
  byId('room-card-title').textContent = card.names.zhs;
  renderCommunityBadge(byId('room-community-score'), card.communityScore);
  byId('card-status').textContent = '';
  byId('card-upgrade-label').hidden = !card.upgrade;
  byId('card-upgrade').checked = false;
  renderFace();
  renderCardActions(player, false);
  byId('card-dialog').showModal();
}

function renderFace() {
  const { card, database } = shownCard;
  byId('room-card-face').replaceChildren(renderCard(card, database, { upgraded: byId('card-upgrade').checked }));
}

function confirmAction(message, action, data = {}) {
  confirmation = { action, data: { ...roomContext(), ...data } };
  byId('confirm-text').textContent = message;
  byId('confirm-status').textContent = '';
  byId('confirm-dialog').showModal();
}

byId('host-settings').addEventListener('click', (event) => handle(event.currentTarget, null, openSettings));
byId('open-banter').addEventListener('click', openBanter);
for (const [phrase, reaction] of Object.entries(reactions)) {
  const button = element('button', `game-button reaction-button ${phrase}`);
  button.type = 'button';
  button.title = `发送${reaction.label}`;
  button.setAttribute('aria-label', button.title);
  button.append(reactionIcon(reaction));
  button.addEventListener('click', () => handle(button, null, () => act('banter', { phrase })));
  byId('room-reactions').append(button);
}
byId('end-round').addEventListener('click', () => confirmAction('结束本局并公开卡名？', 'end'));
byId('clear-memory').addEventListener('click', () => confirmAction('清空记忆池？用过的牌可以重新抽到。', 'clear-memory'));
byId('exit-room').addEventListener('click', () => confirmAction('离开这个房间？', 'leave'));
byId('skip-turn').addEventListener('click', (event) => handle(event.currentTarget, null, () => act('skip', { turn: room.turn })));
byId('turn-catalog').addEventListener('click', () => {
  if (room.canViewCatalog) location.assign('/catalog');
  else if (room.canSpendTurnForCatalog) {
    confirmAction(`消耗本回合全部 ${room.maxGuesses} 次猜测机会，查看图鉴？`, 'browse-catalog', { turn: room.turn });
  }
});
byId('confirm-action').addEventListener('click', (event) => handle(event.currentTarget, byId('confirm-status'), async () => {
  if (!confirmation || !byId('confirm-dialog').open) return;
  const { action, data } = confirmation;
  await act(action, data);
  byId('confirm-dialog').close();
  if (byId('settings-dialog').open) byId('settings-dialog').close();
  if (action === 'browse-catalog') location.assign('/catalog');
}));

byId('table-action').addEventListener('click', (event) => {
  if (room.phase === 'playing') {
    guessTurn = { ...roomContext(), turn: room.turn, dealVersion: room.ownDealVersion };
    byId('guess-answer').value = '';
    byId('guess-status').textContent = '';
    updateGuessRemaining();
    byId('guess-dialog').showModal();
    byId('guess-answer').focus();
  } else handle(event.currentTarget, null, () => act('start'));
});

async function saveSettings(settings) {
  await act('settings', settings);
  byId('settings-dialog').close();
}

byId('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const pools = data.getAll('pools');
  const maxGuesses = Number(data.get('maxGuesses'));
  const guessSuggestions = data.has('guessSuggestions');
  const allowCatalogLookup = data.has('allowCatalogLookup');
  const settings = { pools, maxGuesses, guessSuggestions, allowCatalogLookup, ...settingsContext };
  const changed = maxGuesses !== room.maxGuesses || guessSuggestions !== Boolean(room.guessSuggestions)
    || allowCatalogLookup !== Boolean(room.allowCatalogLookup)
    || pools.length !== room.pools.length || room.pools.some((pool) => !pools.includes(pool));
  if (changed && pools.length && room.memory.used) confirmAction('保存新设置会清空记忆池。', 'settings', settings);
  else handle(event.submitter, byId('settings-status'), () => saveSettings(settings));
});
byId('transfer-form').addEventListener('submit', (event) => {
  event.preventDefault();
  handle(event.submitter, byId('settings-status'), () => act('transfer', { ...settingsContext, target: byId('transfer-player').value }));
});
byId('guess-form').addEventListener('submit', (event) => {
  event.preventDefault();
  handle(event.submitter, byId('guess-status'), async () => {
    clearGuessSuggestions();
    await act('guess', { ...guessTurn, guessesLeft: room.guessesLeft, answer: byId('guess-answer').value });
    if (byId('guess-dialog').open) {
      clearGuessSuggestions();
      byId('guess-status').textContent = '没猜中';
      byId('guess-answer').value = '';
      byId('guess-answer').focus();
    }
  });
});
byId('card-upgrade').addEventListener('change', () => { if (shownCard) renderFace(); });
byId('rate-card').addEventListener('click', (event) => handle(event.currentTarget, byId('card-status'), async () => {
  if (shownCard) {
    const { target, deal, context } = shownCard;
    const card = room.players.find(({ id }) => id === target)?.card;
    if (card?.deal === deal && card.canRate) {
      await act(card.rated ? 'unrate-card' : 'rate-card', { target, deal, ...context });
    }
  }
}));
byId('vote-card').addEventListener('click', (event) => handle(event.currentTarget, byId('card-status'), async () => {
  if (shownCard) {
    const { target, deal, context } = shownCard;
    await act('vote', { target, deal, ...context });
  }
}));

function updateGuessRemaining() {
  const label = byId('guess-remaining');
  label.hidden = room.maxGuesses === 1;
  label.textContent = `剩余 ${room.guessesLeft} 次`;
}

poll();
