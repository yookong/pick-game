import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Plush } from './art.tsx'
import { catalog, settings } from './catalog.ts'
import { CHUTE, CHUTE_GUARD, CHUTE_LIP, ClawMachine, FLOOR, HEIGHT, WIDTH, jawPath } from './claw.ts'

const labels = { aim: '위치를 맞춰 주세요', down: '내려가는 중', close: '집는 중', up: '올라가는 중', travel: '배출구로 이동 중', open: '집게 열림', settle: '배출 확인 중', done: '결과 저장 중' }

export function MachineView({ machine, debug, onDone }: {
  machine: ClawMachine; debug: boolean; onDone: () => void
}) {
  const [, render] = useState(0)
  const done = useRef(onDone)
  done.current = onDone
  const [axis, setAxis] = useState(0)
  const pointer = useRef<number | null>(null)
  useEffect(() => {
    const keys = new Set<string>()
    let previous = 0
    let frame = 0
    const tick = (now: number) => {
      if (document.hidden) { frame = requestAnimationFrame(tick); return }
      if (previous) machine.advance((now - previous) / 1000)
      previous = now
      render(value => value + 1)
      if (machine.phase === 'done') done.current()
      else frame = requestAnimationFrame(tick)
    }
    const key = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const code = event.code
      if (!['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Space'].includes(code)) return
      if (code === 'Space' && event.target instanceof HTMLElement && event.target.tagName === 'BUTTON') return
      event.preventDefault()
      if (code === 'Space') { if (!event.repeat && event.type === 'keydown') machine.drop(); return }
      if (event.type === 'keydown') keys.add(code)
      else keys.delete(code)
      machine.input = Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'))
      setAxis(machine.input)
    }
    const reset = () => {
      keys.clear()
      pointer.current = null
      machine.input = 0
      setAxis(0)
      previous = 0
    }
    frame = requestAnimationFrame(tick)
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', key)
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', reset)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', key)
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', reset)
    }
  }, [machine])

  function joystick(event: PointerEvent<HTMLDivElement>) {
    if (event.type === 'pointerdown') {
      if (pointer.current !== null || machine.phase !== 'aim') return
      pointer.current = event.pointerId
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    if (pointer.current !== event.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect()
    const value = (event.clientX - rect.left - rect.width / 2) / (rect.width * .33)
    machine.input = Math.abs(value) < .12 ? 0 : Math.max(-1, Math.min(1, value))
    setAxis(machine.input)
  }
  function stopJoystick(event: PointerEvent) {
    if (pointer.current !== event.pointerId) return
    pointer.current = null
    machine.input = 0
    setAxis(0)
  }
  return <>
    <div className="machine-status"><span>{machine.strong ? '강한 집게' : '일반 집게'} · {labels[machine.phase]}</span><strong data-testid="timer">{Math.ceil(machine.remaining)}초</strong></div>
    <div className="grip-status">잡는 시간 최대 <strong data-testid="grip-duration">{machine.gripSeconds}초</strong></div>
    <svg className="chamber" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-label="집게 기계">
      <defs>
        <linearGradient id="glass" x2="0" y2="1"><stop stopColor="#f7dbbb"/><stop offset="1" stopColor="#fff4df"/></linearGradient>
        <pattern id="tiles" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M0 0H30M0 0V30" stroke="#643e32" strokeOpacity=".09"/></pattern>
      </defs>
      <rect width={WIDTH} height={HEIGHT} fill="url(#glass)"/>
      <rect width={WIDTH} height={FLOOR} fill="url(#tiles)"/>
      <rect x="0" y="15" width={WIDTH} height="9" fill="#945b50"/>
      <rect x="0" y={FLOOR + 30} width={CHUTE} height={HEIGHT - FLOOR - 30} fill="#4b3439"/>
      <rect x={CHUTE} y={FLOOR} width={WIDTH - CHUTE} height={HEIGHT - FLOOR} fill="#d38172"/>
      <path d={`M${CHUTE} ${FLOOR}H${WIDTH}`} stroke="#734947" strokeWidth="4"/>
      <text x="36" y="394" textAnchor="middle" fill="#fff3dd" fontSize="13" fontWeight="bold">배출구</text>
      <path d={`M${machine.x} 24V${machine.y - 20}`} stroke="#543a42" strokeWidth="3"/>
      {machine.toys.map(({ key, item, body, radius }) => <g key={key} transform={`translate(${body.position.x} ${body.position.y}) rotate(${body.angle * 180 / Math.PI})`}>
        <svg x={-radius * 1.28} y={-radius * 1.42} width={radius * 2.56} height={radius * 2.56}><Plush item={catalog.get(item)!}/></svg>
      </g>)}
      {[-1, 1].map(side => <polyline key={side} data-testid={side === -1 ? 'jaw' : undefined} points={jawPath(machine.x, machine.y, machine.openness, side).map(point => point.join(',')).join(' ')} fill="none" stroke="#604251" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/>)}
      <rect x={machine.x - 11} y={machine.y - 26} width="22" height="11" rx="4" fill="#e69b82" stroke="#604251" strokeWidth="2"/>
      <g aria-hidden="true">
        {!machine.chuteOpen && <rect data-testid="chute-guard" x={CHUTE + 1} y={CHUTE_GUARD.top} width={CHUTE_LIP.width - 2}
          height={CHUTE_GUARD.height} fill="#d8f0e9" fillOpacity=".72" stroke="#53827b" strokeWidth="1.5"/>}
        <rect x={CHUTE} y={FLOOR - CHUTE_LIP.height} width={CHUTE_LIP.width} height={CHUTE_LIP.height} fill="#734947"/>
        <path d={`M${CHUTE + 3} ${FLOOR - CHUTE_LIP.height + 3}h${CHUTE_LIP.width - 6}v${CHUTE_LIP.height - 6}h-${CHUTE_LIP.width - 6}z`} fill="#efc388"/>
      </g>
      {debug && <g fill="none" stroke="#0a7965" strokeWidth="1">
        <rect x="0" y={FLOOR + 30} width={CHUTE} height={HEIGHT - FLOOR - 30} fill="#0d9d5e40"/>
        {machine.collisionBodies().map(body => <polygon key={body.id} points={body.vertices.map(v => `${v.x},${v.y}`).join(' ')}/>)}
      </g>}
    </svg>
    <div className="controls">
      <div className="joystick" role="group" aria-label="좌우 조이스틱" onPointerDown={joystick} onPointerMove={joystick}
        onPointerUp={stopJoystick} onPointerCancel={stopJoystick} onLostPointerCapture={stopJoystick}>
        <span>◀</span><i style={{ transform: `translateX(${axis * 23}px)` }}/><span>▶</span>
      </div>
      <button className="primary drop" disabled={machine.phase !== 'aim'} onClick={() => machine.drop()}>↓ 하강</button>
    </div>
  </>
}

export function MiniGame({ onFinish, busy }: { onFinish: (accuracy: number) => void; busy: boolean }) {
  const time = useRef({ elapsed: 0, previous: 0, position: 0 })
  const [position, setPosition] = useState(0)
  useEffect(() => {
    let frame = 0
    const reset = () => { time.current.previous = 0 }
    const tick = (now: number) => {
      if (document.hidden) { frame = requestAnimationFrame(tick); return }
      const timer = time.current
      if (timer.previous) timer.elapsed += Math.min(50, now - timer.previous)
      timer.previous = now
      const cycle = timer.elapsed % 1900 / 950
      timer.position = cycle <= 1 ? cycle : 2 - cycle
      setPosition(timer.position)
      frame = requestAnimationFrame(tick)
    }
    document.addEventListener('visibilitychange', reset)
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', reset)
    }
  }, [])
  return <>
    <div className="timing-track" aria-hidden="true"><i style={{ left: `${position * 100}%` }}/></div>
    <button className="primary" disabled={busy} onClick={() => onFinish(Math.abs(time.current.position - .62))}>멈추기</button>
  </>
}

export function MachineIntro({ coins, busy, start }: { coins: number; busy: boolean; start: () => void }) {
  return <div className="machine-intro">
    <div className="showcase">{['mochi', 'latte', 'mint'].map(id => <Plush key={id} item={catalog.get(id)!}/>)}</div>
    <h2>인형 친구들</h2>
    <p>조이스틱으로 위치를 맞춘 뒤 집게를 내려요. 왼쪽 배출구에 떨어진 인형을 가져갈 수 있어요.</p>
    <button className="primary" disabled={busy || coins < settings.cost} onClick={start}>뽑기 시작 · {settings.cost} 코인</button>
    {coins < settings.cost && <p>코인이 부족해요. 출석 또는 미니게임으로 모아 보세요.</p>}
  </div>
}
