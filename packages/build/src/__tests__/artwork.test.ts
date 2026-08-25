/**
 * The pictures on a generated site.
 *
 * Asked for a barber shop landing page, the model wrote an image URL from
 * memory and the page showed a photograph of someone deadlifting. It was not a
 * bad guess so much as a guess — no model has a catalogue of real image URLs —
 * so the model now describes each picture and Reklu draws it.
 */
import { describe, expect, it, vi } from 'vitest';
import { artworkPrompt, drawArtwork, plannedArtwork } from '../artwork';
import type { GeneratedFile } from '../parse';

function page(content: string): GeneratedFile {
  return { path: 'components/Hero.tsx', content, language: 'tsx' };
}

describe('finding the pictures a page expects', () => {
  it('reads the description from the alt of the same element', () => {
    const found = plannedArtwork([
      page(
        '<img src="/generated/hero.png" alt="a barber trimming a beard with clippers" width={1600} height={900} />',
      ),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe('public/generated/hero.png');
    expect(found[0]?.description).toBe('a barber trimming a beard with clippers');
  });

  it('reads an element formatted across several lines', () => {
    /*
     * The case that matters, because it is what real output looks like. A
     * pattern that only looked at one line found nothing at all on a formatted
     * component, which is every component the model writes.
     */
    const found = plannedArtwork([
      page(
        [
          '<Image',
          '  src="/generated/chair.png"',
          '  alt="a leather barber chair beside a sunlit window"',
          '  width={800}',
          '  height={800}',
          '/>',
        ].join('\n'),
      ),
    ]);

    expect(found[0]?.description).toBe('a leather barber chair beside a sunlit window');
    expect(found[0]?.shape).toBe('square');
  });

  it('takes the proportions from the declared size', () => {
    const wide = plannedArtwork([
      page('<img src="/generated/a.png" alt="a wide shot of the shop" width="1600" height="900" />'),
    ]);
    const tall = plannedArtwork([
      page('<img src="/generated/b.png" alt="a portrait of the barber" width="800" height="1200" />'),
    ]);

    expect(wide[0]?.shape).toBe('landscape');
    expect(tall[0]?.shape).toBe('portrait');
  });

  it('leaves images the site did not ask Reklu for alone', () => {
    // An external URL is the model guessing, and a local file it wrote itself is
    // not ours to replace. Neither is a request for a drawing.
    const found = plannedArtwork([
      page('<img src="https://images.example.com/x.jpg" alt="a barber shop interior" />'),
      page('<img src="/logo.svg" alt="the shop logo" />'),
    ]);

    expect(found).toHaveLength(0);
  });

  it('skips an image with no usable description', () => {
    /*
     * Drawing something arbitrary would put a confidently wrong picture on the
     * page — which is the failure this exists to remove, not a smaller one.
     */
    expect(plannedArtwork([page('<img src="/generated/x.png" alt="" />')])).toHaveLength(0);
    expect(plannedArtwork([page('<img src="/generated/x.png" alt="photo" />')])).toHaveLength(0);
  });

  it('asks for each picture once', () => {
    const found = plannedArtwork([
      page('<img src="/generated/hero.png" alt="a barber trimming a beard" />'),
      { ...page('<img src="/generated/hero.png" alt="a barber trimming a beard" />'), path: 'app/page.tsx' },
    ]);

    expect(found).toHaveLength(1);
  });
});

describe('what the image model is asked for', () => {
  it('carries the subject and forbids lettering', () => {
    const prompt = artworkPrompt(
      { path: 'public/generated/hero.png', description: 'a barber at work', shape: 'landscape' },
      'Cut & Craft Barber Shop',
    );

    expect(prompt).toContain('Cut & Craft Barber Shop');
    expect(prompt).toContain('a barber at work');
    // These sit behind real headings, and a picture with its own text fights them.
    expect(prompt).toMatch(/no text/i);
  });
});

describe('drawing them', () => {
  const files = [
    page('<img src="/generated/hero.png" alt="a barber trimming a beard" width={1600} height={900} />'),
  ];
  const binary = { storageKey: 'k', contentType: 'image/png', bytes: 1024 };

  it('adds each picture to the tree', async () => {
    const draw = vi.fn().mockResolvedValue(binary);
    const result = await drawArtwork(files, 'a barber shop', draw);

    expect(result.generated).toBe(1);
    const image = result.files.find((file) => file.path === 'public/generated/hero.png');
    expect(image?.binary).toEqual(binary);
    // The bytes are not in the tree; a code view reads this on every page load.
    expect(image?.content).toBe('');
  });

  it('draws one at a time', async () => {
    /*
     * Image generation is the most expensive call in a build. A page wanting
     * six must not open six connections to a provider that limits by the minute.
     */
    let running = 0;
    let peak = 0;
    const draw = vi.fn().mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return binary;
    });

    const many = [
      page(
        ['a', 'b', 'c']
          .map((name) => `<img src="/generated/${name}.png" alt="a barber shop scene ${name}" />`)
          .join('\n'),
      ),
    ];

    await drawArtwork(many, 'a barber shop', draw);

    expect(draw).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
  });

  it('keeps the build when a picture fails', async () => {
    /*
     * The application is written and working; what is missing is a photograph.
     * Throwing away everything around it would be the wrong trade, and saying
     * nothing would leave a gap nobody could explain.
     */
    const draw = vi.fn().mockRejectedValue(new Error('content policy'));
    const result = await drawArtwork(files, 'a barber shop', draw);

    expect(result.generated).toBe(0);
    expect(result.files).toHaveLength(1);
    expect(result.failures[0]?.reason).toContain('content policy');
  });

  it('does nothing at all when no picture was asked for', async () => {
    const draw = vi.fn();
    const result = await drawArtwork([page('<p>no images here</p>')], 'a shop', draw);

    expect(draw).not.toHaveBeenCalled();
    expect(result.files).toHaveLength(1);
  });
});
