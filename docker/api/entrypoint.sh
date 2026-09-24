#!/bin/sh
# Avvio dell'API: prima allinea lo schema, poi serve.
#
# Finora le migrazioni le lanciava una persona a mano. Va bene finche' il
# database e' sul portatile di chi sviluppa; su una macchina remota e' il modo
# di scoprire al primo deploy che l'API parla a uno schema che non esiste, con
# un errore di Prisma invece di un messaggio comprensibile.
#
# `migrate deploy` e non `migrate dev`: applica soltanto le migrazioni gia'
# scritte e versionate, non ne genera di nuove e non chiede niente. E' quello
# pensato per girare senza nessuno davanti.
#
# Idempotente: se lo schema e' gia' allineato non fa nulla e costa un secondo.
# Quindi va bene che giri a ogni avvio del container, compresi i riavvii dopo
# un aggiornamento di immagine - che e' esattamente il momento in cui una
# migrazione nuova deve entrare.
set -e

echo "▸ Allineo lo schema del database..."
if ! node node_modules/prisma/build/index.js migrate deploy; then
  echo "!! Migrazioni fallite: l'API non parte." >&2
  # Uscire e' voluto. Un'API che serve query contro uno schema vecchio
  # risponderebbe con errori incomprensibili invece di non rispondere, e con
  # `restart: unless-stopped` il container riprova da solo quando il database
  # torna raggiungibile.
  exit 1
fi

echo "▸ Schema allineato. Avvio l'API."
exec "$@"
