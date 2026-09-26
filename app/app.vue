<script setup lang="ts">
import { normalizeSearch, type Catalog, type Cube } from '#shared/catalog'

const config = useRuntimeConfig().public
const catalog = ref<Catalog | null>(null)
const pending = ref(false)
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
const products = computed(() => catalog.value?.products || [])
const brands = computed(() => [...new Set(products.value.map(p => p.brand))].sort())
const editions = computed(() => [...new Set(products.value.map(p => p.edition).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
const isFavorite = (p: Cube) => favorites.value.includes(p.id) || favorites.value.includes(p.handle)
const favoriteCount = computed(() => products.value.filter(isFavorite).length)
const availableCount = computed(() => products.value.filter(p => ['in', 'low'].includes(p.stock)).length)
const average = computed(() => {
  const prices = products.value.map(p => p.price).filter((p): p is number => p !== null)
  return prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null
})
const currency = computed(() => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: config.currency }) }
  catch { return null }
})
const money = (price: number | null) => price === null ? 'Price unavailable' : currency.value?.format(price) ?? `${price.toFixed(2)} ${config.currency}`
const visible = computed(() => {
  const terms = query.value.trim().split(/\s+/).map(normalizeSearch).filter(Boolean)
  const list = products.value.filter(p => (!brand.value || p.brand === brand.value)
    && (!favoritesOnly.value || isFavorite(p))
    && (!stock.value || (stock.value === 'in' ? ['in', 'low'].includes(p.stock) : p.stock === stock.value))
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
  { value: 'in', label: 'Available to order' },
  { value: 'low', label: `Low stock (< ${config.lowStockThreshold})` },
  { value: 'out', label: 'Out of stock' },
  { value: 'unknown', label: 'Availability unknown' }
])
function stockLabel(p: Cube) {
  if (p.stock === 'out') return 'Out of stock'
  if (p.stock === 'unknown') return 'Availability unknown'
  if (p.quantity !== null && p.quantity > 0) return `${p.quantity} in stock`
  return 'Available to order'
}
function toggleFavorite(p: Cube) {
  favorites.value = isFavorite(p) ? favorites.value.filter(id => id !== p.id && id !== p.handle) : [...favorites.value, p.id]
  try { localStorage.setItem('scs_favorites', JSON.stringify(favorites.value)) }
  catch { storageWarning.value = 'Favorites work for this visit, but browser storage is unavailable.' }
}
function resetFilters() { brand.value = ''; favoritesOnly.value = false; stock.value = ''; edition.value = ''; query.value = '' }
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
  } catch {
    error.value = catalog.value ? 'Refresh failed. Showing the last successful catalog; prices and availability may have changed.' : 'Unable to load the store catalog. Please try refreshing.'
    logs.value.unshift(`${new Date().toLocaleTimeString()} — Catalog request failed.`)
  } finally { pending.value = false; logs.value = logs.value.slice(0, 30) }
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
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="layout">
    <aside>
      <a class="logo" href="/">◈ 3x3 Stock Dashboard</a>
      <div class="connection" :class="{ warning: error }" role="status">
        <strong>{{ pending ? 'Syncing catalog…' : error ? 'Connection issue' : catalog ? 'Catalog loaded' : 'Waiting to sync' }}</strong>
        <span>Product data from {{ config.storeName }}</span>
      </div>
      <nav aria-label="Catalog filters">
        <h2>Your collection</h2>
        <button :class="{ selected: favoritesOnly }" :aria-pressed="favoritesOnly" @click="favoritesOnly = !favoritesOnly">☆ Starred favorites <b>{{ favoriteCount }}</b></button>
        <h2>Cubes & brands</h2>
        <button :class="{ selected: !brand }" :aria-pressed="!brand" @click="brand = ''">All brands <b>{{ products.length }}</b></button>
        <button v-for="item in brands" :key="item" :class="{ selected: brand === item }" :aria-pressed="brand === item" @click="brand = item">{{ item }} <b>{{ products.filter(p => p.brand === item).length }}</b></button>
        <h2>Availability</h2>
        <button v-for="item in stockOptions" :key="item.value" :class="{ selected: stock === item.value }" :aria-pressed="stock === item.value" @click="stock = stock === item.value ? '' : item.value">{{ item.label }} <b>{{ products.filter(p => item.value === 'in' ? ['in', 'low'].includes(p.stock) : p.stock === item.value).length }}</b></button>
        <template v-if="editions.length">
          <h2>Versions listed in titles</h2>
          <button v-for="item in editions" :key="item" :class="{ selected: edition === item }" :aria-pressed="edition === item" @click="edition = edition === item ? '' : item">{{ item }} <b>{{ products.filter(p => p.edition === item).length }}</b></button>
        </template>
      </nav>
    </aside>
    <main>
      <header>
        <div><p class="eyebrow">{{ config.storeName }} / Catalog monitor</p><h1>{{ favoritesOnly ? 'Starred favorites' : brand ? `${brand} lineup` : 'All 3x3 cubes' }}</h1><p>Browse the latest catalog, compare prices, and keep your favorites close.</p></div>
        <button class="primary" :disabled="pending" @click="refresh">{{ pending ? 'Refreshing…' : 'Refresh catalog' }}</button>
      </header>
      <p v-if="error" class="notice warning" role="alert">{{ error }}</p>
      <p v-if="storageWarning" class="notice warning" role="status">{{ storageWarning }}</p>
      <div class="stats">
        <section><h2>Total cubes</h2><strong>{{ catalog ? products.length : '—' }}</strong></section>
        <section><h2>Available to order</h2><strong class="green">{{ catalog ? availableCount : '—' }}</strong></section>
        <section><h2>Starred favorites</h2><strong>{{ favoriteCount }}</strong></section>
        <section><h2>Average starting price</h2><strong>{{ catalog ? money(average) : '—' }}</strong></section>
      </div>
      <div class="toolbar">
        <label class="search"><span class="sr-only">Search cubes</span><input v-model="query" type="search" placeholder="Search name, brand, or variant…"></label>
        <label><span class="sr-only">Sort cubes</span><select v-model="sort"><option value="newest">Recently published</option><option value="stock">Availability first</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="name">Name: A–Z</option></select></label>
        <button @click="resetFilters">Clear filters</button>
      </div>
      <div class="result-meta"><span>{{ visible.length }} results · Prices in {{ config.currency }}</span><span v-if="catalog">Last successful sync: {{ new Date(catalog.fetchedAt).toLocaleString() }}</span></div>
      <p class="inventory-note">Availability means the store accepts orders and may include preorders. Exact quantities and low-stock labels appear only when all variants report inventory. Check the product page for variant details.</p>
      <div class="grid" :aria-busy="pending">
        <article v-for="p in visible" :key="p.id" class="card">
          <div class="card-top"><span class="eyebrow">{{ p.brand }}</span><button class="star" :class="{ starred: isFavorite(p) }" :aria-label="`${isFavorite(p) ? 'Remove' : 'Add'} ${p.title} ${isFavorite(p) ? 'from' : 'to'} favorites`" :aria-pressed="isFavorite(p)" @click="toggleFavorite(p)">{{ isFavorite(p) ? '★' : '☆' }}</button></div>
          <img v-if="p.image" :src="p.image" :alt="p.title" loading="lazy" width="320" height="190">
          <span class="badge" :class="p.stock">{{ stockLabel(p) }}</span>
          <h2>{{ p.title }}</h2>
          <p v-if="p.edition" class="version">{{ p.edition }}</p>
          <details v-if="p.variants.length"><summary>{{ p.variants.length }} listed {{ p.variants.length === 1 ? 'variant' : 'variants' }}</summary><ul><li v-for="variant in p.variants" :key="variant">{{ variant }}</li></ul></details>
          <div class="card-bottom"><div class="price"><span>From</span><strong>{{ money(p.price) }}</strong></div><a :href="p.url" target="_blank" rel="noopener noreferrer">View on {{ config.storeName }} ↗</a></div>
        </article>
        <div v-if="!visible.length" class="empty" role="status">{{ pending && !catalog ? 'Loading the store catalog…' : !catalog ? 'The catalog is not available yet.' : !products.length ? 'The store returned no 3x3 products.' : 'No cubes match these filters.' }}</div>
      </div>
      <details class="activity"><summary>Sync activity</summary><button @click="logs = []">Clear log</button><p v-for="(line, index) in logs" :key="index">{{ line }}</p></details>
    </main>
  </div>
</template>
