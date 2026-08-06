# Schema Deviations from BUILD_SPEC §5

`BUILD_SPEC.md` remains the product and behavioral source of truth. The versioned database
migrations contain two additive topology fields that were required to represent the §6.2
network without asking an agent to infer physical relationships.

## `points.point_type = 'junction'`

The §5 DDL originally allowed only `receipt`, `delivery`, and `storage`. SEG-2 and SEG-3
terminate at Abilene Junction and DFW South, which are topology nodes rather than commercial
receipt or delivery points. The migration therefore adds `junction` to the allowed values.

## `points.corridor_seq`

The §7.2/§7.3 contracts require `segments_traversed(receipt, delivery)` and
`is_downstream_of(point, segment)`. The original DDL did not store enough information to
answer those questions deterministically.

`corridor_seq` is an integer that increases downstream:

- Waha Hub: 1
- Midland Junction: 2
- Abilene Junction and points attached there: 3
- DFW South and points attached there: 4

This makes the hero assertion explicit and testable: `RP-BETH` is downstream of `SEG-2`, so
LSPP can be informed that its own downstream storage is an available cure path without the
model inferring topology.

## Source-of-truth policy

- Supabase is the runtime source of truth for current operational state.
- `supabase/migrations/` is the version-controlled source of truth for schema and canonical
  seed history.
- Every remote DDL change must have a corresponding reviewed migration in Git.
- Local project link files and credentials remain ignored.
