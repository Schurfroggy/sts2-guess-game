import { randomInt, randomUUID } from 'node:crypto';
import { defaultAvatar, isAvatar } from '../public/avatars.js';
import { roomBackgrounds } from '../public/room-backgrounds.js';
import { banter, isBanter } from '../public/room-banter.js';
import { propKinds, propBatchLimit, propInterval, propRetention } from '../public/prop-rules.js';
import { CardScores } from './card-scores.mjs';

const offlineAfter = 90_000;
const idleLifetime = 5 * 60 * 1000;
export const maxSeats = 8;
const banterCooldown = 1000;
const banterRetention = 30_000;
const banterPhrases = Object.keys(banter);
const guessSuggestionLimit = 5;
const backgroundIds = Object.keys(roomBackgrounds);

export class RoomError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function requireThat(condition, message, status) {
  if (!condition) throw new RoomError(message, status);
}

const isOnline = (member, now) => now - member.seenAt < offlineAfter;

function groupCards(cards) {
  const groups = new Map();
  for (const card of cards) {
    const name = card.names.zhs;
    const key = name === '打击' || name === '防御' ? `name:${name}` : card.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  }
  return groups;
}

export class Rooms {
  constructor(database, { now = Date.now, pick = randomInt, scores = new CardScores(':memory:', database.cards) } = {}) {
    this.now = now;
    this.pick = pick;
    this.scores = scores;
    this.rooms = new Map();
    this.memberships = new Map();
    this.cards = new Map(database.cards.map((card) => [card.id, card]));
    this.eligible = database.cards.filter((card) => card.inLibrary !== false);
    this.poolIds = new Set(this.eligible.map((card) => card.pool));
    this.poolOptions = Object.entries(database.labels.pools)
      .filter(([value]) => this.poolIds.has(value))
      .map(([value, name]) => ({ value, name }));
  }

  sweep() {
    for (const [pin, room] of this.rooms) {
      if (this.now() - room.touchedAt < idleLifetime) continue;
      for (const member of room.members) this.memberships.delete(member.session);
      this.rooms.delete(pin);
    }
  }

  join(session, pin, nickname, avatar) {
    requireThat(typeof pin === 'string' && /^[0-9]{4}$/.test(pin), '请输入 4 位数字房间号。');
    const name = typeof nickname === 'string' ? nickname.trim() : '';
    requireThat(name && [...name].length <= 16 && !/[\p{Cc}\p{Cf}]/u.test(name), '昵称须为 1–16 个可见字符。');
    requireThat(avatar === undefined || isAvatar(avatar), '请选择有效头像。');
    this.sweep();
    const existing = this.memberships.get(session);
    const selectedAvatar = avatar ?? existing?.member.avatar ?? defaultAvatar;
    if (existing?.room.pin === pin) {
      if (existing.member.name !== name || existing.member.avatar !== selectedAvatar) {
        existing.member.name = name;
        existing.member.avatar = selectedAvatar;
        existing.room.revision++;
      }
      return this.state(session);
    }
    let room = this.rooms.get(pin);
    requireThat(!room || room.members.length < maxSeats, `房间已满（最多 ${maxSeats} 人）。`, 409);
    requireThat(room || this.rooms.size < 128, '暂时无法创建更多房间。', 409);
    if (existing) this.leave(session);
    if (!room) {
      const pools = this.poolOptions.map(({ value }) => value).filter((pool) => pool !== 'token' && pool !== 'fool');
      const candidates = this.candidates(pools);
      room = {
        id: randomUUID(), pin, host: null, members: [], revision: 0, round: 0, turn: 0, current: null,
        background: backgroundIds[randomInt(backgroundIds.length)],
        phase: 'waiting', pools,
        candidates, cardGroups: groupCards(candidates), usedGroups: new Set(),
        maxGuesses: 1, guessesLeft: 0, guessSuggestions: false, allowCatalogLookup: false,
        notice: null, banter: [], props: [], touchedAt: this.now()
      };
      this.rooms.set(pin, room);
    }
    const member = {
      id: randomUUID(), session, name, avatar: selectedAvatar, joinedRevision: room.revision,
      seenAt: this.now(), deal: null, solved: false, catalogPass: false
    };
    room.members.push(member);
    room.host ??= member.id;
    room.revision++;
    this.memberships.set(session, { room, member });
    return this.state(session);
  }

  leave(session) {
    const entry = this.memberships.get(session);
    if (!entry) return;
    const { room, member } = entry;
    requireThat(room.phase !== 'playing' || !member.deal, '本局结算后才能退出座位。', 409);
    room.members = room.members.filter((item) => item !== member);
    this.memberships.delete(session);
    if (!room.members.length) this.rooms.delete(room.pin);
    else {
      if (room.host === member.id) room.host = room.members[0].id;
      room.revision++;
    }
  }

