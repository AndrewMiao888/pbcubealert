import type { RawProduct } from '#shared/catalog'

// Cache and coalesce stock requests across visitors. Two queues bound global
// upstream concurrency, with a pause between requests to avoid store throttling.
const cache = new Map<string, { detail: RawProduct; checkedAt: string; expires: number }>()
const pending = new Map<string, Promise<{ detail: RawProduct; checkedAt: string }>>()
const lanes: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()]
let nextLane = 0
let cooldownUntil = 0

interface InventoryItem { handle: string; storeUrl?: string }
function configuredOrigins(config: ReturnType<typeof useRuntimeConfig>) {
  return String(config.storeUrls || config.storeUrl).split(',').map((entry) => {
    const value = (entry.includes('|') ? entry.split('|', 2)[1] : entry) || ''
    return new URL(value.trim()).origin
  })
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ handles?: unknown; items?: unknown }>(event)
  const rawItems = Array.isArray(body?.items) ? body.items : Array.isArray(body?.handles) ? body.handles : []
  if (rawItems.length > 8) {
    throw createError({ statusCode: 400, statusMessage: 'Provide up to eight valid products.' })
  }
  const config = useRuntimeConfig(event)
  const allowedOrigins = new Set(configuredOrigins(config))
  const defaultOrigin = new URL(config.storeUrl).origin
  const items: InventoryItem[] = rawItems.map((item) => typeof item === 'string' ? { handle: item } : item as InventoryItem)
  if (!items.length || !items.every(item => item && typeof item.handle === 'string' && /^[a-z0-9][a-z0-9-]{0,250}$/.test(item.handle))) {
    throw createError({ statusCode: 400, statusMessage: 'Provide up to eight valid products.' })
  }
  const unique = [...new Map(items.map((item) => {
    let origin = defaultOrigin
    try {
      if (item.storeUrl) origin = new URL(item.storeUrl).origin
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'Unknown product store.' })
    }
    if (!allowedOrigins.has(origin)) throw createError({ statusCode: 400, statusMessage: 'Unknown product store.' })
    return [`${origin}/${item.handle}`, { handle: item.handle, origin }]
  })).values()]
  const results = await Promise.all(unique.map(async ({ handle, origin }) => {
    const key = `${origin}/${handle}`
    const stored = cache.get(key)
    if (stored && stored.expires > Date.now()) return { handle, storeUrl: origin, detail: stored.detail, checkedAt: stored.checkedAt }
    try {
      let request = pending.get(key)
      if (!request) {
        const lane = nextLane++ % lanes.length
        request = lanes[lane]!.then(async () => {
          if (Date.now() < cooldownUntil) throw new Error('Store cooling down')
          try {
            const detail = await $fetch<RawProduct>(new URL(`/products/${encodeURIComponent(handle)}.js`, origin).href, { responseType: 'json', timeout: 8000, retry: 0 })
            if (!detail || typeof detail !== 'object') { cooldownUntil = Date.now() + 60000; throw new Error('Store returned a non-JSON response') }
            if (detail.handle !== handle || !Array.isArray(detail.variants)) throw new Error('Invalid stock response')
            // Return only inventory fields, not cents-based prices or descriptions.
            const result = { detail: { handle, variants: detail.variants.map(v => ({ title: v.title, available: v.available, inventory_quantity: v.inventory_quantity, inventory_management: v.inventory_management })) }, checkedAt: new Date().toISOString() }
            if (cache.size >= 1000) cache.delete(cache.keys().next().value!)
            cache.set(key, { ...result, expires: Date.now() + 300000 })
            return result
          } catch (error) {
            const status = (error as { statusCode?: number }).statusCode
            if (status === 429 || status === 403 || status === 430 || error instanceof SyntaxError) cooldownUntil = Date.now() + 60000
            throw error
          } finally {
            await new Promise(resolve => setTimeout(resolve, 600))
          }
        })
        pending.set(key, request)
        lanes[lane] = request.catch(() => undefined)
        void request.finally(() => pending.delete(key)).catch(() => undefined)
      }
      const result = await request
      return { handle, storeUrl: origin, ...result }
    } catch { return { handle, storeUrl: origin, detail: null, checkedAt: null } }
  }))
  setHeader(event, 'Cache-Control', 'no-store')
  return { results, coolingDown: Date.now() < cooldownUntil }
})
