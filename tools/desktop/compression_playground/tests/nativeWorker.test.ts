// Copyright (c) Meta Platforms, Inc. and affiliates.

// @vitest-environment node

import {afterEach, describe, expect, it} from 'vitest';
import {run, type BenchmarkEvent} from '../electron/native-worker.cjs';
import {fakeZli, removeFakeZlis, UNORDERED_CANDIDATES_ZLI} from './fakeZli.ts';

afterEach(removeFakeZlis);

describe('run', () => {
  it('reports in the browser worker’s vocabulary: steps through training and per candidate, then a result per measurement', async () => {
    const events: BenchmarkEvent[] = [];
    const results = await run(
      {
        zliPath: fakeZli(),
        request: {
          input: {data: new TextEncoder().encode('OpenZL '.repeat(1000))},
          iterations: 2,
          compressors: [
            {
              id: 1,
              compressor: 'OpenZL',
              level: 6,
              profile: 'serial',
              trainRequested: true,
              candidates: 10,
              profileArg: '',
            },
            {id: 2, compressor: 'gzip', level: 5},
          ],
        },
      },
      {onEvent: (event) => events.push(event)},
    );

    expect(
      events.map((event) =>
        event.type === 'result' ? {result: event.result.rowId, candidate: event.result.candidate} : event,
      ),
    ).toEqual([
      // Training fills the row's first 80%, its one candidate the rest: the
      // step never goes back.
      {type: 'step', fraction: 0},
      {type: 'step', fraction: 0.4},
      {type: 'step', fraction: 0.8},
      {type: 'step', fraction: 0.8},
      {result: 1, candidate: {index: 1, total: 1}},
      {result: 2, candidate: null},
    ]);
    expect(results.map((result) => result.rowId)).toEqual([1, 2]);
  });

  it('sends each trained candidate’s result as soon as it is measured', async () => {
    const events: BenchmarkEvent[] = [];
    await run(
      {
        zliPath: fakeZli(UNORDERED_CANDIDATES_ZLI),
        request: {
          input: {data: new Uint8Array(100)},
          iterations: 1,
          compressors: [
            {
              id: 1,
              compressor: 'OpenZL',
              level: 1,
              profile: 'serial',
              trainRequested: true,
              candidates: 10,
              profileArg: '',
            },
          ],
        },
      },
      {onEvent: (event) => events.push(event)},
    );

    // After training's steps: each candidate's step, then its result, in turn.
    const described = events.slice(3).map((event) => {
      switch (event.type) {
        case 'step':
          return `step ${event.fraction.toFixed(2)}`;
        case 'result':
          return `result ${event.result.candidate?.index}`;
        case 'failure':
          return 'failure';
      }
    });
    expect(described).toEqual([
      'step 0.80',
      'result 1',
      'step 0.85',
      'result 2',
      'step 0.90',
      'result 3',
      'step 0.95',
      'result 4',
    ]);
  });

  it('reports a row it cannot measure as a failure and goes on to the next', async () => {
    const events: BenchmarkEvent[] = [];
    const results = await run(
      {
        zliPath: fakeZli("process.stderr.write('Profile not found\\n'); process.exit(1);"),
        request: {
          input: {data: new Uint8Array(100)},
          iterations: 1,
          compressors: [
            {
              id: 1,
              compressor: 'OpenZL',
              level: 1,
              profile: 'bogus',
              trainRequested: false,
              candidates: 10,
              profileArg: '',
            },
            {id: 2, compressor: 'gzip', level: 5},
          ],
        },
      },
      {onEvent: (event) => events.push(event)},
    );

    expect(events.map((event) => event.type)).toEqual(['failure', 'result']);
    expect(events[0]).toEqual({
      type: 'failure',
      failure: {rowId: 1, candidate: null, message: expect.stringContaining('Profile not found')},
    });
    expect(results.map((result) => result.rowId)).toEqual([2]);
  });

  it('stops at a cancel rather than reporting it as a failed row', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Benchmark cancelled'));
    const events: BenchmarkEvent[] = [];

    await expect(
      run(
        {
          zliPath: fakeZli(),
          request: {
            input: {data: new Uint8Array(100)},
            iterations: 1,
            compressors: [{id: 1, compressor: 'gzip', level: 5}],
          },
        },
        {signal: controller.signal, onEvent: (event) => events.push(event)},
      ),
    ).rejects.toThrow('Benchmark cancelled');
    expect(events).toEqual([]);
  });
});
