import { describe, expect, it } from "vitest";

import type { ProviderAccessProvider } from "../../integrations/provider-access.js";
import { validateProviderRouting } from "./provider-access.js";

const provider: ProviderAccessProvider = {
  id: "custom-audio",
  name: "Audio provider",
  methods: ["api-key"],
  connected: true,
  configured: true,
  credentialType: "api-key",
  custom: true,
  keyless: false,
  models: [
    { id: "chat-model", name: "Chat model" },
    { id: "whisper-model", name: "Whisper model" },
    { id: "speech-model", name: "Speech model" },
  ],
};

describe("provider model routing", () => {
  it("accepts explicit connected models and inherited audio routes", () => {
    expect(validateProviderRouting({
      chat: { providerId: provider.id, modelId: "chat-model" },
      transcription: { providerId: provider.id, modelId: "whisper-model" },
      tts: null,
    }, [provider], [provider.id])).toEqual({
      chat: { providerId: provider.id, modelId: "chat-model" },
      transcription: { providerId: provider.id, modelId: "whisper-model" },
    });
  });

  it("rejects a disabled provider before persistence", () => {
    expect(() => validateProviderRouting({
      chat: { providerId: provider.id, modelId: "chat-model" },
    }, [provider], [])).toThrow("Connect and enable the chat provider first.");
  });

  it("rejects a model outside the verified provider catalogue", () => {
    expect(() => validateProviderRouting({
      tts: { providerId: provider.id, modelId: "invented-model" },
    }, [provider], [provider.id])).toThrow("Choose an available tts model.");
  });
});
