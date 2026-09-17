import { describe, expect, it } from "vitest";

import { splitRoutingTarget } from "./model-routing.js";

describe("model routing targets", () => {
  it("preserves model identifiers containing slashes", () => {
    expect(splitRoutingTarget("managed-gx10/org/audio/model-v2")).toEqual({
      providerId: "managed-gx10",
      modelId: "org/audio/model-v2",
    });
  });

  it("rejects incomplete targets", () => {
    expect(splitRoutingTarget("managed-gx10")).toBeUndefined();
    expect(splitRoutingTarget("/model")).toBeUndefined();
  });
});
