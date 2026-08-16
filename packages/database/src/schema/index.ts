/**
 * The complete Reklu schema.
 *
 * Drizzle needs every table and relation in one object to resolve the relational
 * query API, so this barrel is the single source drizzle-kit reads.
 */
export * from './enums';
export * from './identity';
export * from './tenancy';
export * from './projects';
export * from './conversations';
export * from './ai';
export * from './knowledge';
export * from './artifacts';
export * from './research';
export * from './build';
export * from './tools';
export * from './skills';
export * from './agents';
export * from './billing';
export * from './platform';