  candidates(pools) {
    return this.eligible.filter((card) => pools.includes(card.pool));
  }

  memoryLocked(room) {
    return room.usedGroups.size * 10 >= room.cardGroups.size * 7;
  }

  unusedGroups(room) {
    return [...room.cardGroups].filter(([key]) => !room.usedGroups.has(key));
  }

  action(session, input) {
    const { room, member } = this.entry(session);
    requireThat(input.roomId === room.id && input.memberId === member.id, '房间或座位已经变化，请重试。', 409);
    requireThat(input.round === room.round, '本局已经变化，请重试。', 409);
    const hostOnly = () => requireThat(room.host === member.id, '只有房主可以执行此操作。', 403);
    const currentTurnOnly = () => requireThat(room.phase === 'playing' && room.current === member.id && input.turn === room.turn,
      '现在不是你的回合。', 409);
    switch (input.action) {
      case 'settings': {
        hostOnly();
        requireThat(room.phase !== 'playing', '请先结束本局，再修改设置。', 409);
        const pools = input.pools;
        requireThat(Array.isArray(pools) && pools.length > 0, '请至少选择一个卡池。');
        requireThat(pools.length <= this.poolIds.size && pools.every((pool) => this.poolIds.has(pool)), '卡池含无效选项。');
        requireThat(Number.isInteger(input.maxGuesses) && input.maxGuesses >= 1 && input.maxGuesses <= 5, '每回合可猜 1–5 次。');
        const { guessSuggestions = room.guessSuggestions, allowCatalogLookup = room.allowCatalogLookup } = input;
        requireThat(typeof guessSuggestions === 'boolean', '关键词联想设置无效。');
        requireThat(typeof allowCatalogLookup === 'boolean', '对局查看图鉴设置无效。');
        const selected = new Set(pools);
        const changed = selected.size !== room.pools.length || room.pools.some((pool) => !selected.has(pool))
          || input.maxGuesses !== room.maxGuesses || guessSuggestions !== room.guessSuggestions
          || allowCatalogLookup !== room.allowCatalogLookup;
        if (changed) {
          room.pools = [...selected];
          room.candidates = this.candidates(room.pools);
          room.cardGroups = groupCards(room.candidates);
          room.maxGuesses = input.maxGuesses;
          room.guessSuggestions = guessSuggestions;
          room.allowCatalogLookup = allowCatalogLookup;
          room.usedGroups.clear();
        }
        break;
      }
      case 'clear-memory':
        hostOnly();
        requireThat(room.phase !== 'playing', '本局结束后才能清空记忆池。', 409);
        room.usedGroups.clear();
        break;
      case 'transfer': {
        hostOnly();
        const target = room.members.find((item) => item.id === input.target);
        requireThat(target && target !== member && (room.phase !== 'playing' || target.deal), '请选择另一名参赛玩家。');
        room.host = target.id;
        break;
      }
      case 'start': {
        hostOnly();
        requireThat(room.phase !== 'playing', '请先结束本局。', 409);
        requireThat(!this.memoryLocked(room), '请先清空记忆池。', 409);
        const now = this.now();
        const participants = room.members.filter((player) => player === member || isOnline(player, now));
        requireThat(participants.length >= 2, '至少需要两名在线玩家。', 409);
        const deck = this.unusedGroups(room);
        requireThat(deck.length >= participants.length, '未用卡牌不足，请清空记忆池或扩大卡池。', 409);
        room.round++;
        room.turn = 1;
        for (const player of room.members) {
          player.deal = null;
          player.solved = false;
          player.catalogPass = false;
        }
        for (const player of participants) player.deal = this.draw(room, deck);
        room.current = participants[this.pick(participants.length)].id;
        room.guessesLeft = room.maxGuesses;
        room.notice = null;
        room.banter = [];
        room.props = [];
        room.phase = 'playing';
        if (this.memoryLocked(room)) this.finish(room);
        break;
      }
      case 'end':
        hostOnly();
        requireThat(room.phase === 'playing', '此局已经结束。', 409);
        this.finish(room);
        break;
      case 'guess': {
        currentTurnOnly();
        requireThat(input.dealVersion === member.deal.version, '你的牌已更换，请重新猜测。', 409);
        requireThat(input.guessesLeft === room.guessesLeft, '猜测次数已更新，请重试。', 409);
        requireThat(typeof input.answer === 'string' && input.answer.trim() && input.answer.length <= 120, '请输入卡牌名称。');
        room.guessesLeft--;
        member.deal.attempted = true;
        member.solved = input.answer === this.cards.get(member.deal.cardId).names.zhs;
        if (member.solved) member.deal.voters.clear();
        room.notice = { kind: member.solved ? 'correct' : 'incorrect', player: member.name };
        const pending = room.members.filter((player) => player.deal && !player.solved);
        if (pending.length <= 1) this.finish(room);
        else if (member.solved || room.guessesLeft === 0) this.advanceTurn(room, member);
        break;
      }
      case 'skip':
      case 'browse-catalog': {
        currentTurnOnly();
        if (input.action === 'browse-catalog') {
          requireThat(room.allowCatalogLookup, '本房间未开启对局查看图鉴。', 403);
          requireThat(this.canSpendTurnForCatalog(room, member), '本回合已提交过猜测，不能查看图鉴。', 409);
          member.catalogPass = true;
        }
        room.notice = null;
        this.advanceTurn(room, member);
        break;
      }
      case 'rate-card':
      case 'unrate-card': {
        const target = room.members.find((item) => item.id === input.target);
        requireThat(this.canRate(room, member, target), '只能为可见的卡牌评分。', 403);
        requireThat(target.deal.id === input.deal, '这张牌已经更换，请查看新卡面。', 409);
        this.scores.rate(target.deal.cardId, this.scores.voter(session), input.action === 'rate-card');
        break;
      }
      case 'vote': {
        const target = room.members.find((item) => item.id === input.target);
        requireThat(room.phase === 'playing' && member.deal && target && this.canVote(room, member, target), '现在不能为这张牌投票。', 403);
        requireThat(target.deal.id === input.deal, '这张牌已经更换，请查看新卡面。', 409);
        requireThat(!target.deal.voters.has(member.id), '你已经投过票。', 409);
        target.deal.voters.add(member.id);
        if (target.deal.voters.size === this.votesRequired(room)) {
          target.deal = this.draw(room, this.unusedGroups(room), target.deal.version + 1);
          room.notice = { kind: 'replaced', player: target.name, playerId: target.id };
          if (this.memoryLocked(room)) this.finish(room);
        }
        break;
      }
      case 'banter': {
        requireThat(room.phase === 'playing' && member.deal, '只有局内参赛玩家可以发言。', 403);
        requireThat(isBanter(input.phrase), '请选择有效的发言。');
        const now = this.now();
        requireThat(now >= (member.nextBanterAt ?? 0), '发送太快，请稍后再试。', 429);
        member.nextBanterAt = now + banterCooldown;
        room.banter = room.banter.filter(({ sentAt }) => now - sentAt < banterRetention);
        room.banter.push({ id: room.revision + 1, playerId: member.id, player: member.name, phrase: input.phrase, sentAt: now });
        break;
      }
      case 'leave':
        this.leave(session);
        return { room: null };
      default:
        throw new RoomError('未知房间操作。');
    }
    room.revision++;
    return this.state(session);
  }

