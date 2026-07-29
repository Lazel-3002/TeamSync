# TeamSync localization terminology

`teamsync-ui-terminology.tsv.gz` is a compact, UTF-8 reference glossary for
TeamSync's recurring interface terms. It is deliberately a **terminology
reference**, not a machine-translation dictionary and not a runtime fallback.
A spelling dictionary can validate a word but cannot produce a natural,
context-aware UI translation.

The glossary contains the source text in its first column and reviewed target
terms for the languages currently being researched. It is kept compressed to
avoid adding a large payload to the application package. Before a new locale is
made selectable, every user-visible string must have a reviewed translation in
that locale's complete UI catalogue and pass the no-fallback UI test.

The entries are original short terminology selections. They are not copied from
third-party dictionaries. External sources are consulted only to verify common
product terminology; their text and word lists are not bundled.

## Review catalogues

`catalogs/` contains one JSON catalogue per planned locale. Every catalogue has
the same 180 structured UI keys and 257 legacy UI keys. Empty values are
intentional review work, never runtime fallbacks. Run `npm run i18n:audit` to
report missing entries; it exits unsuccessfully until every catalogue is full.

Use `node tools/i18n/audit-locales.js --initialize` only to create an absent
catalogue template. It does not translate text and does not mark a locale ready.
