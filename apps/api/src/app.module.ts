import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { AppCoreModule } from './app-core.module';
import type { Env } from './config/env';
import { HealthModule } from './health/health.module';
import { MetaModule } from './meta/meta.module';

/**
 * Dove finisce lo schema SDL generato (code-first).
 *
 * In sviluppo dentro packages/graphql-schema, da cui il frontend genera i
 * propri tipi: una sola fonte di verità. Risolto via package e non con un
 * path relativo a __dirname, che cambierebbe fra sorgenti (src/) e build
 * (dist/src/).
 *
 * In produzione `true`, che vuol dire "in memoria, nessun file". Lo schema
 * su disco e' un artefatto per chi sviluppa: al frontend gia' costruito non
 * serve, e nessuno lo legge dal container.
 *
 * CORRETTO SUL CAMPO: al primo avvio sul server l'API moriva subito con
 * EACCES su packages/graphql-schema/schema.graphql. L'immagine gira come
 * utente non privilegiato e quella cartella non e' sua - giustamente. Nessun
 * chown avrebbe risolto il punto vero, che e' che quel file li' non ci deve
 * essere: renderlo scrivibile significherebbe dare a un processo esposto in
 * rete il permesso di scrivere dentro la propria installazione.
 */
function schemaOutput(nodeEnv: string): string | true {
  return nodeEnv === 'production'
    ? true
    : require.resolve('@mushrooms/graphql-schema/schema.graphql');
}

@Module({
  imports: [
    AppCoreModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const nodeEnv = config.get('NODE_ENV', { infer: true });
        return {
          autoSchemaFile: schemaOutput(nodeEnv),
          sortSchema: true,
          graphiql: config.get('GRAPHQL_PLAYGROUND', { infer: true }),
          introspection: nodeEnv !== 'production',
          path: '/graphql',
        };
      },
    }),
    HealthModule,
    MetaModule,
  ],
})
export class AppModule {}
