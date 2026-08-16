/**
 * Research pipeline contracts (docs/RESEARCH_ARCHITECTURE.md).
 *
 * Each stage is a module with typed input and output so stages can be tested,
 * replaced, and reported on individually — as opposed to "send search results
 * to an LLM", which spec §22 explicitly forbids.
 */

export type ResearchMode = 'quick' | 'research' | 'deep';

/** Mirrors the `research_stage` enum; progress shown is the stage actually entered. */
export type ResearchStage =
  | 'analyzing_intent'
  | 'planning'
  | 'generating_queries'
  | 'discovering_sources'
  | 'fetching_sources'
  | 'extracting_content'
  | 'ranking_relevance'
  | 'cross_validating'
  | 'collecting_evidence'
  | 'reasoning'
  | 'writing_report';

export type SourceKind = 'web' | 'news' | 'academic' | 'file' | 'project' | 'connection';

/** A source before retrieval — a search hit or a knowledge-base match. */
export interface DiscoveredSource {
  readonly kind: SourceKind;
  readonly url: string | null;
  readonly title: string;
  readonly snippet: string | null;
  readonly domain: string | null;
  /** Which planner query surfaced this. */
  readonly foundByQuery: string;
  /** Populated by workspace adapters so retrieval is a lookup, not a fetch. */
  readonly localContent?: string;
  readonly localFileId?: string;
}

/** A source after retrieval. `content` is null when the fetch failed. */
export interface FetchedSource extends DiscoveredSource {
  readonly content: string | null;
  readonly fetchError: string | null;
  readonly httpStatus: number | null;
  readonly retrievedAt: Date;
  readonly publishedAt: Date | null;
}

/** A source after ranking and cross-validation. */
export interface RankedSource extends FetchedSource {
  readonly relevanceScore: number;
  /** Raised when other retrieved sources corroborate this one. */
  readonly corroborationScore: number;
  /** Indexes of retrieved sources that contradict this one. */
  readonly contradictedBy: readonly number[];
  /** 1-based display index; null when the source was not used. */
  readonly citationIndex: number | null;
}

export interface ResearchPlan {
  /** What the user is actually asking, restated. */
  readonly intent: string;
  /** Sub-questions that must be answered for the whole question to be answered. */
  readonly subQuestions: readonly string[];
  /** What kind of evidence would settle it. */
  readonly evidenceNeeded: readonly string[];
  /** When to stop — prevents Deep Research looping without end. */
  readonly stoppingCondition: string;
}

export interface EvidenceItem {
  readonly claim: string;
  /** Verbatim passage supporting the claim. */
  readonly passage: string;
  /** 1-based index into the ranked source list. */
  readonly sourceIndex: number;
}

export interface ResearchOutcome {
  readonly plan: ResearchPlan;
  readonly queries: readonly string[];
  readonly sources: readonly RankedSource[];
  readonly report: string;
  /** Short answer, for Quick Search. */
  readonly answer: string | null;
  readonly citations: readonly EvidenceItem[];

  readonly sourcesDiscovered: number;
  readonly sourcesFetched: number;
  readonly sourcesUsed: number;
  /** Reported honestly: "14 of 18 sources retrieved" (spec §88). */
  readonly sourcesFailed: number;
  /** Markers the model invented, which were stripped from the report. */
  readonly fabricatedCitationsRemoved: number;
}

/** Progress callback. Stages are announced as they are entered, never predicted. */
export type StageReporter = (stage: ResearchStage, detail?: string) => void | Promise<void>;

export interface SourceAdapter {
  readonly kind: SourceKind;
  /** True when this instance can actually use the adapter. */
  isConfigured(): boolean;
  search(query: string, limit: number): Promise<readonly DiscoveredSource[]>;
}

export class ResearchNotConfiguredError extends Error {
  readonly requiredEnv: readonly string[];
  constructor(requiredEnv: readonly string[]) {
    super(
      'Web research is not configured on this Reklu instance. ' +
        `Set ${requiredEnv.join(' or ')} to enable it.`,
    );
    this.name = 'ResearchNotConfiguredError';
    this.requiredEnv = requiredEnv;
  }
}
