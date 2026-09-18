# Synthetic external IDE fixture

`zed-thread.zstd` contains no user data. It is a Zstd level-3 compressed JSON object
with version `0.3.0`, title `Compressed sample`, and two Rust-enum-shaped messages:
`User` with text `Example question`, then `Agent` with text `Example answer`.
The format follows Zed's `crates/agent/src/thread.rs` and `db.rs`.
Tests exercise real decompression, not a mocked decoder.
