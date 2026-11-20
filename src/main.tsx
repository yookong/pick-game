import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { Plush } from './art.tsx'
import { catalog, items, SERIES, settings, tuningDefaults } from './catalog.ts'
import { ClawMachine } from './claw.ts'
import { feedback, primeAudio } from './feedback.ts'
import { MachineIntro, MachineView, MiniGame } from './machine-view.tsx'
import {
  attendance, begin, buyCoins, exchange, exchangeQuote, finishMini, localDay, miniUsed, newState,
  recover, settle, startMini, type State,
} from './state.ts'
import { decodeSave, openSession, type SaveStore } from './storage.ts'
import './style.css'

declare const __LAB__: boolean
const Lab = __LAB__ ? lazy(() => import('./lab.tsx')) : null
type Page = 'home' | 'claw' | 'collection' | 'exchange' | 'settings' | 'lab'
const tabs = [
  ['home', '⌂', '홈'], ['claw', '♧', '뽑기'], ['collection', '▦', '도감'],
  ['exchange', '⇄', '교환소'], ['settings', '⚙', '설정'],
] as const
type Reward = { item: string; fresh: boolean }
export type Commit = <T>(action: (state: State) => T) => Promise<T | undefined>

function download(data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'little-room-treasures.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function describe(error: unknown) { return error instanceof Error ? error.message : String(error) }

function App() {
  const [store, setStore] = useState<SaveStore>()
  const [state, setState] = useState<State>()
  const [error, setError] = useState('')
  const [page, setPage] = useState<Page>('home')
  const [today, setToday] = useState(localDay)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const [machine, setMachine] = useState<ClawMachine>()
  const [rewards, setRewards] = useState<Reward[] | null>(null)
  const [mini, setMini] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [detail, setDetail] = useState<string | null>(null)
  const [series, setSeries] = useState('all')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [confirm, setConfirm] = useState<'shards' | 'coins' | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void openSession().then(async db => {
      setStore(db)
      setState((await db.update(recover)).state)
    }).catch(cause => setError(describe(cause)))
    const updateDay = () => setToday(localDay())
    const interval = window.setInterval(updateDay, 1000)
    document.addEventListener('visibilitychange', updateDay)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', updateDay) }
  }, [])

  const commit: Commit = async action => {
    if (!store || running.current) return
    running.current = true
    setBusy(true)
    try {
      const result = await store.update(action)
      setState(result.state)
      return result.value
    } catch (cause) { setError(describe(cause)) }
    finally { running.current = false; setBusy(false) }
  }
  async function exportData() {
    try { download((await store?.raw()) ?? null) }
    catch (cause) { setError(describe(cause)) }
  }
  async function replace(data: State) {
    if (!store || running.current) return
    running.current = true
    setBusy(true)
    try {
      await store.replace(data)
      setState(data)
      setMachine(undefined)
      setRewards(null)
      setMini(null)
      setDetail(null)
      setConfirm(null)
      setQuantities({})
      setPage('home')
      setError('')
      setNotice('저장 데이터를 불러왔어요.')
    } catch (cause) { setError(describe(cause)) }
    finally { running.current = false; setBusy(false) }
  }
  async function importData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !window.confirm('현재 진행을 선택한 저장 파일로 교체할까요?')) return
    try { await replace(decodeSave(await file.text())) }
    catch { setNotice('이 파일의 저장 버전 또는 데이터 형식을 확인해 주세요.') }
  }
  const filePicker = <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={importData}/>
  if (error) return <main className="shell recovery">
    <h1>저장을 열 수 없어요</h1>
    <p>다른 탭을 닫고 다시 시도하거나, 백업 파일로 복구해 주세요.</p>
    <details><summary>오류 정보</summary><p>{error}</p></details>
    {notice && <p role="status">{notice}</p>}
    <button onClick={() => location.reload()}>다시 시도</button>
    {store && <>
      <button onClick={exportData}>원본 데이터 내보내기</button>
      <button disabled={busy} onClick={() => fileInput.current?.click()}>백업 가져오기</button>
      <button disabled={busy} onClick={() => {
        if (window.confirm('모든 진행을 지우고 새 게임을 시작할까요?')) void replace(newState())
      }}>새 저장 만들기</button>
    </>}
    {filePicker}
  </main>
  if (!state) return <main className="shell recovery"><p role="status">오락실을 열고 있어요…</p></main>

  function navigate(next: Page) {
    setPage(next)
    setDetail(null)
    setRewards(null)
    setNotice('')
    setConfirm(null)
    setQuantities({})
    window.scrollTo(0, 0)
  }
  async function play() {
    if (state!.preferences.sound) primeAudio()
    const started = await commit(draft => begin(draft, __LAB__) ? {
      pending: draft.pending!, pile: draft.pile, tuning: __LAB__ ? draft.lab.tuning : tuningDefaults,
    } : null)
    if (!started) return
    setMachine(new ClawMachine(started.pile, started.pending.strong, started.tuning))
    setRewards(null)
  }
  async function completePlay() {
    if (!machine || !state?.pending) return
    const id = state.pending.id
    const result = await commit(draft => settle(draft, id, machine.captures, machine.snapshot(), localDay()))
    setMachine(undefined)
    if (result) {
      setRewards(result)
      if (result.length) feedback(state.preferences)
    }
  }
  const locked = !!machine || mini !== null || busy
  const dailyLimit = __LAB__ ? state.lab.tuning.miniLimit : settings.dailyGames
  const attendanceDone = !!state.attendance.day && state.attendance.day >= today
  const progress = Object.keys(state.inventory).length
  const quote = exchangeQuote(state, quantities)
  const selectedItem = detail ? catalog.get(detail) : undefined

  return <div className={machine ? 'shell playing' : 'shell'}>
    <header className="masthead">
      <div className="brand"><span aria-hidden="true">✦</span><div><p>작은 방의</p><strong>보물들</strong></div></div>
      <div className="wallet"><span aria-label={`코인 ${state.coins}`}><i className="coin" aria-hidden="true">C</i>{state.coins}</span>
        <span aria-label={`조각 ${state.shards}`}><i className="shard" aria-hidden="true">◆</i>{state.shards}</span></div>
    </header>
    <main>
      {notice && <p className="notice" role="status">{notice}</p>}
      {page === 'home' && <>
        <section className="hero">
          <div className="hero-copy"><p className="eyebrow">작은 오락실</p><h1>오늘은 어떤<br/>친구를 만날까요?</h1>
            <button className="primary" disabled={locked} onClick={() => navigate('claw')}>뽑기 기계로 <span aria-hidden="true">↗</span></button>
          </div>
          <div className="hero-machine" aria-hidden="true">
            <div className="awning"/><div className="hero-window">
              <span className="spark s1">✦</span><span className="spark s2">✦</span>
              <svg className="hero-jaw" viewBox="0 0 60 70"><path d="M30 0v34m-3 0L14 47l7 12m12-25 13 13-7 12" fill="none" stroke="#593b48" strokeWidth="4" strokeLinecap="round"/></svg>
              {['mochi', 'latte', 'mint'].map(id => <Plush key={id} item={catalog.get(id)!}/>)}
            </div><div className="hero-base"><i/><b/></div>
          </div>
        </section>
        <section className="panel daily">
          <div className="section-heading"><h2>하루 출석</h2><span>{attendanceDone ? '오늘 완료' : '오늘 보상 가능'}</span></div>
          <ol className="attendance">{settings.attendance.map((amount, index) => {
            const cycle = state.attendance.total % 7
            const completed = index < (attendanceDone && cycle === 0 ? 7 : cycle)
            return <li key={index} className={completed ? 'claimed' : index === cycle ? 'next' : ''}><small>{index + 1}일</small><b>{amount}</b></li>
          })}</ol>
          <p>기기 현지 날짜 기준 · 다음 보상 {settings.attendance[state.attendance.total % 7]} 코인</p>
          <button disabled={locked || attendanceDone} onClick={async () => {
            if (state.preferences.sound) primeAudio()
            const amount = await commit(draft => attendance(draft, localDay()))
            if (amount) { setNotice(`${amount} 코인을 받았어요.`); feedback(state.preferences) }
          }}>{attendanceDone ? '출석 완료' : '출석하고 코인 받기'}</button>
        </section>
        <section className="panel">
          <div className="section-heading"><h2>멈춰라, 커서!</h2><span>오늘 {Math.max(0, dailyLimit - miniUsed(state, today))}회 남음</span></div>
          <p>가운데 분홍 구간에 가까울수록 보상이 커져요. {settings.miniRewards.join(' · ')} 코인</p>
          {mini === null ? <button disabled={locked || miniUsed(state, today) >= dailyLimit || (!!state.mini.day && state.mini.day > today)} onClick={async () => {
            if (state.preferences.sound) primeAudio()
            const id = await commit(draft => startMini(draft, localDay(), dailyLimit))
            if (id != null) setMini(id)
          }}>미니게임 시작</button> : <MiniGame busy={busy} onFinish={async score => {
            const amount = await commit(draft => finishMini(draft, mini, score))
            if (amount) { setMini(null); setNotice(`${amount} 코인을 받았어요.`); feedback(state.preferences) }
          }}/>}
        </section>
      </>}
      {page === 'claw' && <>
        {!machine && <h1>집게 뽑기</h1>}
        {machine ? <section className="cabinet"><MachineView machine={machine} debug={__LAB__ && state.lab.debug} onDone={completePlay}/></section> :
          <section className="panel">
            <MachineIntro coins={state.coins} busy={busy || rewards !== null} start={play}/>
            {rewards !== null && <section className="result" aria-label="뽑기 결과">
              <h2>{rewards.length ? '인형을 얻었어요!' : '이번에는 아쉬웠어요'}</h2>
              {rewards.length ? <ul>{rewards.map(({ item, fresh }, index) => <li key={index}><Plush item={catalog.get(item)!}/>{catalog.get(item)!.name}{fresh && <small>신규</small>}</li>)}</ul> :
                <p>움직인 인형은 기계 안에 남아요. 배출구 가까이에 있는 친구를 노려 보세요.</p>}
              <button className="primary" onClick={() => setRewards(null)}>결과 닫기</button>
            </section>}
          </section>}
      </>}
      {page === 'collection' && <>
        <h1>인형 도감</h1>
        <div className="collection-meta"><p>{progress} / {items.length}종 수집</p><progress value={progress} max={items.length} aria-label="수집 진행률"/></div>
        <label className="filter">시리즈 <select value={series} onChange={event => setSeries(event.currentTarget.value)}><option value="all">전체</option><option value={SERIES}>인형 친구들</option></select></label>
        {selectedItem && <section className="panel detail" aria-label="아이템 상세">
          <Plush item={selectedItem} muted={!state.inventory[selectedItem.id]}/>
          <div><h2>{state.inventory[selectedItem.id] ? selectedItem.name : '미획득 인형'}</h2>
            <p>{selectedItem.rarity} · {state.inventory[selectedItem.id]?.count ?? 0}개</p>
            {state.inventory[selectedItem.id] && <><p>{selectedItem.description}</p><p>최초 획득일 {state.inventory[selectedItem.id].first}</p><p>중복 교환 시 조각 {selectedItem.shards}개</p></>}
            <button onClick={() => setDetail(null)}>상세 닫기</button>
          </div>
        </section>}
        <div className="collection-grid">{items.filter(item => series === 'all' || item.seriesId === series).map((item, index) => {
          const entry = state.inventory[item.id]
          return <button className={entry ? 'item-card' : 'item-card missing'} key={item.id} onClick={async () => {
            setDetail(item.id)
            if (entry?.fresh) await commit(draft => { draft.inventory[item.id].fresh = false })
          }}><Plush item={item} muted={!entry}/><strong>{entry ? item.name : `미획득 ${index + 1}`}</strong><small>{entry ? `${entry.count}개` : item.rarity}</small>{entry?.fresh && <b className="new">신규</b>}</button>
        })}</div>
      </>}
      {page === 'exchange' && <>
        <h1>교환소</h1>
        <section className="panel"><h2>중복 인형 → 조각</h2><p>도감에 남길 인형 한 개를 빼고 교환할 수 있어요.</p>
          {items.filter(item => (state.inventory[item.id]?.count ?? 0) > 1).map(item => <label className="trade" key={item.id}>
            <Plush item={item}/><span>{item.name}<small>한 개당 {item.shards} 조각</small></span>
            <select aria-label={`${item.name} 교환 수량`} disabled={locked || confirm !== null} value={quantities[item.id] ?? 0} onChange={event => {
              const amount = Number(event.currentTarget.value)
              setQuantities(previous => {
                const next = { ...previous }
                if (amount) next[item.id] = amount
                else delete next[item.id]
                return next
              })
            }}>{Array.from({ length: Math.min(state.inventory[item.id].count, 1000) }, (_, count) => <option key={count}>{count}</option>)}</select>
          </label>)}
          {!items.some(item => (state.inventory[item.id]?.count ?? 0) > 1) && <p>교환할 중복 인형이 없어요.</p>}
          <button disabled={locked || !quote || confirm !== null} onClick={() => setConfirm('shards')}>교환 확인 · {quote} 조각</button>
        </section>
        <section className="panel"><h2>조각 → 코인</h2><p>{settings.shardsPerExchange} 조각으로 {settings.coinsPerExchange} 코인을 얻어요.</p>
          <button disabled={locked || state.shards < settings.shardsPerExchange || confirm !== null} onClick={() => setConfirm('coins')}>코인 교환 확인</button>
        </section>
        {confirm && <section className="panel result"><h2>이대로 교환할까요?</h2>
          <p>{confirm === 'shards' ? `인형 ${Object.values(quantities).reduce((sum, n) => sum + n, 0)}개 → ${quote} 조각` : `${settings.shardsPerExchange} 조각 → ${settings.coinsPerExchange} 코인`}</p>
          <button className="primary" disabled={locked} onClick={async () => {
            if (running.current) return
            const kind = confirm
            setConfirm(null)
            const done = await commit(draft => kind === 'shards' ? exchange(draft, quantities) : buyCoins(draft))
            if (done) { setQuantities({}); setNotice('교환을 마쳤어요.') }
          }}>교환하기</button>
          <button disabled={locked} onClick={() => setConfirm(null)}>취소</button>
        </section>}
      </>}
      {page === 'settings' && <>
        <h1>설정</h1>
        <section className="panel"><h2>플레이</h2>
          {(['sound', 'vibrate'] as const).map(key => <label className="toggle" key={key}>{key === 'sound' ? '소리' : '진동'}
            <input type="checkbox" checked={state.preferences[key]} disabled={busy} onChange={event => {
              const enabled = event.currentTarget.checked
              if (key === 'sound' && enabled) primeAudio()
              void commit(draft => { draft.preferences[key] = enabled })
            }}/></label>)}
          <p>강한 집게가 나올 때마다 다음 간격을 1~15회에서 균등하게 정해요. 그 간격의 마지막 시도에 강한 집게가 작동해요.</p>
          <p>일반 집게는 기본 0.2초 동안 잡아요. ←/→ 또는 A/D로 움직이고 Space로 내려요.</p>
        </section>
        <section className="panel"><h2>저장 데이터</h2><p>게임 진행은 이 브라우저에 저장돼요.</p>
          <button disabled={busy} onClick={exportData}>내보내기</button>
          <button disabled={busy} onClick={() => fileInput.current?.click()}>가져오기</button>
          {Lab && <button disabled={busy} onClick={() => navigate('lab')}>물리 테스트 도구</button>}
        </section>
      </>}
      {Lab && page === 'lab' && <Suspense fallback={<p>테스트 도구를 여는 중…</p>}><Lab state={state} busy={busy} commit={commit}
        onExport={exportData} onImport={() => fileInput.current?.click()} onReset={() => replace(newState())}/></Suspense>}
    </main>
    {!machine && <nav className="tabs" aria-label="게임 메뉴">{tabs.map(([id, icon, label]) => <button key={id} disabled={locked} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)}><span aria-hidden="true">{icon}</span>{label}</button>)}</nav>}
    {filePicker}
  </div>
}

createRoot(document.getElementById('root')!).render(<App/>)
if (import.meta.env.PROD && !__LAB__ && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('./sw.js').catch(console.warn) })
}
