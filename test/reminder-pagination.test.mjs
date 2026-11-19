
import test from "node:test";
import assert from "node:assert/strict";

import { forEachSchedulePage } from "../supabase/functions/send-due-reminders/pagination.mjs";

function createMockAdmin(records) {
  const queries = [];

  return {
    queries,

    from(table) {
      assert.equal(table, "reminder_schedules");

      return {
        select(columns) {
          assert.equal(
            columns,
            "id,firebase_uid,reminder_time,timezone,repeat_days,notification_body,updated_at",
          );

          const query = {
            enabled: null,
            orderBy: null,
            ascending: null,
            pageSize: null,
            lastId: null,
          };

          const builder = {
            eq(column, value) {
              assert.equal(column, "enabled");
              query.enabled = value;
              return builder;
            },

            order(column, options) {
              query.orderBy = column;
              query.ascending = options.ascending;
              return builder;
            },

            limit(value) {
              query.pageSize = value;
              return builder;
            },

            gt(column, value) {
              assert.equal(column, "id");
              query.lastId = value;
              return builder;
            },

            then(resolve, reject) {
              queries.push({ ...query });

              let filtered = records
                .filter(record => record.enabled === query.enabled)
                .sort((a, b) => a.id.localeCompare(b.id));

              if (query.lastId !== null) {
                filtered = filtered.filter(
                  record => record.id > query.lastId,
                );
              }

              return Promise.resolve({
                data: filtered.slice(0, query.pageSize),
                error: null,
              }).then(resolve, reject);
            },
          };

          return builder;
        },
      };
    },
  };
}

test("Pagination processes 1201 records without duplicates or skipped records", async () => {
  const records = Array.from({ length: 1201 }, (_, index) => ({
    id: `schedule-${String(index + 1).padStart(4, "0")}`,
    firebase_uid: `user-${index + 1}`,
    enabled: true,
  }));

  const expectedIds = records.map(record => record.id);
  const processedIds = [];

  const admin = createMockAdmin(records);

  await forEachSchedulePage(
    admin,
    async schedule => {
      processedIds.push(schedule.id);
    },
    500,
  );

  // Every record was processed.
  assert.equal(processedIds.length, 1201);

  // No duplicate records.
  assert.equal(new Set(processedIds).size, 1201);

  // No skipped records and correct order.
  assert.deepEqual(processedIds, expectedIds);

  // Exactly three page queries: 500 + 500 + 201.
  assert.equal(admin.queries.length, 3);

  assert.deepEqual(
    admin.queries.map(query => query.lastId),
    [
      null,
      "schedule-0500",
      "schedule-1000",
    ],
  );

  for (const query of admin.queries) {
    assert.equal(query.enabled, true);
    assert.equal(query.orderBy, "id");
    assert.equal(query.ascending, true);
    assert.equal(query.pageSize, 500);
  }
});

test("Pagination rejects an invalid page size", async () => {
  const admin = createMockAdmin([]);

  await assert.rejects(
    () => forEachSchedulePage(admin, async () => {}, 0),
    /pageSize must be a positive integer/,
  );
});

test("Pagination propagates database query errors", async () => {
  const admin = {
    from() {
      return {
        select() {
          return {
            eq() { return this; },
            order() { return this; },
            limit() { return this; },

            then(resolve) {
              return Promise.resolve({
                data: null,
                error: new Error("Database connection failed"),
              }).then(resolve);
            },
          };
        },
      };
    },
  };

  await assert.rejects(
    () => forEachSchedulePage(admin, async () => {}),
    /Database connection failed/,
  );
});
