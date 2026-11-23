import { appendDescription, getPreview, renderCard } from './renderer.js';
import { plainDescription } from './description-markup.js';
import { colorGroup, filterCards } from './filter.js';
import { roomRequest } from './room-client.js';
import { formatCommunityPickRate, renderCommunityBadge } from './community-score.js';
import { createKaoStrip } from './card-kao-ui.js';

const byId = (id) => document.getElementById(id);
const pageSize = 24;
const state = { query: '', type: '', color: '', rarity: '', pool: '', cost: '', sort: byId('sort').value, page: 1, upgraded: false };
const typeOrder = ['Attack', 'Skill', 'Power', 'Status', 'Curse', 'Quest'];
const colorOrder = ['red', 'green', 'blue', 'orange', 'pink', 'yellow', 'colorless', 'other'];
const poolByColor = { red: 'ironclad', green: 'silent', blue: 'defect', orange: 'regent', pink: 'necrobinder', yellow: 'fool' };
const detail = byId('detail');
let database;
let detailScore;
let communityScores;

function el(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function labelForColor(color, showPool = false) {
  if (color === 'other') return '其他';
  const pool = poolByColor[color];
  return database.labels.colors[color] + (showPool && pool ? ` · ${database.labels.pools[pool]}` : '');
}

function options(id, entries) {
  const menu = byId(id);
  for (const [key, label] of entries) menu.add(new Option(label, key));
}

function addColorOptions() {
  const colorsInUse = new Set(database.cards.map((card) => colorGroup(card.color)));
  for (const key of ['', ...colorOrder.filter((color) => colorsInUse.has(color))]) {
    const button = el('button', 'chip', key ? labelForColor(key, true) : '全部');
    button.type = 'button';
    button.dataset.key = key;
    if (key) button.prepend(el('span', `swatch swatch-${key}`));
    button.addEventListener('click', () => {
      state.color = key;
      showFirst();
    });
    byId('colors').append(button);
  }
}

function showFirst() {
  state.page = 1;
  renderResults();
}

function renderResults() {
  for (const button of byId('colors').children) {
    button.setAttribute('aria-pressed', String(button.dataset.key === state.color));
  }
  const activeColor = byId('active-color');
  activeColor.textContent = state.color ? labelForColor(state.color) : '';
  activeColor.hidden = !state.color;
  const matches = filterCards(database.cards, state, Object.keys(database.labels.rarities));
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  state.page = Math.max(1, Math.min(pages, state.page));
  const start = (state.page - 1) * pageSize;
  byId('count').textContent = `${matches.length} 张`;
  const grid = byId('cards');
  grid.replaceChildren();
  if (!matches.length) grid.append(el('p', 'empty', '无匹配卡牌'));
  for (const card of matches.slice(start, start + pageSize)) {
    const button = el('button', 'card-tile');
    button.type = 'button';
    const type = state.type && card.types.includes(state.type) ? state.type : card.type;
    const config = { upgraded: state.upgraded, type };
    button.append(renderCard(card, database, { ...config, lazyImages: true }));
    const caption = el('span', 'tile-caption');
    caption.append(el('strong', '', getPreview(card, config).title), el('span', '', database.labels.pools[card.pool] + ' · ' + database.labels.types[type]));
    button.append(caption);
    button.setAttribute('aria-label', `查看 ${card.names.zhs} · ${database.labels.pools[card.pool]}`);
    button.addEventListener('click', () => openDetail(card, config));
    grid.append(button);
  }
  byId('pagination').hidden = pages === 1;
  byId('prev').disabled = state.page === 1;
  byId('next').disabled = state.page === pages;
  byId('page').textContent = `第 ${state.page} / ${pages} 页`;
}

async function refreshDetailScore() {
  const score = detailScore;
  if (!detail.open || !score || score.pending) return;
  score.pending = true;
  try {
    const { kao, rank } = await roomRequest('/card-score?' + new URLSearchParams({ id: score.id }));
    if (detailScore !== score || !detail.open) return;
    score.value = kao;
    score.rank = rank;
    score.manual.update({ rank, kao }, true);
  } catch {
  } finally {
    score.pending = false;
  }
}

function showCommunityDetails(detailData, community, label, source) {
  const stats = detailData.community;
  renderCommunityBadge(community, stats);
  source.hidden = !stats;
  if (!stats) {
    label.textContent = '';
  } else if (!stats.offered) {
    label.textContent = '无选牌样本';
  } else {
    label.textContent = `抓取率 ${formatCommunityPickRate(stats)}（${stats.picked.toLocaleString('zh-CN')}/${stats.offered.toLocaleString('zh-CN')}）`;
  }
}

async function refreshCommunityScore(detailData) {
  communityScores ??= fetch('/data/community-scores.json', { cache: 'no-store' }).then((response) => {
    if (!response.ok) return null;
    return response.json();
  }).catch(() => null);
  const snapshot = await communityScores;
  if (detailScore !== detailData || !detail.open || snapshot?.version !== database.game.version) return;
  detailData.community = snapshot.cards[detailData.id] ?? { score: 0, offered: 0, picked: 0 };
  showCommunityDetails(detailData, detail.querySelector('.community-score'), detail.querySelector('.community-pick-rate'),
    detail.querySelector('.community-score-source'));
}

function openDetail(card, initial) {
  const config = { ...initial };
  const score = { id: card.id };
  function display() {
    const view = getPreview(card, config);
    const wrapper = el('div', 'detail-content');
    const close = el('button', 'dialog-close', '关闭');
    close.type = 'button';
    close.autofocus = true;
    close.addEventListener('click', () => detail.close());
    const portrait = el('div', 'detail-portrait');
    portrait.append(renderCard(card, database, config));
    const preview = el('div', 'detail-preview');
    score.manual = createKaoStrip();
    score.manual.update({ rank: score.rank, kao: score.value });
    preview.append(portrait, score.manual.node);
    const info = el('div', 'detail-info');
    const title = el('h2', '', view.title);
    title.id = 'detail-title';
    const header = el('div', 'catalog-detail-header');
    const titleLine = el('div', 'card-title-line');
    const community = el('div', 'community-score');
    community.id = 'catalog-community-score';
    titleLine.append(title, community);
    header.append(titleLine, close);
    const communityDetails = el('p', 'card-detail-stats community-sample');
    const communityLabel = el('span', 'community-pick-rate');
    const communitySource = el('a', 'community-score-source', `Spire Codex · ${database.game.version}`);
    communitySource.href = 'https://spire-codex.com/stats/cards';
    communitySource.target = '_blank';
    communitySource.rel = 'noopener noreferrer';
    showCommunityDetails(score, community, communityLabel, communitySource);
    communityDetails.append(communityLabel, communitySource);
    info.append(el('p', 'eyebrow', card.id), el('p', 'english', card.names.eng), communityDetails);
    const attributes = el('dl', 'attributes');
    const values = [
      ['类型', database.labels.types[view.type]], ['稀有度', database.labels.rarities[card.rarity]],
      ['卡池', database.labels.pools[card.pool]], ['卡框颜色', labelForColor(colorGroup(card.color))],
      ['能量', view.energy ?? '—'], ['星星', view.stars ?? '—'],
      ['目标', database.labels.targets[card.target] ?? card.target], ['关键词', (view.upgraded ? card.upgrade.keywords : card.keywords).map((key) => database.labels.keywords[key] ?? key).join('、') || '—']
    ];
    for (const [name, value] of values) {
      const attr = el('div');
      attr.append(el('dt', '', name), el('dd', '', value));
      attributes.append(attr);
    }
    info.append(attributes);
    if (view.text) {
      const preview = el('p', 'detail-description');
      appendDescription(preview, view.text, card, database);
      info.append(preview);
    }
    const controls = el('div', 'detail-actions');
    if (card.upgrade) {
      const upgrade = el('button', 'quiet', view.upgraded ? '查看基础版' : '查看升级版');
      upgrade.addEventListener('click', () => { config.upgraded = !config.upgraded; display(); byId('detail-upgrade')?.focus(); });
      upgrade.id = 'detail-upgrade';
      controls.append(upgrade);
    }
    if (card.types.length > 1) {
      const menu = el('select');
      menu.id = 'detail-variant';
      menu.setAttribute('aria-label', '卡牌变体');
      for (const type of card.types) menu.add(new Option(database.labels.types[type], type));
      menu.value = config.type;
      menu.addEventListener('change', () => { config.type = menu.value; display(); byId('detail-variant')?.focus(); });
      controls.append(menu);
    }
    if (controls.childElementCount) info.append(controls);
    wrapper.append(header, preview, info);
    detail.replaceChildren(wrapper);
  }
  display();
  detailScore = score;
  detail.showModal();
  void refreshDetailScore();
  void refreshCommunityScore(score);
}

async function start() {
  const response = await fetch('/data/cards.json', { cache: 'no-store' });
  if (response.status === 403) {
    location.replace('/room');
    return;
  }
  if (!response.ok) throw Error('加载失败');
  database = await response.json();
  for (const card of database.cards) {
    card.searchText = [card.id, card.id.replaceAll('_', ' '), card.names.zhs, card.names.zht, card.names.eng,
      ...Object.values(card.alternateNames), plainDescription(card.preview.base.text),
      plainDescription(card.preview.upgraded?.text ?? '')].join(' ').toLowerCase();
  }
  byId('total').textContent = database.cards.length.toLocaleString('zh-CN');
  byId('build').textContent = `${database.game.version} · 公开测试版`;
  byId('build').hidden = false;
  options('pool', Object.entries(database.labels.pools));
  options('type', typeOrder.filter((type) => database.labels.types[type]).map((type) => [type, database.labels.types[type]]));
  options('rarity', Object.entries(database.labels.rarities));
  addColorOptions();
  const moreFilters = byId('more-filters');
  const advancedFilters = byId('advanced-filters');
  moreFilters.addEventListener('click', () => {
    advancedFilters.hidden = !advancedFilters.hidden;
    moreFilters.setAttribute('aria-expanded', String(!advancedFilters.hidden));
  });
  byId('search').addEventListener('input', (event) => { state.query = event.target.value; showFirst(); });
  for (const key of ['pool', 'type', 'rarity', 'cost', 'sort']) {
    byId(key).addEventListener('change', (event) => { state[key] = event.target.value; showFirst(); });
  }
  byId('upgraded').addEventListener('change', (event) => { state.upgraded = event.target.checked; renderResults(); });
  byId('reset').addEventListener('click', () => {
    for (const field of ['query', 'type', 'color', 'pool', 'rarity', 'cost']) state[field] = '';
    for (const id of ['search', 'rarity', 'pool', 'type', 'cost']) byId(id).value = '';
    showFirst();
  });
  for (const [button, delta] of [['prev', -1], ['next', 1]]) {
    byId(button).addEventListener('click', () => {
      state.page += delta;
      renderResults();
      byId('results-heading').scrollIntoView({ block: 'start' });
    });
  }
  detail.addEventListener('click', (event) => { if (event.target === detail) detail.close(); });
  detail.addEventListener('close', () => { if (!detail.open) detailScore = null; });
  renderResults();
}

async function syncRoom() {
  try {
    const { room } = await roomRequest();
    if (room?.phase === 'playing' && !room.canViewCatalog) {
      location.replace('/room');
      return;
    }
    const back = byId('catalog-back');
    const label = byId('catalog-back-label');
    back.href = room ? '/room' : '/';
    label.textContent = room ? '返回房间' : '返回首页';
    void refreshDetailScore();
  } catch {
    // Retry when the room service reconnects.
  }
  setTimeout(syncRoom, document.hidden ? 4000 : 1500);
}

syncRoom();
start().catch(() => {
  byId('count').textContent = '加载失败';
});
