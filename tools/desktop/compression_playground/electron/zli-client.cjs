// Copyright (c) Meta Platforms, Inc. and affiliates.

/* eslint-disable @typescript-eslint/no-require-imports */

'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

const TRAINING_THREADS = Math.min(4, Math.max(1, os.availableParallelism()));
// The leading columns of zli benchmark --output-csv. The path column after them
// is not read, so a quoted path cannot shift the numbers.
const CSV_COLUMNS = ['srcSize', 'compressedSize', 'compressionRatio', 'ctimeMs', 'dtimeMs', 'iters'];
const KILL_GRACE_MS = 2000;

// SIGTERM first, then SIGKILL if zli has not exited. Windows terminates on either.
function terminate(child) {
  child.kill('SIGTERM');
  const escalate = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
  // 'exit' rather than 'close', which waits for stdio and need not follow.
  child.once('exit', () => clearTimeout(escalate));
}

// At --verbose 3, zli prints a progress bar on stderr for each step of
// training, one line per redraw on a pipe:
// `[=====---------------------------------------------] Training ACE graph 1 / 2: ACE progress`.
const PROGRESS_LINE = /^\[([=-]+)\] /;
const GRAPH_COUNTER = /\bgraph (\d+) \/ (\d+)\b/;

/**
 * How far through training a zli progress line says it is, or undefined for
 * any other line. Each ACE graph gets a bar of its own that starts again from
 * empty, so a bar's fill is placed within its graph's share of the whole.
 */
function progressFraction(line) {
  const bar = PROGRESS_LINE.exec(line)?.[1];
  if (bar === undefined) {
    return undefined;
  }
  const fill = bar.replaceAll('-', '').length / bar.length;
  const [, graph, graphs] = GRAPH_COUNTER.exec(line)?.map(Number) ?? [];
  return graph >= 1 && graphs >= graph ? (graph - 1 + fill) / graphs : fill;
}

/**
 * What zli printed about why it failed. Its progress and other INFO lines come
 * first; a fatal error comes last, usually as a heading and its tab-indented
 * detail (`I/O Exception:` then `\tFailed to open input file ...`), otherwise
 * as one line. Empty when zli was killed by a signal (a crash, or out of
 * memory) and printed no heading: whatever INFO line came last says nothing
 * about that, so the signal is reported instead.
 */
function failureFromVerboseStderr(stderr, killed) {
  const lines = stderr
    .trim()
    .split(/\r?\n/)
    .filter((line) => progressFraction(line) === undefined);
  const heading = lines.findLastIndex((line, index) => !line.startsWith('\t') && lines[index + 1]?.startsWith('\t'));
  if (heading !== -1) {
    return lines.slice(heading).join('\n');
  }
  return killed ? '' : (lines.at(-1) ?? '');
}

/**
 * Runs zli, which reports failures on stderr. With `onProgress`, zli runs at
 * --verbose 3: each progress line is reported as a fraction, and only the
 * fatal error is kept as the failure message.
 */
function runZli(zliPath, args, {signal, onChild, onProgress}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    // --verbose 1 limits stderr to errors, so a failure message can be shown
    // as-is; 3 adds the progress lines `onProgress` reads.
    const child = spawn(zliPath, [...args, '--verbose', onProgress === undefined ? '1' : '3'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    child.stderr.setEncoding('utf8');
    let stderr = '';
    // Why zli was stopped; reported once it has actually exited.
    let stopReason;
    let settled = false;
    const fail = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    const stop = (reason) => {
      if (stopReason === undefined) {
        stopReason = reason;
        terminate(child);
      }
    };
    const onAbort = () => stop(signal.reason);
    signal?.addEventListener('abort', onAbort, {once: true});
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    if (child.pid !== undefined) {
      onChild?.({pid: child.pid, state: 'spawned'});
    }

    // The end of the last chunk, until the rest of its line arrives.
    let partialLine = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (onProgress === undefined) {
        process.stderr.write(chunk);
        return;
      }
      const lines = (partialLine + chunk).split(/\r?\n/);
      partialLine = lines.pop();
      for (const line of lines) {
        const fraction = progressFraction(line);
        if (fraction === undefined) {
          process.stderr.write(`${line}\n`);
        } else {
          onProgress(fraction);
        }
      }
    });
    child.once('error', (error) => {
      cleanup();
      fail(error);
    });
    child.once('close', (code, exitSignal) => {
      cleanup();
      // A last line with no newline after it, which the 'data' handler held back.
      if (partialLine !== '' && progressFraction(partialLine) === undefined) {
        process.stderr.write(`${partialLine}\n`);
      }
      if (child.pid !== undefined) {
        onChild?.({pid: child.pid, state: 'exited'});
      }
      if (settled) {
        return;
      }
      if (stopReason !== undefined) {
        fail(stopReason);
        return;
      }
      if (code !== 0) {
        const detail = onProgress === undefined ? stderr.trim() : failureFromVerboseStderr(stderr, exitSignal !== null);
        fail(
          new Error(
            detail !== ''
              ? detail
              : `zli exited unexpectedly (${exitSignal === null ? `code ${code}` : `signal ${exitSignal}`})`,
          ),
        );
        return;
      }
      settled = true;
      resolve();
    });
  });
}

