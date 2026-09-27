<script setup lang="ts">
import { applyInventory, normalizeSearch, type Catalog, type Cube, type RawProduct } from '#shared/catalog'
import { filterTitle, matchesStock, selectView } from '#shared/filters'

const config = useRuntimeConfig().public
const catalog = ref<Catalog | null>(null)
const pending = ref(false)
const stockProgress = ref(0)
const checkingStock = ref(false)
let disposed = false
const error = ref('')
const storageWarning = ref('')
const favorites = ref<string[]>([])
const brand = ref('')
const favoritesOnly = ref(false)
const stock = ref('')
const edition = ref('')
const query = ref('')
const sort = ref('newest')
const logs = ref<string[]>([])
const brandSearch = ref('')
const filterState = computed(() => ({ favoritesOnly: favoritesOnly.value, brand: brand.value, stock: stock.value, edition: edition.value, query: query.value }))
const pageTitle = computed(() => filterTitle(filterState.value, Number(config.lowStockThreshold)))
useHead(() => ({ title: `${pageTitle.value} | 3x3 Stock Dashboard` }))
const products = computed(() => catalog.value?.products || [])
const brands = computed(() => [...new Set(products.value.map(p => p.brand))].sort())
const matchingBrands = computed(() => brands.value.filter(b => b.toLowerCase().includes(brandSearch.value.toLowerCase())))
const viewProducts = computed(() => products.value.filter(p => favoritesOnly.value ? isFavorite(p) : !brand.value || p.brand === brand.value))
const stockCount = (value: string) => viewProducts.value.filter(p => matchesStock(p, value)).length
const knownQuantityCount = computed(() => viewProducts.value.filter(p => p.quantity !== null).length)
const editions = computed(() => [...new Set(products.value.map(p => p.edition).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
const isFavorite = (p: Cube) => favorites.value.includes(p.id) || favorites.value.includes(p.handle)
const favoriteCount = computed(() => products.value.filter(isFavorite).length)
const availableCount = computed(() => visible.value.filter(p => ['in', 'low'].includes(p.stock)).length)
const average = computed(() => {
  const prices = visible.value.map(p => p.price).filter((p): p is number => p !== null)
  return prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null
})
const priceCurrency = computed(() => catalog.value?.currency || config.currency)
const currency = computed(() => {
  try { return new Intl.NumberFormat('en-AU', { style: 'currency', currency: priceCurrency.value, currencyDisplay: 'code' }) }
  catch { return null }
})
const money = (price: number | null) => price === null ? 'Price unavailable' : currency.value?.format(price) ?? `${price.toFixed(2)} ${priceCurrency.value}`
const visible = computed(() => {
  const terms = query.value.trim().split(/\s+/).map(normalizeSearch).filter(Boolean)
  const list = products.value.filter(p => (!brand.value || p.brand === brand.value)
    && (!favoritesOnly.value || isFavorite(p))
    && matchesStock(p, stock.value)
    && (!edition.value || p.edition === edition.value)
    && terms.every(t => normalizeSearch(`${p.title} ${p.brand} ${p.edition || ''} ${p.variants.join(' ')}`).includes(t)))
  return list.sort((a, b) => {
    if (sort.value.startsWith('price')) {
      if (a.price === null) return b.price === null ? 0 : 1
      if (b.price === null) return -1
      return sort.value === 'price-low' ? a.price - b.price : b.price - a.price
    }
    if (sort.value === 'stock') {
      const rank = { in: 0, low: 1, out: 2, unknown: 3 }
      return rank[a.stock] - rank[b.stock] || (b.quantity ?? -1) - (a.quantity ?? -1)
    }
    return (sort.value === 'newest' ? b.publishedAt - a.publishedAt : 0) || a.title.localeCompare(b.title)
  })
})
const stockOptions = computed(() => [
  { value: '', label: 'All stock levels' },
  { value: 'in', label: 'Available to order' },
  { value: 'low', label: `Fewer than ${config.lowStockThreshold} in stock` },
  { value: 'out', label: 'Out of stock' },
  { value: 'unreported', label: 'Quantity not reported' }
])
function stockLabel(p: Cube) {
  if (p.stock === 'out') return 'Out of stock'
  if (p.stock === 'unknown') return 'Availability unknown'
  if (p.quantity !== null && p.quantity > 0) return p.stock === 'low' ? `Only ${p.quantity} left` : `${p.quantity} in stock`
  if (p.quantity === 0) return 'Available on backorder / preorder'
  return 'Available to order'
}
function toggleFavorite(p: Cube) {
  favorites.value = isFavorite(p) ? favorites.value.filter(id => id !== p.id && id !== p.handle) : [...favorites.value, p.id]
  try { localStorage.setItem('scs_favorites', JSON.stringify(favorites.value)) }
  catch { storageWarning.value = 'Favorites work for this visit, but browser storage is unavailable.' }
}
function openView(selectedBrand = '', starred = false) {
  const next = selectView(selectedBrand, starred)
  brand.value = next.brand; favoritesOnly.value = next.favoritesOnly
  stock.value = next.stock; edition.value = next.edition; query.value = next.query
}
function resetFilters() { stock.value = ''; edition.value = ''; query.value = '' }
async function refresh() {
  if (pending.value) return
  pending.value = true
  error.value = ''
  try {
    const result = await $fetch<Catalog>('/api/catalog')
    catalog.value = result
    if (brand.value && !brands.value.includes(brand.value)) brand.value = ''
    if (edition.value && !editions.value.includes(edition.value)) edition.value = ''
    logs.value.unshift(`${new Date().toLocaleTimeString()} — Loaded ${result.products.length} products.`)
    checkingStock.value = true
    stockProgress.value = 0
    let failed = 0
    for (let start = 0; start < result.products.length && !disposed; start += 8) {
      const handles = result.products.slice(start, start + 8).map(p => p.handle)
      try {
        const batch = await $fetch<{ results: { handle: string; detail: RawProduct | null; checkedAt: string | null }[]; coolingDown: boolean }>('/api/inventory', { method: 'POST', body: { handles } })
        for (const item of batch.results) {
          const index = catalog.value.products.findIndex(p => p.handle === item.handle)
          if (!item.detail || index < 0) { failed++; continue }
          try {
            const updated = applyInventory(catalog.value.products[index]!, item.detail, Number(config.lowStockThreshold))
            updated.stockCheckedAt = item.checkedAt || undefined
            catalog.value.products[index] = updated
          } catch { failed++ }
        }
        stockProgress.value = Math.min(start + handles.length, result.products.length)
        if (batch.coolingDown) { failed += result.products.length - stockProgress.value; break }
      } catch { failed += result.products.length - start; break }
    }
    catalog.value.stockFailures = failed
    logs.value.unshift(`${new Date().toLocaleTimeString()} — Stock checks finished; ${failed} quantities could not be checked.`)
  } catch {
    error.value = catalog.value ? 'Refresh failed. Showing the last successful catalog; prices and availability may have changed.' : 'Unable to load the store catalog. Please try refreshing.'
    logs.value.unshift(`${new Date().toLocaleTimeString()} — Catalog request failed.`)
  } finally { pending.value = false; checkingStock.value = false; logs.value = logs.value.slice(0, 30) }
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem('scs_favorites') || '[]')
    if (Array.isArray(stored)) favorites.value = stored.filter((id): id is string => typeof id === 'string')
  } catch { storageWarning.value = 'Saved favorites could not be read. You can start a new list.' }
  void refresh()
  const seconds = Number(config.refreshSeconds)
  if (Number.isFinite(seconds) && seconds > 0) timer = setInterval(() => { if (!document.hidden) void refresh() }, Math.max(seconds, 30) * 1000)
})
onBeforeUnmount(() => { disposed = true; clearInterval(timer) })
</script>

