// 冒烟测试：node smoke.mjs（需先启动 server.mjs）
const B = 'http://127.0.0.1:18080/api/v1/admin'
const A = { Authorization: 'mock-jwt' }
let fails = 0
const ok = (cond, msg) => {
  if (!cond) {
    fails++
    console.log('  FAIL', msg)
  }
}
async function get(p) {
  const r = await fetch(B + p, { headers: A })
  const t = await r.text()
  let j
  try { j = JSON.parse(t) } catch { j = t }
  return { status: r.status, j, t, type: r.headers.get('content-type') }
}
async function post(p, body, form = false) {
  const r = await fetch(B + p, {
    method: 'POST',
    headers: { ...A, 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: form ? body : JSON.stringify(body ?? {}),
  })
  const t = await r.text()
  let j
  try { j = JSON.parse(t) } catch { j = t }
  return { status: r.status, j, t, type: r.headers.get('content-type') }
}
const line = (name, r, extra = '') => console.log(`${String(r.status).padEnd(4)} ${name.padEnd(42)} ${extra}`)

// ---- 列表 ----
for (const [p, min] of [
  ['/user/fetch?current=1&pageSize=20', 20],
  ['/order/fetch?current=1&pageSize=20', 20],
  ['/coupon/fetch?current=1&pageSize=20', 20],
  ['/giftcard/fetch?current=1&pageSize=20', 20],
  ['/ticket/fetch?current=1&pageSize=20', 20],
  ['/system/getSystemLog?current=1&page_size=20', 20],
  ['/stat/getStatUser?user_id=5&current=1&pageSize=10', 10],
]) {
  const r = await get(p)
  line(p, r, `total=${r.j.total} rows=${r.j.data?.length}`)
  ok(r.status === 200 && Array.isArray(r.j.data) && r.j.data.length >= min && r.j.total >= r.j.data.length, p)
}
// page 3 of users
{
  const r = await get('/user/fetch?current=3&pageSize=20')
  line('user/fetch page 3', r, `rows=${r.j.data.length}`)
  ok(r.j.data.length === 12, 'user page3 = 12')
}
// PHP bracket filters
{
  const q = new URLSearchParams()
  q.append('filter[0][key]', 'email'); q.append('filter[0][condition]', '模糊'); q.append('filter[0][value]', 'qq.com')
  q.append('filter[1][key]', 'transfer_enable'); q.append('filter[1][condition]', '>='); q.append('filter[1][value]', '100')
  q.append('current', '1'); q.append('pageSize', '50'); q.append('sort', 'total_used'); q.append('sort_type', 'DESC')
  const r = await get('/user/fetch?' + q)
  line('user/fetch filter email~qq & >=100GB', r, `total=${r.j.total} first=${r.j.data[0]?.email}`)
  ok(r.j.data.every((u) => u.email.includes('qq.com') && u.transfer_enable >= 100 * 1073741824), 'user filter')
  ok(r.j.data.every((u, i, a) => i === 0 || a[i - 1].total_used >= u.total_used), 'user sort total_used desc')
  const bad = await get('/user/fetch?filter[0][key]=x&filter=abc&filter[][]=1&current=abc&pageSize[x]=1')
  line('user/fetch garbage params', bad, `total=${bad.j.total}`)
  ok(bad.status === 200, 'garbage params do not crash')
  const nul = await get('/user/fetch?filter[0][key]=plan_id&filter[0][condition]=%3D&filter[0][value]=null')
  line('user/fetch plan_id = null', nul, `total=${nul.j.total}`)
  ok(nul.j.data.every((u) => u.plan_id === null), 'plan_id null filter')
}
{
  const r = await get('/order/fetch?is_commission=1&pageSize=50')
  line('order/fetch is_commission', r, `total=${r.j.total}`)
  ok(r.j.data.every((o) => o.invite_user_id && o.commission_balance > 0 && ![0, 2].includes(o.status)), 'is_commission')
  const o = (await get('/order/fetch?pageSize=100')).j.data
  const statuses = {}; const types = {}
  for (const x of o) { statuses[x.status] = (statuses[x.status] || 0) + 1; types[x.type] = (types[x.type] || 0) + 1 }
  console.log('     order status', JSON.stringify(statuses), 'types', JSON.stringify(types))
  const withSurplus = o.find((x) => x.surplus_order_ids)
  const withComm = o.find((x) => x.commission_status === 2)
  for (const x of [withSurplus, withComm].filter(Boolean)) {
    const d = await post('/order/detail', { id: x.id })
    line(`order/detail #${x.id}`, d, `plan_name=${d.j.data.plan_name} logs=${d.j.data.commission_log?.length} surplus=${d.j.data.surplus_orders?.length ?? '-'}`)
    ok(d.status === 200 && Array.isArray(d.j.data.commission_log), 'order detail')
  }
}
{
  const r = await get('/ticket/fetch?reply_status[0]=0&status=0&pageSize=20')
  line('ticket/fetch pending', r, `total=${r.j.total}`)
  ok(r.j.data.every((t) => t.status === 0 && t.reply_status === 0), 'ticket filter')
  const d = await get(`/ticket/fetch?id=${r.j.data[0].id}`)
  line('ticket/fetch?id', d, `msgs=${d.j.data.message.length} is_me=${d.j.data.message.map((m) => (m.is_me ? 'A' : 'U')).join('')}`)
  ok(Array.isArray(d.j.data.message) && d.j.data.message.length > 0, 'ticket detail')
}

// ---- 非分页 ----
for (const p of ['/plan/fetch', '/notice/fetch', '/knowledge/fetch', '/knowledge/getCategory', '/payment/fetch', '/payment/getPaymentMethods', '/server/group/fetch', '/server/route/fetch', '/server/manage/getNodes', '/config/getEmailTemplate', '/config/getThemeTemplate', '/system/getQueueWorkload']) {
  const r = await get(p)
  line(p, r, `len=${r.j.data?.length}`)
  ok(r.status === 200 && Array.isArray(r.j.data) && r.j.data.length > 0, p)
}
{
  const nodes = (await get('/server/manage/getNodes')).j.data
  const byType = {}
  for (const n of nodes) byType[n.type] = (byType[n.type] || 0) + 1
  console.log('     nodes by type', JSON.stringify(byType), 'status', JSON.stringify(nodes.map((n) => n.available_status).join('')))
  ok(Object.keys(byType).length === 8, 'all 8 protocols present')
  const k = (await get('/knowledge/fetch?id=4')).j.data
  line('knowledge/fetch?id=4', { status: 200 }, `${k.title} body=${k.body?.length}`)
  ok(k.body && k.language, 'knowledge detail')
  const plans = (await get('/plan/fetch')).j.data
  console.log('     plans', plans.map((p) => `${p.id}:${p.name}(${p.count})`).join(' '))
}

// ---- 对象 ----
{
  const r = await get('/config/fetch')
  line('/config/fetch', r, `groups=${Object.keys(r.j.data).join(',')} fields=${Object.values(r.j.data).reduce((s, g) => s + Object.keys(g).length, 0)}`)
  ok(Object.keys(r.j.data).length === 11, 'config 11 groups')
  const k = await get('/config/fetch?key=ticket')
  line('/config/fetch?key=ticket', k, JSON.stringify(k.j))
  const noauth = await fetch(B + '/config/fetch?key=ticket')
  line('/config/fetch?key=ticket (no auth)', { status: noauth.status })
}
for (const p of ['/stat/getOverride', '/system/getSystemStatus', '/system/getQueueStats', '/theme/getThemes']) {
  const r = await get(p)
  line(p, r, JSON.stringify(r.j.data).slice(0, 150))
  ok(r.status === 200 && r.j.data && typeof r.j.data === 'object', p)
}
{
  const r = await get('/stat/getOrder')
  const types = [...new Set(r.j.data.map((x) => x.type))]
  line('/stat/getOrder', r, `points=${r.j.data.length} types=${types.join('|')} first=${JSON.stringify(r.j.data[0])} last=${JSON.stringify(r.j.data.at(-1))}`)
  ok(r.j.data.length === 155, 'trend 31x5')
  for (const p of ['/stat/getServerTodayRank', '/stat/getServerLastRank', '/stat/getUserTodayRank', '/stat/getUserLastRank']) {
    const x = await get(p)
    line(p, x, `len=${x.j.data.length} top=${JSON.stringify(x.j.data[0])}`)
    ok(x.j.data.length === 15, p)
  }
  const m = await get('/system/getQueueMasters')
  line('/system/getQueueMasters', m, Object.keys(m.j).join(','))
}
{
  const r = await post('/theme/getThemeConfig', { name: 'nebula' })
  line('/theme/getThemeConfig nebula', r, JSON.stringify(r.j.data).slice(0, 120))
  const cfg = Buffer.from(JSON.stringify({ theme_color: 'green', hero_title: '你好，世界' })).toString('base64')
  const s = await post('/theme/saveThemeConfig', { name: 'nebula', config: cfg })
  line('/theme/saveThemeConfig', s, JSON.stringify(s.j.data).slice(0, 120))
  ok(s.j.data.hero_title === '你好，世界', 'theme save utf8')
  const f = await post('/payment/getPaymentForm', { payment: 'EPay', id: 2 })
  line('/payment/getPaymentForm EPay id=2', f, JSON.stringify(f.j.data).slice(0, 160))
  ok(f.j.data.url.value, 'payment form value filled')
  const f2 = await post('/payment/getPaymentForm', 'payment=AlipayF2F', true)
  line('/payment/getPaymentForm (form-urlencoded)', f2, Object.keys(f2.j.data).join(','))
  ok(f2.status === 200, 'form-urlencoded body')
}

// ---- 写操作 & 状态 ----
{
  let r = await post('/plan/save', { name: '测试套餐', group_id: 1, transfer_enable: 50, month_price: 990 })
  const plans = (await get('/plan/fetch')).j.data
  const np = plans.find((p) => p.name === '测试套餐')
  line('plan/save (new)', r, `id=${np?.id}`)
  ok(np, 'plan created')
  r = await post('/plan/update', { id: np.id, show: 1 }); line('plan/update show=1', r)
  r = await post('/plan/sort', { plan_ids: plans.map((p) => p.id).reverse() }); line('plan/sort', r)
  r = await post('/plan/drop', { id: 3 }); line('plan/drop id=3 (has users)', r, r.j.message)
  ok(r.status === 500, 'plan drop guarded')
  r = await post('/plan/drop', { id: np.id }); line('plan/drop new', r)
  ok(r.status === 200, 'plan drop ok')
  r = await post('/plan/drop', { id: 8 }); line('plan/drop id=8 (unused)', r)
  ok(r.status === 200, 'plan 8 deletable')

  r = await post('/notice/save', { title: '新公告', content: '内容', tags: ['测试'] }); line('notice/save', r)
  const notices = (await get('/notice/fetch')).j.data
  ok(notices[0].title === '新公告', 'notice created first')
  r = await post('/notice/show', { id: notices[0].id }); line('notice/show', r)
  r = await post('/notice/drop', { id: notices[0].id }); line('notice/drop', r)
  r = await post('/notice/update', { id: 1 }); line('notice/update (dead route)', r, r.j.message)
  ok(r.status === 500, 'dead route 500')

  r = await post('/coupon/generate', { name: '新券', type: 1, value: 500, started_at: 1790000000, ended_at: 1800000000 }); line('coupon/generate single', r)
  r = await post('/coupon/generate', { name: '批量券', type: 2, value: 10, started_at: 1790000000, ended_at: 1800000000, generate_count: 3, limit_plan_ids: [2, 3] }); line('coupon/generate batch', r, `${r.type} lines=${r.t.trim().split('\n').length}`)
  ok(typeof r.j === 'string' && r.t.startsWith('名称,'), 'coupon csv')
  r = await post('/coupon/show', { id: 1 }); line('coupon/show', r)
  r = await post('/coupon/drop', { id: 1 }); line('coupon/drop', r)
  r = await post('/giftcard/generate', { name: '批量卡', type: 3, value: 10, started_at: 1790000000, ended_at: 1800000000, generate_count: 2 }); line('giftcard/generate batch', r, `lines=${r.t.trim().split('\n').length}`)
  r = await post('/giftcard/generate', { name: '单卡', type: 4, started_at: 1790000000, ended_at: 1800000000 }); line('giftcard/generate single', r)
  r = await post('/giftcard/drop', { id: 1 }); line('giftcard/drop', r)

  r = await post('/knowledge/save', { category: '新手入门', language: 'zh-CN', title: 't', body: 'b' }); line('knowledge/save', r)
  r = await post('/knowledge/show', { id: 1 }); line('knowledge/show', r)
  r = await post('/knowledge/sort', { knowledge_ids: [2, 1, 3] }); line('knowledge/sort', r)
  r = await post('/knowledge/drop', { id: 3 }); line('knowledge/drop', r)

  const users = (await get('/user/fetch?pageSize=100')).j.data
  const u = users.find((x) => x.invite_user_id && x.plan_id)
  const info = await get(`/user/getUserInfoById?id=${u.id}`)
  line('user/getUserInfoById', info, `invite_user=${info.j.data.invite_user?.email}`)
  ok(info.j.data.invite_user, 'invite_user attached')
  r = await post('/user/update', { ...u, email: u.email, remarks: '改过', plan_id: 4, invite_user_email: info.j.data.invite_user.email }); line('user/update', r)
  const after = (await get(`/user/getUserInfoById?id=${u.id}`)).j.data
  ok(after.remarks === '改过' && after.group_id === 3 && after.invite_user_id === u.invite_user_id, 'user update applied')
  r = await post('/user/resetSecret', { id: u.id }); line('user/resetSecret', r)
  r = await post('/user/generate', { email_prefix: 'newbie', email_suffix: 'qq.com', plan_id: 2 }); line('user/generate single', r)
  r = await post('/user/generate', { email_suffix: 'test.com', generate_count: 3 }); line('user/generate batch', r, `lines=${r.t.trim().split('\n').length}`)
  r = await post('/user/dumpCSV', { filter: [{ key: 'email', condition: '模糊', value: 'gmail' }] }); line('user/dumpCSV', r, `${r.type} lines=${r.t.trim().split('\n').length} bom=${r.t.charCodeAt(0) === 0xfeff}`)
  r = await post('/user/sendMail', { filter: [], subject: 's', content: 'c' }); line('user/sendMail', r)
  r = await post('/user/ban', { filter: [{ key: 'email', condition: '=', value: 'newbie@qq.com' }] }); line('user/ban (filtered)', r)
  r = await post('/user/allDel', { filter: [{ key: 'email', condition: '模糊', value: 'test.com' }] }); line('user/allDel (filtered)', r)
  const total = (await get('/user/fetch')).j.total
  ok(total === 53, `user total after gen/del = ${total}`)
  r = await post('/user/delUser', { id: 50 }); line('user/delUser', r)
  r = await post('/user/setInviteUser', {}); line('user/setInviteUser (dead)', r, r.j.message)

  const orders = (await get('/order/fetch?pageSize=100')).j.data
  const pending = orders.find((o) => o.status === 0)
  r = await post('/order/assign', { email: users.find((x) => x.plan_id === 2).email, plan_id: 3, period: 'month_price', total_amount: 0 }); line('order/assign', r, JSON.stringify(r.j))
  if (pending) {
    r = await post('/order/paid', { trade_no: pending.trade_no }); line('order/paid', r)
    r = await post('/order/paid', { trade_no: pending.trade_no }); line('order/paid again', r, r.j.message)
  }
  const pend2 = (await get('/order/fetch?pageSize=100')).j.data.find((o) => o.status === 0)
  if (pend2) { r = await post('/order/cancel', { trade_no: pend2.trade_no }); line('order/cancel', r) }
  r = await post('/order/update', { trade_no: orders[0].trade_no, commission_status: 3 }); line('order/update', r)

  r = await post('/ticket/reply', { id: 24, message: '您好，已处理' }); line('ticket/reply', r)
  r = await post('/ticket/close', { id: 24 }); line('ticket/close', r)

  r = await post('/payment/save', { name: 'x', payment: 'EPay', config: { url: 'u' } }); line('payment/save without notify_domain', r, JSON.stringify(r.j))
  r = await post('/payment/save', { name: '新支付', payment: 'EPay', config: { url: 'u' }, notify_domain: 'https://p.example.com', handling_fee_percent: 1.5 }); line('payment/save', r)
  r = await post('/payment/show', { id: 5 }); line('payment/show', r)
  r = await post('/payment/sort', { ids: [2, 1, 3, 4, 5, 6] }); line('payment/sort', r)
  r = await post('/payment/drop', { id: 6 }); line('payment/drop', r)

  r = await post('/server/group/save', { name: '新组' }); line('server/group/save', r)
  r = await post('/server/group/drop', { id: 1 }); line('server/group/drop used', r, r.j.message)
  r = await post('/server/group/drop', { id: 7 }); line('server/group/drop unused', r)
  r = await post('/server/route/save', { remarks: 'r', match: ['a'], action: 'block' }); line('server/route/save', r)
  r = await post('/server/route/save', { remarks: 'd', action: 'default_out' }); line('server/route/save default_out', r)
  r = await post('/server/route/drop', { id: 1 }); line('server/route/drop', r)
  for (const proto of ['shadowsocks', 'trojan', 'vmess', 'tuic', 'anytls', 'hysteria', 'vless', 'v2node']) {
    const s = await post(`/server/${proto}/save`, { name: `新 ${proto}`, group_id: [1], host: 'x.example', port: '443', server_port: 443, rate: 1 })
    const up = await post(`/server/${proto}/update`, { id: 1, show: 0 })
    const cp = await post(`/server/${proto}/copy`, { id: 1 })
    const ed = await post(`/server/${proto}/save`, { id: 1, name: `改 ${proto}`, group_id: [1, 2], host: 'y.example', port: '443', server_port: 443, rate: '1.5' })
    const dr = await post(`/server/${proto}/drop`, { id: 2 })
    line(`server/${proto}/save|update|copy|save(id)|drop`, s, [s, up, cp, ed, dr].map((x) => x.status).join(','))
    ok([s, up, cp, ed, dr].every((x) => x.status === 200), proto)
  }
  r = await post('/server/manage/sort', { vless: { 1: 5, 3: 1 }, trojan: { 1: 2 } }); line('server/manage/sort', r)
  r = await post('/config/save', { app_name: '新名字', try_out_enable: 0 }); line('config/save', r)
  ok((await get('/config/fetch?key=site')).j.data.site.app_name === '新名字', 'config saved')
  r = await post('/config/testSendMail'); line('config/testSendMail', r, JSON.stringify(r.j))
  r = await post('/config/setTelegramWebhook', { telegram_bot_token: 'x' }); line('config/setTelegramWebhook', r)

  for (const p of ['/stat/getStat', '/stat/getRanking', '/stat/getStatRecord']) {
    const x = await get(p); line(p + ' (dead)', x, x.j.message)
  }
  const unk = await get('/foo/fetch'); line('unknown /foo/fetch', unk, JSON.stringify(unk.j))
  const unk2 = await post('/foo/bar', {}); line('unknown /foo/bar', unk2, JSON.stringify(unk2.j))
  const reset = await fetch('http://127.0.0.1:18080/__mock/reset'); line('/__mock/reset', { status: reset.status })
  ok((await get('/user/fetch')).j.total === 52, 'reset restores users')
}
console.log(fails ? `\n${fails} FAILURES` : '\nALL OK')
