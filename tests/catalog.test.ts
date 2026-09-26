import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCatalog, normalizeProduct, normalizeSearch, type RawProduct } from '../shared/catalog.ts'

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
