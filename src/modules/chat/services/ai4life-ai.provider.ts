import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AiProvider,
  AiMessage,
  AiResponse,
  AiStreamResponse,
  AiStreamChunk,
} from "./ai-provider.interface";

const ROLE_MAPPING = {
  bac_si_tram_y_te: "bac_si_tramyte",
};

@Injectable()
export class Ai4lifeAiProvider extends AiProvider {
  private readonly logger = new Logger(Ai4lifeAiProvider.name);
  private readonly apiUrl: string;

  constructor(private configService: ConfigService) {
    super();
    this.apiUrl = this.configService.get<string>("AI4LIFE_API_URL")
      || "http://localhost:8000";
  }

  async generateResponse(
    messages: AiMessage[],
    streaming = false,
    role = "",
  ): Promise<AiResponse | AiStreamResponse> {
    if (streaming) {
      return this.generateStreamingResponse(messages, role);
    }

    return this.generateNonStreamingResponse(messages, role);
  }

  private readChunkBuffer(buffer: string): {
    remainingBuffer: string;
    messages: ParsedSseMessage[];
  } {
    const normalizedBuffer = buffer.replace(/\r\n/g, "\n");
    const parts = normalizedBuffer.split("\n\n");
    const remainingBuffer = parts.pop() ?? "";
    const messages = parts
      .map(part => this.parseSseMessage(part))
      .filter((message): message is ParsedSseMessage => message !== null);

    return {
      remainingBuffer,
      messages,
    };
  }

  private flushChunkBuffer(buffer: string): ParsedSseMessage[] {
    const normalizedBuffer = buffer.replace(/\r\n/g, "\n").trim();
    if (!normalizedBuffer) {
      return [];
    }

    const message = this.parseSseMessage(normalizedBuffer);
    return message ? [message] : [];
  }

  private parseSseMessage(rawMessage: string): ParsedSseMessage | null {
    const lines = rawMessage.split("\n");
    let event: string | undefined;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (!line || line.startsWith(":")) {
        continue;
      }

      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
        continue;
      }

