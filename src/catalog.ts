export const SERIES = 'plush-friends'
export const settings = {
  initialCoins: 120, cost: 10, attendance: [15, 15, 20, 20, 25, 30, 50],
  dailyGames: 3, miniRewards: [2, 6, 12], shardsPerExchange: 8, coinsPerExchange: 10,
  aimSeconds: 12, refillBelow: 3,
}
export const tuningDefaults = {
  weakHold: 0.2, strongHold: 8, weakForce: 0.38, strongForce: 0.85,
  mass: 1, friction: 0.35, miniLimit: settings.dailyGames,
}
export const tuningRanges = {
  weakHold: [0, 3, .05], strongHold: [0, 12, .1], weakForce: [0, 1, .01],
  strongForce: [0, 1, .01], mass: [.25, 3, .05], friction: [0, 1, .01], miniLimit: [0, 20, 1],
} as const

const designs = [
  ['mochi', '모찌 토끼', '쫑긋한 귀에 봄 향기를 담았어요.', 'rabbit', '#efa6a5'],
  ['latte', '라테 곰', '우유 거품처럼 포근한 친구예요.', 'bear', '#c59775'],
  ['choco', '초코 강아지', '긴 귀를 흔들며 달려와요.', 'dog', '#cf916e'],
  ['cream', '크림 고양이', '햇살이 드는 창가를 좋아해요.', 'cat', '#f5d7a5'],
  ['mint', '민트 개구리', '비가 오는 날이면 노래해요.', 'frog', '#9ec39a'],
  ['soda', '소다 펭귄', '남쪽 바다에서 가져온 파란 인사.', 'penguin', '#a1bedb'],
  ['peach', '복숭아 토끼', '볼에 복숭아빛이 물들었어요.', 'rabbit', '#f3ac83'],
  ['plum', '자두 고양이', '자두를 닮은 자줏빛 귀가 특징이에요.', 'cat', '#b99ad0'],
  ['lemon', '레몬 강아지', '새콤한 레몬색 귀를 가졌어요.', 'dog', '#ebc15d'],
  ['night', '별잠 곰', '잠옷을 입고 별을 세다가 잠들어요.', 'bear', '#aca6d6'],
  ['berry', '딸기 개구리', '딸기밭에 숨어 있는 작은 친구예요.', 'frog', '#e78f9a'],
  ['moon', '달잠 펭귄', '달빛을 모아 이불을 덮어요.', 'penguin', '#b3a8c6'],
] as const
export const items = designs.map(([id, name, description, kind, color], index) => ({
  id, name, seriesId: SERIES, description, imageKey: kind, color,
  rarity: index < 6 ? '일반' : index < 9 ? '특별' : '빛나는',
  physics: { radius: 19 + index % 3, mass: .85 + (index % 4) * .12 },
  shards: index < 6 ? 2 : index < 9 ? 3 : 5,
}))
export const catalog = new Map(items.map(item => [String(item.id), item]))
export type Item = typeof items[number]
