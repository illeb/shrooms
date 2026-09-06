import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Query, Resolver } from '@nestjs/graphql';
import { ApiInfo } from './meta.model';
import type { Env } from '../config/env';

/**
 * Resolver minimo, presente per due motivi: uno schema GraphQL deve avere
 * almeno una Query per essere valido, e serve un endpoint banale su cui
 * verificare che il transport funzioni end-to-end.
 */
@Resolver()
export class MetaResolver {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<Env, true>) {}

  @Query(() => ApiInfo, { description: "Informazioni di servizio sull'API." })
  apiInfo(): ApiInfo {
    return {
      name: 'mushrooms-predictions-api',
      version: process.env['npm_package_version'] ?? '0.1.0',
      environment: this.config.get('NODE_ENV', { infer: true }),
      serverTime: new Date(),
    };
  }
}
