import { randomBytes } from 'node:crypto';
import { RoomError, Rooms } from './rooms.mjs';

export function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
  }).end(JSON.stringify(payload));
}

export async function readAction(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new RoomError('请求格式无效。', 415);
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
    throw new RoomError('只接受本站的房间操作。', 403);
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 8192) throw new RoomError('请求太大。', 413);
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks)); } catch { throw new RoomError('请求格式无效。'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RoomError('请求格式无效。');
  return input;
}

export function sessionFromRequest(req) {
  return req.headers.cookie?.match(/(?:^|;\s*)spire_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

export function roomApi(database, rooms = new Rooms(database), community) {
  const communityCards = community?.version === database.game?.version ? community?.cards : null;
  return async (req, res, url) => {
    try {
      const { pathname, searchParams } = url;
      const session = sessionFromRequest(req);
      if (req.method === 'GET' && pathname === '/api/room') {
        if (!session) {
          const token = randomBytes(32).toString('hex');
          res.setHeader('Set-Cookie', `spire_session=${token}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict${req.socket.encrypted ? '; Secure' : ''}`);
        }
        return json(res, 200, rooms.state(session));
      }
      if (req.method === 'POST' && pathname === '/api/room') {
        if (!session) throw new RoomError('请允许本站使用 Cookie，再刷新页面。', 401);
        const input = await readAction(req);
        const result = input.action === 'join' ? rooms.join(session, input.pin, input.nickname, input.avatar) : rooms.action(session, input);
        return json(res, 200, result);
      }
      if (req.method === 'POST' && pathname === '/api/room/props') {
        if (!session) throw new RoomError('请先进入房间。', 401);
        return json(res, 200, rooms.throwProps(session, await readAction(req)));
      }
      if (req.method === 'GET' && pathname === '/api/room/card') {
        const card = rooms.card(session, searchParams.get('player'), searchParams.get('deal'));
        const communityScore = communityCards ? communityCards[card.id] ?? { score: 0, offered: 0, picked: 0 } : null;
        return json(res, 200, { ...card, communityScore });
      }
      if (req.method === 'GET' && pathname === '/api/room/card-score') {
        if (!rooms.canViewCatalog(session)) throw new RoomError('对局中暂不能查看图鉴。', 403);
        return json(res, 200, rooms.cardScore(searchParams.get('id')));
      }
      if (req.method === 'GET' && pathname === '/api/room/suggestions') {
        const prefix = searchParams.get('prefix');
        const round = Number(searchParams.get('round'));
        const turn = Number(searchParams.get('turn'));
        return json(res, 200, { names: rooms.suggestions(session, prefix, round, turn) });
      }
      if (req.method === 'GET' && pathname === '/api/room/config') {
        rooms.entry(session);
        const { visuals, labels, pools } = database;
        return json(res, 200, { visuals, labels, pools, poolOptions: rooms.poolOptions });
      }
      return json(res, 404, { error: '接口不存在。' });
    } catch (error) {
      if (!(error instanceof RoomError)) console.error(error);
      return json(res, error instanceof RoomError ? error.status : 500, { error: error instanceof RoomError ? error.message : '房间服务暂时不可用。' });
    }
  };
}
