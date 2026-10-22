// Copyright (c) Meta Platforms, Inc. and affiliates.

/* eslint-disable @typescript-eslint/no-require-imports */

'use strict';

const fs = require('node:fs');
const {performance} = require('node:perf_hooks');
const zlib = require('node:zlib');
const {runOpenZLBenchmark} = require('./zli-client.cjs');

// The codecs are synchronous, so the worker yields between timed iterations to
// receive a cancel message. Only the codec calls themselves are timed.
async function timedIterations(iterations, signal, operation) {
  let elapsedMs = 0;
  let output;
  for (let index = 0; index < iterations; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    signal?.throwIfAborted();
    const start = performance.now();
    output = operation();
    elapsedMs += performance.now() - start;
  }
  return {elapsedMs, output};
}

async function nativeCodecBenchmark(input, iterations, compress, decompress, signal) {
  // The untimed warm-up calls cannot be interrupted either, so check first.
  signal?.throwIfAborted();
  compress(input);
  const {elapsedMs: compressMs, output: compressed} = await timedIterations(iterations, signal, () => compress(input));

  signal?.throwIfAborted();
  decompress(compressed);
  const {elapsedMs: decompressMs, output: decompressed} = await timedIterations(iterations, signal, () =>
    decompress(compressed),
  );
  if (!Buffer.from(decompressed).equals(input)) {
    throw new Error('Native codec did not reproduce the input');
  }
  const bytesMeasured = input.length * iterations;
  return {
    iterations,
    srcSize: input.length,
    compressedSize: compressed.length,
    ratio: compressed.length === 0 ? 0 : input.length / compressed.length,
    compressMs,
    decompressMs,
    compressMBps: compressMs === 0 ? Infinity : bytesMeasured / compressMs / 1000,
    decompressMBps: decompressMs === 0 ? Infinity : bytesMeasured / decompressMs / 1000,
  };
}

function benchmarkZstd(input, level, iterations, signal) {
  if (typeof zlib.zstdCompressSync !== 'function' || typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('This Electron runtime does not include native zstd support');
  }
  const params = {[zlib.constants.ZSTD_c_compressionLevel]: level};
  return nativeCodecBenchmark(
    input,
    iterations,
    (value) => zlib.zstdCompressSync(value, {params}),
    (value) => zlib.zstdDecompressSync(value),
    signal,
  );
}

function benchmarkGzip(input, level, iterations, signal) {
  return nativeCodecBenchmark(
    input,
    iterations,
    (value) => zlib.gzipSync(value, {level}),
    (value) => zlib.gunzipSync(value),
    signal,
  );
}

function readRequestInput(input) {
  if ('path' in input) {
    return fs.readFileSync(input.path);
  }
  return Buffer.from(input.data.buffer, input.data.byteOffset, input.data.byteLength);
}

function finishOpenZLResult(result) {
  const bytesMeasured = result.srcSize * result.iterations;
  return {
    ...result,
    ratio: result.compressedSize === 0 ? 0 : result.srcSize / result.compressedSize,
    compressMBps: result.compressMs === 0 ? Infinity : bytesMeasured / result.compressMs / 1000,
    decompressMBps: result.decompressMs === 0 ? Infinity : bytesMeasured / result.decompressMs / 1000,
  };
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

async function measure({zliPath, request, tempRoot}, compressor, readInput, options) {
  if (compressor.compressor === 'OpenZL') {
    const measurements = await runOpenZLBenchmark(zliPath, request.input, compressor, request.iterations, {
      ...options,
      tempRoot,
    });
    return measurements.map((measurement, index) => ({
      ...finishOpenZLResult(measurement),
      rowId: compressor.id,
      candidate: compressor.trainRequested ? {index: index + 1, total: measurements.length} : null,
    }));
  }
  const measurement =
    compressor.compressor === 'zstd'
      ? await benchmarkZstd(readInput(), compressor.level, request.iterations, options.signal)
      : await benchmarkGzip(readInput(), compressor.level, request.iterations, options.signal);
  return [{...measurement, rowId: compressor.id, candidate: null}];
}

/**
 * Runs every row in order, reporting as the browser's worker does: a `result`
 * per measurement, or a `failure` for a row that could not be measured. A
 * failed row does not stop the run; only cancelling does. Trained candidates
 * are counted from 1, best ratio first; `candidate` is null for every row that
 * does not train.
 */
async function run(payload, {signal, onChild, onEvent} = {}) {
  const results = [];
  let input;
  const readInput = () => (input ??= readRequestInput(payload.request.input));

  for (const compressor of payload.request.compressors) {
    signal?.throwIfAborted();
    let measured;
    try {
      measured = await measure(payload, compressor, readInput, {signal, onChild});
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      onEvent?.({type: 'failure', failure: {rowId: compressor.id, candidate: null, message: messageOf(error)}});
      continue;
    }
    for (const result of measured) {
      results.push(result);
      onEvent?.({type: 'result', result});
    }
  }
  return results;
}

/**
 * Worker protocol. From the main process: {type: 'start', zliPath, request, tempRoot},
 * then optionally {type: 'cancel'}. To it: {type: 'child', pid, state} for
 * every zli process, run()'s events, then exactly one of {type: 'finished'},
 * {type: 'failed', message}, or {type: 'cancelled'}.
 */
function serve(parentPort) {
  const controller = new AbortController();
  const postMessage = (message) => parentPort.postMessage(message);
  parentPort.on('message', ({data}) => {
    if (data?.type === 'cancel') {
      controller.abort(new Error('Benchmark cancelled'));
    } else if (data?.type === 'start') {
      const {signal} = controller;
      run(data, {signal, onChild: (event) => postMessage({type: 'child', ...event}), onEvent: postMessage}).then(
        () => postMessage({type: 'finished'}),
        (error) =>
          postMessage(
            // Only a rejection the abort caused: a run can fail on its own
            // just as a cancel arrives, and its error should still be seen.
            signal.aborted && error === signal.reason
              ? {type: 'cancelled'}
              : {type: 'failed', message: messageOf(error)},
          ),
      );
    }
  });
}

if (process.parentPort !== undefined) {
  serve(process.parentPort);
}

module.exports = {run};
