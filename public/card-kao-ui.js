import { element } from './room-client.js';

export function kaoRankTone(rank) {
  if (!Number.isInteger(rank) || rank < 1 || rank > 100) return 'neutral';
  if (rank <= 25) return 'gold';
  if (rank <= 50) return 'silver';
  return 'bronze';
}

function rankLaurel() {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 64 32');
  icon.setAttribute('class', 'kao-laurel');
  icon.setAttribute('aria-hidden', 'true');
  const leaves = document.createElementNS(namespace, 'path');
  leaves.setAttribute('d', 'M16 27C8 24 4 16 5 7m3 12c-4 0-6-2-7-6 4 0 7 2 7 6Zm-2-6C3 11 2 8 3 4c3 1 5 5 3 9Zm6 10c-1-4 0-7 3-9 2 4 1 7-3 9Zm36 4c8-3 12-11 11-20m-3 12c4 0 6-2 7-6-4 0-7 2-7 6Zm2-6c3-2 4-5 3-9-3 1-5 5-3 9Zm-6 10c1-4 0-7-3-9-2 4-1 7 3 9Z');
  icon.append(leaves);
  return icon;
}

export function createKaoStrip(action) {
  const node = element('div', action ? 'kao-strip' : 'kao-strip kao-strip-readonly');
  const metrics = element('dl', 'kao-metrics');
  const rankStat = element('div', 'kao-stat kao-rank');
  rankStat.dataset.tone = 'neutral';
  const rankValue = element('strong', 'kao-stat-value', '—');
  const rankNumber = element('dd');
  rankNumber.append(rankLaurel(), rankValue);
  rankStat.append(element('dt', 'kao-stat-label', '考排名'), rankNumber);
  const scoreStat = element('div', 'kao-stat kao-vote-score');
  const scoreValue = element('strong', 'kao-stat-value', '—');
  scoreValue.setAttribute('role', 'status');
  scoreValue.setAttribute('aria-label', '分值');
  const scoreNumber = element('dd');
  scoreNumber.append(scoreValue);
  scoreStat.append(element('dt', 'kao-stat-label', '分值'), scoreNumber);
  metrics.append(rankStat, scoreStat);
  node.append(metrics);
  if (action) node.append(action);
  let pulse;
  return {
    node,
    update({ rank, kao } = {}, animate = false) {
      const tone = kaoRankTone(rank);
      const rankText = rank === undefined ? '—' : tone === 'neutral' ? '100+' : String(rank);
      const scoreText = Number.isInteger(kao) ? String(kao) : '—';
      if (rankStat.dataset.tone !== tone) rankStat.dataset.tone = tone;
      if (rankValue.textContent !== rankText) rankValue.textContent = rankText;
      if (!animate) pulse?.cancel();
      if (scoreValue.textContent === scoreText) return;
      const hadScore = scoreValue.textContent !== '—';
      scoreValue.textContent = scoreText;
      if (animate && hadScore && typeof scoreValue.animate === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        pulse?.cancel();
        pulse = scoreValue.animate([
          { transform: 'scale(.94)' }, { transform: 'translateY(-2px) scale(1.13)', offset: .36 },
          { transform: 'scale(1)' }
        ], { duration: 250, easing: 'ease-out' });
      }
    }
  };
}
