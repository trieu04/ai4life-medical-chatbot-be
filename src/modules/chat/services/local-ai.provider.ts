import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AiProvider,
  AiMessage,
  AiResponse,
  AiStreamChunk,
  AiStreamResponse,
} from "./ai-provider.interface";

@Injectable()
export class LocalAiProvider extends AiProvider {
  private readonly logger = new Logger(LocalAiProvider.name);
  private readonly apiUrl: string;
  private readonly model: string;

  constructor(private configService: ConfigService) {
    super();
    this.apiUrl = this.configService.get<string>("AI_API_URL")
      || "http://localhost:11434/api";
    this.model = this.configService.get<string>("AI_MODEL") || "llama2";
  }

  async generateResponse(
    messages: AiMessage[],
    streaming = false,
    _role = "",
  ): Promise<AiResponse | AiStreamResponse> {
    const systemPrompt = this.getSystemPrompt();
    const allMessages: AiMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    if (streaming) {
      return this.generateStreamingResponse(allMessages);
    }

    return this.generateNonStreamingResponse(allMessages);
  }

  private async generateNonStreamingResponse(
    messages: AiMessage[],
  ): Promise<AiResponse> {
    try {
      const response = await fetch(`${this.apiUrl}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI API error: ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.message?.content || "";
      const tokenCount = this.countTokens(content);

      return {
        content,
        tokenCount,
      };
    }
    catch (error) {
      this.logger.error("Error calling Local AI API", error);
      throw error;
    }
  }

  private async generateStreamingResponse(
    messages: AiMessage[],
  ): Promise<AiStreamResponse> {
    try {
      const response = await fetch(`${this.apiUrl}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI API error: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body reader available");
      }

      const decoder = new TextDecoder();

      const stream = async function* (): AsyncIterable<AiStreamChunk> {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n").filter(line => line.trim());

            for (const line of lines) {
              try {
                const data = JSON.parse(line);
                if (data.message?.content) {
                  yield { type: "text", text: data.message.content as string };
                }
              }
              catch {
                // Skip invalid JSON lines
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
      this.logger.error("Error calling Local AI API (streaming)", error);
      throw error;
    }
  }

  countTokens(text: string): number {
    // Simple approximation: ~4 characters per token for English
    // For production, use a proper tokenizer library
    return Math.ceil(text.length / 4);
  }

  private getSystemPrompt(): string {
    return `You are a medical AI assistant designed to provide health information and guidance. 

IMPORTANT DISCLAIMERS:
1. You are NOT a replacement for professional medical advice, diagnosis, or treatment.
2. Always encourage users to consult with qualified healthcare professionals for medical concerns.
3. Do not provide definitive diagnoses - only provide general health information.
4. If symptoms appear serious or emergency-related, strongly recommend immediate medical attention.

GUIDELINES:
1. Ask clarifying questions to understand the user's symptoms and medical history fully.
2. Provide balanced, evidence-based health information.
3. Be empathetic and supportive while maintaining professional boundaries.
4. Clearly state when a condition requires professional medical evaluation.
5. Respect patient privacy and confidentiality.

Remember: Your role is to inform and guide, not to diagnose or prescribe treatment.`;
  }
}
