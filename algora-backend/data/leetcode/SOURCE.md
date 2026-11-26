# LeetCode problem catalog — dataset provenance

`problems.json` is the version-controlled metadata catalog that Algora's problem library
searches and assigns from. Nothing in this directory is fetched at runtime.

## Source

| | |
| --- | --- |
| Source URL | https://huggingface.co/datasets/Hahho2/leetcode-problem-set |
| Source file | `data.csv` (metadata-only table) |
| Upstream lineage | metadata mirror of `kaysss/leetcode-problem-set`; scraper: https://github.com/timetooth/leetcode_scraper |
| Declared license | MIT (dataset card `license: mit`) |
| Retrieved | 2026-11-26 |
| Source last updated | 2026-10-28 (dataset repository commit date) |
| Problems | 3,511 |

We redistribute **factual metadata only** (problem number, title, slug, difficulty, URL,
free/premium flag, topic tags). Problem statements, examples, solutions, editorials,
hidden test cases, acceptance rates and company tags are deliberately excluded, both from
this file and from the importer.

## License verification and limitations

- The dataset card declares MIT. That declaration covers the *compilation* published by the
  source; the underlying problem titles and metadata originate from LeetCode.
- No claim is made here that LeetCode grants redistribution rights for its content. Algora
  uses only short factual identifiers, which it must show to let trainers find and link to
  problems. The full problem text always lives on leetcode.com via the recorded URL.
- The source README calls the collection suitable for "educational and research purposes".
  If Algora's legal review requires a different basis, replace `problems.json` through the
  update workflow below; the application does not depend on this particular source.
- Freshness: the snapshot is from October 2026 and grows through the update workflow only.
  Problems added to LeetCode after that date are absent until the dataset is refreshed. The
  catalog is not deleted or rewritten by LeetCode changes, and manual entries fill gaps.
- 86 records have no topic tags in the source. They are stored with an empty `topics` array;
  nothing is invented to fill them.
- Duplicate slugs, duplicate numbers and gaps in numbering were checked during validation;
  the published snapshot has none (numbers 1–3511 are all present).

## Record shape

```json
{"id":704,"title":"Binary Search","slug":"binary-search","difficulty":"Easy","url":"https://leetcode.com/problems/binary-search/","isPremium":false,"topics":["Array","Binary Search"],"platform":"leetcode"}
```

`metadata.json` records the dataset version, counts, source, license, retrieval date,
checksum (`sha256` of `problems.json`) and the fields that were dropped.

## Updating the catalog

1. Obtain an updated metadata file from a source whose license permits this use.
2. Convert it to the record shape above (metadata only) and replace `problems.json`.
3. Update `metadata.json`: version, counts, `retrievedAt`, `lastUpdated`, checksum and license.
4. Run `npm run catalog:validate` — it checks the checksum, duplicates, URLs, field values and
   prints the counts. Use `--compare <previous.json>` to review added/removed/modified problems.
5. Review the diff, commit `data/leetcode/` and run `npm run catalog:import:dry-run`, then
   `npm run catalog:import` against the target database.

The import never deletes catalog rows, never touches chapter assignments and never
overwrites a problem number that a different slug already owns.
