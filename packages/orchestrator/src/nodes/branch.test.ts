/**
 * The bands a branch decides between.
 *
 * Two things are being protected. Every graph in production relies on the
 * three original names, so the defaults have to be exactly what they were.
 * And a graph that names its own paths has to actually get them — an outcome
 * the decision never returns is an edge nothing ever takes, with no error and
 * no failed run, which is the failure this whole area keeps producing.
 */
import { describe, expect, it } from 'vitest';
import { resolveOutcomes } from './branch.js';

const names = (config: Record<string, unknown>, pass = 0.6, human = 0.35) =>
  resolveOutcomes(config, pass, human).map((b) => b.name);

/** What the node would choose for a score, given its bands. */
const choose = (
  config: Record<string, unknown>,
  score: number,
  pass = 0.6,
  human = 0.35,
) => {
  const bands = resolveOutcomes(config, pass, human);
  return (
    bands.find((b) => score >= b.min)?.name ?? bands[bands.length - 1]!.name
  );
};

describe('the defaults are unchanged', () => {
  it('is still pass / human_review / reject when nothing is configured', () => {
    expect(names({})).toEqual(['pass', 'human_review', 'reject']);
  });

  it('still picks the same path for the same score', () => {
    expect(choose({}, 0.9)).toBe('pass');
    expect(choose({}, 0.6)).toBe('pass');
    expect(choose({}, 0.5)).toBe('human_review');
    expect(choose({}, 0.35)).toBe('human_review');
    expect(choose({}, 0.1)).toBe('reject');
    expect(choose({}, 0)).toBe('reject');
  });

  it('honours thresholds a graph set', () => {
    expect(choose({}, 0.85, 0.9, 0.5)).toBe('human_review');
    expect(choose({}, 0.95, 0.9, 0.5)).toBe('pass');
  });
});

describe('a graph naming its own paths', () => {
  const config = {
    outcomes: [
      { name: 'auto_send', min: 0.9 },
      { name: 'review', min: 0.5 },
      { name: 'escalate', min: 0.2 },
      { name: 'drop', min: 0 },
    ],
  };

  it('gets the paths it asked for', () => {
    expect(names(config)).toEqual(['auto_send', 'review', 'escalate', 'drop']);
  });

  it('takes the highest band the score reaches', () => {
    expect(choose(config, 0.95)).toBe('auto_send');
    expect(choose(config, 0.9)).toBe('auto_send');
    expect(choose(config, 0.7)).toBe('review');
    expect(choose(config, 0.3)).toBe('escalate');
    expect(choose(config, 0)).toBe('drop');
  });

  it('sends anything below every band to the lowest one', () => {
    // The catch-all. A score under the last threshold must land somewhere, and
    // silently choosing the FIRST band would send the worst work down the best
    // path.
    expect(choose(config, -5)).toBe('drop');
  });

  it('sorts bands however they were written', () => {
    const jumbled = {
      outcomes: [
        { name: 'drop', min: 0 },
        { name: 'auto_send', min: 0.9 },
        { name: 'review', min: 0.5 },
      ],
    };
    expect(names(jumbled)).toEqual(['auto_send', 'review', 'drop']);
    expect(choose(jumbled, 0.95)).toBe('auto_send');
  });

  it('supports more than three paths, which was the whole limitation', () => {
    expect(names(config)).toHaveLength(4);
  });
});

describe('a malformed band does not become a catch-all', () => {
  it('drops a band with no usable threshold rather than reading it as zero', () => {
    // A typo that silently became min 0 would sit below everything and
    // swallow every run.
    const config = {
      outcomes: [
        { name: 'good', min: 0.8 },
        { name: 'typo', min: 'high' },
        { name: 'bad', min: 0 },
      ],
    };
    expect(names(config)).toEqual(['good', 'bad']);
  });

  it('drops a nameless band', () => {
    const config = {
      outcomes: [
        { name: 'good', min: 0.8 },
        { name: '', min: 0.4 },
      ],
    };
    expect(names(config)).toEqual(['good']);
  });

  it('falls back to the defaults when nothing usable is left', () => {
    expect(names({ outcomes: [] })).toEqual(['pass', 'human_review', 'reject']);
    expect(names({ outcomes: 'nonsense' })).toEqual([
      'pass',
      'human_review',
      'reject',
    ]);
    expect(names({ outcomes: [{ name: 'x' }] })).toEqual([
      'pass',
      'human_review',
      'reject',
    ]);
  });
});
