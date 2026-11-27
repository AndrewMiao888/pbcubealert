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

async function acceptedCurrency(origin: URL, currency: string) {
  const cart = await $fetch<{ currency?: string }>(new URL('/cart.js', origin).href, {
    query: { currency }, responseType: 'json', timeout: 20000, retry: 1
  })
  return String(cart.currency || '').trim().toUpperCase()
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  setHeader(event, 'Cache-Control', 'no-store')
  try {
    const stores = configuredStores(config)
    const requestedCurrency = config.public.currency.trim().toUpperCase()
    const collection = config.collectionHandle.trim()
    const maxPages = Number(config.maxPages)
    if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error('Invalid page limit')
    let currency = requestedCurrency
    const requestedSupport = await Promise.all(stores.map(async store => ({ ...store, currency: await acceptedCurrency(store.origin, requestedCurrency) })))
    if (requestedSupport.some(store => store.currency !== requestedCurrency)) {
      const usdSupport = await Promise.all(stores.map(async store => ({ ...store, currency: await acceptedCurrency(store.origin, 'USD') })))
      if (usdSupport.every(store => store.currency === 'USD')) currency = 'USD'
      else throw new Error(`Not every store accepts ${requestedCurrency}, and USD is not available across all stores`)
    }
    const loadedStores = await Promise.all(stores.map(async ({ name, origin }) => {
      const url = new URL(collection ? `/collections/${encodeURIComponent(collection)}/products.json` : '/products.json', origin)
      const catalog = await loadCatalog(
        page => $fetch<{ products: RawProduct[] }>(url.href, { query: { limit: 250, page, currency }, timeout: 20000, retry: 1 }),
        origin.href, name, Number(config.public.lowStockThreshold), maxPages
      )
      return { name, origin, ...catalog }
    }))
    const products = loadedStores.flatMap(store => store.products)
    for (const product of products) {
      const productUrl = new URL(product.url)
      productUrl.searchParams.set('currency', currency)
      product.url = productUrl.href
    }
    return {
      products,
      stores: loadedStores.map(store => ({ name: store.name, url: store.origin.origin, products: store.products.length, pages: store.pages })),
      fetchedAt: new Date().toISOString(),
      currency
    }
  } catch (error) {
    console.error('Catalog sync failed:', error instanceof Error ? error.message : 'Unknown error')
    throw createError({ statusCode: 502, statusMessage: 'The store catalog could not be loaded. Please retry shortly.' })
  }
})
