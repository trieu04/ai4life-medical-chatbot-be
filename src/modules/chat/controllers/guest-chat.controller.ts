import {
  Body,
  Controller,
  Post,
  UsePipes,
  ValidationPipe,
  Sse,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiProperty } from "@nestjs/swagger";
import { Observable, from, map } from "rxjs";
import { AiService } from "../services/ai.service";
import { SendMessageDto } from "../dtos/send-message.dto";
import { AiStreamResponse, AiStreamChunk } from "../services/ai-provider.interface";
import { IsNotEmpty, IsString, MaxLength, IsArray, IsOptional, ValidateNested, IsIn } from "class-validator";
import { Type } from "class-transformer";

class ContextMessageDto {
  @ApiProperty({ enum: ["user", "assistant"] })
  @IsIn(["user", "assistant"])
  role: "user" | "assistant";

  @ApiProperty()
  @IsString()
  @MaxLength(10000)
  content: string;
}

class GuestChatWithContextDto {
  @ApiProperty({ description: "The new message content" })
  @IsNotEmpty()
  @IsString()
  @MaxLength(5000)
  content: string;

  @ApiProperty({ description: "Previous messages for context", type: [ContextMessageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContextMessageDto)
  context: ContextMessageDto[] = [];
}

@ApiTags("Guest Chat")
@Controller("chat/guest")
@UsePipes(new ValidationPipe())
export class GuestChatController {
  constructor(private readonly aiService: AiService) {}

  /**
   * Guest streaming endpoint - no authentication required
   * This endpoint allows guests to chat without saving to database
   * The frontend stores the conversation locally
   */
  @Post("stream")
  @ApiOperation({ summary: "Guest chat with streaming response (no auth required)" })
  @Sse("sse")
  async guestStream(
    @Body() dto: SendMessageDto,
  ): Promise<Observable<{ data: string }>> {
    // For guest users, we only send the current message without conversation context
    const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      { role: "user", content: dto.content },
    ];

    // Generate streaming response
    const aiResponse = (await this.aiService.generateResponse(
      messages,
      true,
    )) as AiStreamResponse;

    const stream = aiResponse.stream;

    return from(
      (async function* () {
        for await (const chunk of stream) {
          yield JSON.stringify(chunk as AiStreamChunk);
        }
      })(),
    ).pipe(map(data => ({ data })));
  }

  /**
   * Guest streaming with conversation context
   * Accepts previous messages for context
   */
  @Post("stream/with-context")
  @ApiOperation({ summary: "Guest chat with context and streaming response" })
  @Sse("sse")
  async guestStreamWithContext(
    @Body() dto: GuestChatWithContextDto,
  ): Promise<Observable<{ data: string }>> {
    // Build messages from context
    const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      ...dto.context.map(msg => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      { role: "user" as const, content: dto.content },
    ];

    // Generate streaming response
    const aiResponse = (await this.aiService.generateResponse(
      messages,
      true,
    )) as AiStreamResponse;

    const stream = aiResponse.stream;

    return from(
      (async function* () {
        for await (const chunk of stream) {
          yield JSON.stringify(chunk as AiStreamChunk);
        }
      })(),
    ).pipe(map(data => ({ data })));
  }
}
