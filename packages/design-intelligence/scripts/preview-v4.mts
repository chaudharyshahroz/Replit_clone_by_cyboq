/** Deterministic compiler fixture, NOT an AI-generation benchmark. No API or database calls. */
import { createServer } from 'node:http';
import { createDesignEngineV4, compileDesignStyles, understandProduct } from '../src/index.ts';

const subjects = {
  coffee: ['Coffino', 'Coffee shop', 'Coffee for your everyday ritual.'],
  finance: ['Ledger', 'Financial analytics SaaS', 'Know where your business stands.'],
  fitness: ['Forma', 'Premium gym', 'Build strength with purpose.'],
  fashion: ['Vela', 'Fashion brand', 'A considered collection.'],
} as const;
const server = createServer((request, response) => {
  const key =
    new URL(request.url ?? '/', 'http://localhost').searchParams.get('category') ?? 'coffee';
  const [product, summary, heading] = subjects[key as keyof typeof subjects] ?? subjects.coffee;
  const engine = createDesignEngineV4(understandProduct({ product, summary, target: 'website' }));
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>V4 compiler fixture · ${product}</title><style>${compileDesignStyles(engine)}
  *{box-sizing:border-box}p{max-width:62ch}nav{display:flex;align-items:center;justify-content:space-between;padding-block:1rem;border-bottom:1px solid #8885}article{padding:var(--card-padding);border:1px solid #8885;border-radius:var(--card-radius)}a{color:inherit}.fixture-demo{padding:2rem;background:var(--color-surface);border:1px solid #8885;border-radius:var(--card-radius)}.fixture-demo strong{display:block;font-size:2rem}.fixture-demo p{margin-block:1rem}footer{padding:2rem}small{display:block}
  </style><body><nav class="rk-container"><strong>${product}</strong><a href="#collection">Explore</a></nav>
  <main><section class="rk-container rk-hero" data-section-id="arrival"><div><small>COMPILER REGRESSION FIXTURE</small><h1 class="rk-hero-title">${heading}</h1><p>This tests real typography, responsive columns, controls and semantic color pairs. It is not a generated customer website.</p><a class="rk-button" href="#collection">Explore the details <span aria-hidden="true">→</span></a></div><div class="fixture-demo"><strong>Readable by design</strong><p>Hero and section sizes are separate. Useful content fits beside the heading.</p><p>No photograph is claimed here: this is a structural test fixture.</p></div></section>
  <section class="rk-container rk-section" id="collection" data-section-id="evidence"><h2 class="rk-section-title">A clear choice, without the clutter.</h2><div class="rk-grid">${Array.from({ length: 6 }, (_, index) => `<article><h3>Option ${index + 1}</h3><p>A readable paragraph should not become a stack of single words inside a skinny card.</p><button class="rk-button" type="button" onclick="this.textContent='Selected'">Select option</button></article>`).join('')}</div></section>
  <section class="rk-surface-primary rk-section" data-section-id="action"><div class="rk-container"><h2 class="rk-section-title">A readable final action.</h2><p>Foreground and background are a semantic pair, even when an image is unavailable.</p><a href="#collection">Review the collection</a></div></section></main><footer class="rk-container">Development fixture · not a production or competitor benchmark</footer></body></html>`);
});
server.listen(4317, '127.0.0.1', () =>
  console.log('V4 structural fixture listening on 127.0.0.1:4317'),
);
