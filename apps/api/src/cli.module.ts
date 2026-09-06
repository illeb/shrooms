import { Module } from '@nestjs/common';
import { AppCoreModule } from './app-core.module';

/**
 * Composizione dei comandi one-shot: il cuore dell'applicazione senza il
 * trasporto. Stesso container di dipendenze del server, meno il server.
 */
@Module({ imports: [AppCoreModule] })
export class CliModule {}
