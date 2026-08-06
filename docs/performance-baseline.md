# Phase 5/6 Performance and Cost Baseline

Verified against the connected synthetic Supabase project on 2026-08-05. Pricing is time-bound
and must be checked again before extrapolating.

## Generated live gate

- Seed: `SCN-4F7A`
- Notice: Stage 3
- Derated SEG-2 capacity: 790,000 Dth
- Recut: CEMK 30,000 / −55,000; SABT 30,000 / −55,000; factor 0.1875
- Aggregate projected exposure: $2,367,400.00
- Two correlated runs; 46 append-only events; zero error events
- Three actions executed; four shipper messages delivered; final phase `resolved`
- End-to-end wall time: 266 seconds (4:26), including operator review pauses
- Scheduling agent time to staged recut: 29 seconds
- Continuation agent time to staged communications: 60 seconds

## Claude usage

The runtime recorded counts and duration only. It did not log prompts, tool payloads, credentials,
or provider response bodies.

| Metric | Value |
|---|---:|
| Model calls | 11 |
| Model | `claude-sonnet-5` |
| Summed request duration | 111,816 ms |
| Uncached input tokens | 1,618 |
| Output tokens | 8,610 |
| 5-minute cache-write tokens | 23,839 |
| Cache-read tokens | 39,659 |

Using Anthropic's introductory Sonnet 5 prices in effect through 2026-08-31:

- uncached input: 1,618 × $2 / MTok = $0.0032
- output: 8,610 × $10 / MTok = $0.0861
- 5-minute cache writes: 23,839 × $2.50 / MTok = $0.0596
- cache reads: 39,659 × $0.20 / MTok = $0.0079
- estimated total: **$0.1569**

This estimate explains why switching to Sonnet 4.6 is not currently a cost optimization:
Sonnet 4.6 is priced at $3/$15 per MTok while Sonnet 5 has temporary $2/$10 pricing. Re-evaluate
after Sonnet 5 moves to standard pricing and benchmark quality, tokens, latency, and retries on
the same fixed seed before changing `AGENT_MODEL`.
