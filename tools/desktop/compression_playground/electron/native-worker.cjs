// Copyright (c) Meta Platforms, Inc. and affiliates.

/* eslint-disable @typescript-eslint/no-require-imports */

'use strict';

const fs = require('node:fs');
const {performance} = require('node:perf_hooks');
const zlib = require('node:zlib');
const {runOpenZLBenchmark} = require('./zli-client.cjs');

function nativeCodecBenchmark(input, iterations, compress, decompress) {
  let compressed = compress(input);
  const compressStart = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    compressed = compress(input);
  }
  const compressMs = performance.now() - compressStart;

  let decompressed = decompress(compressed);
  const decompressStart = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    decompressed = decompress(compressed);
  }
  const decompressMs = performance.now() - decompressStart;
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

function benchmarkZstd(input, level, iterations) {
  if (typeof zlib.zstdCompressSync !== 'function' || typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('This Electron runtime does not include native zstd support');
  }
  const params = {[zlib.constants.ZSTD_c_compressionLevel]: level};
  return nativeCodecBenchmark(
    input,
    iterations,
    (value) => zlib.zstdCompressSync(value, {params}),
    (value) => zlib.zstdDecompressSync(value),
  );
}

function benchmarkGzip(input, level, iterations) {
  return nativeCodecBenchmark(
    input,
    iterations,
    (value) => zlib.gzipSync(value, {level}),
    (value) => zlib.gunzipSync(value),
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

async function measure({zliPath, request}, compressor, readInput) {
  if (compressor.compressor === 'OpenZL') {
    const measurements = await runOpenZLBenchmark(zliPath, request.input, compressor, request.iterations);
    return measurements.map((measurement, index) => ({
      ...finishOpenZLResult(measurement),
      rowId: compressor.id,
      candidate: compressor.trainRequested ? {index: index + 1, total: measurements.length} : null,
    }));
  }
  const measurement =
    compressor.compressor === 'zstd'
      ? benchmarkZstd(readInput(), compressor.level, request.iterations)
      : benchmarkGzip(readInput(), compressor.level, request.iterations);
  return [{...measurement, rowId: compressor.id, candidate: null}];
}

/**
 * Runs every row in order, reporting as the browser's worker does: a `result`
 * per measurement, or a `failure` for a row that could not be measured. A
 * failed row does not stop the run. Trained candidates are counted from 1,
 * best ratio first; `candidate` is null for every row that does not train.
 */
async function run(payload, {onEvent} = {}) {
  const results = [];
  let input;
  const readInput = () => (input ??= readRequestInput(payload.request.input));

  for (const compressor of payload.request.compressors) {
    let measured;
    try {
      measured = await measure(payload, compressor, readInput);
    } catch (error) {
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
 * Worker protocol. From the main process: {zliPath, request}. To it: run()'s
 * events, then exactly one of {type: 'finished'} or {type: 'failed', message}.
 */
async function execute(payload, postMessage) {
  try {
    await run(payload, {onEvent: postMessage});
    postMessage({type: 'finished'});
  } catch (error) {
    postMessage({type: 'failed', message: messageOf(error)});
  }
}

if (process.parentPort !== undefined) {
  process.parentPort.once('message', (event) => {
    void execute(event.data, (message) => process.parentPort.postMessage(message));
  });
}

module.exports = {run};
