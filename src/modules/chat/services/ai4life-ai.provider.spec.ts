import { ConfigService } from "@nestjs/config";
import { Ai4lifeAiProvider } from "./ai4life-ai.provider";

function createStreamResponse(chunks: string[]) {
  const encoder = new TextEncoder();

  return {
    ok: true,
    statusText: "OK",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
  };
}

describe("Ai4lifeAiProvider", () => {
  const originalFetch = global.fetch;

  async function collectStreamTexts(provider: Ai4lifeAiProvider) {
    const result = await provider.generateResponse([
      { role: "user", content: "Hi" },
    ], true);

    if (!("stream" in result)) {
      throw new Error("Expected streaming response");
    }

    const chunks: string[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk.text);
    }

    return chunks;
  }

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns the final SSE text chunk even when the stream ends without a trailing newline", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      createStreamResponse([
        'data: {"text":"Xin chao"}',
      ]) as unknown as Response,
    );

    const provider = new Ai4lifeAiProvider({
      get: jest.fn().mockReturnValue("http://example.test"),
    } as unknown as ConfigService);

    const result = await provider.generateResponse([
      { role: "user", content: "Hi" },
    ], false);

    expect("content" in result && result.content).toBe("Xin chao");
  });

  it("ignores trace events and joins multi-line answer data in non-streaming mode", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      createStreamResponse([
        "event: trace\n",
        "data: Dinh tuyen: Dang phan tich y dinh\n\n",
        "data: ## \n",
        "data: Phan\n",
        "data:  tich\n\n",
      ]) as unknown as Response,
    );

    const provider = new Ai4lifeAiProvider({
      get: jest.fn().mockReturnValue("http://example.test"),
    } as unknown as ConfigService);

    const result = await provider.generateResponse([
      { role: "user", content: "Hi" },
    ], false);

    expect("content" in result && result.content).toBe("## \nPhan\n tich");
  });

  it("emits trace text before answer chunks in streaming mode", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      createStreamResponse([
        "event: trace\n",
        "data: Dinh tuyen: Dang phan tich y dinh\n\n",
        "data: ## \n",
        "data: Phan\n",
        "data:  tich\n\n",
      ]) as unknown as Response,
    );

    const provider = new Ai4lifeAiProvider({
      get: jest.fn().mockReturnValue("http://example.test"),
    } as unknown as ConfigService);

    const chunks = await collectStreamTexts(provider);

    expect(chunks).toEqual([
      "Dinh tuyen: Dang phan tich y dinh",
      "## \nPhan\n tich",
    ]);
  });

  it("extracts citations after parsing a JSON SSE payload", async () => {
    const payload = JSON.stringify({
      text: 'Noi dung {"start_char":0,"end_char":8,"resource_type":"guideline"}',
    });

    global.fetch = jest.fn().mockResolvedValue(
      createStreamResponse([
        `data: ${payload}\n\n`,
      ]) as unknown as Response,
    );

    const provider = new Ai4lifeAiProvider({
      get: jest.fn().mockReturnValue("http://example.test"),
    } as unknown as ConfigService);

    const result = await provider.generateResponse([
      { role: "user", content: "Hi" },
    ], false);

    expect("content" in result && result.content).toBe("Noi dung ");
    expect("citations" in result && result.citations).toEqual([
      {
        start_char: 0,
        end_char: 8,
        resource_type: "guideline",
      },
    ]);
  });
});
