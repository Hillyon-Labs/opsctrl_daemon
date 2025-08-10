import { ContainerStatusSummary } from './containerStatus.interface';

export interface PodStatus {
  phase: string;
  containerStates: ContainerStatusSummary[];
}
