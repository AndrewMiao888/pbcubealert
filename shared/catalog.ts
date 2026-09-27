export interface RawVariant {
  title?: string
  price?: string | number | null
  available?: boolean
  inventory_quantity?: number | null
  inventory_management?: string | null
}
export interface RawProduct {
  id?: string | number
  handle?: string
  title?: string
  vendor?: string
  product_type?: string
  published_at?: string
  variants?: RawVariant[]
  images?: { src?: string }[]
}
export interface Cube {
  id: string
  handle: string
  title: string
  brand: string
  url: string
  image: string | null
  edition: string | null
  variants: string[]
  price: number | null
  publishedAt: number
  stock: 'in' | 'low' | 'out' | 'unknown'
  quantity: number | null
  variantStock?: { title: string; quantity: number | null; available: boolean | null }[]
  stockCheckedAt?: string
}
export interface Catalog { products: Cube[]; fetchedAt: string; currency: string; stockFailures?: number }

export function applyInventory(cube: Cube, detail: RawProduct, threshold: number): Cube {
  if (detail.handle !== cube.handle || !Array.isArray(detail.variants) || !detail.variants.length) throw new Error('Invalid inventory response')
  const variants = detail.variants.map(v => ({
    ...v,
    inventory_quantity: v.inventory_management === null ? null : v.inventory_quantity
  }))
  const normalized = normalizeProduct({ ...detail, product_type: '3x3', title: cube.title, variants }, cube.url, threshold)!
  return {
    ...cube, stock: normalized.stock, quantity: normalized.quantity,
    variantStock: variants.map(v => ({
      title: v.title && v.title !== 'Default Title' ? v.title : 'Standard',
      quantity: typeof v.inventory_quantity === 'number' && Number.isFinite(v.inventory_quantity) ? Math.max(0, v.inventory_quantity) : null,
      available: typeof v.available === 'boolean' ? v.available : null
    })),
    stockCheckedAt: new Date().toISOString()
  }
}

export function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/×/g, 'x').replace(/[^\p{L}\p{N}]/gu, '')
}

export function normalizeProduct(raw: RawProduct, storeUrl: string, lowThreshold: number): Cube | null {
  if (!raw.handle || !raw.title) return null
  const dimension = /(?:^|\D)3\s*[x×]\s*3(?:\D|$)/i
  if (!dimension.test(raw.product_type || raw.title)) return null
  const variants = Array.isArray(raw.variants) ? raw.variants : []
  const prices = variants.map(v => v.price === null || v.price === undefined || v.price === '' ? NaN : Number(v.price))
    .filter(p => Number.isFinite(p) && p >= 0)
  // Only total inventory when EVERY variant exposes a quantity. Missing is not zero.
  const quantity = variants.length && variants.every(v => typeof v.inventory_quantity === 'number' && Number.isFinite(v.inventory_quantity))
    ? variants.reduce((sum, v) => sum + Math.max(0, v.inventory_quantity!), 0) : null
  const available = variants.some(v => v.available === true)
  const unavailable = variants.length > 0 && variants.every(v => v.available === false)
  let stock: Cube['stock'] = 'unknown'
  if (unavailable) stock = 'out'
  else if (available) stock = quantity !== null && quantity > 0 && quantity < lowThreshold ? 'low' : 'in'
  // Quantity alone doesn't establish whether the store permits purchases.
  const edition = raw.title.match(/\bv\s*(\d+)\b/i)?.[1]
  let image: string | null = null
  try {
    const url = new URL(raw.images?.[0]?.src || '', storeUrl)
    if (raw.images?.[0]?.src && ['https:', 'http:'].includes(url.protocol)) image = url.href
  } catch { /* Invalid images are omitted. */ }
  return {
    id: String(raw.id ?? raw.handle), handle: raw.handle, title: raw.title,
    brand: raw.vendor?.trim() || 'Unspecified brand',
    url: new URL(`/products/${encodeURIComponent(raw.handle)}`, storeUrl).href,
    image, edition: edition ? `V${Number(edition)}` : null,
    variants: [...new Set(variants.map(v => v.title?.trim()).filter((v): v is string => !!v && v !== 'Default Title'))],
    price: prices.length ? Math.min(...prices) : null,
    publishedAt: Date.parse(raw.published_at || '') || 0, stock, quantity
  }
}

export async function loadCatalog(fetchPage: (page: number) => Promise<{ products: RawProduct[] }>, storeUrl: string, threshold: number, maxPages: number): Promise<Cube[]> {
  const products = new Map<string, Cube>()
  const seen = new Set<string>()
  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchPage(page)
    if (!data || !Array.isArray(data.products)) throw new Error('Invalid catalog response')
    if (!data.products.length) return [...products.values()]
    let newItems = 0
    for (const raw of data.products) {
      const key = String(raw.id ?? raw.handle ?? '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      newItems++
      const product = normalizeProduct(raw, storeUrl, threshold)
      if (product) products.set(product.handle, product)
    }
    if (!newItems) throw new Error('Catalog pagination repeated a page')
  }
  throw new Error('Catalog page limit reached; increase NUXT_MAX_PAGES')
}
