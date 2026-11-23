import { element } from './room-client.js';

const tiers = [
  { min: 48, tone: 'gold', label: 'S 档', path: 'M19.1 9.1h-1.4l-.8-2.6c-1-1-2.4-1.5-4-1.5-2 0-3.3 1-3.3 2.4 0 1.3 1 1.9 3.9 2.9 4 1.4 5.9 3 5.9 5.7 0 3.4-2.9 5.9-7.3 5.9-2.1 0-3.8-.5-5.2-1.5l-1.8 1.3-.4-6.6h1.5l1 2.9c1.2 1.1 2.8 1.8 4.7 1.8 2.1 0 3.5-1 3.5-2.5 0-1.4-1.3-2.1-4.2-3.2-3.7-1.3-5.6-3-5.6-5.5 0-3.4 2.8-5.6 7-5.6 1.7 0 3.4.4 4.4 1.2l1.7-1.2.4 6.1Z' },
  { min: 33, tone: 'purple', label: 'A 档', path: 'M11.6 2.7h1.1l6.9 16.1 1.7 1.1v1.4h-7.9v-1.4l1.9-1-1.2-3.2H8.2l-1.2 3.1 2 1.1v1.4H2.7v-1.4l1.9-1.1L11.6 2.7ZM9 13.6h4.3l-2.1-5.5L9 13.6Z' },
  { min: 21, tone: 'blue', label: 'B 档', path: 'M4 3.1h8.5c4.3 0 6.8 1.7 6.8 4.4 0 1.8-1.3 3.2-3.5 4 3 .6 4.5 2.3 4.5 4.6 0 3.3-2.8 5.1-7.4 5.1H4v-1.4l2-1V5.5L4 4.4V3.1Zm6 2v5.6h1.8c2.1 0 3.4-1 3.4-2.9 0-1.7-1.1-2.7-3.3-2.7H10Zm0 7.5v6.6h2.2c2.4 0 3.8-1.1 3.8-3.3s-1.4-3.3-3.8-3.3H10Z' },
  { min: 1, tone: 'jade', label: 'C 档', path: 'M19.8 9.6h-1.4l-.9-2.8c-.8-.9-2.1-1.6-3.8-1.6-3.5 0-5.6 2.5-5.6 6.8 0 4.6 2.3 7.2 5.7 7.2 2.4 0 4.2-1 5.6-2.7l1.1 1.1c-1.7 2.7-4.2 4.1-7.6 4.1-5.6 0-9.2-3.8-9.2-9.5 0-5.5 3.6-9.3 9-9.3 1.8 0 3.7.5 4.9 1.4L19.4 3l.4 6.6Z' },
  { min: 0, tone: 'gray', label: 'F 档：无数据', path: 'M4.2 3.1h14.9l.6 5.3h-1.4l-1.5-3.1h-6.6v5.8h4.2l1-1.8h1.4v5.8h-1.4l-1-1.9h-4.2v5.6l2.6 1v1.4H4.2v-1.4l2-1V5.5l-2-1V3.1Z' }
];

export function communityTier(score) {
  if (!Number.isInteger(score) || score < 0 || score > 100) return null;
  return tiers.find(({ min }) => score >= min);
}

export function formatCommunityPickRate({ picked, offered }) {
  return `${(100 * picked / offered).toFixed(1)}%`;
}

export function renderCommunityBadge(container, stats) {
  const tier = communityTier(stats?.score);
  const missing = stats?.score === 0;
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', '社区评分');
  container.replaceChildren(
    element('span', 'community-score-label', '社区'),
    element('strong', missing ? 'community-score-value community-score-missing' : 'community-score-value',
      missing ? '无数据' : tier ? String(stats.score) : '—')
  );
  if (!tier) {
    container.removeAttribute('tabindex');
    container.removeAttribute('aria-describedby');
    return;
  }
  const { offered, picked, score } = stats;
  const tooltipText = missing ? '无选牌样本。\nF 档'
    : `在 ${offered.toLocaleString('zh-CN')} 次中被选中 ${picked.toLocaleString('zh-CN')} 次，抓取率 ${formatCommunityPickRate(stats)}。\n社区分 ${score} · ${tier.label}`;
  const tooltip = element('span', 'community-score-tooltip', tooltipText);
  tooltip.id = `${container.id}-tooltip`;
  tooltip.setAttribute('role', 'tooltip');
  container.tabIndex = 0;
  container.setAttribute('aria-describedby', tooltip.id);
  const badge = element('span', `community-tier community-tier-${tier.tone}`);
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', tier.label);
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(namespace, 'path');
  shape.setAttribute('d', tier.path);
  icon.append(shape);
  badge.append(icon);
  container.append(badge, tooltip);
}
