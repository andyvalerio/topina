/**
 * Everything that has to outlive the process.
 *
 * `node:sqlite` is built in, so this costs no dependency. It holds four
 * things: settings, the outing state, a log of meaningful events, and
 * incidents.
 *
 * Settings follow the pattern already used by `showgrab`: seeded from
 * defaults and the environment **once**, after which the stored value wins.
 * That surprises people later — editing an environment variable then does
 * nothing — so every setting records where its value came from, and the
 * dashboard can say so rather than leaving it a mystery (**N9**).
 *
 * The state rows are what make a restart survivable. Without them a service
 * restarted mid-outing forgets she is outside, stops tracking, and says
 * nothing about it.
 */
import { DatabaseSync } from 'node:sqlite';

/**
 * @param {string} path
 * @returns {object}
 */
export function open(path) {
    const db = new DatabaseSync(path);

    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            source     TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS state (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            ts   INTEGER NOT NULL,
            kind TEXT NOT NULL,
            data TEXT
        );
        CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
        CREATE TABLE IF NOT EXISTS incidents (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at INTEGER NOT NULL,
            ended_at   INTEGER,
            codes      TEXT NOT NULL,
            peak       TEXT,
            label      TEXT
        );
        CREATE INDEX IF NOT EXISTS incidents_started ON incidents (started_at);
    `);

    const stmt = {
        readSetting: db.prepare('SELECT value, source FROM settings WHERE key = ?'),
        allSettings: db.prepare('SELECT key, value, source FROM settings ORDER BY key'),
        writeSetting: db.prepare(
            'INSERT INTO settings (key, value, source, updated_at) VALUES (?, ?, ?, ?) ' +
                'ON CONFLICT(key) DO UPDATE SET value = excluded.value, ' +
                'source = excluded.source, updated_at = excluded.updated_at'
        ),
        readState: db.prepare('SELECT value FROM state WHERE key = ?'),
        writeState: db.prepare(
            'INSERT INTO state (key, value) VALUES (?, ?) ' +
                'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        ),
        addEvent: db.prepare('INSERT INTO events (ts, kind, data) VALUES (?, ?, ?)'),
        eventsBetween: db.prepare('SELECT ts, kind, data FROM events WHERE ts >= ? AND ts <= ? ORDER BY ts'),
        addIncident: db.prepare(
            'INSERT INTO incidents (started_at, ended_at, codes, peak, label) VALUES (?, ?, ?, ?, NULL)'
        ),
        recentIncidents: db.prepare(
            'SELECT id, started_at, ended_at, codes, peak, label FROM incidents ORDER BY started_at DESC LIMIT ?'
        ),
        labelIncident: db.prepare('UPDATE incidents SET label = ? WHERE id = ?'),
        prune: db.prepare('DELETE FROM events WHERE ts < ?'),
        countEvents: db.prepare('SELECT COUNT(*) AS n FROM events'),
    };

    return {
        /**
         * Seed a setting if it has never been stored. Later calls do nothing,
         * which is why the source is recorded.
         * @param {string} key
         * @param {unknown} value
         * @param {string} source 'default' or 'env'
         */
        seed(key, value, source) {
            if (stmt.readSetting.get(key)) return;
            stmt.writeSetting.run(key, JSON.stringify(value), source, Date.now());
        },

        /** @param {string} key */
        get(key) {
            const row = stmt.readSetting.get(key);
            return row ? JSON.parse(row.value) : undefined;
        },

        /** Every setting, with where its value came from. */
        settings() {
            return stmt.allSettings.all().map((r) => ({
                key: r.key,
                value: JSON.parse(r.value),
                source: r.source,
            }));
        },

        /** @param {string} key @param {unknown} value */
        set(key, value) {
            stmt.writeSetting.run(key, JSON.stringify(value), 'dashboard', Date.now());
        },

        /** @param {string} key @param {unknown} value */
        saveState(key, value) {
            stmt.writeState.run(key, JSON.stringify(value));
        },

        /** @param {string} key */
        loadState(key) {
            const row = stmt.readState.get(key);
            return row ? JSON.parse(row.value) : null;
        },

        /** @param {string} kind @param {unknown} [data] @param {number} [ts] */
        record(kind, data = null, ts = Date.now()) {
            stmt.addEvent.run(ts, kind, data === null ? null : JSON.stringify(data));
        },

        /** @param {number} fromMs @param {number} toMs */
        events(fromMs, toMs) {
            return stmt.eventsBetween.all(fromMs, toMs).map((r) => ({
                ts: r.ts,
                kind: r.kind,
                data: r.data ? JSON.parse(r.data) : null,
            }));
        },

        /**
         * @param {{startedAt: number, endedAt: number|null, codes: string[], peak: object, zone: string|null}} incident
         */
        addIncident(incident) {
            stmt.addIncident.run(
                incident.startedAt,
                incident.endedAt,
                JSON.stringify(incident.codes),
                JSON.stringify({ ...incident.peak, zone: incident.zone })
            );
        },

        /** @param {number} [limit] */
        incidents(limit = 50) {
            return stmt.recentIncidents.all(limit).map((r) => ({
                id: r.id,
                startedAt: r.started_at,
                endedAt: r.ended_at,
                codes: JSON.parse(r.codes),
                peak: r.peak ? JSON.parse(r.peak) : null,
                label: r.label,
            }));
        },

        /**
         * The whole point of storing them: saying which were real is what
         * turns provisional thresholds into measured ones.
         * @param {number} id @param {string} label
         */
        labelIncident(id, label) {
            stmt.labelIncident.run(label, id);
        },

        /**
         * Drop events older than a cut-off. Incidents are never pruned — they
         * are scarce and they are the part worth keeping.
         * @param {number} beforeMs
         */
        prune(beforeMs) {
            stmt.prune.run(beforeMs);
        },

        countEvents: () => stmt.countEvents.get().n,

        close: () => db.close(),
    };
}
