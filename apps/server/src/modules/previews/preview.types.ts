export type PreviewEnvStatus = 'creating' | 'ready' | 'destroyed';

export type PreviewBackend = 'docker' | 'k8s' | 'stub';

export interface PreviewEnvView {
  id: string;
  traceId: string;
  serviceId: string;
  prNumber: number;
  prTitle?: string;
  branch?: string;
  commit?: string;
  url?: string;
  status: PreviewEnvStatus;
  createdAt: string;
  destroyedAt?: string;
  ttlHours: number;
  container?: string;
  port?: number;
  image?: string;
  backend?: PreviewBackend;
  pod?: string;
  service?: string;
}

export function previewEnvName(prNumber: number): string {
  return `preview-pr-${prNumber}`;
}

export function previewUrl(serviceId: string, prNumber: number): string {
  return `http://${previewEnvName(prNumber)}.${serviceId}.previews.jack.local`;
}
