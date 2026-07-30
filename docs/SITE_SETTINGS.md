# Fanaticosos Site Settings

Status: Approved requirement; dashboard integration planned for Phase 6

## Purpose

Homepage values that change independently of an article are stored in `src/data/site-settings.json`. They are content settings, not component source code.

## Music settings

- `music.playlistUrl` is the complete shared Navidrome playlist.
- `music.weeklySongUrl` is the currently featured individual song.

Both values must be HTTPS share links under `musica.fanaticosos.com/share/`. Invalid or missing values stop the build before publication.

## Owner workflow

During Phase 6, the private publishing dashboard will expose labeled fields for both URLs. Saving the settings will update the validated settings file through the same controlled publication workflow as article content.

Routine playlist or weekly-song changes will not require editing a component or other source code.
