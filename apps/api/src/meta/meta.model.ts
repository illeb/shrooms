import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: "Informazioni di servizio sull'istanza API." })
export class ApiInfo {
  @Field(() => String, { description: 'Nome del servizio.' })
  name!: string;

  @Field(() => String, { description: 'Versione del pacchetto.' })
  version!: string;

  @Field(() => String, { description: 'Ambiente di esecuzione.' })
  environment!: string;

  @Field(() => Date, { description: 'Ora del server (UTC).' })
  serverTime!: Date;
}
