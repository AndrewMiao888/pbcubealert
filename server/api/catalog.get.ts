import { loadCatalog, type RawProduct } from '#shared/catalog'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  setHeader(event, 'Cache-Control', 'no-store')
  try {
    const origin = new URL(config.storeUrl)
    if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Invalid store URL')
    const currency = config.public.currency.trim().toUpperCase()
    // Confirm the store supports the requested currency rather than relabeling its base prices.
    const cart = await $fetch<{ currency: string }>(new URL('/cart.js', origin).href, {
      query: { currency }, responseType: 'json', timeout: 20000, retry: 1
    })
    if (cart.currency !== currency) throw new Error('The store did not accept the requested currency')
    const collection = config.collectionHandle.trim()
    const url = new URL(collection ? `/collections/${encodeURIComponent(collection)}/products.json` : '/products.json', origin)
    const maxPages = Number(config.maxPages)
    if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error('Invalid page limit')
    const products = await loadCatalog(
      page => $fetch<{ products: RawProduct[] }>(url.href, { query: { limit: 250, page, currency }, timeout: 20000, retry: 1 }),
      origin.href, Number(config.public.lowStockThreshold), maxPages
    )
    for (const product of products) {
      const productUrl = new URL(product.url)
      productUrl.searchParams.set('currency', currency)
      product.url = productUrl.href
    }
    return { products, fetchedAt: new Date().toISOString(), currency }
  } catch (error) {
    console.error('Catalog sync failed:', error instanceof Error ? error.message : 'Unknown error')
    throw createError({ statusCode: 502, statusMessage: 'The store catalog could not be loaded. Please retry shortly.' })
  }
})