  entry(session) {
    this.sweep();
    const entry = this.memberships.get(session);
    requireThat(entry, '房间已不存在，请重新加入。', 404);
    return entry;
  }

  canViewCatalog(session) {
    this.sweep();
    const entry = this.memberships.get(session);
    return !entry || this.catalogVisible(entry.room, entry.member);
  }

  catalogVisible(room, member) {
    return room.phase !== 'playing' || (member.catalogPass && room.current !== member.id);
  }

  canSpendTurnForCatalog(room, member) {
    return room.allowCatalogLookup && room.phase === 'playing' && room.current === member.id
      && room.guessesLeft === room.maxGuesses;
  }

  throwProps(session, input) {
    const { room, member } = this.entry(session);
    requireThat(input.roomId === room.id && input.memberId === member.id && input.round === room.round,
      '房间或对局已变化。', 409);
    requireThat(room.phase !== 'playing' || member.deal, '观战时不能发送道具。', 403);
    const { items } = input;
    requireThat(Array.isArray(items) && items.length > 0 && items.length <= propBatchLimit, '道具数量无效。');
    let count = 0;
    for (const item of items) {
      requireThat(item && propKinds.includes(item.kind) && Number.isInteger(item.count)
        && item.count > 0 && item.count <= propBatchLimit, '道具参数无效。');
      const target = room.members.find(({ id }) => id === item.target);
      requireThat(target && target !== member && (room.phase !== 'playing' || target.deal),
        '请选择房间内的其他座位。', 403);
      count += item.count;
    }
    requireThat(count <= propBatchLimit, '道具数量无效。');
    const now = this.now();
    const credit = Math.min(propBatchLimit, (member.propCredit ?? propBatchLimit) + Math.max(0, now - (member.lastPropAt ?? now)) / propInterval);
    requireThat(credit >= count, '发送太快，请稍后再试。', 429);
    member.propCredit = credit - count;
    member.lastPropAt = now;
    member.seenAt = room.touchedAt = now;
    room.props = room.props.filter(({ sentAt }) => now - sentAt < propRetention);
    for (const { target, kind, count } of items) {
      room.props.push({ id: ++room.revision, from: member.id, target, kind, count, sentAt: now });
    }
    if (room.props.length > 96) room.props.splice(0, room.props.length - 96);
    return { ok: true };
  }

