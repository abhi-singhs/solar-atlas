# Scientific data

`loadDataset(onProgress?)` in `src/simulation/dataset.ts` returns the unchanged `Dataset` interface from `src/contracts.ts`. It loads local files under `import.meta.env.BASE_URL`, never NASA or another remote data service.

The loader fetches, checks SHA-256, and validates every manifest file. A module worker parses the binary and transfers 72 `Float64Array` buffers to the main thread. The worker then terminates. `Dataset.evaluate()` runs synchronously against those arrays. Browsers without workers receive an explicit progress message before main-thread loading. Worker startup, parsing, network, and transfer failures reject the load. They never select a substitute dataset.

HTTPS and localhost use Web Crypto. Insecure HTTP hosts without Web Crypto use the included SHA-256 implementation and report that choice. Hashes detect corruption, not authenticity. They are not digital signatures.

## Rebuilding and verifying

Run from the application root:

```sh
python3 scripts/prepare_data.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'science*.py' -v
npm test -- tests/science-data.test.ts tests/science-time-rotation.test.ts tests/science-worker.test.ts
```

The converter reads `blender/` without modifying it. `--source` accepts another original project root. The output defaults to `public/data/`. Python uses only its standard library. Conversion has no timestamp and preserves deterministic output.

The Python tests compare all 657,072 source samples, including all seven binary64 components per sample. They verify byte parity for catalog, orientation, rights, kernels, source records, and validation files. They also compare the complete record section with the prior validated conversion. The browser test requires Playwright Chromium or installed Google Chrome. It checks a real worker, transferred Float64 arrays, and nested local URLs. Its browser profile and Vite cache remain inside the test directory and are removed afterward.

## Binary and epochs

`states.bin` occupies 36,796,943 bytes. It contains the 71 hourly tracks, each with 8,761 samples, plus the mandatory 35,041-sample `phobos@refined` track. Evaluation always uses refined Phobos. The hourly track remains intact for preservation and comparison.

All binary fields are little endian with no padding:

| Field | Representation |
| --- | --- |
| Magic | Eight ASCII bytes, `SOLARD01` |
| Version and record count | Two uint32 values, `1` and `72` |
| Declared first and last JD TDB | Two float64 values |
| Repeated record identifier | uint16 byte length, then ASCII identifier |
| Record sample count | uint32 |
| Repeated sample | Seven float64 values, `jd,x,y,z,vx,vy,vz` |

The parser rejects duplicate or unknown identifiers, wrong record or sample counts, missing Phobos refinement, malformed bounds, nonfinite values, reversed or repeated epochs, excessive gaps, incomplete endpoints, and trailing bytes. File sizes cannot exceed 64 MiB. Tracks cannot exceed 40,000 samples.

The header uses the source's declared UTC-to-TDB conversions. The prior app used rounded printed epochs in its header. Only these two header doubles differ from that prior conversion. Every record byte is identical.

Declared bounds are authoritative. `evaluate()` rejects even one representable double outside them. Horizons printed epochs may differ from a declared endpoint by at most `2e-9` days. The loader validates that limit before binding a track. If a requested endpoint lies just outside the stored sample interval, evaluation returns the stored endpoint unchanged. If it lies inside the sample interval, evaluation uses the actual-epoch Hermite curve. The bundled declared final epoch is about 80 microseconds before its printed last sample, so it follows the latter rule. Stored epochs never move.

Positions remain right-handed barycentric ICRF kilometers. Velocities remain km/s. Cubic Hermite uses actual neighboring sample epochs and endpoint velocities. Returned velocity is the analytic derivative of that same cubic. `trajectory(id, count=512)` returns physical ICRF points across the declared cached interval. It includes both ends, caps output at the track's sample count, and accepts integer counts from 2 through 40,000. A one-year outer-body track does not become a complete orbit.

The retained doubles occupy 36,796,032 bytes, about 35.1 MiB. Loading also holds the input binary and network buffers. No giant per-sample JavaScript object tree survives parsing.

## Rotations and time

Supported attitude models use the source formula:

```text
Rz(RA + 90 degrees) * Rx(90 degrees - DEC) * Rz(W)
```

Pole polynomials use Julian centuries from their source epoch. Prime-meridian polynomials use days. Negative rates retain retrograde spin. Quaternions use `[x,y,z,w]` and rotate body-local coordinates into ICRF. The simulation performs no renderer-axis conversion.

The 43 models retain all approximation notes. They omit periodic nutation, precession, libration, and Earth orientation parameters. Haumea, Quaoar, and Chariklo use only their source ring poles. Their fixed zero meridian is a display-coordinate convention, not a measured phase or invented spin. The other 25 bodies return identity with an explicit unknown-attitude caveat. `orientationStatus()` distinguishes secular, pole-only, and unknown cases.

UTC conversion uses the copied `naif0012.tls` DELTET constants and all 28 leap-table entries. UTC input requires `Z` or `+00:00`, valid calendar fields, and a year from 1972 onward. Typed seconds=60 are rejected. Display supports all 27 known positive leap seconds.

The pinned kernel assumes TAI-UTC remains 37 seconds after January 1, 2017. Unknown future leap seconds change UTC labels, not stored TDB states. The periodic TDB-TT approximation is accurate to about 30 microseconds before floating-point Julian-date rounding. UTC display rounds to milliseconds.

The source's roughly 49 m Phobos refinement comparison is not a universal accuracy guarantee. `ephemeris_validation.json`, `validation.json`, `provenance.json`, and the original source metadata preserve the measured limitations.
