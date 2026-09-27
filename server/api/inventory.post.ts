import type { RawProduct } from '#shared/catalog'

// Cache and coalesce stock requests across visitors. Two queues bound global
// upstream concurrency, with a pause between requests to avoid store throttling.
const cache = new Map<string, { detail: RawProduct; checkedAt: string; expires: number }>()
const pending = new Map<string, Promise<{ detail: RawProduct; checkedAt: string }>>()
const lanes: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()]
let nextLane = 0
let cooldownUntil = 0

export default defineEventHandler(async (event) => {
  const body = await readBody<{ handles?: unknown }>(event)
  if (!Array.isArray(body?.handles) || body.handles.length > 8 || !body.handles.every(h => typeof h === 'string' && /^[a-z0-9][a-z0-9-]{0,250}$/.test(h))) {
    throw createError({ statusCode: 400, statusMessage: 'Provide up to eight valid product handles.' })
  }
  const config = useRuntimeConfig(event)
  const origin = new URL(config.storeUrl)
  const results = await Promise.all([...new Set(body.handles as string[])].map(async (handle) => {
    const key = `${origin.origin}/${handle}`
    const stored = cache.get(key)
    if (stored && stored.expires > Date.now()) return { handle, detail: stored.detail, checkedAt: stored.checkedAt }
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
      return { handle, ...result }
    } catch { return { handle, detail: null, checkedAt: null } }
  }))
  setHeader(event, 'Cache-Control', 'no-store')
  return { results, coolingDown: Date.now() < cooldownUntil }
})
