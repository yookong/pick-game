import { useState } from 'react'
import { items, tuningRanges } from './catalog.ts'
import type { Commit } from './main.tsx'
import { grant, localDay, refill, type State, type Tuning } from './state.ts'

export default function Lab({ state, busy, commit, onExport, onImport, onReset }: {
  state: State; busy: boolean; commit: Commit; onExport: () => void; onImport: () => void; onReset: () => void
}) {
  const [machineNotice, setMachineNotice] = useState('')
  const [selected, setSelected] = useState<string>(items[0].id)
  const [seed, setSeed] = useState('1')
  const validSeed = /^\d+$/.test(seed) && Number(seed) >= 1 && Number(seed) <= 0xffffffff
  const [amount, setAmount] = useState('100')
  const validAmount = /^-?\d+$/.test(amount) && Math.abs(Number(amount)) <= 100000
  const labels: Record<keyof Tuning, string> = {
    weakHold: '일반 유지 시간 (초)', strongHold: '강한 유지 시간 (초)',
    weakForce: '일반 집게 힘', strongForce: '강한 집게 힘', mass: '질량 배율',
    friction: '마찰', miniLimit: '하루 미니게임 한도',
  }
  return <>
    <h1>관리자 테스트 모드</h1>
    <p className="notice">여기서 지급한 재화와 변경한 기계 배치는 이 브라우저의 테스트 게임에만 저장돼요.</p>
    <fieldset className="panel" disabled={busy}>
      <legend>보상과 진행</legend>
      <label>증감량 <input type="number" value={amount} onChange={event => setAmount(event.currentTarget.value)}/></label>
      {(['coins', 'shards'] as const).map(currency => <button key={currency} disabled={!validAmount} onClick={() => void commit(draft => {
        draft[currency] = Math.max(0, draft[currency] + Number(amount))
      })}>{currency === 'coins' ? '코인' : '조각'}에 적용</button>)}
      <button onClick={() => void commit(draft => { draft.attendance = { day: null, total: 0 }; draft.mini = { ...draft.mini, day: null, used: 0, active: null } })}>출석과 미니게임 초기화</button>
      <label>지급할 인형 <select value={selected} onChange={event => setSelected(event.currentTarget.value)}>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button onClick={() => void commit(draft => grant(draft, selected, localDay()))}>인형 1개 지급</button>
      <button onClick={() => void commit(draft => { for (const item of items) if (!draft.inventory[item.id]) grant(draft, item.id, localDay()) })}>도감 전체 해금</button>
    </fieldset>
    <fieldset className="panel" disabled={busy}>
      <legend>집게와 배치</legend>
      <p>누적 {state.attempts}회 · 다음 예약 강한 집게까지 {state.nextStrong}회</p>
      <label>집게 모드 <select value={state.lab.mode} onChange={event => {
        const mode = event.currentTarget.value as State['lab']['mode']
        void commit(draft => { draft.lab.mode = mode })
      }}><option value="auto">자동</option><option value="weak">일반 고정</option><option value="strong">강한 고정</option></select></label>
      <button disabled={state.lab.forceNext} onClick={() => void commit(draft => { draft.lab.forceNext = true })}>{state.lab.forceNext ? '다음 시도 예약됨' : '다음 시도 강한 집게'}</button>
      {Object.entries(tuningRanges).map(([name, [min, max, step]]) => {
        const key = name as keyof Tuning
        return <label className="toggle" key={key}>{labels[key]}<input type="number" min={min} max={max} step={step}
          key={state.lab.tuning[key]} defaultValue={state.lab.tuning[key]} onBlur={event => {
            const input = event.currentTarget
            const value = input.valueAsNumber
            if (!Number.isFinite(value) || value < min || value > max || (key === 'miniLimit' && !Number.isInteger(value))) {
              input.value = String(state.lab.tuning[key]); return
            }
            if (value !== state.lab.tuning[key]) void commit(draft => { draft.lab.tuning[key] = value })
          }}/></label>
      })}
      <label className="toggle">충돌 및 배출 영역 표시<input type="checkbox" checked={state.lab.debug} onChange={event => {
        const debug = event.currentTarget.checked
        void commit(draft => { draft.lab.debug = debug })
      }}/></label>
      <label>난수 시드 <input type="number" min="1" max="4294967295" value={seed} onChange={event => setSeed(event.currentTarget.value)}/></label>
      <button disabled={!validSeed} onClick={() => void commit(draft => { draft.rng = Number(seed); refill(draft) })}>시드 적용 및 재배치</button>
      <button onClick={async () => {
        const done = await commit(draft => { refill(draft); return true })
        if (done) setMachineNotice('기계에 인형을 다시 채웠어요.')
      }}>기계 초기화 · 인형 다시 채우기</button>
      {machineNotice && <p role="status">{machineNotice}</p>}
    </fieldset>
    <fieldset className="panel" disabled={busy}>
      <legend>저장</legend>
      <button onClick={onExport}>내보내기</button><button onClick={onImport}>가져오기</button>
      <button onClick={() => { if (window.confirm('모든 게임 진행을 지울까요?')) onReset() }}>전체 저장 초기화</button>
    </fieldset>
  </>
}
