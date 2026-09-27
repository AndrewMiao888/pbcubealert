// Run after npm run build: node tests/inventory.integration.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

let stockRequests = 0
const upstream = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json')
  if (req.url.startsWith('/products/blocked.js')) { res.statusCode = 429; res.end('{}'); return }
  stockRequests++
  res.end(JSON.stringify({ handle: 'sample-cube', variants: [{ title: 'Blue', available: true, inventory_quantity: 3, inventory_management: 'shopify', price: 1499 }] }))
})
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
process.env.NUXT_STORE_URL = `http://127.0.0.1:${upstream.address().port}`
process.env.PORT = '3188'
process.env.HOST = '127.0.0.1'
await import('../.output/server/index.mjs')
const request = handles => fetch('http://127.0.0.1:3188/api/inventory', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handles })
})
try {
  const home = await fetch('http://127.0.0.1:3188')
  assert.equal(home.status, 200)
  assert.match(await home.text(), /All 3x3 cubes/)
  assert.equal((await request(['../../invalid'])).status, 400)
  const first = await (await request(['sample-cube'])).json()
  assert.equal(first.results[0].detail.variants[0].inventory_quantity, 3)
  assert.equal(first.results[0].detail.variants[0].price, undefined)
  const cached = await (await request(['sample-cube'])).json()
  assert.equal(cached.results[0].checkedAt, first.results[0].checkedAt)
  assert.equal(stockRequests, 1)
  const throttled = await (await request(['blocked'])).json()
  assert.equal(throttled.coolingDown, true)
  assert.equal(throttled.results[0].detail, null)
  const afterThrottle = await (await request(['sample-cube', 'another-cube'])).json()
  assert.equal(afterThrottle.results[0].detail.variants[0].inventory_quantity, 3)
  assert.equal(afterThrottle.results[1].detail, null)
  assert.equal(stockRequests, 1)
  console.log('PASS: homepage, inventory, price isolation, caching, validation, and throttle cooldown')
  upstream.close()
  process.exit(0)
} catch (error) { console.error(error); upstream.close(); process.exit(1) }
