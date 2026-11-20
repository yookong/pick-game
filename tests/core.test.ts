import assert from 'node:assert/strict'
import { test } from 'node:test'
import Matter from 'matter-js'
import { catalog, settings, tuningDefaults } from '../src/catalog.ts'
import { CHUTE, ClawMachine } from '../src/claw.ts'
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

test('each extra toy-width adds 0.05 seconds and drop locks the starting band', () => {
  const machine = new ClawMachine([toy(182)], false, tuningDefaults)
  for (const [x, seconds] of [[72, .2], [146, .2], [147, .25], [189, .3], [321, .45]]) {
    machine.x = x
    assert.equal(machine.gripSeconds, seconds)
  }
  machine.drop()
  advance(machine, 160)
  assert.ok(machine.x < 147)
  assert.equal(machine.gripSeconds, .45)
  const strong = new ClawMachine([toy(182)], true, tuningDefaults)
  strong.x = 189
  assert.equal(strong.gripSeconds, 8.1)
})

test('the chute lip stops a toy rolling across the shelf before the claw drops', () => {
  const machine = new ClawMachine([toy(124, 319)], false, tuningDefaults)
  Matter.Body.setVelocity(machine.toys[0].body, { x: -7, y: 0 })
  advance(machine, 120)
  assert.equal(machine.phase, 'aim')
  assert.equal(machine.captures.length, 0)
  assert.ok(machine.snapshot()[0].x > CHUTE)
})

test('weak grip can displace a supported toy over the chute lip', () => {
  const machine = new ClawMachine([toy(96)], false, tuningDefaults)
  machine.x = 96
  advance(machine, 60)
  assert.equal(machine.captures.length, 0)
  machine.drop()
  advance(machine, 300)
  assert.equal(machine.captures.length, 1)
})

test('the guard blocks a falling upper toy through aiming and a missed drop', () => {
  const machine = new ClawMachine([toy(124, 220)], true, tuningDefaults)
  Matter.Body.setVelocity(machine.toys[0].body, { x: -7, y: 0 })
  advance(machine, 120)
  assert.equal(machine.chuteOpen, false)
  assert.equal(machine.captures.length, 0)
  assert.ok(machine.snapshot()[0].x > CHUTE)
  machine.x = 300
  machine.drop()
  advance(machine, 300)
  assert.equal(machine.phase, 'done')
  assert.equal(machine.chuteOpen, false)
  assert.equal(machine.captures.length, 0)
})

test('an unattended timeout still drops but keeps the guard closed on contact', () => {
  const machine = new ClawMachine([toy(182)], true, tuningDefaults)
  advance(machine, (settings.aimSeconds + 6) * 60)
  assert.equal(machine.phase, 'done')
  assert.equal(machine.chuteOpen, false)
  assert.equal(machine.captures.length, 0)
})

test('awards only observed chute crossings and persists the resulting pile', () => {
  const state = newState(1)
  assert.ok(begin(state))
  const machine = new ClawMachine(state.pile, false, tuningDefaults)
  run(machine)
  assert.equal(machine.chuteOpen, true)
  assert.equal(machine.captures.length, 2)
  const id = state.pending!.id
  const captures = [...machine.captures, ...machine.captures, { key: 'unknown', item: 'mochi' }]
  assert.equal(settle(state, id, captures, machine.snapshot(), today)?.length, 2)
  for (const capture of machine.captures) assert.equal(state.inventory[capture.item].count, 1)
  assert.equal(state.pile.length, 13)
  assert.deepEqual(decodeSave(JSON.stringify(state)).pile, state.pile)
  assert.equal(settle(state, id, captures, machine.snapshot(), today), null)
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
