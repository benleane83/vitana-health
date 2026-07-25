import { describe, expect, it } from "vitest";
import {
  mobileMigrationBatchAcknowledgementSchema,
  mobileMigrationManifestSchema
} from "../mobileMigration.js";

describe("mobile migration contracts", () => {
  it("accepts protocol v1 manifests and rejects unknown fields or versions", () => {
    const manifest = {
      protocolVersion: 1,
      datasetId: "dataset-1",
      datasetFingerprint: "standalone:dataset-1",
      sourceProfileId: "profile-1",
      counts: { sourceImports: 1, dataSources: 1, observationGroups: 1, observations: 1 }
    };

    expect(mobileMigrationManifestSchema.parse(manifest)).toEqual(manifest);
    expect(() => mobileMigrationManifestSchema.parse({ ...manifest, protocolVersion: 2 })).toThrow();
    expect(() => mobileMigrationManifestSchema.parse({ ...manifest, destinationProfileId: "other-profile" })).toThrow();
  });

  it("requires per-record duplicate classifications to match aggregate counts", () => {
    const acknowledgement = mobileMigrationBatchAcknowledgementSchema.parse({
      sessionId: "session-1",
      batchId: "batch-1",
      counts: { accepted: 1, duplicates: 1, conflicts: 0 },
      duplicates: [{
        entityType: "observation",
        entityId: "observation-1",
        classification: "canonical-observation"
      }],
      conflicts: []
    });

    expect(acknowledgement.duplicates[0]?.classification).toBe("canonical-observation");
    expect(() => mobileMigrationBatchAcknowledgementSchema.parse({
      ...acknowledgement,
      duplicates: [{ ...acknowledgement.duplicates[0], classification: "same-time" }]
    })).toThrow();
  });
});