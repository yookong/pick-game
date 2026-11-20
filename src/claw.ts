import Matter from 'matter-js'
import { catalog, settings } from './catalog.ts'
import type { Capture, Piece, Tuning } from './state.ts'

const { Bodies, Body, Composite, Constraint, Engine, Events, Query } = Matter
// Matter 0.20 supports updateVelocity, which is missing in its type declaration.
const moveBody = Body.setPosition as (body: Matter.Body, position: Matter.Vector, updateVelocity: boolean) => void
export const WIDTH = 360
export const HEIGHT = 410
export const CHUTE = 72
export const FLOOR = 338
export const CHUTE_LIP = { width: 12, height: 20 }
export const CHUTE_GUARD = { top: 0, height: FLOOR - CHUTE_LIP.height }
const HOME = 38
const RAIL = 51
const STEP = 1 / 60
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const ease = (n: number) => n * n * (3 - 2 * n)
const mix = (a: number, b: number, p: number) => a + (b - a) * p

type Phase = 'aim' | 'down' | 'close' | 'up' | 'travel' | 'open' | 'settle' | 'done'
type Toy = { key: string; item: string; body: Matter.Body; radius: number }
const phases: Record<Exclude<Phase, 'aim' | 'done'>, number> = {
  down: .85, close: .32, up: .82, travel: .85, open: .24, settle: 1.85,
}

export function jawPath(x: number, y: number, openness: number, side: number) {
  return [
    [x + side * 7, y - 20],
    [x + side * (23 + 13 * openness), y - 3],
    [x + side * (21 + 12 * openness), y + 13],
    [x + side * (12 + 16 * openness), y + 23],
  ]
}
function sampleJaw(path: number[][], index: number) {
  const position = index * 3 / 9
  const leg = Math.min(2, Math.floor(position))
  const fraction = position - leg
  return { x: mix(path[leg][0], path[leg + 1][0], fraction), y: mix(path[leg][1], path[leg + 1][1], fraction) }
}

