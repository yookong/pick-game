import { newState, recover, stateSchema, type State } from './state.ts'

export interface SaveStore {
  update<T>(action: (draft: State) => T): Promise<{ state: State; value: T }>
  raw(): Promise<unknown>
  replace(state: State): Promise<void>
}
export function openStore(name: string): Promise<SaveStore> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('progress')
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('다른 창에서 데이터베이스를 사용 중입니다.'))
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      function transaction<T>(mode: IDBTransactionMode, run: (raw: unknown, store: IDBObjectStore) => T) {
        return new Promise<T>((done, fail) => {
          const tx = db.transaction('progress', mode)
          const store = tx.objectStore('progress')
          const read = store.get('save')
          let result: T
          let error: unknown
          read.onsuccess = () => {
            try { result = run(read.result, store) }
            catch (cause) { error = cause; tx.abort() }
          }
          tx.oncomplete = () => done(result)
          tx.onabort = () => fail(error ?? tx.error ?? new Error('저장이 중단되었습니다.'))
        })
      }
      resolve({
        raw: () => transaction('readonly', raw => raw),
        replace: state => transaction('readwrite', (_, store) => { store.put(stateSchema.parse(state), 'save') }),
        update: action => transaction('readwrite', (raw, store) => {
          const state = raw === undefined ? newState() : stateSchema.parse(raw)
          const value = action(state)
          store.put(stateSchema.parse(state), 'save')
          return { state, value }
        }),
      })
    }
  })
}

export async function openSession(lab: boolean) {
  const name = lab ? 'little-room-treasures-lab' : 'little-room-treasures'
  const lockName = lab ? 'little-room-lab-save-session' : 'little-room-save-session'
  // Hold a per-origin exclusive lease for the lifetime of this page.
  if (navigator.locks) {
    await new Promise<void>((resolve, reject) => {
      void navigator.locks.request(lockName, { ifAvailable: true }, lock => {
        if (!lock) throw new Error('다른 탭에서 게임이 열려 있습니다. 해당 탭을 닫고 다시 시도해 주세요.')
        resolve()
        return new Promise<void>(() => {})
      }).catch(reject)
    })
  }
  return openStore(name)
}

export function decodeSave(text: string) {
  const state = stateSchema.parse(JSON.parse(text))
  recover(state)
  return state
}
