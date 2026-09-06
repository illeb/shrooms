import { Module } from '@nestjs/common';
import { ArpaeAdapter } from './adapters/arpae/arpae.adapter';
import { OpenMeteoAdapter } from './adapters/open-meteo/open-meteo.adapter';
import { GeocodingService } from './geocoding.service';
import { IngestionService } from './ingestion.service';

/**
 * Registro delle sorgenti meteo.
 *
 * Aggiungere una regione = scrivere un adapter, aggiungerlo ai provider e
 * inserirlo nella lista dentro IngestionService. Nient'altro cambia.
 */
@Module({
  providers: [ArpaeAdapter, OpenMeteoAdapter, IngestionService, GeocodingService],
  exports: [IngestionService, GeocodingService],
})
export class IngestionModule {}
