/** Platform health — the four checks that find faults nothing else reports. */
import { request } from "../api";

export type PlatformCheckFinding = {
  id: string;
  /**
   * `unchecked` is a state of its own, never folded into `pass`. A check that
   * could not see and a check that saw nothing wrong are different answers,
   * and treating the first as the second is the exact failure these checks
   * exist to catch.
   */
  status: "pass" | "fail" | "unchecked";
  message: string;
  /** The specific rows at fault, for somebody about to fix them. */
  detail: string[];
};

export type PlatformChecks = {
  ok: boolean;
  checkedAt: string;
  counts: {
    bindings: number;
    activeGraphs: number;
    registeredNodes: number;
  };
  findings: PlatformCheckFinding[];
};

export function loadPlatformChecks() {
  return request<PlatformChecks>("/platform/checks");
}
