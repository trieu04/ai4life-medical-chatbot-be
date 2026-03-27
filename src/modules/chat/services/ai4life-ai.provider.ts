import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AiProvider,
  AiMessage,
  AiResponse,
  AiStreamResponse,
  AiStreamChunk,
  Citation,
} from "./ai-provider.interface";

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
  ): Promise<AiResponse | AiStreamResponse> {
    if (streaming) {
      return this.generateStreamingResponse(messages);
    }

    return this.generateNonStreamingResponse(messages);
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
    text: string;
    extractedCitations: Citation[];
  } {
    if (message.data === "[DONE]") {
      return {
        shouldStop: true,
        text: "",
        extractedCitations: [],
      };
    }

    if (message.event === "trace") {
      return {
        shouldStop: false,
        text: options.includeTrace ? message.data : "",
        extractedCitations: [],
      };
    }

    const payloadText = this.extractTextFromStreamPayload(message.data);
    const textToParse = payloadText || message.data;
    const { text, extractedCitations } = this.parseTextAndCitations(textToParse);

    return {
      shouldStop: false,
      text,
      extractedCitations,
    };
  }

  private async generateNonStreamingResponse(
    messages: AiMessage[],
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
        }),
      });

      if (!response.ok) {
        throw new Error(`AI4Life API error: ${response.statusText}`);
      }

      // Collect full response from stream
      let fullContent = "";
      const citations: Citation[] = [];

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

            if (result.text) {
              fullContent += result.text;
              citations.push(...result.extractedCitations);
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

            if (result.text) {
              fullContent += result.text;
              citations.push(...result.extractedCitations);
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
        citations,
      };
    }
    catch (error) {
      this.logger.error("Error calling AI4Life API", error);
      throw error;
    }
  }

  private async generateStreamingResponse(
    messages: AiMessage[],
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

            const yieldedChunks: AiStreamChunk[] = [];
            let shouldStop = false;
            for (const message of parsedMessages) {
              const result = processSseMessage(message, {
                includeTrace: true,
              });

              if (result.text) {
                yieldedChunks.push({ text: result.text, citation: undefined });
              }

              for (const citation of result.extractedCitations) {
                yieldedChunks.push({ text: "", citation });
              }

              if (result.shouldStop) {
                shouldStop = true;
                break;
              }
            }

            for (const chunk of yieldedChunks) {
              yield chunk;
            }

            if (shouldStop) {
              return;
            }
          }

          if (buffer.trim()) {
            const yieldedChunks: AiStreamChunk[] = [];
            for (const message of flushChunkBuffer(buffer)) {
              const result = processSseMessage(message, {
                includeTrace: true,
              });

              if (result.text) {
                yieldedChunks.push({ text: result.text, citation: undefined });
              }

              for (const citation of result.extractedCitations) {
                yieldedChunks.push({ text: "", citation });
              }
            }

            for (const chunk of yieldedChunks) {
              yield chunk;
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
  private extractTextFromStreamPayload(data: string): string {
    try {
      const payload = JSON.parse(data) as {
        text?: unknown;
        message?: { content?: unknown };
        content?: unknown;
        response?: unknown;
        answer?: unknown;
      };

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
    }
    catch {
      return "";
    }

    return "";
  }

  /**
   * Parse text and extract inline JSON citations
   * Returns cleaned text and array of citations
   */
  private parseTextAndCitations(text: string): {
    text: string;
    extractedCitations: Citation[];
  } {
    const citations: Citation[] = [];
    let cleanedText = text;

    // Regular expression to match JSON objects in the text
    // Matches {...} that appear to be citation objects
    const citationRegex = /\{[^{}]*"start_char"[^{}]*\}/g;

    const matches = text.matchAll(citationRegex);

    for (const match of matches) {
      try {
        const citationJson = match[0];
        const citation = JSON.parse(citationJson) as Citation;

        // Validate that it's a citation object (must have start_char and end_char)
        if (citation.start_char !== undefined && citation.end_char !== undefined) {
          citations.push(citation);

          // Remove the citation JSON from the text
          cleanedText = cleanedText.replace(citationJson, "");
        }
      }
      catch {
        // Not a valid citation JSON, skip
      }
    }

    return {
      text: cleanedText,
      extractedCitations: citations,
    };
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
