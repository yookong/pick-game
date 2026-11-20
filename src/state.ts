import { z } from 'zod'
import { catalog, items, settings, tuningDefaults, tuningRanges } from './catalog.ts'

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const item = z.string().refine(id => catalog.has(id))
const tuning = z.object({
  weakHold: z.number().min(0).max(3), strongHold: z.number().min(0).max(12),
  weakForce: z.number().min(0).max(1), strongForce: z.number().min(0).max(1),
  mass: z.number().min(.25).max(3), friction: z.number().min(0).max(1),
  miniLimit: z.number().int().min(0).max(20),
} satisfies Record<keyof typeof tuningRanges, z.ZodType>)
const pileSchema = z.array(z.object({
  key: z.string().min(1), item, x: z.number().min(0).max(360), y: z.number().min(0).max(410), angle: z.number(),
})).max(40).refine(pile => new Set(pile.map(piece => piece.key)).size === pile.length)

export const stateSchema = z.object({
  version: z.literal(1), coins: count, shards: count, attempts: count,
  nextStrong: z.number().int().min(1).max(15),
  rng: z.number().int().min(1).max(0xffffffff),
  pending: z.object({ id: count, strong: z.boolean() }).nullable(),
  pile: pileSchema,
  inventory: z.record(item, z.object({ count: count.min(1), first: day, fresh: z.boolean() })),
  attendance: z.object({ day: day.nullable(), total: count }),
  mini: z.object({ day: day.nullable(), used: count, serial: count, active: count.nullable() }),
  preferences: z.object({ sound: z.boolean(), vibrate: z.boolean() }),
  lab: z.object({ mode: z.enum(['auto', 'weak', 'strong']), forceNext: z.boolean(), debug: z.boolean(), tuning }),
}).refine(state => !state.pending || state.pending.id === state.attempts)

export type State = z.infer<typeof stateSchema>
export type Piece = State['pile'][number]
export type Tuning = State['lab']['tuning']
export type Capture = { key: string; item: string }

export function localDay(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

function roll(state: State, upper: number) {
  // Reject the uneven tail so that all interval buckets have equal size.
  const limit = Math.floor(0xffffffff / upper) * upper
  let sample: number
  do {
    let n = state.rng
    n ^= n << 13
    n ^= n >>> 17
    n ^= n << 5
    state.rng = n >>> 0
    sample = state.rng - 1
  } while (sample >= limit)
  return sample % upper
}

export function refill(state: State) {
  state.pile = Array.from({ length: 15 }, (_, i) => ({
    key: String(i), item: items[roll(state, items.length)].id,
    x: 100 + i % 6 * 42, y: 311 - Math.floor(i / 6) * 44, angle: 0,
  }))
}
export function newState(seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]): State {
  const state: State = {
    version: 1, coins: settings.initialCoins, shards: 0, attempts: 0, nextStrong: 1, rng: (seed >>> 0) || 1,
    pending: null, pile: [], inventory: {}, attendance: { day: null, total: 0 },
    mini: { day: null, used: 0, serial: 0, active: null }, preferences: { sound: true, vibrate: true },
    lab: { mode: 'auto', forceNext: false, debug: false, tuning: { ...tuningDefaults } },
  }
  state.nextStrong = roll(state, 15) + 1
  refill(state)
  return state
}
export function recover(state: State) {
  if (state.pending) state.coins += settings.cost
  state.pending = null
  state.mini.active = null
}
export function begin(state: State, lab = false) {
  if (state.pending || state.coins < settings.cost) return false
  state.coins -= settings.cost
  state.attempts++
  const scheduled = --state.nextStrong === 0
  if (scheduled) state.nextStrong = roll(state, 15) + 1
  const strong = !lab ? scheduled : state.lab.forceNext ||
    (state.lab.mode === 'auto' ? scheduled : state.lab.mode === 'strong')
  if (lab) state.lab.forceNext = false
  state.pending = { id: state.attempts, strong }
  return true
}
export function grant(state: State, id: string, today: string) {
  if (!catalog.has(id)) return false
  const entry = state.inventory[id]
  if (entry) entry.count++
  else state.inventory[id] = { count: 1, first: today, fresh: true }
  return !entry
}
export function settle(state: State, id: number, captures: Capture[], pile: Piece[], today: string) {
  if (state.pending?.id !== id) return null
  const available = new Map(state.pile.map(piece => [piece.key, piece.item]))
  const rewards = []
  for (const capture of captures) {
    if (available.get(capture.key) !== capture.item) continue
    available.delete(capture.key)
    rewards.push({ item: capture.item, fresh: grant(state, capture.item, today) })
  }
  state.pile = pile.filter(piece => available.get(piece.key) === piece.item)
  if (state.pile.length < settings.refillBelow) refill(state)
  state.pending = null
  return rewards
}
export function attendance(state: State, today: string) {
  if (state.attendance.day && state.attendance.day >= today) return 0
  const reward = settings.attendance[state.attendance.total % settings.attendance.length]
  state.attendance = { day: today, total: state.attendance.total + 1 }
  state.coins += reward
  return reward
}
export function miniUsed(state: State, today: string) {
  return state.mini.day && state.mini.day >= today ? state.mini.used : 0
}
export function startMini(state: State, today: string, limit: number) {
  const used = miniUsed(state, today)
  if (state.mini.active !== null || used >= limit || (state.mini.day && state.mini.day > today)) return null
  const id = state.mini.serial + 1
  state.mini = { day: today, used: used + 1, serial: id, active: id }
  return id
}
export function finishMini(state: State, id: number, accuracy: number) {
  if (id !== state.mini.active) return 0
  state.mini.active = null
  const reward = settings.miniRewards[accuracy <= .045 ? 2 : accuracy <= .12 ? 1 : 0]
  state.coins += reward
  return reward
}
export function exchangeQuote(state: State, quantities: Record<string, number>) {
  let total = 0
  for (const [id, amount] of Object.entries(quantities)) {
    const item = catalog.get(id)
    if (!item || !Number.isSafeInteger(amount) || amount < 0 || amount >= (state.inventory[id]?.count ?? 0)) return 0
    total += item.shards * amount
  }
  return total
}
export function exchange(state: State, quantities: Record<string, number>) {
  const total = exchangeQuote(state, quantities)
  if (!total) return false
  for (const [id, amount] of Object.entries(quantities)) state.inventory[id].count -= amount
  state.shards += total
  return true
}
export function buyCoins(state: State) {
  if (state.shards < settings.shardsPerExchange) return false
  state.shards -= settings.shardsPerExchange
  state.coins += settings.coinsPerExchange
  return true
}
