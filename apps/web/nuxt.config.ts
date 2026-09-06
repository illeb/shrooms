export default defineNuxtConfig({
  compatibilityDate: '2026-09-05',
  devtools: { enabled: true },

  modules: ['@nuxt/ui'],

  ssr: false,
  runtimeConfig: {
    public: {
      // Sovrascrivibile a runtime con NUXT_PUBLIC_GRAPHQL_ENDPOINT.
      graphqlEndpoint: 'http://localhost:4000/graphql',
    },
  },

  css: ['~/assets/css/main.css'],

  typescript: { typeCheck: false, strict: true },

  devServer: { port: 3000 },
});