export class ClawMachine {
  engine = Engine.create({ positionIterations: 9, velocityIterations: 7 })
  toys: Toy[]
  captures: Capture[] = []
  phase: Phase = 'aim'
  remaining = settings.aimSeconds
  input = 0
  x = 182
  y = RAIL
  openness = 1
  private elapsed = 0
  private lag = 0
  private fromX = this.x
  private targetY = 286
  private holdTime = 0
  private openFrom = 0
  private grip: { toy: Toy; joint: Matter.Constraint } | null = null
  private fingers: Matter.Body[][]
  private chuteLip: Matter.Body
  private chuteGuard: Matter.Body
  private playerActed = false
  private chuteGuardOpen = false
  get chuteOpen() { return this.chuteGuardOpen }
  readonly strong: boolean
  readonly tuning: Tuning
  constructor(pile: Piece[], strong: boolean, tuning: Tuning) {
    this.strong = strong
    this.tuning = tuning
    this.toys = pile.map(piece => {
      const definition = catalog.get(piece.item)!
      const { radius, mass } = definition.physics
      // Recover pieces left over the chute by an older machine layout.
      const onShelf = piece.x < CHUTE + CHUTE_LIP.width
      const x = onShelf ? CHUTE + CHUTE_LIP.width + radius : piece.x
      const body = Bodies.circle(x, Math.min(piece.y, FLOOR - radius), radius, {
        friction: tuning.friction, frictionAir: .027, restitution: .12, angle: piece.angle,
      })
      Body.setMass(body, mass * tuning.mass)
      return { key: piece.key, item: piece.item, radius, body }
    })
    this.fingers = [-1, 1].map(side => Array.from({ length: 10 }, (_, index) => {
      const point = sampleJaw(jawPath(this.x, this.y, 1, side), index)
      return Bodies.circle(point.x, point.y, 4.5, { isStatic: true, friction: 0.45 })
    }))
    const wall = (x: number, y: number, width: number, height: number) =>
      Bodies.rectangle(x, y, width, height, { isStatic: true, friction: .7 })
    this.chuteLip = wall(CHUTE + CHUTE_LIP.width / 2, FLOOR - CHUTE_LIP.height / 2,
      CHUTE_LIP.width, CHUTE_LIP.height)
    this.chuteGuard = wall(CHUTE + CHUTE_LIP.width / 2, CHUTE_GUARD.height / 2,
      CHUTE_LIP.width, CHUTE_GUARD.height)
    Composite.add(this.engine.world, [
      this.chuteLip, this.chuteGuard,
      wall(-12, HEIGHT / 2, 24, HEIGHT + 40), wall(WIDTH + 12, HEIGHT / 2, 24, HEIGHT + 40),
      wall(WIDTH / 2, -12, WIDTH + 24, 24), wall(WIDTH / 2, HEIGHT + 12, WIDTH, 24),
      wall((WIDTH + CHUTE) / 2, FLOOR + 22, WIDTH - CHUTE, 44),
      ...this.toys.map(toy => toy.body), ...this.fingers.flat(),
    ])
    const toyBodies = new Set(this.toys.map(toy => toy.body))
    const jawBodies = new Set(this.fingers.flat())
    Events.on(this.engine, 'collisionStart', ({ pairs }) => {
      if (!this.playerActed || this.chuteGuardOpen || this.phase === 'aim') return
      if (!pairs.some(({ bodyA, bodyB }) =>
        (toyBodies.has(bodyA) && jawBodies.has(bodyB)) ||
        (toyBodies.has(bodyB) && jawBodies.has(bodyA)))) return
      this.chuteGuardOpen = true
    })
  }
  drop() {
    if (this.phase !== 'aim') return
    this.playerActed = true
    this.startDrop()
  }
  private startDrop() {
    this.fromX = this.x
    const below = this.toys.filter(toy => Math.abs(toy.body.position.x - this.x) < 37)
    this.targetY = clamp(Math.min(317, ...below.map(toy => toy.body.position.y - 15)), 75, 317)
    this.phase = 'down'
    this.elapsed = 0
  }
  advance(seconds: number) {
    this.lag += clamp(seconds, 0, .1)
    while (this.lag >= STEP && this.phase !== 'done') {
      this.step()
      this.lag -= STEP
    }
  }
  private release() {
    if (!this.grip) return
    Composite.remove(this.engine.world, this.grip.joint)
    this.grip = null
  }
  private closeGrip() {
    const force = this.strong ? this.tuning.strongForce : this.tuning.weakForce
    const hold = this.strong ? this.tuning.strongHold : this.tuning.weakHold
    if (!force || !hold) return
    const candidates = this.toys.filter(({ body }) =>
      Math.abs(body.position.x - this.x) < 21 && body.position.y >= this.y - 4 && body.position.y < this.y + 34 &&
      this.fingers.every(finger => Query.collides(body, finger.slice(3)).length > 0))
    candidates.sort((a, b) => Math.abs(a.body.position.x - this.x) - Math.abs(b.body.position.x - this.x))
    const toy = candidates[0]
    if (!toy) return
    const offset = Math.abs(toy.body.position.x - this.x)
    if (toy.body.mass * (1 + offset / 24) > .82 + force * .95) return
    const joint = Constraint.create({
      bodyB: toy.body, pointA: { ...toy.body.position }, length: 0, stiffness: force * .65, damping: .18,
    })
    Composite.add(this.engine.world, joint)
    this.grip = { toy, joint }
    this.holdTime = 0
  }
  private relax(seconds: number) {
    const hold = this.strong ? this.tuning.strongHold : this.tuning.weakHold
    this.openness = ease(clamp((seconds - hold) / .22, 0, 1))
  }
  private step() {
    this.elapsed += STEP
    const phase = this.phase
    const duration = phase === 'aim' || phase === 'done' ? Infinity : phases[phase]
    const p = clamp(this.elapsed / duration, 0, 1)
    switch (phase) {
      case 'aim':
        if (this.input) this.playerActed = true
        this.x = clamp(this.x + clamp(this.input, -1, 1) * 155 * STEP, 39, WIDTH - 39)
        this.remaining = Math.max(0, this.remaining - STEP)
        if (!this.remaining) this.startDrop()
        break
      case 'down': this.y = mix(RAIL, this.targetY, ease(p)); break
      case 'close': this.openness = 1 - ease(p); break
      case 'up':
        this.y = mix(this.targetY, RAIL, ease(p))
        this.relax(this.elapsed)
        this.x = mix(this.fromX, Math.max(HOME, this.fromX - 26), ease(p))
        break
      case 'travel':
        this.x = mix(Math.max(HOME, this.fromX - 26), HOME, ease(p))
        this.relax(phases.up + this.elapsed)
        break
      case 'open': this.openness = mix(this.openFrom, 1, ease(p)); break
    }
    this.fingers.forEach((finger, side) => {
      const path = jawPath(this.x, this.y, this.openness, side ? 1 : -1)
      finger.forEach((body, index) => {
        const point = sampleJaw(path, index)
        moveBody(body, point, true)
      })
    })
    if (this.grip) {
      this.holdTime += STEP
      const { toy, joint } = this.grip
      const maxTime = this.strong ? this.tuning.strongHold : this.tuning.weakHold
      joint.pointA.x = this.x
      joint.pointA.y = this.y + 14
      if (phase === 'open' || this.holdTime >= maxTime ||
          Math.hypot(toy.body.position.x - joint.pointA.x, toy.body.position.y - joint.pointA.y) > 46) this.release()
    }
    if (phase === 'close' && p === 1) this.closeGrip()
    const wasOpen = this.chuteGuardOpen
    Engine.update(this.engine, 1000 * STEP)
    if (!wasOpen && this.chuteGuardOpen) Composite.remove(this.engine.world, this.chuteGuard)
    for (let index = this.toys.length - 1; index >= 0; index--) {
      const toy = this.toys[index]
      const { x, y } = toy.body.position
      if (!this.chuteGuardOpen || y < FLOOR + 30 || x < 0 || x >= CHUTE) continue
      if (this.grip?.toy === toy) this.release()
      this.captures.push({ key: toy.key, item: toy.item })
      Composite.remove(this.engine.world, toy.body)
      this.toys.splice(index, 1)
    }
    if (p < 1) return
    const sequence: Phase[] = ['down', 'close', 'up', 'travel', 'open', 'settle', 'done']
    this.phase = sequence[sequence.indexOf(phase) + 1]
    if (this.phase === 'open') this.openFrom = this.openness
    this.elapsed = 0
  }
  snapshot(): Piece[] {
    return this.toys.map(({ key, item, body }) => ({
      key, item, x: clamp(body.position.x, 0, WIDTH), y: clamp(body.position.y, 0, HEIGHT), angle: body.angle,
    }))
  }
  collisionBodies() {
    return [this.chuteLip, ...(this.chuteGuardOpen ? [] : [this.chuteGuard]),
      ...this.toys.map(toy => toy.body), ...this.fingers.flat()]
  }
}
