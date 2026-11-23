export const defaultAvatar = 'ironclad';

export const avatars = Object.freeze({
  ironclad: '铁甲战士',
  silent: '静默猎手',
  regent: '储君',
  necrobinder: '亡灵契约师',
  defect: '故障机器人',
  random_character: '愚者',
  'nndx-1': '奶龙 1',
  'nndx-2': '奶龙 2',
  'nndx-3': '奶龙 3',
  'nndx-4': '奶龙 4'
});

export function isAvatar(value) {
  return typeof value === 'string' && Object.hasOwn(avatars, value);
}

export function avatarUrl(value) {
  const asset = value === 'random_character' ? 'fool' : isAvatar(value) ? value : defaultAvatar;
  return `/assets/room/avatar-${asset}.png`;
}
