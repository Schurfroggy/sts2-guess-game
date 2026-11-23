import { byId, element, readPreference, roomRequest, savePreference } from './room-client.js';
import { avatars, avatarUrl, defaultAvatar, isAvatar } from './avatars.js';

const nickname = byId('nickname');
const pin = byId('pin');
const status = byId('home-status');
const button = byId('join-button');
const preference = readPreference('avatar');
let avatar = isAvatar(preference) ? preference : defaultAvatar;
const avatarInputs = new Map();
for (const [id, name] of Object.entries(avatars)) {
  const label = element('label', 'avatar-option');
  label.title = name;
  const input = element('input', 'sr-only');
  input.type = 'radio';
  input.name = 'avatar';
  input.value = id;
  input.checked = avatar === id;
  input.setAttribute('aria-label', name);
  const image = element('img', 'avatar');
  image.src = avatarUrl(id);
  image.alt = '';
  label.append(input, image);
  byId('avatar-options').append(label);
  avatarInputs.set(id, input);
  input.addEventListener('change', () => {
    avatar = id;
    savePreference('avatar', id);
  });
}
nickname.value = readPreference('nickname');
pin.value = readPreference('pin');
nickname.addEventListener('change', () => savePreference('nickname', nickname.value.trim()));
pin.addEventListener('input', () => { pin.value = pin.value.replace(/[^0-9]/g, '').slice(0, 4); });

try {
  const { room } = await roomRequest();
  byId('home-compendium').hidden = room?.phase === 'playing';
  if (room) {
    const player = room.players.find(({ id }) => id === room.self);
    pin.value = room.pin;
    nickname.value ||= player.name;
    if (!isAvatar(readPreference('avatar')) && isAvatar(player.avatar)) {
      avatar = player.avatar;
      avatarInputs.get(avatar).checked = true;
    }
    button.textContent = '返回原房间';
  }
} catch {
  status.textContent = '连接失败';
}
button.disabled = false;

byId('join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = '';
  try {
    await roomRequest();
    await roomRequest('', { action: 'join', pin: pin.value, nickname: nickname.value, avatar });
    savePreference('nickname', nickname.value.trim());
    savePreference('pin', pin.value);
    savePreference('avatar', avatar);
    location.assign('/room');
  } catch (error) {
    status.textContent = error.message || '连接失败，请重试。';
    button.disabled = false;
  }
});
