// Just the parts of Chrome's Prompt API this extension uses.
// https://developer.chrome.com/docs/ai/prompt-api
type LanguageModelAvailability = "unavailable" | "downloadable" | "downloading" | "available";

interface LanguageModelExpected { type: "text"; languages: string[] }

interface LanguageModelOptions {
  expectedInputs?: LanguageModelExpected[];
  expectedOutputs?: LanguageModelExpected[];
}

interface LanguageModelCreateOptions extends LanguageModelOptions {
  signal?: AbortSignal;
  temperature?: number;
  topK?: number;
  initialPrompts?: { role: "system" | "user" | "assistant"; content: string }[];
  monitor?(m: EventTarget): void;
}

interface LanguageModelSession {
  prompt(input: string, options?: { signal?: AbortSignal; responseConstraint?: object | RegExp }): Promise<string>;
  clone(options?: { signal?: AbortSignal }): Promise<LanguageModelSession>;
  destroy(): void;
}

declare const LanguageModel: {
  availability(options?: LanguageModelOptions): Promise<LanguageModelAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
};
