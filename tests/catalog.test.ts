import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyInventory, loadCatalog, normalizeProduct, normalizeSearch, type RawProduct } from '../shared/catalog.ts'
import { filterTitle, matchesStock, selectView } from '../shared/filters.ts'

const product: RawProduct = { id: 1, handle: 'example', title: 'Example 3×3 V42', vendor: 'New Brand', variants: [{ price: '12.50', available: true }] }
const normalize = (overrides: Partial<RawProduct> = {}) => normalizeProduct({ ...product, ...overrides }, 'https://example.com', 5)!
test('new products, brands, editions and prices come from the feed', () => {
  const p = normalize()
  assert.equal(p.brand, 'New Brand')
  assert.equal(p.edition, 'V42')
  assert.equal(p.price, 12.5)
  assert.equal(p.stock, 'in')
  assert.equal(p.quantity, null)
  assert.equal(normalize({ title: 'Example 4x4' }), null)
})
test('missing price is not free, and valid zero prices are retained', () => {
  assert.equal(normalize({ variants: [{ price: null }] }).price, null)
  assert.equal(normalize({ variants: [{ price: 'bad' }, { price: '' }] }).price, null)
  assert.equal(normalize({ variants: [{ price: '0' }, { price: '5' }] }).price, 0)
})
test('partial inventory cannot produce an exact or low stock count', () => {
  const p = normalize({ variants: [{ available: true, inventory_quantity: 2 }, { available: true }] })
  assert.equal(p.quantity, null)
  assert.equal(p.stock, 'in')
  assert.equal(normalize({ variants: [{ available: true, inventory_quantity: 4 }] }).stock, 'low')
  assert.equal(normalize({ variants: [{ available: true, inventory_quantity: 5 }] }).stock, 'in')
})
test('availability handles sold-out, preorder and unknown variants', () => {
  assert.equal(normalize({ variants: [{ available: false, inventory_quantity: 9 }] }).stock, 'out')
  assert.equal(normalize({ variants: [{ available: true, inventory_quantity: 0 }] }).stock, 'in')
  assert.equal(normalize({ variants: [{ available: false }, {}] }).stock, 'unknown')
  assert.equal(normalize({ variants: [] }).stock, 'unknown')
})
test('pagination reads through the empty page and deduplicates', async () => {
  const result = await loadCatalog(async page => ({ products: page === 1 ? [product] : page === 2 ? [product, { ...product, id: 2, handle: 'new' }] : [] }), 'https://example.com', 5, 4)
  assert.equal(result.length, 2)
})
test('failed, malformed and repeated pages never return a partial catalog', async () => {
  await assert.rejects(loadCatalog(async page => { if (page === 2) throw new Error('offline'); return { products: [product] } }, 'https://example.com', 5, 4))
  await assert.rejects(loadCatalog(async () => ({ products: [product] }), 'https://example.com', 5, 4), /repeated/)
  await assert.rejects(loadCatalog(async () => ({} as { products: RawProduct[] }), 'https://example.com', 5, 4), /Invalid/)
  await assert.rejects(loadCatalog(async () => ({ products: [product] }), 'https://example.com', 5, 1), /limit/)
})
test('search treats ball-core and ballcore, 3x3 and 3×3 equally', () => {
  assert.equal(normalizeSearch('Ball-Core 3×3'), normalizeSearch('ballcore 3x3'))
})

test('product detail inventory enriches counts without replacing AUD decimal prices with cents', () => {
  const cube = applyInventory(normalize(), { ...product, variants: [{ title: 'Blue', price: 1250, available: true, inventory_quantity: 2, inventory_management: 'shopify' }, { title: 'Red', available: false, inventory_quantity: 0 }] }, 5)
  assert.equal(cube.price, 12.5)
  assert.equal(cube.quantity, 2)
  assert.equal(cube.stock, 'low')
  assert.equal(cube.variantStock?.[0]?.quantity, 2)
  assert.ok(cube.stockCheckedAt)
  const untracked = applyInventory(normalize(), { ...product, variants: [{ available: true, inventory_quantity: 0, inventory_management: null }] }, 5)
  assert.equal(untracked.quantity, null)
  assert.equal(untracked.stock, 'in')
})
test('favorites always opens all brands with previous filters cleared', () => {
  assert.deepEqual(selectView('MoYu', true), { favoritesOnly: true, brand: '', stock: '', edition: '', query: '' })
  assert.equal(selectView('GAN').favoritesOnly, false)
})
test('headings describe brand, stock, version and search; low stock excludes sold out and unknown quantities', () => {
  assert.equal(filterTitle({ ...selectView('MoYu'), stock: 'low' }, 5), 'MoYu · Fewer than 5 in stock')
  assert.equal(filterTitle(selectView('', true), 5), 'All starred favorites')
  assert.equal(filterTitle({ ...selectView('GAN'), edition: 'V2', query: 'UV', stock: 'out' }, 5), 'GAN · Out of stock · V2 · Search: “UV”')
  assert.equal(matchesStock(normalize(), 'low'), false)
  assert.equal(matchesStock(normalize({ variants: [{ available: false, inventory_quantity: 0 }] }), 'low'), false)
  assert.equal(matchesStock(normalize({ variants: [{ available: true, inventory_quantity: 4 }] }), 'low'), true)
})
