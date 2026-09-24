// 生成 README 用的页面截图（docs/screenshots/*.webp）。
//
// 前提：mock 后端（npm run mock）+ 一个能访问后台的地址。推荐用生产构建：
//   npm run build，再把 dist/ 按 README「部署」一节挂起来；或者直接用 dev server。
// 用法：
//   node gallery.mjs [outDir]            # 默认输出到仓库的 docs/screenshots
//   BASE=http://127.0.0.1:5173/admin/v2 node gallery.mjs
// 每张图都是桌面端 1440×900 视口，webp 格式控制仓库体积。
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(process.argv[2] || path.join(here, '../../docs/screenshots'))
const BASE = process.env.BASE || 'http://127.0.0.1:5173/admin/v2'
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 点击第一个文字包含 text 的按钮 / 链接 / tab（可限定在 scope 选择器内、第 nth 个） */
async function clickText(page, text, { scope = 'body', nth = 0, selector } = {}) {
  const ok = await page.evaluate(
    (text, scope, nth, selector) => {
      const root = document.querySelector(scope) || document.body
      const sel = selector || 'button, a, [role="tab"], [role="menuitem"], .ant-segmented-item, .ant-tabs-tab'
      const els = [...root.querySelectorAll(sel)].filter(
        (e) => e.textContent && e.textContent.trim().includes(text) && e.offsetParent !== null,
      )
      const el = els[nth]
      if (!el) return false
      el.scrollIntoView({ block: 'center' })
      el.click()
      return true
    },
    text,
    scope,
    nth,
    selector,
  )
  if (!ok) throw new Error(`找不到可点击的「${text}」`)
  await sleep(1500)
}

const SHOTS = [
  { name: 'login', route: '/login', login: false },
  { name: 'dashboard', route: '/' },
  { name: 'dashboard-dark', route: '/', dark: true },
  { name: 'users', route: '/user' },
  { name: 'user-edit', route: '/user', act: (p) => clickText(p, '编辑', { scope: '.ant-table-tbody' }) },
  { name: 'user-bulk', route: '/user', act: async (p) => { await clickText(p, '批量操作'); await clickText(p, '批量封禁', { selector: '[role="menuitem"]' }) } },
  { name: 'orders', route: '/order' },
  { name: 'order-detail', route: '/order', act: (p) => clickText(p, '详情', { scope: '.ant-table-tbody', nth: 2 }) },
  { name: 'plans', route: '/plan' },
  { name: 'plan-edit', route: '/plan', act: (p) => clickText(p, '编辑', { scope: '.ant-table-tbody', nth: 2 }) },
  { name: 'coupons', route: '/coupon' },
  { name: 'coupon-edit-dark', route: '/coupon', dark: true, act: (p) => clickText(p, '编辑', { scope: '.ant-table-tbody', nth: 1 }) },
  { name: 'giftcards', route: '/giftcard' },
  { name: 'notices', route: '/notice' },
  { name: 'knowledge-edit', route: '/knowledge', act: (p) => clickText(p, '编辑', { scope: '.ant-table-tbody' }) },
  { name: 'servers', route: '/server' },
  { name: 'server-edit', route: '/server', act: (p) => clickText(p, '编辑', { scope: '.ant-table-tbody' }) },
  { name: 'server-routes', route: '/server', act: (p) => clickText(p, '路由规则') },
  { name: 'tickets', route: '/ticket' },
  { name: 'ticket-chat', route: '/ticket', act: (p) => clickText(p, '查看', { scope: '.ant-table-tbody' }) },
  { name: 'config', route: '/config' },
  { name: 'config-dark', route: '/config', dark: true, act: (p) => clickText(p, '邀请与佣金') },
  { name: 'payments', route: '/payment' },
  { name: 'themes', route: '/theme' },
  { name: 'system-dark', route: '/system', dark: true },
]

const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--lang=zh-CN'] })
let failed = 0
try {
  for (const s of SHOTS) {
    if (only && !only.has(s.name)) continue
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await page.evaluateOnNewDocument((login, dark) => {
      try {
        if (login) localStorage.setItem('v2board_admin_v2_auth', JSON.stringify({ authData: 'mock-jwt', isAdmin: true }))
        localStorage.setItem('v2board_admin_v2_theme', dark ? 'dark' : 'light')
        localStorage.setItem('v2board_admin_v2_sider_collapsed', '0')
      } catch {}
    }, s.login !== false, !!s.dark)
    try {
      await page.goto(BASE + s.route, { waitUntil: 'networkidle2', timeout: 180000 })
      await sleep(1500)
      if (s.act) await s.act(page)
      // 等动画和字体
      await page.evaluate(() => document.fonts.ready)
      await sleep(800)
      const file = path.join(OUT, `${s.name}.webp`)
      await page.screenshot({ path: file, type: 'webp', quality: 86 })
      console.log('ok  ', s.name, `${Math.round(fs.statSync(file).size / 1024)} KB`)
    } catch (e) {
      failed++
      console.log('FAIL', s.name, String(e.message || e))
    }
    await page.close()
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
