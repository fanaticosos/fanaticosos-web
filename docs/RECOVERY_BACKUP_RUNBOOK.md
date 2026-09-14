# Respaldo externo y restauración de Fanaticosos

El paquete de recuperación cubre la base SQLite del publicador, los audios
aceptados, la caché pagada de bloques ElevenLabs y exportaciones SQL de las D1
`fanaticosos-bears-nation` y `fanaticosos-participa`. No incluye credenciales.

## Crear y sacar el paquete de Papabear

```bash
BACKUP_ID=db-YYYYMMDDTHHMMSSZ
sudo /usr/local/sbin/fanaticosos-blog-admin create-recovery-bundle EXPECTED_COMMIT "$BACKUP_ID"
```

El helper crea primero un backup SQLite consistente, exporta D1 mediante la API
de Cloudflare, calcula SHA-256 para cada archivo y deja un `.tar.gz` modo `0600`
en `/var/tmp/fanaticosos-recovery/`, propiedad del administrador que invocó el
comando. La credencial de Cloudflare nunca entra al archivo.

Desde la Mac autorizada, copiar el paquete fuera de la VM:

```bash
scp papabear:/var/tmp/fanaticosos-recovery/recovery-YYYYMMDDTHHMMSSZ.tar.gz \
  "/Users/acontreras/Documents/Fanaticosos Backups/"
```

## Drill en otra máquina

Desde el worktree correspondiente al commit del manifiesto:

```bash
scripts/backup/verify_recovery_bundle.sh \
  "/Users/acontreras/Documents/Fanaticosos Backups/recovery-YYYYMMDDTHHMMSSZ.tar.gz"
```

El drill extrae en un directorio temporal, valida todos los hashes, abre y
verifica SQLite, importa el SQL de D1 en otra base SQLite, ejecuta
`PRAGMA integrity_check` en ambas y decodifica con FFprobe todos los MP3 de
audio aceptado y caché. El directorio temporal se elimina al terminar.

Un paquete solo cuenta como respaldo operativo después de estar fuera de
Papabear y producir el mensaje `PASS` en otra máquina.