  advanceTurn(room, member) {
    const at = room.members.indexOf(member);
    for (let step = 1; step < room.members.length; step++) {
      const next = room.members[(at + step) % room.members.length];
      if (!next.deal || next.solved) continue;
      next.catalogPass = false;
      room.current = next.id;
      room.turn++;
      room.guessesLeft = room.maxGuesses;
      return;
    }
  }

  draw(room, deck, version = 1) {
    const [[key, variants]] = deck.splice(this.pick(deck.length), 1);
    const card = variants.length === 1 ? variants[0] : variants[this.pick(variants.length)];
    room.usedGroups.add(key);
    return { id: randomUUID(), cardId: card.id, version, attempted: false, voters: new Set() };
  }

  finish(room) {
    room.phase = 'settled';
    room.current = null;
    room.guessesLeft = 0;
    room.banter = [];
    for (const member of room.members) member.deal?.voters.clear();
  }

  votesRequired(room) {
    return room.members.filter((member) => member.deal).length - 1;
  }

  visible(room, viewer, target) {
    return target.deal && (room.phase === 'settled' || viewer !== target || viewer.solved);
  }

  canVote(room, viewer, target) {
    return Boolean(room.phase === 'playing' && viewer !== target && viewer.deal && target.deal
      && !target.solved && room.usedGroups.size < room.cardGroups.size);
  }

  canRate(room, viewer, target) {
    return Boolean((room.phase === 'playing' || room.phase === 'settled') && target && this.visible(room, viewer, target));
  }

  cardScore(id) {
    const score = this.scores.get(id);
    requireThat(score, '卡牌不存在。', 404);
    return { kao: score.kao, rank: score.rank };
  }

  card(session, targetId, dealId) {
    const { room, member } = this.entry(session);
    const target = room.members.find((item) => item.id === targetId);
    requireThat(target && this.visible(room, member, target), '这张卡面不可见。', 404);
    requireThat(target.deal.id === dealId, '卡牌已变化，请重新打开。', 409);
    return this.cards.get(target.deal.cardId);
  }

  suggestions(session, prefix, round, turn) {
    const { room, member } = this.entry(session);
    requireThat(room.guessSuggestions, '关键词联想未开启。', 403);
    requireThat(room.phase === 'playing' && room.current === member.id && round === room.round && turn === room.turn,
      '现在不是你的回合。', 409);
    const query = prefix?.trim();
    if (!query || query.length > 120) return [];

    const names = new Set();
    for (const card of room.candidates) {
      const name = card.names.zhs;
      if (name.startsWith(query)) names.add(name);
      if (names.size === guessSuggestionLimit) break;
    }
    return [...names];
  }

  state(session) {
    this.sweep();
    const entry = this.memberships.get(session);
    if (!entry) return { room: null };
    const { room, member } = entry;
    const now = this.now();
    member.seenAt = room.touchedAt = now;
    const votesRequired = this.votesRequired(room);
    const voter = this.scores.voter(session);
    return { room: {
      id: room.id, pin: room.pin, background: room.background, host: room.host, self: member.id, phase: room.phase, round: room.round,
      turn: room.turn, current: room.current, revision: room.revision, notice: room.notice,
      banter: room.banter.filter(({ id, sentAt }) => id > member.joinedRevision && now - sentAt < banterRetention), banterPhrases,
      props: room.props.filter(({ id, sentAt }) => id > member.joinedRevision && now - sentAt < propRetention),
      pools: room.pools, maxGuesses: room.maxGuesses, guessesLeft: room.guessesLeft, guessSuggestions: room.guessSuggestions,
      allowCatalogLookup: room.allowCatalogLookup, canViewCatalog: this.catalogVisible(room, member),
      canSpendTurnForCatalog: this.canSpendTurnForCatalog(room, member),
      ownDealVersion: member.deal?.version ?? 0,
      ownDealChanged: Boolean(member.deal?.version > 1 && !member.deal.attempted),
      memory: { used: room.usedGroups.size, total: room.cardGroups.size, locked: this.memoryLocked(room) },
      players: room.members.map((target) => {
        const visible = this.visible(room, member, target);
        return {
          id: target.id, name: target.name, avatar: target.avatar, solved: target.solved, spectator: room.phase === 'playing' && !target.deal,
          online: isOnline(target, now),
          card: visible ? {
            deal: target.deal.id, name: this.cards.get(target.deal.cardId).names.zhs,
            canRate: this.canRate(room, member, target), ...this.scores.get(target.deal.cardId, voter)
          } : null,
          vote: visible && this.canVote(room, member, target) ? {
            count: target.deal.voters.size, required: votesRequired, cast: target.deal.voters.has(member.id)
          } : null
        };
      })
    } };
  }
}
