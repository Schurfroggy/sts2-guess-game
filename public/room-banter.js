export const banterDuration = 2000;

export const reactions = Object.freeze({
  'reaction-check': { label: '勾', path: 'M13 37 29 54 60 16' },
  'reaction-cross': { label: '叉', path: 'M15 15 57 57 M57 15 15 57' }
});

export const banter = Object.freeze({
  ironclad: { name: '铁甲战士', avatar: 'ironclad', text: '快点。' },
  silent: { name: '静默猎手', avatar: 'silent', text: '……' },
  regent: { name: '储君', avatar: 'regent', text: '我等着！！' },
  necrobinder: { name: '亡灵契约师', avatar: 'necrobinder', text: '再等几天也行……' },
  defect: { name: '故障机器人', avatar: 'defect', text: '0x54494D45 0x204C494D 0x49542045 0x58434545 0x00444544' },
  fool: { name: '愚者', avatar: 'random_character', text: '惆怅地哼唱……' },
  'nndx-1': { name: '奶龙 1', avatar: 'nndx-1', text: '哇哈哈哈哈哈哈！' },
  'nndx-2': { name: '奶龙 2', avatar: 'nndx-2', text: '！？区区？！' },
  'nndx-3': { name: '奶龙 3', avatar: 'nndx-3', text: '...忘我地大笑...' },
  'nndx-4': { name: '奶龙 4', avatar: 'nndx-4', text: '...不停地大笑...' }
});

export function isBanter(value) {
  return typeof value === 'string' && (Object.hasOwn(banter, value) || Object.hasOwn(reactions, value));
}

export function createBanterTracker() {
  const storageKey = 'spire.banter-cursor';
  const active = new Map();
  let scope;
  let lastId = 0;

  return (room, now = performance.now()) => {
    const nextScope = `${room.id}/${room.self}/${room.round}`;
    const changed = scope !== nextScope;
    if (changed) {
      scope = nextScope;
      active.clear();
      lastId = 0;
      try {
        const cursor = JSON.parse(sessionStorage.getItem(storageKey));
        if (cursor?.scope === scope && Number.isSafeInteger(cursor.lastId)) lastId = cursor.lastId;
      } catch {}
    }

    const speeches = new Map();
    const announcements = new Map();
    if (room.phase !== 'playing') {
      active.clear();
      return { speeches, announcement: '' };
    }

    const previousId = lastId;
    for (const { id, playerId, player, phrase } of room.banter) {
      if (id <= lastId) continue;
      lastId = id;
      if (!isBanter(phrase)) continue;
      active.set(playerId, { phrase, receivedAt: now });
      announcements.set(playerId, `${player}：${reactions[phrase]?.label ?? banter[phrase].text}`);
    }
    if (lastId !== previousId) {
      try { sessionStorage.setItem(storageKey, JSON.stringify({ scope, lastId })); } catch {}
    }

    for (const [playerId, { phrase, receivedAt }] of active) {
      const elapsed = now - receivedAt;
      if (elapsed < banterDuration) speeches.set(playerId, { phrase, elapsed });
      else active.delete(playerId);
    }
    const announcement = announcements.size || changed ? [...announcements.values()].join(' ') : null;
    return { speeches, announcement };
  };
}
