# MD5 Bruteforce Script

Path: `scripts/bruteforce_md5.py`

High-performance multiprocessing brute-force for MD5 with robust progress, safe counters, and optional Hashcat/GPU backend.

## Features

- 64-bit tested counter to avoid overflow
- Fast stop using `multiprocessing.Event`
- Debounced atomic increments (local batching) for low contention
- Smooth single-line progress with instantaneous and average rates
- Even work distribution via striding by worker index
- Auto worker selection (CPU backend): micro-benchmarks [N/2, N, 2N] based on actual per-iteration cost
- Optional Hashcat backend (GPU): launches hashcat for each length and parses result

## Usage

### CPU Backend (default)

```
python3 scripts/bruteforce_md5.py \
  --hash 2fde26f37ddfa7a7ee19f6e6dfe16edb \
  --min 1 --max 6 \
  --alphabet abcdefghijklmnopqrstuvwxyz0123456789
```

- Auto workers: selected based on CPU affinity/cgroups and micro-benchmark; printed as `Auto-selected workers: X`.
- Manual override: `--workers 32`
- Other flags:
  - `--batch 50000` (local increments before atomic add)
  - `--refresh 0.25` (progress update period, seconds)

### Hashcat Backend (GPU)

Requires hashcat installed.

```
python3 scripts/bruteforce_md5.py \
  --backend hashcat \
  --hash 2fde26f37ddfa7a7ee19f6e6dfe16edb \
  --min 1 --max 6 \
  --alphabet abcdefghijklmnopqrstuvwxyz0123456789 \
  --devices "-d 1" \
  --hashcat-args "--optimized-kernel-enable --status --status-timer 5"
```

- For each length, the script constructs a mask `?1…?1` and sets `-1 <alphabet>`.
- Status is streamed directly from hashcat; result is read from a temporary potfile.
- Use `--hashcat` to specify an explicit path to the binary if not in PATH.

## Notes

- Average rate is computed from the total tested since the start of the current length; instantaneous rate uses a recent delta window.
- On find, workers and progress terminate cleanly and scanning stops; no cross-length log interleaving.
- The script currently targets MD5 (`-m 0`). Extending to other algorithms is straightforward via a flag and minor plumbing.

