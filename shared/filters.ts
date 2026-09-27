import type { Cube } from './catalog'

export interface Filters { favoritesOnly: boolean; brand: string; stock: string; edition: string; query: string }
export function selectView(brand: string, favoritesOnly = false): Filters {
  return { favoritesOnly, brand: favoritesOnly ? '' : brand, stock: '', edition: '', query: '' }
}
export function matchesStock(product: Cube, stock: string) {
  return !stock || (stock === 'in' ? ['in', 'low'].includes(product.stock) : stock === 'unreported' ? product.quantity === null : product.stock === stock)
}
export function filterTitle(filters: Filters, threshold: number) {
  const labels: Record<string, string> = { in: 'Available to order', low: `Fewer than ${threshold} in stock`, out: 'Out of stock', unknown: 'Availability unknown', unreported: 'Quantity not reported' }
  return [filters.favoritesOnly ? 'All starred favorites' : filters.brand || 'All 3x3 cubes', labels[filters.stock], filters.edition, filters.query.trim() ? `Search: “${filters.query.trim()}”` : ''].filter(Boolean).join(' · ')
}