<template>
  <div class="layout">
    <aside>
      <a class="logo" href="/">◈ 3x3 Stock Dashboard</a>
      <div class="connection" :class="{ warning: error }" role="status">
        <strong>{{ pending ? 'Checking live inventory...' : error ? 'Connection issue' : catalog ? 'Catalog loaded' : 'Waiting to sync' }}</strong>
        <span>Product data from {{ config.storeName }}</span>
      </div>
      <nav aria-label="Catalog navigation">
        <h2>Browse</h2>
        <button :class="{ selected: !brand && !favoritesOnly }" :aria-pressed="!brand && !favoritesOnly" @click="openView()"><span>All cubes</span><b>{{ products.length }}</b></button>
        <button class="favorites-nav" :class="{ selected: favoritesOnly }" :aria-pressed="favoritesOnly" @click="openView('', true)"><span>&#9733; Starred favorites</span><b>{{ favoriteCount }}</b></button>
        <h2>Shop by brand</h2>
        <label class="brand-search"><span class="sr-only">Find a brand</span><input v-model="brandSearch" type="search" placeholder="Find a brand..."></label>
        <div class="brand-list">
          <button v-for="item in matchingBrands" :key="item" :class="{ selected: !favoritesOnly && brand === item }" :aria-pressed="!favoritesOnly && brand === item" @click="openView(item)"><span>{{ item }}</span><b>{{ products.filter(p => p.brand === item).length }}</b></button>
          <p v-if="!matchingBrands.length" class="muted">{{ pending ? 'Loading brands...' : 'No brands found.' }}</p>
        </div>
      </nav>
    </aside>
    <main>
      <header>
        <div><p class="eyebrow">{{ config.storeName }} / Catalog monitor</p><h1>{{ pageTitle }}</h1><p>{{ favoritesOnly ? 'Your saved cubes from every brand, together in one place.' : `Live prices in ${priceCurrency}. Find your next cube and check what is left.` }}</p></div>
        <button class="primary" :disabled="pending" @click="refresh">{{ pending ? 'Checking prices and stock...' : 'Refresh prices and stock' }}</button>
      </header>
      <p v-if="error" class="notice warning" role="alert">{{ error }}</p>
      <p v-if="storageWarning" class="notice warning" role="status">{{ storageWarning }}</p>
      <div v-if="checkingStock" class="stock-progress" role="status"><span>Checking exact stock: {{ stockProgress }} / {{ products.length }} cubes. You can browse while this runs.</span><progress :value="stockProgress" :max="products.length || 1" aria-label="Inventory checks completed" /></div>
      <div class="stats">
        <section><h2>Cubes in this view</h2><strong>{{ catalog ? visible.length : '—' }}</strong></section>
        <section><h2>Available to order</h2><strong class="green">{{ catalog ? availableCount : '—' }}</strong></section>
        <section><h2>Exact stock counts</h2><strong>{{ catalog ? visible.filter(p => p.quantity !== null).length : '—' }}</strong></section>
        <section><h2>Average starting price</h2><strong>{{ catalog ? money(average) : '—' }}</strong></section>
      </div>
      <section v-if="!favoritesOnly" class="filter-panel" aria-label="Filter this view">
        <div class="filter-heading"><div><h2>Filter {{ brand || 'all cubes' }}</h2><p>Choose a stock level to narrow this view.</p></div><button class="text-button" @click="resetFilters">Reset filters</button></div>
        <div class="stock-filters" aria-label="Stock level">
          <button v-for="item in stockOptions" :key="item.value" :class="{ active: stock === item.value }" :aria-pressed="stock === item.value" @click="stock = item.value"><span>{{ item.label }}</span><b>{{ stockCount(item.value) }}</b></button>
        </div>
        <label v-if="editions.length" class="edition-select">Version <select v-model="edition"><option value="">All versions</option><option v-for="item in editions" :key="item" :value="item">{{ item }}</option></select></label>
      </section>
      <div class="toolbar">
        <label class="search"><span class="sr-only">Search cubes</span><input v-model="query" type="search" placeholder="Search name, brand, or variant…"></label>
        <label><span class="sr-only">Sort cubes</span><select v-model="sort"><option value="newest">Recently published</option><option value="stock">Availability first</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="name">Name: A–Z</option></select></label>
        <button v-if="query || edition || stock" @click="resetFilters">Clear filters</button>
      </div>
      <div class="result-meta"><span>{{ visible.length }} results · Prices in {{ priceCurrency }}</span><span v-if="catalog">Last successful sync: {{ new Date(catalog.fetchedAt).toLocaleString() }}</span></div>
      <div class="inventory-note"><strong>{{ knownQuantityCount }} of {{ viewProducts.length }} cubes in {{ favoritesOnly ? 'your favorites' : brand || 'the catalog' }} have exact stock counts.</strong> Counts are totals across variants. Fewer than {{ config.lowStockThreshold }} means 1 to {{ Number(config.lowStockThreshold) - 1 }} units; sold-out cubes have their own filter.
        <span v-if="catalog?.stockFailures"> {{ catalog.stockFailures }} product stock checks failed; availability from the catalog is shown for those products.</span>
      </div>
      <div class="grid" :aria-busy="pending">
        <article v-for="p in visible" :key="p.id" class="card">
          <div class="card-top"><span class="eyebrow">{{ p.brand }}</span><button class="star" :class="{ starred: isFavorite(p) }" :aria-label="`${isFavorite(p) ? 'Remove' : 'Add'} ${p.title} ${isFavorite(p) ? 'from' : 'to'} favorites`" :aria-pressed="isFavorite(p)" @click="toggleFavorite(p)">{{ isFavorite(p) ? '★' : '☆' }}</button></div>
          <img v-if="p.image" :src="p.image" :alt="p.title" loading="lazy" width="320" height="190">
          <span class="badge" :class="p.stock">{{ stockLabel(p) }}</span>
          <p class="quantity-detail">{{ p.quantity === null ? 'Exact quantity not reported' : `${p.quantity} units across all variants` }}<span v-if="p.stockCheckedAt"> Checked {{ new Date(p.stockCheckedAt).toLocaleTimeString() }}</span></p>
          <h2>{{ p.title }}</h2>
          <p v-if="p.edition" class="version">{{ p.edition }}</p>
          <details v-if="p.variantStock?.length" class="variant-stock"><summary>Stock by variant <span>{{ p.variantStock.length }}</span></summary><ul><li v-for="(variant, index) in p.variantStock" :key="index"><span>{{ variant.title }}</span><strong>{{ variant.quantity === null ? 'Quantity unknown' : `${variant.quantity} left` }}</strong><small>{{ variant.available === false ? 'Sold out' : variant.available === true ? 'Available to order' : 'Availability unknown' }}</small></li></ul></details>
          <details v-else-if="p.variants.length"><summary>{{ p.variants.length }} listed {{ p.variants.length === 1 ? 'variant' : 'variants' }}</summary><ul><li v-for="variant in p.variants" :key="variant">{{ variant }}</li></ul></details>
          <div class="card-bottom"><div class="price"><span>From</span><strong>{{ money(p.price) }}</strong></div><a :href="p.url" target="_blank" rel="noopener noreferrer">View on {{ config.storeName }} ↗</a></div>
        </article>
        <div v-if="!visible.length" class="empty" role="status">{{ pending && !catalog ? 'Loading prices and checking stock for each cube...' : !catalog ? 'The catalog is not available yet.' : !products.length ? 'The store returned no 3x3 products.' : stock === 'low' && knownQuantityCount < viewProducts.length ? 'No confirmed low-stock cubes in this view. Products with unreported quantities cannot be included.' : favoritesOnly && !favoriteCount ? 'No favorites yet. Use the star button on a cube to save it here.' : 'No cubes match these filters.' }}</div>
      </div>
      <details class="activity"><summary>Sync activity</summary><button @click="logs = []">Clear log</button><p v-for="(line, index) in logs" :key="index">{{ line }}</p></details>
    </main>
  </div>
</template>
