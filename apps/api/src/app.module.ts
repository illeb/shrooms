import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { AppCoreModule } from './app-core.module';
import type { Env } from './config/env';
import { HealthModule } from './health/health.module';
import { MetaModule } from './meta/meta.module';

/**
 * Lo schema SDL viene emesso (code-first) dentro packages/graphql-schema,
 * da cui il frontend genera i propri tipi: una sola fonte di verità.
 *
 * Risolto via package e non con un path relativo a __dirname, che cambierebbe
 * fra sorgenti (src/) e build (dist/src/).
 */
const SCHEMA_OUTPUT = require.resolve('@mushrooms/graphql-schema/schema.graphql');

@Module({
  imports: [
    AppCoreModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        autoSchemaFile: SCHEMA_OUTPUT,
        sortSchema: true,
        graphiql: config.get('GRAPHQL_PLAYGROUND', { infer: true }),
        introspection: config.get('NODE_ENV', { infer: true }) !== 'production',
        path: '/graphql',
      }),
    }),
    HealthModule,
    MetaModule,
  ],
})
export class AppModule {}
