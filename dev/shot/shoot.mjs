// Screenshot harness for v2board-admin.
// Usage:
//   node shoot.mjs <outDir> <route1> [route2 ...]
//   route may be "path" or "path|clickText" (clicks the first button/link whose text contains clickText, then waits)
//   env: BASE (default http://localhost:5173/admin/v2), W (1440), H (900), THEME (light|dark), FULL (1 = fullPage)
// Session is injected into localStorage before any page script runs, so no login is needed.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const [outDir, ...routes] = process.argv.slice(2)
if (!outDir || routes.length === 0) {
  console.error('usage: node shoot.mjs <outDir> <route...>')
  process.exit(1)
}
const BASE = process.env.BASE || 'http://localhost:5173/admin/v2'
const W = Number(process.env.W || 1440)
const H = Number(process.env.H || 900)
const FULL = process.env.FULL === '1'
fs.mkdirSync(outDir, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
})
try {
  for (const spec of routes) {
    const [route, clickText] = spec.split('|')
    const page = await browser.newPage()
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
    if (process.env.THEME) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: process.env.THEME }])
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    if (route !== '/login') {
      await page.evaluateOnNewDocument((theme) => {
        localStorage.setItem('v2board_admin_v2_auth', JSON.stringify({ authData: 'mock-jwt', isAdmin: true }))
        if (theme) localStorage.setItem('v2board_admin_v2_theme', theme)
      }, process.env.THEME || '')
    }
    await page.goto(BASE + (route === '/' ? '/' : route), { waitUntil: 'networkidle2', timeout: 180000 })
    await new Promise((r) => setTimeout(r, 800))
    if (clickText) {
      const clicked = await page.evaluate((t) => {
        const els = [...document.querySelectorAll('button, a, [role="tab"], .ant-dropdown-trigger, [role="menuitem"]')]
        const el = els.find((e) => e.textContent && e.textContent.includes(t))
        if (el) { el.click(); return true }
        return false
      }, clickText)
      if (!clicked) errors.push(`click target not found: ${clickText}`)
      await new Promise((r) => setTimeout(r, 1200))
    }
    const name = (spec.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, '_').replace(/^_|_$/g, '') || 'root') + (process.env.THEME ? `-${process.env.THEME}` : '') + (W < 768 ? `-m${W}` : '')
    const file = path.join(outDir, `${name}.png`)
    await page.screenshot({ path: file, fullPage: FULL })
    console.log(`${file}${errors.length ? '  ERRORS: ' + errors.join(' | ').slice(0, 800) : ''}`)
    await page.close()
  }
} finally {
  await browser.close()
}