      if (line.startsWith("data:")) {
        const value = line.slice(5);
        dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
      }
    }

    if (dataLines.length === 0) {
      return null;
    }

    return {
      event,
      data: dataLines.join("\n"),
    };
  }

  private processSseMessage(
    message: ParsedSseMessage,
    options: { includeTrace: boolean },
  ): {
    shouldStop: boolean;
    chunks: AiStreamChunk[];
    fullText: string;
  } {
    const payload = this.parseStreamPayload(message.data);

    if (payload?.type === "trace") {
      const trace = typeof payload.text === "string"
        ? payload.text.trim()
        : "";

      return {
        shouldStop: false,
        chunks: options.includeTrace && trace
          ? [{ type: "trace", trace }]
          : [],
        fullText: "",
      };
    }

    if (payload?.type === "text" && typeof payload.text === "string") {
      return {
        shouldStop: false,
        chunks: payload.text ? [{ type: "text", text: payload.text }] : [],
        fullText: payload.text,
      };
    }

    if (payload?.type === "done") {
      return {
        shouldStop: true,
        chunks: [],
        fullText: "",
      };
    }

    const payloadText = this.extractTextFromStreamPayload(message.data);
    const chunks: AiStreamChunk[] = [];
    const text = payloadText || message.data;

    if (text) {
      chunks.push({ type: "text", text });
    }

    return {
      shouldStop: false,
      chunks,
      fullText: text,
    };
  }

  private async generateNonStreamingResponse(
    messages: AiMessage[],
    role = "",
  ): Promise<AiResponse> {
    try {
      // Get the last user message as the question
      const lastUserMessage = messages.filter(m => m.role === "user").pop();
      if (!lastUserMessage) {
        throw new Error("No user message found");
      }

      const response = await fetch(`${this.apiUrl}/api/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: lastUserMessage.content,
          role: ROLE_MAPPING[role] || role,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI4Life API error: ${response.statusText}`);
      }

      // Collect full response from stream
      let fullContent = "";
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body reader available");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const { messages: parsedMessages, remainingBuffer } = this.readChunkBuffer(buffer);
          buffer = remainingBuffer;

          let shouldStop = false;
          for (const message of parsedMessages) {
            const result = this.processSseMessage(message, {
              includeTrace: false,
            });

            if (result.fullText) {
              fullContent += result.fullText;
            }

            if (result.shouldStop) {
              shouldStop = true;
              break;
            }
          }

          if (shouldStop) {
            break;
          }
        }

        if (buffer.trim()) {
          for (const message of this.flushChunkBuffer(buffer)) {
            const result = this.processSseMessage(message, {
              includeTrace: false,
            });

            if (result.fullText) {
              fullContent += result.fullText;
            }
          }
        }
      }
      finally {
        reader.releaseLock();
      }

      const tokenCount = this.countTokens(fullContent);

      return {
        content: fullContent,
        tokenCount,
      };
    }
    catch (error) {
      this.logger.error("Error calling AI4Life API", error);
      throw error;
    }
  }

  private async generateStreamingResponse(
    messages: AiMessage[],
    role = "",
  ): Promise<AiStreamResponse> {
    try {
      // Get the last user message as the question
      const lastUserMessage = messages.filter(m => m.role === "user").pop();
      if (!lastUserMessage) {
        throw new Error("No user message found");
      }

      const response = await fetch(`${this.apiUrl}/api/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: lastUserMessage.content,
          role: ROLE_MAPPING[role] || role,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI4Life API error: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body reader available");
      }

      const decoder = new TextDecoder();
      const readChunkBuffer = this.readChunkBuffer.bind(this);
      const flushChunkBuffer = this.flushChunkBuffer.bind(this);
      const processSseMessage = this.processSseMessage.bind(this);

      const stream = async function* (): AsyncIterable<AiStreamChunk> {
        try {
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const { messages: parsedMessages, remainingBuffer } = readChunkBuffer(buffer);
            buffer = remainingBuffer;

            let shouldStop = false;
            for (const message of parsedMessages) {
              const result = processSseMessage(message, {
                includeTrace: true,
              });

              for (const chunk of result.chunks) {
                yield chunk;
              }

              if (result.shouldStop) {
                shouldStop = true;
                break;
              }
            }

            if (shouldStop) {
              return;
            }
          }

          if (buffer.trim()) {
            for (const message of flushChunkBuffer(buffer)) {
              const result = processSseMessage(message, {
                includeTrace: true,
              });

              for (const chunk of result.chunks) {
                yield chunk;
              }
            }
          }
        }
        finally {
          reader.releaseLock();
        }
      };

      return {
        stream: stream(),
        totalTokens: 0, // Will be calculated after streaming completes
      };
    }
    catch (error) {
      this.logger.error("Error calling AI4Life API (streaming)", error);
      throw error;
    }
  }

  /**
   * Extract text from JSON SSE payloads when present.
   */
  private parseStreamPayload(data: string): {
    type?: unknown;
    text?: unknown;
    message?: { content?: unknown };
    content?: unknown;
    response?: unknown;
    answer?: unknown;
  } | null {
    try {
      return JSON.parse(data) as {
        type?: unknown;
        text?: unknown;
        message?: { content?: unknown };
        content?: unknown;
        response?: unknown;
        answer?: unknown;
      };
    }
    catch {
      return null;
    }
  }

  /**
   * Extract text from JSON SSE payloads when present.
   */
  private extractTextFromStreamPayload(data: string): string {
    const payload = this.parseStreamPayload(data);

    if (!payload) {
      return "";
    }

    if (typeof payload.text === "string") {
      return payload.text;
    }

    if (typeof payload.message?.content === "string") {
      return payload.message.content;
    }

    if (typeof payload.content === "string") {
      return payload.content;
    }

    if (typeof payload.response === "string") {
      return payload.response;
    }

    if (typeof payload.answer === "string") {
      return payload.answer;
    }

    return "";
  }

  countTokens(text: string): number {
    // Simple approximation: ~4 characters per token for Vietnamese/English
    // For production, use a proper tokenizer library
    return Math.ceil(text.length / 4);
  }
}

interface ParsedSseMessage {
  event?: string;
  data: string;
}
