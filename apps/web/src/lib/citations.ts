/**
 * A source a report cites.
 *
 * Lives here rather than in @reklu/research because client components render
 * it, and that package reaches the database — importing it into the browser is
 * a mistake this repo has made three times and now checks for.
 */
export interface CitedSource {
  readonly index: number;
  readonly url: string;
  readonly title: string;
  readonly domain: string | null;
  /** The passage the claim was drawn from, when the pipeline captured one. */
  readonly snippet?: string | null;
}
