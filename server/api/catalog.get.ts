import { loadCatalog, type RawProduct } from '#shared/catalog'

function configuredStores(config: ReturnType<typeof useRuntimeConfig>) {
  const raw = String(config.storeUrls || config.storeUrl)
  return raw.split(',').map((entry) => {
    const parts = entry.includes('|') ? entry.split('|', 2) : ['', entry]
    const name = parts[0] || ''
    const url = parts[1] || name
    const origin = new URL(url.trim())
    if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Invalid store URL')
    return { name: name.trim() || origin.hostname.replace(/^www\./, ''), origin }
  })
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  setHeader(event, 'Cache-Control', 'no-store')
  try {
    const stores = configuredStores(config)
    const currency = config.public.currency.trim().toUpperCase()
    const collection = config.collectionHandle.trim()
    const maxPages = Number(config.maxPages)
    if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error('Invalid page limit')
    const products = (await Promise.all(stores.map(async ({ name, origin }) => {
      // Confirm each store supports the requested currency rather than relabeling its base prices.
      const cart = await $fetch<{ currency: string }>(new URL('/cart.js', origin).href, {
        query: { currency }, responseType: 'json', timeout: 20000, retry: 1
      })
      if (cart.currency !== currency) throw new Error(`${name} did not accept the requested currency`)
      const url = new URL(collection ? `/collections/${encodeURIComponent(collection)}/products.json` : '/products.json', origin)
      return loadCatalog(
        page => $fetch<{ products: RawProduct[] }>(url.href, { query: { limit: 250, page, currency }, timeout: 20000, retry: 1 }),
        origin.href, name, Number(config.public.lowStockThreshold), maxPages
      )
    }))).flat()
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
