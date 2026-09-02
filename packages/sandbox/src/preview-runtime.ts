/**
 * Runtime-only files shared by every sandbox driver.
 *
 * Keep the path relative to the sandbox working directory. An absolute `/tmp`
 * path works inside Docker and E2B, but points at the Reklu host when the local
 * development driver runs a diagnostic command. That made local preview logs
 * permanently empty and allowed an unconsumed child-process pipe to fill up.
 */
export const DEV_LOG_PATH = '.reklu-dev-server.log';
