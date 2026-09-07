import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { IngestionModule } from './ingestion/ingestion.module';
import { MycologyModule } from './mycology/mycology.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Il cuore dell'applicazione: configurazione, database, ingestione, dominio
 * micologico. Tutto cio' che serve per fare il lavoro.
 *
 * Sta separato dal trasporto HTTP/GraphQL perche' i comandi CLI ne hanno
 * bisogno e di quello no. Non e' solo pulizia: la CLI gira con `tsx`, che non
 * emette i metadati dei decoratori, e il costruttore dello schema GraphQL su
 * quei metadati ci conta. Farglielo costruire per lanciare un'ingestione
 * sarebbe lavoro sprecato che per giunta non funziona.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ['.env', '../../.env'],
    }),
    // Nessuno scheduler dentro l'API: l'ingestione giornaliera gira nel
    // container `scheduler`. Qui c'era `ScheduleModule.forRoot()` registrato
    // con zero job, che e' il modo migliore di far credere che un cron esista.
    PrismaModule,
    IngestionModule,
    MycologyModule,
  ],
  exports: [IngestionModule, MycologyModule],
})
export class AppCoreModule {}
