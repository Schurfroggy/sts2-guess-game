const order = new Intl.Collator('zh-CN');
const numericCost = (cost) => typeof cost === 'number' ? cost : cost === 'X' ? Infinity : -1;

export const colorGroup = (color) => color === 'curse' || color === 'quest' ? 'other' : color;

export function filterCards(cards, state, rarityOrder = []) {
  const terms = state.query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const filtered = cards.filter((card) => {
    if (state.type && !card.types.includes(state.type)) return false;
    if (state.color && state.color !== colorGroup(card.color)) return false;
    if (state.pool && state.pool !== card.pool) return false;
    if (state.rarity && state.rarity !== card.rarity) return false;
    if (state.cost === '3+' ? !(typeof card.energy === 'number' && card.energy >= 3)
      : state.cost === 'none' ? card.energy !== null : state.cost && String(card.energy) !== state.cost) return false;
    return terms.every((term) => card.searchText.includes(term));
  });
  const nameSort = (left, right) => order.compare(left.names.zhs, right.names.zhs) || left.id.localeCompare(right.id);
  let primary;
  switch (state.sort) {
    case 'rarity': {
      const ranks = new Map(rarityOrder.map((rarity, index) => [rarity, index]));
      const rank = (card) => ranks.get(card.rarity) ?? ranks.size;
      primary = (left, right) => rank(left) - rank(right);
      break;
    }
    case 'energy':
      primary = (left, right) => numericCost(left.energy) - numericCost(right.energy);
      break;
    case 'pool':
      primary = (left, right) => left.pool.localeCompare(right.pool);
      break;
  }
  return filtered.sort((left, right) => primary?.(left, right) || nameSort(left, right));
}
