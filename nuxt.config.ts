export default defineNuxtConfig({
  compatibilityDate: '2026-09-27',
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  app: { head: { title: '3x3 Stock Dashboard', htmlAttrs: { lang: 'en' } } },
  runtimeConfig: {
    storeUrl: 'https://speedcubeshop.com',
    collectionHandle: '3x3-speed-cubes',
    maxPages: 40,
    public: { storeName: 'SpeedCubeShop', currency: 'USD', refreshSeconds: 300, lowStockThreshold: 5 }
  }
})
