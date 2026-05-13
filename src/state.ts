export type ApprovalResult = "notApproval" | "remainApproval" | "approved";

export interface ApprovalStateOptions {
  requiredApprovers: string[];
  minimumApprovalCount: number;
}

export class ApprovalState {
  private readonly remaining: Set<string>;
  private readonly approved: string[] = [];
  private readonly minimum: number;

  constructor({ requiredApprovers, minimumApprovalCount }: ApprovalStateOptions) {
    this.remaining = new Set(requiredApprovers);
    this.minimum = minimumApprovalCount;
  }

  approve(userId: string): ApprovalResult {
    if (!this.remaining.has(userId)) return "notApproval";
    this.remaining.delete(userId);
    this.approved.push(userId);
    return this.approved.length >= this.minimum ? "approved" : "remainApproval";
  }

  hasApproved(userId: string): boolean {
    return this.approved.includes(userId);
  }

  isRequired(userId: string): boolean {
    return this.remaining.has(userId);
  }

  canReject(userId: string): boolean {
    return this.remaining.has(userId) || this.approved.includes(userId);
  }

  get isFullyApproved(): boolean {
    return this.approved.length >= this.minimum;
  }

  get approvers(): readonly string[] {
    return this.approved;
  }

  get remainingApprovers(): readonly string[] {
    return [...this.remaining];
  }

  get remainingApprovalCount(): number {
    return Math.max(0, this.minimum - this.approved.length);
  }

  get minimumApprovalCount(): number {
    return this.minimum;
  }
}
