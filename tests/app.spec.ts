import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { test, expect } from '@playwright/test'
import { newState } from '../src/state.ts'

test('production loads offline, settles a touch-driven catch and saves the collection', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '오늘은 어떤 친구를 만날까요?' })).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  // Use a known pile so a deliberate leftward move aligns with a toy perched near the chute.
  const state = newState(1)
  state.pile = [{ key: 'a', item: 'mochi', x: 96, y: 318, angle: 0 },
    ...[192, 244, 300].map((x, i) => ({ key: String(i), item: 'latte', x, y: 318, angle: 0 }))]
  state.nextStrong = 1
  await page.evaluate(state => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('little-room-treasures', 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const tx = open.result.transaction('progress', 'readwrite')
      tx.objectStore('progress').put(state, 'save')
      tx.oncomplete = () => { open.result.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
  }), state)
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('button', { name: '뽑기 기계로' }).tap()
  await page.getByRole('button', { name: /뽑기 시작/ }).tap()
  await expect(page.getByLabel('코인 110', { exact: true })).toBeVisible()
  const joystick = page.getByRole('group', { name: '좌우 조이스틱' })
  const box = (await joystick.boundingBox())!
  const cdp = await context.newCDPSession(page)
  const initial = await page.getByTestId('jaw').getAttribute('points')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 12, y: box.y + box.height / 2 }] })
  try {
    await expect.poll(async () => {
      const points = (await page.getByTestId('jaw').getAttribute('points'))!
      return Number(points.split(',')[0])
    }, { intervals: [16], timeout: 1600 }).toBeLessThanOrEqual(90)
  } finally {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  await expect(page.getByTestId('jaw')).not.toHaveAttribute('points', initial!)
  await page.getByRole('button', { name: '↓ 하강' }).tap()
  await expect(page.getByRole('heading', { name: '인형을 얻었어요!' })).toBeVisible({ timeout: 9000 })
  await expect(page.getByLabel('뽑기 결과')).toContainText('모찌 토끼')
  await page.getByRole('button', { name: '결과 닫기' }).tap()
  await page.getByRole('button', { name: '도감' }).tap()
  await expect(page.getByRole('button', { name: /모찌 토끼.*1개.*신규/ })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '도감' }).tap()
  await page.getByRole('button', { name: /모찌 토끼/ }).tap()
  await expect(page.getByLabel('아이템 상세')).toContainText('최초 획득일')
  await page.getByRole('button', { name: '설정' }).tap()
  await expect(page.getByRole('button', { name: '물리 테스트 도구' })).toHaveCount(0)
})

test('reload refunds just once, attendance and three mini games pay exactly once', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '뽑기 기계로' }).tap()
  await page.getByRole('button', { name: /뽑기 시작/ }).tap()
  await expect(page.getByLabel('코인 110', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('코인 120', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('코인 120', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '출석하고 코인 받기' }).tap()
  await expect(page.getByLabel('코인 135', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '출석 완료' })).toBeDisabled()
  for (let round = 0; round < 3; round++) {
    await page.getByRole('button', { name: '미니게임 시작' }).tap()
    await page.getByRole('button', { name: '멈추기' }).tap()
  }
  await expect(page.getByRole('button', { name: '미니게임 시작' })).toBeDisabled()
  await page.reload()
  await expect(page.getByText('오늘 0회 남음')).toBeVisible()
})

test('development lab grants duplicates and selected duplicates can be exchanged', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174')
  await page.getByRole('button', { name: '설정' }).tap()
  await page.getByRole('button', { name: '물리 테스트 도구' }).tap()
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: '인형 1개 지급' }).tap()
  }
  await page.getByRole('button', { name: '교환소', exact: true }).tap()
  await page.getByLabel('모찌 토끼 교환 수량').selectOption('4')
  await page.getByRole('button', { name: '교환 확인 · 8 조각' }).tap()
  await expect(page.getByText('인형 4개 → 8 조각')).toBeVisible()
  await page.getByRole('button', { name: '교환하기' }).tap()
  await expect(page.getByLabel('조각 8', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '코인 교환 확인' }).tap()
  await page.getByRole('button', { name: '교환하기' }).tap()
  await expect(page.getByLabel('코인 130', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '도감' }).tap()
  await expect(page.getByRole('button', { name: /모찌 토끼.*1개/ })).toBeVisible()
})

test('offline shell uses its own build even if the host serves stale index.html', async ({ page, context }) => {
  const base = '/pick-game/'
  const directory = resolve('dist')
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  }
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (!path.startsWith(base)) { response.writeHead(404).end(); return }
    const location = path.slice(base.length)
    if (location === 'index.html') {
      response.writeHead(200, { 'Content-Type': types['.html'] }).end('<h1>Stale host response</h1>')
      return
    }
    try {
      const file = resolve(directory, location || 'index.html')
      const contents = await readFile(file)
      response.writeHead(200, { 'Content-Type': types[extname(file)] }).end(contents)
    } catch { response.writeHead(404).end() }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + base
    await page.goto(url)
    await page.getByRole('button', { name: '뽑기 기계로' }).waitFor()
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('button', { name: '뽑기 기계로' })).toBeVisible()
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
