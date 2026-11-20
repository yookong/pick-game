import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalog, settings, tuningDefaults } from '../src/catalog.ts'
import { CHUTE, ClawMachine, FLOOR } from '../src/claw.ts'
import { decodeSave } from '../src/storage.ts'
import {
  attendance, begin, buyCoins, exchange, finishMini, grant, miniUsed, newState, recover,
  settle, startMini, stateSchema, type Piece,
} from '../src/state.ts'

const today = '2026-11-20'
const tomorrow = '2026-11-21'
const toy = (x: number, y = 318): Piece => ({ key: 'a', item: 'mochi', x, y, angle: 0 })
function advance(machine: ClawMachine, frames: number) {
  for (let frame = 0; frame < frames; frame++) machine.advance(1 / 60)
}
function run(machine: ClawMachine) {
  advance(machine, 60)
  machine.drop()
  advance(machine, 300)
  assert.equal(machine.phase, 'done')
}

test('charges exactly once and rejects insufficient balance', () => {
  const state = newState(1)
  state.coins = settings.cost - 1
  assert.equal(begin(state), false)
  state.coins++
  assert.equal(begin(state), true)
  assert.equal(begin(state), false)
  assert.equal(state.coins, 0)
  assert.equal(state.attempts, 1)
})

test('strong intervals count down, re-roll, and survive recovery', () => {
  let state = newState(16)
  let strongCount = 0
  const intervals = new Set()
  for (let i = 0; i < 180; i++) {
    const before = state.nextStrong
    const coins = state.coins
    assert.ok(begin(state))
    assert.equal(state.pending?.strong, before === 1)
    if (before === 1) { strongCount++; intervals.add(state.nextStrong) }
    else assert.equal(state.nextStrong, before - 1)
    const after = state.nextStrong
    const attempt = state.attempts
    const pile = structuredClone(state.pile)
    state = decodeSave(JSON.stringify(state))
    assert.equal(state.pending, null)
    assert.equal(state.nextStrong, after)
    assert.equal(state.attempts, attempt)
    assert.deepEqual(state.pile, pile)
    assert.equal(state.coins, coins)
    recover(state)
    assert.equal(state.coins, coins)
  }
  assert.ok(strongCount > 10 && intervals.size > 4)
})

test('strong grip can lift a centered toy and release it through the chute', () => {
  const machine = new ClawMachine([toy(182)], true, tuningDefaults)
  advance(machine, 60)
  machine.drop()
  advance(machine, 140)
  assert.ok(machine.toys[0].body.position.y < 110)
  assert.equal(machine.captures.length, 0)
  advance(machine, 200)
  assert.deepEqual(machine.captures, [{ key: 'a', item: 'mochi' }])
  assert.equal(machine.snapshot().length, 0)
})

test('a strong attempt can miss and a weak attempt can move a toy without awarding it', () => {
  const miss = new ClawMachine([toy(310)], true, tuningDefaults)
  run(miss)
  assert.equal(miss.captures.length, 0)
  const weak = new ClawMachine([toy(182)], false, tuningDefaults)
  advance(weak, 60)
  weak.drop()
  advance(weak, 84)
  assert.ok(weak.toys[0].body.position.y < 310)
  advance(weak, 240)
  assert.equal(weak.captures.length, 0)
  assert.ok(weak.snapshot()[0].y > 310)
})

test('weak grip can displace a supported toy over the edge', () => {
  const machine = new ClawMachine([toy(96)], false, tuningDefaults)
  machine.x = 96
  advance(machine, 60)
  assert.equal(machine.captures.length, 0)
  machine.drop()
  advance(machine, 300)
  assert.equal(machine.captures.length, 1)
})

test('awards only observed chute crossings and persists the resulting pile', () => {
  const state = newState(12)
  state.pile = [toy(30, FLOOR + 15), { ...toy(58, FLOOR + 57), key: 'b' },
    ...[130, 220, 310].map((x, index) => ({ ...toy(x), key: String(index) }))]
  assert.ok(begin(state))
  const machine = new ClawMachine(state.pile, false, tuningDefaults)
  assert.equal(machine.captures.length, 0)
  advance(machine, 60)
  assert.ok(machine.toys.every(({ body }) => body.position.x >= CHUTE))
  machine.drop()
  advance(machine, 300)
  const id = state.pending!.id
  assert.equal(settle(state, id, [...machine.captures, ...machine.captures, { key: 'unknown', item: 'mochi' }], machine.snapshot(), today)?.length, 2)
  assert.equal(state.inventory.mochi.count, 2)
  assert.ok(state.pile.length >= settings.refillBelow)
  assert.deepEqual(decodeSave(JSON.stringify(state)).pile, state.pile)
  assert.equal(settle(state, id, machine.captures, machine.snapshot(), today), null)
  assert.equal(state.inventory.mochi.count, 2)
})

test('attendance and minigame use the device day and settle only once', () => {
  const state = newState(1)
  assert.equal(attendance(state, today), settings.attendance[0])
  assert.equal(attendance(state, today), 0)
  assert.equal(attendance(state, tomorrow), settings.attendance[1])
  assert.equal(attendance(state, today), 0)
  for (let i = 0; i < 3; i++) {
    const id = startMini(state, today, 3)!
    assert.equal(startMini(state, today, 3), null)
    assert.equal(finishMini(state, id, 0), 12)
    assert.equal(finishMini(state, id, 0), 0)
  }
  assert.equal(startMini(state, today, 3), null)
  assert.equal(miniUsed(state, tomorrow), 0)
  const id = startMini(state, tomorrow, 3)!
  recover(state)
  assert.equal(finishMini(state, id, 0), 0)
  assert.equal(miniUsed(state, tomorrow), 1)
})

test('duplicate exchange protects the last copy and spends exact ratios', () => {
  const state = newState(1)
  for (let i = 0; i < 5; i++) grant(state, 'mochi', today)
  assert.equal(exchange(state, { mochi: 5 }), false)
  assert.equal(exchange(state, { mochi: 4 }), true)
  assert.equal(exchange(state, { mochi: 4 }), false)
  assert.equal(state.inventory.mochi.count, 1)
  assert.equal(state.shards, 4 * catalog.get('mochi')!.shards)
  assert.equal(buyCoins(state), true)
  assert.equal(buyCoins(state), false)
  assert.equal(state.coins, settings.initialCoins + settings.coinsPerExchange)
})

test('save validation rejects unsupported versions, unknown items, and duplicate pieces', () => {
  const original = newState(1)
  assert.ok(stateSchema.safeParse(original).success)
  assert.throws(() => decodeSave(JSON.stringify({ ...original, version: 2 })))
  assert.throws(() => decodeSave(JSON.stringify({ ...original, pile: [toy(80), toy(120)] })))
  assert.throws(() => decodeSave(JSON.stringify({ ...original, pile: [{ ...toy(100), item: 'unknown' }] })))
})