function profileArguments(compressor) {
  const args = ['--profile', compressor.profile];
  // An empty --profile-arg is not the same as none: csv rejects it as a separator.
  if (compressor.profileArg !== '') {
    args.push('--profile-arg', compressor.profileArg);
  }
  return args;
}

/** Reads the single row zli benchmark --output-csv writes for one input file. */
async function readBenchmarkCsv(csvPath) {
  const [header, row = ''] = (await fs.readFile(csvPath, 'utf8')).split(/\r?\n/);
  const names = header.split(',').slice(0, CSV_COLUMNS.length);
  const values = row.split(',').slice(0, CSV_COLUMNS.length);
  if (
    names.join() !== CSV_COLUMNS.join() ||
    values.length !== CSV_COLUMNS.length ||
    values.some((value) => value.trim() === '' || !(Number(value) >= 0))
  ) {
    throw new Error('zli returned an unexpected result');
  }
  const field = Object.fromEntries(CSV_COLUMNS.map((name, index) => [name, Number(values[index])]));
  return {
    iterations: field.iters,
    srcSize: field.srcSize,
    compressedSize: field.compressedSize,
    compressMs: field.ctimeMs,
    decompressMs: field.dtimeMs,
  };
}

async function benchmark(zliPath, inputPath, compressorArgs, level, iterations, csvPath, context) {
  await runZli(
    zliPath,
    [
      'benchmark',
      inputPath,
      ...compressorArgs,
      '--level',
      String(level),
      '--num-iters',
      String(iterations),
      '--output-csv',
      csvPath,
    ],
    context,
  );
  return readBenchmarkCsv(csvPath);
}

async function trainedCandidatePaths(zliPath, inputPath, compressor, outputDirectory, context) {
  await runZli(
    zliPath,
    [
      'train',
      inputPath,
      ...profileArguments(compressor),
      '--output',
      outputDirectory,
      '--pareto-frontier',
      '--max-num-candidates',
      String(compressor.candidates),
      '--threads',
      String(TRAINING_THREADS),
      '--use-all-samples',
    ],
    context,
  );
  // zli train --pareto-frontier writes candidate i to <output>/<i>.zc.
  const indices = (await fs.readdir(outputDirectory))
    .flatMap((name) => /^(\d+)\.zc$/.exec(name)?.[1] ?? [])
    .map(Number)
    .sort((a, b) => a - b);
  if (indices.length === 0) {
    throw new Error('OpenZL training produced no candidates');
  }
  return indices.map((index) => path.join(outputDirectory, `${index}.zc`));
}

/**
 * Removes a scratch directory. A failure is ignored: on Windows a zli that was
 * just killed can still hold a file open, and throwing here would replace the
 * run's own result or error with this one.
 */
async function removeScratch(directory) {
  try {
    await fs.rm(directory, {recursive: true, force: true});
  } catch {
    // Left behind; see above.
  }
}

/**
 * zli train benchmarks candidates at a fixed iteration count and has no
 * --level, so each candidate is re-benchmarked with the requested settings.
 * Aborting `signal` stops the running zli and rejects with `signal.reason`.
 * Scratch files go under `tempRoot`, which defaults to the OS temp directory.
 * `onStage` hears which phase is starting: benchmark, train, or candidates;
 * then, while training, each fraction zli's progress bar shows.
 * `onMeasurement` hears each measurement as soon as it is made, with its index
 * and how many there will be, rather than when the last candidate is done.
 */
async function runOpenZLBenchmark(
  zliPath,
  input,
  compressor,
  iterations,
  {signal, onChild, onStage, onMeasurement, tempRoot = os.tmpdir()} = {},
) {
  const context = {signal, onChild};
  const workDirectory = await fs.mkdtemp(path.join(tempRoot, 'openzl-playground-'));
  try {
    let inputPath;
    if ('path' in input) {
      // Absolute paths never start with '-', so zli cannot parse them as flags.
      inputPath = path.resolve(input.path);
    } else {
      inputPath = path.join(workDirectory, 'input.bin');
      await fs.writeFile(inputPath, Buffer.from(input.data.buffer, input.data.byteOffset, input.data.byteLength));
    }

    if (!compressor.trainRequested) {
      onStage?.({stage: 'benchmark'});
      const result = await benchmark(
        zliPath,
        inputPath,
        profileArguments(compressor),
        compressor.level,
        iterations,
        path.join(workDirectory, 'benchmark.csv'),
        context,
      );
      onMeasurement?.(result, 0, 1);
      return [result];
    }
    onStage?.({stage: 'train'});
    const candidatePaths = await trainedCandidatePaths(
      zliPath,
      inputPath,
      compressor,
      path.join(workDirectory, 'candidates'),
      {...context, onProgress: (fraction) => onStage?.({stage: 'train', fraction})},
    );
    const results = [];
    for (const [index, candidatePath] of candidatePaths.entries()) {
      onStage?.({stage: 'candidates', candidate: index + 1, candidateCount: candidatePaths.length});
      const result = await benchmark(
        zliPath,
        inputPath,
        ['--compressor', candidatePath],
        compressor.level,
        iterations,
        path.join(workDirectory, `candidate-${index}.csv`),
        context,
      );
      onMeasurement?.(result, index, candidatePaths.length);
      results.push(result);
    }
    return results;
  } finally {
    await removeScratch(workDirectory);
  }
}

module.exports = {runOpenZLBenchmark};
