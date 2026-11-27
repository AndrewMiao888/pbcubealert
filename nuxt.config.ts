export default defineNuxtConfig({
  compatibilityDate: '2026-09-27',
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  app: { head: { title: 'Cube Stock Dashboard', htmlAttrs: { lang: 'en' }, link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }] } },
  runtimeConfig: {
    storeUrl: 'https://speedcubeshop.com',
    storeUrls: 'SpeedCubeShop|https://speedcubeshop.com,TheCubicle|https://www.thecubicle.com',
    collectionHandle: '',
    maxPages: 200,
    public: { storeName: 'SpeedCubeShop + TheCubicle', currency: 'AUD', refreshSeconds: 300, lowStockThreshold: 5 }
  }
})
