/**
 * Column conventions shared across the schema.
 *
 * Consistency here is what makes authorization auditable: if every
 * workspace-scoped table carries `workspaceId` the same way, a reviewer can
 * check tenancy by grepping for it rather than reading every query.
 */
import { sql } from 'drizzle-orm';
import { text, timestamp } from 'drizzle-orm/pg-core';
import { newId, type IdPrefixKey } from '@reklu/shared';

/** Primary key using Reklu's prefixed, time-sortable ids. */
export const primaryId = (kind: IdPrefixKey) =>
  text('id')
    .primaryKey()
    .$defaultFn(() => newId(kind));

/** `timestamptz` everywhere — storing local time is a bug waiting to happen. */
export const tsColumn = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** created_at / updated_at, applied to every table. */
export const timestamps = {
  createdAt: tsColumn('created_at')
    .notNull()
    .default(sql`now()`),
  updatedAt: tsColumn('updated_at')
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
};

/**
 * Soft deletion plus attribution, for business records where an accidental
 * delete must be recoverable and an audit question ("who removed this
 * connection?") must be answerable. Every query over these tables must filter
 * `deletedAt IS NULL` — see `notDeleted()` in ../query-helpers.
 */
export const softDelete = {
  deletedAt: tsColumn('deleted_at'),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
};
