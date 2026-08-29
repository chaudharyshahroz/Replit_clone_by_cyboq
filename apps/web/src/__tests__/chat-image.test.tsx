/**
 * A generated picture belongs in the transcript.
 *
 * Image generation worked and then announced itself in a sentence — "Generated
 * … · 1024x1024 · 1465 KB" — while the picture went to Artifacts, so the one
 * thing that was asked for was the one thing not on screen. These cover both
 * halves: the picture arriving mid-stream, and the picture still being there
 * when the conversation is reopened.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/chat',
}));

const { ChatView } = await import('@/components/chat/chat-view');

const models = [
  {
    key: 'gpt-5',
    displayName: 'GPT-5',
    providerName: 'OpenAI',
    description: 'Frontier reasoning',
    speed: 'balanced',
    costTier: 'premium',
    isDevelopmentMock: false,
  },
];

/** A stream that answers with a sentence and an image, as the image tool does. */
function streamingResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('generated images in chat', () => {
  it('shows the picture the turn produced, not only its size', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamingResponse([
          { type: 'start', modelKey: 'gpt-5' },
          { type: 'text-delta', text: 'Generated **a man at a desk** · 1024x1024 · 1465 KB' },
          {
            type: 'image',
            image: {
              storageKey: 'ws_1/images/abc.png',
              alt: 'a man at a desk',
              size: '1024x1024',
              bytes: 1_500_000,
              artifactId: 'artifact_1',
            },
          },
          { type: 'finish', finishReason: 'stop' },
        ]),
      ),
    );

    const user = userEvent.setup();
    render(<ChatView models={models} initialMessages={[]} devMockActive={false} />);

    await user.type(screen.getByRole('textbox'), 'a man at a desk');
    await user.keyboard('{Enter}');

    const image = await screen.findByAltText('a man at a desk');
    // Read through the authenticated file route, never a raw storage path.
    await waitFor(() =>
      expect(image.getAttribute('src')).toContain('/api/files/ws_1/images/abc.png'),
    );
  });

  it('keeps the picture when the conversation is reopened', () => {
    render(
      <ChatView
        models={models}
        initialMessages={[
          {
            id: 'msg_1',
            role: 'assistant',
            text: 'Generated **a man at a desk**',
            modelKey: 'gpt-5',
            images: [
              {
                storageKey: 'ws_1/images/abc.png',
                alt: 'a man at a desk',
                size: '1024x1024',
                bytes: 1_500_000,
              },
            ],
          },
        ]}
        devMockActive={false}
      />,
    );

    expect(screen.getByAltText('a man at a desk')).toBeTruthy();
  });
});
