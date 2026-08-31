import { Injectable } from '@nestjs/common';

export type ReleaseStrategyType = 'canary' | 'blue-green' | 'rolling';

export interface ReleaseStrategy {
  type: ReleaseStrategyType;
  steps?: number[];
}

export interface ReleaseStep {
  index: number;
  weight: number;
  status: 'pending' | 'succeeded';
}

export interface ReleaseView {
  id: string;
  traceId: string;
  runId: string;
  version: string;
  artifacts: string[];
  strategy: ReleaseStrategyType;
  steps: ReleaseStep[];
  status: 'in_progress' | 'promoted' | 'rolled_back';
  createdAt: string;
}

export function defaultSteps(strategy: ReleaseStrategyType): number[] {
  if (strategy === 'canary') {
    return [10, 50, 100];
  }
  if (strategy === 'blue-green') {
    return [100];
  }
  return [100];
}

export function deterministicOn(key: string, rolloutPercent: number): boolean {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100 < rolloutPercent;
}
