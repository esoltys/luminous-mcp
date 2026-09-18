---
name: luminous
description: Query and control Luminous Music Player and local music library via MCP tools.
---

# Luminous Music Player Guide

When interacting with Luminous Music Player and the local music library, use the following tool guidelines:

## Live Playback & Transport Controls
- **What is currently playing / Now Playing / Current playback state:**
  ALWAYS use `get_playback_state` (or `luminous__get_playback_state`).
  Returns the currently playing track (title, artist, album, duration), playback status (`playing`, `paused`, `stopped`), progress position, volume, and shuffle/repeat modes.
- **Control playback transport:**
  Use `control_playback` (or `luminous__control_playback`) with `action`:
  - `play`, `pause`, `resume`, `play_pause`, `next`, `previous`, `seek`, `set_volume`, `set_shuffle`, `set_repeat`.
- **Queue replacement & immediate play:**
  Use `play_tracks` (or `luminous__play_tracks`) with an array of track IDs.
- **Stop after current song:**
  Use `pause_after_track` (or `luminous__pause_after_track`) to pause cleanly when the current track finishes playing.

## Library Search & Acoustic Filtering
- **Search songs, artists, albums, or genres:**
  Use `search_library` (or `luminous__search_library`). Supports FTS full-text search as well as structured filters like `genre`, `year_min`, `year_max`, `bpm_min`, `bpm_max`, and `loudness_lufs_max`.
- **Comprehensive track details:**
  Use `get_track_details` (or `luminous__get_track_details`) for audio formats, sample rate, bit depth, lyrics, and acoustic metrics.
- **Artist summaries & discography:**
  Use `get_artist_summary` (or `luminous__get_artist_summary`) for catalog statistics, albums owned, top tracks, and collaborators.

## Listening Habits & History
- **Top tracks, top artists, forgotten favorites, skip patterns:**
  Use `get_listening_stats` (or `luminous__get_listening_stats`).
- **Past playback history:**
  Use `get_recent_history` (or `luminous__get_recent_history`).
  *NOTE: This tool returns historical playback logs of previously completed songs. NEVER call this tool to find out what is currently playing.*

## Playlist Management & Curation
- **Inspect or create playlists:**
  Use `list_playlists`, `get_playlist`, `create_playlist`, `add_to_playlist`, or `remove_from_playlist`.
- **Curation & metadata enrichment:**
  Use `update_artist_profile` or `update_album_profile` to store biographical summaries and review citations.