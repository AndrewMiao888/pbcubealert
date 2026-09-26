import { loadCatalog, type RawProduct } from '#shared/catalog'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  setHeader(event, 'Cache-Control', 'no-store')
  try {
    const origin = new URL(config.storeUrl)
    if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Invalid store URL')
    const collection = config.collectionHandle.trim()
    const url = new URL(collection ? `/collections/${encodeURIComponent(collection)}/products.json` : '/products.json', origin)
    const maxPages = Number(config.maxPages)
    if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error('Invalid page limit')
    const products = await loadCatalog(
      page => $fetch<{ products: RawProduct[] }>(url.href, { query: { limit: 250, page }, timeout: 20000, retry: 1 }),
      origin.href, Number(config.public.lowStockThreshold), maxPages
    )
    return { products, fetchedAt: new Date().toISOString() }
  } catch (error) {
    console.error('Catalog sync failed:', error instanceof Error ? error.message : 'Unknown error')
    throw createError({ statusCode: 502, statusMessage: 'The store catalog could not be loaded. Please retry shortly.' })
  }
})
