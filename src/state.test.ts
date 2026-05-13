import { describe, it, expect } from "vitest";
import { ApprovalState } from "./state";

describe("ApprovalState", () => {
  describe("approve", () => {
    it("returns 'approved' when the only required approver clicks", () => {
      const state = new ApprovalState({
        requiredApprovers: ["U1"],
        minimumApprovalCount: 1,
      });

      expect(state.approve("U1")).toBe("approved");
      expect(state.isFullyApproved).toBe(true);
    });

    it("returns 'remainApproval' when more approvals are still needed", () => {
      const state = new ApprovalState({
        requiredApprovers: ["U1", "U2"],
        minimumApprovalCount: 2,
      });

      expect(state.approve("U1")).toBe("remainApproval");
      expect(state.isFullyApproved).toBe(false);
      expect(state.remainingApprovalCount).toBe(1);
    });

    it("transitions to 'approved' once the threshold is reached", () => {
      const state = new ApprovalState({
        requiredApprovers: ["U1", "U2", "U3"],
        minimumApprovalCount: 2,
      });

      expect(state.approve("U1")).toBe("remainApproval");
      expect(state.approve("U2")).toBe("approved");
      expect(state.isFullyApproved).toBe(true);
    });

    it("returns 'notApproval' for a user not in the required list", () => {
      const state = new ApprovalState({
        requiredApprovers: ["U1"],
        minimumApprovalCount: 1,
      });

      expect(state.approve("U-stranger")).toBe("notApproval");
      expect(state.isFullyApproved).toBe(false);
    });

    it("returns 'notApproval' if the same user approves twice", () => {
      const state = new ApprovalState({
        requiredApprovers: ["U1", "U2"],
        minimumApprovalCount: 2,
      });

      expect(state.approve("U1")).toBe("remainApproval");
      expect(state.approve("U1")).toBe("notApproval");
      expect(state.isFullyApproved).toBe(false);
    });

    it("can be threshold-met before all required approvers have clicked", () => {
      const state = new ApprovalState({
        requiredApprovers: ["U1", "U2", "U3"],
        minimumApprovalCount: 1,
      });

      expect(state.approve("U1")).toBe("approved");
      expect(state.remainingApprovers).toEqual(["U2", "U3"]);
      expect(state.approvers).toEqual(["U1"]);
    });
  });

  describe("hasApproved / isRequired / canReject", () => {
    it("hasApproved is true only after the user has approved", () => {
      const state = new ApprovalState({
        requiredApprovers: ["U1", "U2"],
        minimumApprovalCount: 2,
      });

      expect(state.hasApproved("U1")).toBe(false);
      state.approve("U1");
      expect(state.hasApproved("U1")).toBe(true);
      expect(state.hasApproved("U2")).toBe(false);
    });

    it("isRequired tracks remaining approvers only", () => {
      const state = new ApprovalState({
        requiredApprovers: ["U1", "U2"],
        minimumApprovalCount: 2,
      });

      expect(state.isRequired("U1")).toBe(true);
      state.approve("U1");
      expect(state.isRequired("U1")).toBe(false);
      expect(state.isRequired("U2")).toBe(true);
      expect(state.isRequired("U-stranger")).toBe(false);
    });

    it("canReject is true for any required-or-approved user, false for strangers", () => {
      const state = new ApprovalState({
        requiredApprovers: ["U1", "U2"],
        minimumApprovalCount: 2,
      });

      expect(state.canReject("U1")).toBe(true);
      state.approve("U1");
      expect(state.canReject("U1")).toBe(true);
      expect(state.canReject("U2")).toBe(true);
      expect(state.canReject("U-stranger")).toBe(false);
    });
  });

  describe("getters", () => {
    it("exposes minimumApprovalCount as configured", () => {
      const state = new ApprovalState({
        requiredApprovers: ["U1", "U2"],
        minimumApprovalCount: 2,
      });
      expect(state.minimumApprovalCount).toBe(2);
    });

    it("remainingApprovalCount clamps at zero past the threshold", () => {
      const state = new ApprovalState({
        requiredApprovers: ["U1", "U2", "U3"],
        minimumApprovalCount: 1,
      });

      state.approve("U1");
      state.approve("U2");
      expect(state.remainingApprovalCount).toBe(0);
    });

    it("remainingApprovers reflects approvals", () => {
      const state = new ApprovalState({
        requiredApprovers: ["U1", "U2"],
        minimumApprovalCount: 2,
      });

      expect(state.remainingApprovers).toEqual(["U1", "U2"]);
      state.approve("U1");
      expect(state.remainingApprovers).toEqual(["U2"]);
    });

    it("approvers tracks the order of approvals", () => {
      const state = new ApprovalState({
        requiredApprovers: ["U1", "U2", "U3"],
        minimumApprovalCount: 3,
      });

      state.approve("U2");
      state.approve("U1");
      expect(state.approvers).toEqual(["U2", "U1"]);
    });
  });
});
