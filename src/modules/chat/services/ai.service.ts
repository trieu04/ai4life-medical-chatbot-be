import { Injectable } from "@nestjs/common";
import { AiProvider } from "./ai-provider.interface";

@Injectable()
export class AiService {
  constructor(private readonly aiProvider: AiProvider) {}

  async generateResponse(
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
    streaming = false,
    role = "",
  ) {
    return this.aiProvider.generateResponse(messages, streaming, role);
  }

  countTokens(text: string): number {
    return this.aiProvider.countTokens(text);
  }
}
