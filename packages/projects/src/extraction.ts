/**
 * Proposing memories from a conversation (spec §18).
 *
 * Reklu reads a completed turn and proposes durable facts, decisions and
 * preferences. Everything it proposes lands **unapproved** — the approval gate
 * in memory.ts is what keeps a model from silently writing its own long-term
 * beliefs.
 *
 * Two design constraints:
 *
 *  - **Structured output, strictly validated.** A model asked for JSON will
 *    occasionally return prose, a fenced block, or extra keys. The parser
 *    tolerates the common deviations and rejects the rest rather than
 *    persisting garbage.
 *  - **Nothing is invented.** The prompt demands each memory be traceable to
 *    something actually said; the extractor records the message it came from,
 *    so the UI can always answer "why does Reklu think this?".
 */
import { z } from 'zod';
import { getProvider, type ModelMessage, type RegisteredModel } from '@reklu/ai';
import { logger } from '@reklu/shared';
import { remember } from './memory';

const ProposedMemory = z.object({
  kind: z.enum(['fact', 'preference', 'decision']),
  content: z.string().trim().min(8).max(500),
  importance: z.number().min(0).max(1).optional(),
});

const ProposalList = z.object({
  memories: z.array(ProposedMemory).max(5),
});

export type ProposedMemoryValue = z.infer<typeof ProposedMemory>;

const EXTRACTION_PROMPT = [
  'You extract durable project memory from a conversation.',
  '',
  'Return JSON: {"memories":[{"kind":"fact"|"preference"|"decision","content":"…"}]}',
  '',
  'Rules:',
  '- Only record things that will still matter in a future conversation.',
  '- Each memory must be traceable to something actually stated. Never infer beyond the text.',
  '- Skip pleasantries, restatements of the question, and anything transient.',
  '- Write each memory as a standalone sentence that makes sense without the conversation.',
  '- Return {"memories":[]} when nothing durable was said. That is the common case.',
].join('\n');

/**
 * Parse a model response into proposals.
 *
 * Exported for testing: this is the part most likely to break when a model
 * changes its formatting habits, and it must never throw into a request.
 */
export function parseProposals(raw: string): readonly ProposedMemoryValue[] {
  const text = raw.trim();
  if (text.length === 0) return [];

  // Models frequently wrap JSON in a fence despite being told not to.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();

  // Or prepend prose before the object.
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    return [];
  }

  const result = ProposalList.safeParse(parsed);
  if (!result.success) {
    // Salvage the valid entries rather than discarding the whole batch for one
    // malformed item.
    const loose = z.object({ memories: z.array(z.unknown()) }).safeParse(parsed);
    if (!loose.success) return [];
    return loose.data.memories
      .map((entry) => ProposedMemory.safeParse(entry))
      .filter((entry): entry is { success: true; data: ProposedMemoryValue } => entry.success)
      .map((entry) => entry.data);
  }

  return result.data.memories;
}

export interface ExtractionInput {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly model: RegisteredModel;
  readonly userMessage: string;
  readonly assistantMessage: string;
  /** Provenance for everything proposed from this turn. */
  readonly sourceMessageId: string;
}

export interface ExtractionResult {
  readonly proposed: number;
  readonly skippedReason?: string;
}

/**
 * Extract and persist proposals for review.
 *
 * Never throws: memory extraction is an enhancement running after the user
 * already has their answer, and failing it must not surface as an error.
 */
export async function extractMemories(input: ExtractionInput): Promise<ExtractionResult> {
  // A mock cannot do structured extraction, and inventing memories from it
  // would populate the review queue with nonsense.
  if (input.model.isDevelopmentMock) {
    return { proposed: 0, skippedReason: 'Development mock cannot extract memories' };
  }

  const provider = getProvider(input.model.providerKey);
  if (!provider) return { proposed: 0, skippedReason: 'Provider unavailable' };

  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            'Conversation turn:',
            '',
            `User: ${input.userMessage.slice(0, 4_000)}`,
            '',
            `Assistant: ${input.assistantMessage.slice(0, 4_000)}`,
          ].join('\n'),
        },
      ],
    },
  ];

  try {
    const result = await provider.generate({
      modelIdentifier: input.model.modelIdentifier,
      messages,
      system: EXTRACTION_PROMPT,
      maxOutputTokens: 800,
      // Deterministic: the same turn should not yield different memories on a
      // retry.
      temperature: 0,
    });

    const proposals = parseProposals(result.text);
    if (proposals.length === 0) return { proposed: 0 };

    for (const proposal of proposals) {
      await remember({
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        kind: proposal.kind,
        // Always 'inferred' — this is Reklu's reading, not the user's statement,
        // so it stays out of context until approved.
        source: 'inferred',
        content: proposal.content,
        ...(proposal.importance !== undefined ? { importance: proposal.importance } : {}),
        sourceMessageId: input.sourceMessageId,
      });
    }

    logger.info('Proposed project memories for review', {
      projectId: input.projectId,
      count: proposals.length,
    });
    return { proposed: proposals.length };
  } catch (error) {
    logger.error('Memory extraction failed', { error, projectId: input.projectId });
    return { proposed: 0, skippedReason: 'Extraction failed' };
  }
}
