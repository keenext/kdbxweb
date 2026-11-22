# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), the versions [Semantic Versioning](https://semver.org/) (see [FORK.md](FORK.md#versions)). Everything that differs from upstream kdbxweb is listed in [FORK.md](FORK.md).

## 3.0.0 – 2026-11-22

Breaking for callers that rely on upstream's merge results or on `move` accepting any target.

### Changed
- `Kdbx.merge` decides up front where each entry and group goes, so every object ends up in exactly one group. An entry the other side moved and changed was kept in two groups, saved twice, and every later merge failed with `MergeError: duplicate`. Groups only one side has are merged too; groups the two sides moved into each other no longer drop out of the tree.
- `Kdbx.merge` applies tombstones after merging, against the merged times, as KeePass 2 does: an object changed or moved after its deletion stays, a group goes only once it is empty. Custom icons the same way.
- `Kdbx.merge` no longer deletes custom icons that nothing uses.
- `Kdbx.move` throws `InvalidArg` for a group moved into itself or its subtree, which cut it off from the tree.

### Fixed
- CR in field values survives saving (written as `&#13;`).
- Missing group `IconID`, `IsExpanded`, `EnableAutoType`, `EnableSearching` and meta `RecycleBinEnabled` are written with KeePass' defaults; KeePassXC refused the empty elements or read the recycle bin as off.
- A 32-byte key file passed to `KdbxCredentials` is no longer masked in place.
