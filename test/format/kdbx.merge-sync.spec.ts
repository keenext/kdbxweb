import expect from 'expect.js';
import * as kdbxweb from '../../lib/index';

// Two devices start from the same file, change it and merge: moves, deletions and icons.
describe('Kdbx.merge between two copies', () => {
    const cred = new kdbxweb.KdbxCredentials(kdbxweb.ProtectedValue.fromString('demo'));
    const t0 = new Date(2024, 0, 1);
    const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

    interface Base {
        db: kdbxweb.Kdbx;
        g1: kdbxweb.KdbxGroup;
        g2: kdbxweb.KdbxGroup;
        entry: kdbxweb.KdbxEntry;
    }

    /** Root with groups G1 and G2 (merged in that order) and an entry in G2, all dated t0 */
    function base(): Base {
        const db = kdbxweb.Kdbx.create(cred, 'demo');
        const root = db.getDefaultGroup();
        const g1 = db.createGroup(root, 'G1');
        const g2 = db.createGroup(root, 'G2');
        const entry = db.createEntry(g2);
        entry.fields.set('Title', 'E');
        for (const item of root.allGroupsAndEntries()) {
            item.times.lastModTime = t0;
            item.times.locationChanged = t0;
        }
        return { db, g1, g2, entry };
    }

    async function copies(db: kdbxweb.Kdbx): Promise<[kdbxweb.Kdbx, kdbxweb.Kdbx]> {
        const xml = await db.saveXml();
        return [await kdbxweb.Kdbx.loadXml(xml, cred), await kdbxweb.Kdbx.loadXml(xml, cred)];
    }

    function find(db: kdbxweb.Kdbx, uuid: kdbxweb.KdbxUuid): (kdbxweb.KdbxEntry | kdbxweb.KdbxGroup)[] {
        return [...db.getDefaultGroup().allGroupsAndEntries()].filter((item) =>
            item.uuid.equals(uuid)
        );
    }

    function entry(db: kdbxweb.Kdbx, uuid: kdbxweb.KdbxUuid): kdbxweb.KdbxEntry {
        const found = find(db, uuid);
        expect(found).to.have.length(1);
        return <kdbxweb.KdbxEntry>found[0];
    }

    function group(db: kdbxweb.Kdbx, uuid: kdbxweb.KdbxUuid): kdbxweb.KdbxGroup {
        return db.getGroup(uuid)!;
    }

    function isDeleted(db: kdbxweb.Kdbx, uuid: kdbxweb.KdbxUuid): boolean {
        return db.deletedObjects.some((d) => d.uuid?.equals(uuid));
    }

    describe('moves', () => {
        it('puts an entry moved and changed remotely into a group merged earlier only there', async () => {
            const b = base();
            const [local, remote] = await copies(b.db);
            const remoteEntry = entry(remote, b.entry.uuid);
            remote.move(remoteEntry, group(remote, b.g1.uuid));
            remoteEntry.times.locationChanged = at(5);
            remoteEntry.fields.set('Title', 'moved');
            remoteEntry.times.lastModTime = at(5);

            local.merge(remote);

            const merged = entry(local, b.entry.uuid);
            expect(merged.parentGroup!.uuid.equals(b.g1.uuid)).to.be(true);
            expect(merged.fields.get('Title')).to.be('moved');
            expect(merged.times.locationChanged).to.eql(at(5));
            const [again] = await copies(local);
            again.merge(remote);
            expect(find(again, b.entry.uuid)).to.have.length(1);
        });

        it('keeps an entry where it was moved locally later than remotely', async () => {
            const b = base();
            const [local, remote] = await copies(b.db);
            const localEntry = entry(local, b.entry.uuid);
            local.move(localEntry, group(local, b.g1.uuid));
            localEntry.times.locationChanged = at(10);
            const remoteEntry = entry(remote, b.entry.uuid);
            remote.move(remoteEntry, remote.getDefaultGroup());
            remoteEntry.times.locationChanged = at(5);
            remoteEntry.fields.set('Title', 'changed');
            remoteEntry.times.lastModTime = at(5);

            local.merge(remote);

            const merged = entry(local, b.entry.uuid);
            expect(merged.parentGroup!.uuid.equals(b.g1.uuid)).to.be(true);
            expect(merged.fields.get('Title')).to.be('changed');
            expect(merged.times.locationChanged).to.eql(at(10));
        });

        it('takes a local edit along when the remote side moved the entry into a new group', async () => {
            const b = base();
            const [local, remote] = await copies(b.db);
            const created = remote.createGroup(remote.getDefaultGroup(), 'New');
            const remoteEntry = entry(remote, b.entry.uuid);
            remote.move(remoteEntry, created);
            remoteEntry.times.locationChanged = at(5);
            const localEntry = entry(local, b.entry.uuid);
            localEntry.fields.set('Title', 'local edit');
            localEntry.times.lastModTime = at(10);

            local.merge(remote);

            const merged = entry(local, b.entry.uuid);
            expect(merged.parentGroup!.uuid.equals(created.uuid)).to.be(true);
            expect(merged.fields.get('Title')).to.be('local edit');
        });

        it('takes a remote edit to an entry moved locally into a new group', async () => {
            const b = base();
            const [local, remote] = await copies(b.db);
            const created = local.createGroup(local.getDefaultGroup(), 'New');
            const localEntry = entry(local, b.entry.uuid);
            local.move(localEntry, created);
            localEntry.times.locationChanged = at(5);
            const remoteEntry = entry(remote, b.entry.uuid);
            remoteEntry.fields.set('Title', 'remote edit');
            remoteEntry.times.lastModTime = at(10);

            local.merge(remote);

            const merged = entry(local, b.entry.uuid);
            expect(merged.parentGroup!.uuid.equals(created.uuid)).to.be(true);
            expect(merged.fields.get('Title')).to.be('remote edit');
        });

        it('keeps groups moved into each other on the two sides reachable', async () => {
            const b = base();
            const [local, remote] = await copies(b.db);
            const localG1 = group(local, b.g1.uuid);
            local.move(localG1, group(local, b.g2.uuid));
            localG1.times.locationChanged = at(5);
            const remoteG2 = group(remote, b.g2.uuid);
            remote.move(remoteG2, group(remote, b.g1.uuid));
            remoteG2.times.locationChanged = at(10);

            local.merge(remote);
            remote.merge((await copies(local))[0]);

            for (const db of [local, remote]) {
                expect(find(db, b.g1.uuid)).to.have.length(1);
                expect(find(db, b.g2.uuid)).to.have.length(1);
                expect(find(db, b.entry.uuid)).to.have.length(1);
            }
            // G1 was placed earlier, so it goes where the remote side has it: below G2 stays
            // out, G2 below G1 wins
            expect(group(local, b.g2.uuid).parentGroup!.uuid.equals(b.g1.uuid)).to.be(true);
            expect(group(local, b.g1.uuid).parentGroup).to.be(local.getDefaultGroup());
        });
    });

    describe('deletions', () => {
        it('keeps an entry deleted on one side and changed later on the other', async () => {
            const b = base();
            const [local, remote] = await copies(b.db);
            local.move(entry(local, b.entry.uuid), null);
            local.deletedObjects[local.deletedObjects.length - 1].deletionTime = at(5);
            const remoteEntry = entry(remote, b.entry.uuid);
            remoteEntry.fields.set('Title', 'changed');
            remoteEntry.times.lastModTime = at(10);

            local.merge(remote);

            expect(entry(local, b.entry.uuid).fields.get('Title')).to.be('changed');
            expect(isDeleted(local, b.entry.uuid)).to.be(false);
        });

        it('deletes an entry the other side did not change since', async () => {
            const b = base();
            const [local, remote] = await copies(b.db);
            remote.move(entry(remote, b.entry.uuid), null);
            remote.deletedObjects[remote.deletedObjects.length - 1].deletionTime = at(5);

            local.merge(remote);

            expect(find(local, b.entry.uuid)).to.have.length(0);
            expect(isDeleted(local, b.entry.uuid)).to.be(true);
        });

        it('keeps a deleted group that got a new entry later, without its old entries', async () => {
            const b = base();
            const [local, remote] = await copies(b.db);
            local.move(group(local, b.g2.uuid), null);
            for (const d of local.deletedObjects) {
                d.deletionTime = at(5);
            }
            const added = remote.createEntry(group(remote, b.g2.uuid));
            added.times.lastModTime = at(10);
            added.times.locationChanged = at(10);

            local.merge(remote);

            expect(find(local, b.g2.uuid)).to.have.length(1);
            expect(find(local, added.uuid)).to.have.length(1);
            expect(find(local, b.entry.uuid)).to.have.length(0);
            expect(isDeleted(local, b.g2.uuid)).to.be(false);
            expect(isDeleted(local, b.entry.uuid)).to.be(true);
        });

        it('keeps one tombstone per object, with the later deletion time', async () => {
            const b = base();
            const [local, remote] = await copies(b.db);
            local.addDeletedObject(b.entry.uuid, at(5));
            remote.addDeletedObject(b.entry.uuid, at(7));
            local.move(entry(local, b.entry.uuid), null);
            local.deletedObjects.pop();

            local.merge(remote);

            const tombstones = local.deletedObjects.filter((d) => d.uuid?.equals(b.entry.uuid));
            expect(tombstones).to.have.length(1);
            expect(tombstones[0].deletionTime).to.eql(at(7));
        });
    });

    describe('custom icons', () => {
        const iconId = kdbxweb.KdbxUuid.random();
        const icon = (): kdbxweb.KdbxCustomIcon => ({
            data: kdbxweb.ByteUtils.stringToBytes('icon').buffer as ArrayBuffer,
            lastModified: t0
        });

        it('keeps icons that nothing uses', async () => {
            const b = base();
            b.db.meta.customIcons.set(iconId.id, icon());
            const [local, remote] = await copies(b.db);

            local.merge(remote);

            expect(local.meta.customIcons.has(iconId.id)).to.be(true);
            expect(isDeleted(local, iconId)).to.be(false);
        });

        it('deletes an icon the other side deleted and nobody used since', async () => {
            const b = base();
            b.db.meta.customIcons.set(iconId.id, icon());
            b.entry.customIcon = iconId;
            const [local, remote] = await copies(b.db);
            remote.meta.customIcons.delete(iconId.id);
            remote.addDeletedObject(iconId, at(5));
            entry(remote, b.entry.uuid).customIcon = undefined;

            local.merge(remote);

            expect(local.meta.customIcons.has(iconId.id)).to.be(false);
            expect(entry(local, b.entry.uuid).customIcon).to.be(undefined);
        });

        it('keeps a deleted icon that an entry started using later', async () => {
            const b = base();
            b.db.meta.customIcons.set(iconId.id, icon());
            const [local, remote] = await copies(b.db);
            remote.meta.customIcons.delete(iconId.id);
            remote.addDeletedObject(iconId, at(5));
            const localEntry = entry(local, b.entry.uuid);
            localEntry.customIcon = iconId;
            localEntry.times.lastModTime = at(10);

            local.merge(remote);

            expect(local.meta.customIcons.has(iconId.id)).to.be(true);
            expect(isDeleted(local, iconId)).to.be(false);
        });
    });

    it('refuses to move a group into its own subtree', () => {
        const b = base();
        const child = b.db.createGroup(b.g1, 'Child');
        expect(() => b.db.move(b.g1, child)).to.throwException((e) => {
            expect(e).to.be.a(kdbxweb.KdbxError);
            expect(e.code).to.be(kdbxweb.Consts.ErrorCodes.InvalidArg);
        });
        expect(() => b.db.move(b.g1, b.g1)).to.throwException();
        expect(child.parentGroup).to.be(b.g1);
        expect(b.g1.parentGroup).to.be(b.db.getDefaultGroup());
    });
});
