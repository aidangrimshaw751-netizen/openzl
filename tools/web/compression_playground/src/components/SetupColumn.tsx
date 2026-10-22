// Copyright (c) Meta Platforms, Inc. and affiliates.

import {Box, Text, VStack} from '@chakra-ui/react';
import {useState} from 'react';
import {getOpenZlProfiles} from '../compressors.ts';
import ConfigureRunCard from './ConfigureRunCard.tsx';
import RunBenchmarkCard from './RunBenchmarkCard.tsx';
import UploadCard from './UploadCard.tsx';
import type {RunConfig, RunState} from '../benchmarkTypes.ts';
import {resultsOf} from '../measurements.ts';
import type {CompressorRows} from '../useCompressorRows.ts';

interface SetupColumnProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  compressors: CompressorRows;
  iterations: number;
  onIterationsChange: (iterations: number) => void;
  runConfig: RunConfig | null;
  runState: RunState;
  onRun: ((config: RunConfig) => void) | null;
  onTrySample: (() => void) | null;
  runBlockers: readonly string[];
}

export default function SetupColumn({
  file,
  onFileChange,
  compressors,
  iterations,
  onIterationsChange,
  runConfig,
  runState,
  onRun,
  onTrySample,
  runBlockers,
}: SetupColumnProps) {
  const [profilesReady, setProfilesReady] = useState(getOpenZlProfiles().length > 0);
  return (
    <VStack gap="20px" width={{base: '100%', lg: '520px'}} flexShrink={0} align="stretch">
      <UploadCard file={file} onFileChange={onFileChange} />
      <ConfigureRunCard
        compressors={compressors}
        iterations={iterations}
        onIterationsChange={onIterationsChange}
        onProfilesReady={setProfilesReady}
      />
      <RunBenchmarkCard
        runConfig={runConfig}
        runState={runState}
        onRun={profilesReady || compressors.rows.every((row) => row.compressor !== 'OpenZL') ? onRun : null}
        onTrySample={profilesReady ? onTrySample : null}
        runBlockers={runBlockers}
      />
      {/* The results panel carries the full desktop-app callout until there
          are results to show, and this takes its place once there are. */}
      {resultsOf(runState).length > 0 && (
        <Box as="aside" aria-label="Desktop app recommendation" bg="pg.note" borderRadius="8px" px="16px" py="12px">
          <Text color="pg.secondary" fontSize="12.5px" m={0}>
            Benchmarking something large? <Text as="strong">Get the desktop app</Text> &mdash; reads files straight off
            disk, no upload and no size limit.
          </Text>
        </Box>
      )}
    </VStack>
  );
}
