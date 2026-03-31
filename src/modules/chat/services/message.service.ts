import { Injectable } from "@nestjs/common";
import { MessageRepository } from "../repositories/message.repository";
import { ConversationRepository } from "../repositories/conversation.repository";
import { AiService } from "./ai.service";
import { ChatService } from "./chat.service";
import { MessageEntity, MessageRole } from "../entities/message.entity";
import { SendMessageDto } from "../dtos/send-message.dto";
import { AiResponse, AiStreamChunk, AiStreamResponse } from "./ai-provider.interface";

function mergeThinkingMetadata(
  metadata: Record<string, unknown> | null | undefined,
  thinking: string[],
): Record<string, unknown> | undefined {
  if (thinking.length === 0) {
    return metadata ?? undefined;
  }

  return {
    ...(metadata ?? {}),
    thinking,
  };
}

@Injectable()
export class MessageService {
  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly aiService: AiService,
    private readonly chatService: ChatService,
  ) {}

  async sendMessage(
    conversationId: string,
    userId: string,
    dto: SendMessageDto,
    role = "",
  ): Promise<{ userMessage: MessageEntity; assistantMessage: MessageEntity }> {
    // Verify conversation exists and belongs to user
    const conversation = await this.chatService.getConversationById(
      conversationId,
      userId,
    );

    // Create user message
    const userTokenCount = this.aiService.countTokens(dto.content);
    const userMessage = this.messageRepository.create({
      conversationId,
      role: MessageRole.USER,
      content: dto.content,
      tokenCount: userTokenCount,
    });

    await this.messageRepository.save(userMessage);

    // Get context messages for AI
    const contextMessages = await this.chatService.getRecentMessagesForContext(
      conversationId,
      conversation.maxTokens * 0.7, // Use 70% of max tokens for context
    );

    // Generate AI response
    const aiResponse = (await this.aiService.generateResponse(
      contextMessages,
      false,
      role,
    )) as AiResponse;

    // Create assistant message
    const assistantMessage = this.messageRepository.create({
      conversationId,
      role: MessageRole.ASSISTANT,
      content: aiResponse.content,
      tokenCount: aiResponse.tokenCount,
    });

    await this.messageRepository.save(assistantMessage);

    // Update conversation token count
    await this.chatService.updateConversationTokens(conversationId);

    return {
      userMessage,
      assistantMessage,
    };
  }

  async sendMessageStreaming(
    conversationId: string,
    userId: string,
    dto: SendMessageDto,
    role = "",
  ): Promise<{
    userMessage: MessageEntity;
    stream: AsyncIterable<AiStreamChunk>;
  }> {
    // Verify conversation exists and belongs to user
    const conversation = await this.chatService.getConversationById(
      conversationId,
      userId,
    );

    // Create user message
    const userTokenCount = this.aiService.countTokens(dto.content);
    const userMessage = this.messageRepository.create({
      conversationId,
      role: MessageRole.USER,
      content: dto.content,
      tokenCount: userTokenCount,
    });

    await this.messageRepository.save(userMessage);

    // Get context messages for AI
    const contextMessages = await this.chatService.getRecentMessagesForContext(
      conversationId,
      conversation.maxTokens * 0.7,
    );

    // Generate AI streaming response
    const aiResponse = (await this.aiService.generateResponse(
      contextMessages,
      true,
      role,
    )) as AiStreamResponse;

    // We'll save the complete assistant message after streaming completes
    // For now, return the stream and userMessage
    return {
      userMessage,
      stream: this.wrapStreamWithSave(
        aiResponse.stream,
        conversationId,
      ),
    };
  }

  private async* wrapStreamWithSave(
    stream: AsyncIterable<AiStreamChunk>,
    conversationId: string,
  ): AsyncIterable<AiStreamChunk> {
    let fullContent = "";
    const thinkingSteps: string[] = [];

    for await (const chunk of stream) {
      if (chunk.type === "text") {
        fullContent += chunk.text;
      } else if (chunk.type === "trace") {
        const nextTrace = chunk.trace.trim();

        if (nextTrace && thinkingSteps.at(-1) !== nextTrace) {
          thinkingSteps.push(nextTrace);
        }
      }

      yield chunk;
    }

    // After streaming completes, save the assistant message
    const tokenCount = this.aiService.countTokens(fullContent);
    const assistantMessage = this.messageRepository.create({
      conversationId,
      role: MessageRole.ASSISTANT,
      content: fullContent,
      tokenCount,
      metadata: mergeThinkingMetadata(undefined, thinkingSteps),
    });

    await this.messageRepository.save(assistantMessage);
    await this.chatService.updateConversationTokens(conversationId);
  }

  async searchMessages(
    userId: string,
    keyword: string,
    filters: {
      conversationId?: string;
      startDate?: string;
      endDate?: string;
    },
    page: number,
    limit: number,
  ) {
    const { items, total } = await this.messageRepository.searchMessages(
      userId,
      keyword,
      filters,
      page,
      limit,
    );

    return {
      items,
      pagination: {
        page,
        pageSize: limit,
        totalItems: total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Start a new conversation with the first message (non-streaming)
   * Uses the user's message as the conversation title
   */
  async sendFirstMessage(
    userId: string,
    content: string,
    role = "",
  ): Promise<{
    conversation: import("../entities/conversation.entity").ConversationEntity;
    userMessage: MessageEntity;
    assistantMessage: MessageEntity;
  }> {
    // Create conversation with user's message as title (truncated to 100 chars)
    const title = content.length > 100 ? content.substring(0, 97) + "..." : content;
    const conversation = await this.chatService.createConversation(userId, { title });

    // Create and save user message
    const userTokenCount = this.aiService.countTokens(content);
    const userMessage = this.messageRepository.create({
      conversationId: conversation.id,
      role: MessageRole.USER,
      content,
      tokenCount: userTokenCount,
    });
    await this.messageRepository.save(userMessage);

    // Get context and generate AI response
    const contextMessages = await this.chatService.getRecentMessagesForContext(
      conversation.id,
      conversation.maxTokens * 0.7,
    );

    const aiResponse = (await this.aiService.generateResponse(
      contextMessages,
      false,
      role,
    )) as AiResponse;

    // Create assistant message
    const assistantMessage = this.messageRepository.create({
      conversationId: conversation.id,
      role: MessageRole.ASSISTANT,
      content: aiResponse.content,
      tokenCount: aiResponse.tokenCount,
    });
    await this.messageRepository.save(assistantMessage);

    // Update conversation token count
    await this.chatService.updateConversationTokens(conversation.id);

    return {
      conversation,
      userMessage,
      assistantMessage,
    };
  }

  /**
   * Start a new conversation with the first message (streaming)
   * Uses the user's message as the conversation title
   */
  async sendFirstMessageStreaming(
    userId: string,
    content: string,
    role = "",
  ): Promise<{
    conversation: import("../entities/conversation.entity").ConversationEntity;
    userMessage: MessageEntity;
    stream: AsyncIterable<AiStreamChunk>;
  }> {
    // Create conversation with user's message as title (truncated to 100 chars)
    const title = content.length > 100 ? content.substring(0, 97) + "..." : content;
    const conversation = await this.chatService.createConversation(userId, { title });

    // Create and save user message
    const userTokenCount = this.aiService.countTokens(content);
    const userMessage = this.messageRepository.create({
      conversationId: conversation.id,
      role: MessageRole.USER,
      content,
      tokenCount: userTokenCount,
    });
    await this.messageRepository.save(userMessage);

    // Get context and generate AI streaming response
    const contextMessages = await this.chatService.getRecentMessagesForContext(
      conversation.id,
      conversation.maxTokens * 0.7,
    );

    const aiResponse = (await this.aiService.generateResponse(
      contextMessages,
      true,
      role,
    )) as AiStreamResponse;

    return {
      conversation,
      userMessage,
      stream: this.wrapStreamWithSave(aiResponse.stream, conversation.id),
    };
  }
}
