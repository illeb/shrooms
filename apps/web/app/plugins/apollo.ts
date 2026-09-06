import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client/core';
import { DefaultApolloClient } from '@vue/apollo-composable';

/**
 * Client Apollo condiviso.
 *
 * Registrato con `provide` a livello di app invece che con `provideApolloClient`:
 * quest'ultimo richiede un'istanza di componente attiva, e in SSR non ne esiste
 * una quando gira il plugin.
 *
 * Il client viene creato dentro il plugin, che in SSR gira una volta per
 * richiesta: nessuna cache condivisa fra utenti diversi.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const { graphqlEndpoint } = useRuntimeConfig().public;

  const client = new ApolloClient({
    link: new HttpLink({
      uri: graphqlEndpoint,
      // Apollo Server 5 ha la protezione CSRF attiva di default e rifiuta le
      // richieste "semplici". Mandiamo l'header di preflight invece di
      // disattivarla lato server.
      headers: { 'apollo-require-preflight': 'true' },
    }),
    cache: new InMemoryCache(),
    ssrMode: import.meta.server,
    defaultOptions: {
      query: { fetchPolicy: 'network-only' },
      watchQuery: { fetchPolicy: 'cache-and-network' },
    },
  });

  nuxtApp.vueApp.provide(DefaultApolloClient, client);
});
