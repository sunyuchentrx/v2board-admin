// node probe.mjs <route> <jsExpressionFile>  — evaluates JS in page (logged in), prints result
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [route, file] = process.argv.slice(2)
const W = Number(process.env.W || 1440), H = Number(process.env.H || 900)
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: W, height: H })
await page.evaluateOnNewDocument((theme) => { localStorage.setItem('v2board_admin_v2_auth', JSON.stringify({ authData: 'mock-jwt', isAdmin: true })); if (theme) localStorage.setItem('v2board_admin_v2_theme', theme) }, process.env.THEME || '')
await page.goto('http://localhost:5173/admin/v2' + route, { waitUntil: 'networkidle2', timeout: 180000 })
await new Promise(r => setTimeout(r, 800))
const code = fs.readFileSync(file, 'utf8')
console.log(await page.evaluate(code))
await browser.close()
